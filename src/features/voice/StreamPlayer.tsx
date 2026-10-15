import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize, Minimize, Volume2, VolumeX, X } from "lucide-react";
import {
  DisconnectReason,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { problemMessage } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { IconButton } from "../../components/ui";
import { formatStats, type StreamStats, summarizeInbound } from "./streamStats";

/** How often the received size, frame rate and bitrate are refreshed. */
const STATS_EVERY_MS = 2000;
/** Controls fade out after the pointer rests this long over a playing stream. */
const CONTROLS_IDLE_MS = 2500;

type Status = "connecting" | "waiting" | "playing" | "ended" | "unsupported" | "error";

const MESSAGES: Record<Exclude<Status, "playing" | "unsupported">, string> = {
  connecting: "Connecting to the stream…",
  waiting: "Waiting for the stream…",
  ended: "The stream has ended.",
  error: "The stream could not be opened.",
};

/** Whether this webview can decode a codec (`video/AV1`); unknown counts as yes. */
function canDecode(mimeType: string): boolean {
  const codecs =
    typeof RTCRtpReceiver !== "undefined" && typeof RTCRtpReceiver.getCapabilities === "function"
      ? RTCRtpReceiver.getCapabilities("video")?.codecs
      : undefined;
  return !codecs || codecs.some((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
}

/** Element full screen fills only the window in WebView2; the window follows it in the app. */
function setWindowFullscreen(on: boolean) {
  if (isTauri()) void getCurrentWindow().setFullscreen(on).catch(() => undefined);
}

type Api = ReturnType<typeof useApi>;

/** The shared connection stays this long after the last player closes, for a quick switch back. */
const RELEASE_AFTER_MS = 3000;

interface Viewer {
  channelId: string;
  room: Room;
  ready: Promise<void>;
  users: number;
  closeTimer?: ReturnType<typeof setTimeout>;
}

/**
 * One hidden viewer connection per channel, shared by players. Every viewer connection of a user
 * has the same identity (`{userId}#viewer`), so a second one would push the first out of the room
 * and could fail while doing so: switching streams changes subscriptions instead of reconnecting.
 */
let viewer: Viewer | null = null;

function forgetViewer(entry: Viewer) {
  if (viewer === entry) viewer = null;
}

function closeViewer(entry: Viewer) {
  clearTimeout(entry.closeTimer);
  forgetViewer(entry);
  void entry.room.disconnect();
}

function acquireViewer(api: Api, channelId: string): Viewer {
  if (viewer?.channelId === channelId) {
    clearTimeout(viewer.closeTimer);
    viewer.users += 1;
    return viewer;
  }
  if (viewer) closeViewer(viewer);
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const connect = async () => {
    const { data, error } = await api.POST("/channels/{channelId}/voice/watch", { params: { path: { channelId } } });
    if (!data) throw error;
    await room.connect(data.serverUrl, data.token, { autoSubscribe: false });
  };
  const entry: Viewer = { channelId, room, users: 1, ready: connect() };
  // A connection that failed or dropped is not reused: the next player connects again.
  entry.ready.catch(() => forgetViewer(entry));
  room.on(RoomEvent.Disconnected, () => forgetViewer(entry));
  viewer = entry;
  return entry;
}

function releaseViewer(entry: Viewer) {
  entry.users -= 1;
  if (entry.users <= 0) entry.closeTimer = setTimeout(() => closeViewer(entry), RELEASE_AFTER_MS);
}

export interface StreamPlayerProps {
  channelId: string;
  /** The sharer's user ID (their SFU identity). */
  participantId: string;
  /** Shown in the top bar, for example "Ada" or "Your stream · Game". */
  title: string;
  /** Sound controls when the share's sound plays here (in the room, not your own share). */
  sound: { volume: number; setVolume: (percent: number) => void } | null;
  onClose: () => void;
}

/**
 * Plays one screen share (ADR-0017), also your own as a preview. The webview watches over its own
 * hidden, subscribe-only connection (`{userId}#viewer`, from `POST /channels/{id}/voice/watch`)
 * and subscribes to that share's video only; its sound plays in the voice engine.
 */
export function StreamPlayer({ channelId, participantId, title, sound, onClose }: StreamPlayerProps) {
  const api = useApi();
  const container = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let closed = false;
    let track: RemoteTrack | null = null;
    let previous: StreamStats | null = null;
    const statsTimer = setInterval(() => {
      void track?.getRTCStatsReport().then((report) => {
        if (closed || !report) return;
        previous = summarizeInbound(report, previous, Date.now()) ?? previous;
        setStats(previous);
      });
    }, STATS_EVERY_MS);
    const fail = (status: Status, text: string | null) => {
      setMessage(text);
      setStatus(status);
    };
    const show = (subscribed: RemoteTrack) => {
      if (!video.current) return;
      track = subscribed;
      subscribed.attach(video.current);
      fail("playing", null);
    };
    const entry = acquireViewer(api, channelId);
    const room = entry.room;
    const isTheShare = (publication: RemoteTrackPublication, participant: RemoteParticipant) =>
      participant.identity === participantId && publication.source === Track.Source.ScreenShare;
    const current = () =>
      room.remoteParticipants.get(participantId)?.getTrackPublication(Track.Source.ScreenShare) as
        | RemoteTrackPublication
        | undefined;
    const subscribe = (publication: RemoteTrackPublication | undefined) => {
      if (!publication) {
        fail("waiting", null);
        return;
      }
      // Streams tuned for text use AV1; say so instead of showing a black picture.
      if (publication.mimeType && !canDecode(publication.mimeType)) {
        const codec = publication.mimeType.replace(/^video\//i, "").toUpperCase();
        fail("unsupported", `This stream uses ${codec}, which this device cannot play. Ask them to share with "Smooth motion".`);
        return;
      }
      publication.setSubscribed(true);
      if (publication.track) show(publication.track);
    };

    const onSubscribed = (subscribed: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (isTheShare(publication, participant)) show(subscribed);
    };
    const onPublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (isTheShare(publication, participant)) subscribe(publication);
    };
    const onUnpublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      // A quality change republishes the share: wait for the new track instead of ending.
      if (!isTheShare(publication, participant)) return;
      track = null;
      setStats(null);
      fail("waiting", null);
    };
    const onLeft = (participant: RemoteParticipant) => {
      if (participant.identity === participantId) fail("ended", null);
    };
    const onJoined = (participant: RemoteParticipant) => {
      if (participant.identity === participantId) subscribe(current());
    };
    const onDisconnected = (reason?: DisconnectReason) => {
      const why = reason === undefined ? "unknown" : (DisconnectReason[reason] ?? String(reason));
      fail("error", `${MESSAGES.error} (disconnected: ${why})`);
    };
    room
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackPublished, onPublished)
      .on(RoomEvent.TrackUnpublished, onUnpublished)
      .on(RoomEvent.ParticipantDisconnected, onLeft)
      .on(RoomEvent.ParticipantConnected, onJoined)
      .on(RoomEvent.Disconnected, onDisconnected);

    entry.ready.then(
      () => {
        if (!closed) subscribe(current());
      },
      (e: unknown) => {
        if (closed) return;
        // API problems carry a title; LiveKit connection errors only a message.
        console.error("screen share viewer", e);
        fail("error", e instanceof Error ? `${MESSAGES.error} (${e.message})` : problemMessage(e, MESSAGES.error));
      },
    );

    return () => {
      closed = true;
      clearInterval(statsTimer);
      room
        .off(RoomEvent.TrackSubscribed, onSubscribed)
        .off(RoomEvent.TrackPublished, onPublished)
        .off(RoomEvent.TrackUnpublished, onUnpublished)
        .off(RoomEvent.ParticipantDisconnected, onLeft)
        .off(RoomEvent.ParticipantConnected, onJoined)
        .off(RoomEvent.Disconnected, onDisconnected);
      // Stop downloading this stream; the connection itself is shared.
      if (track && video.current) track.detach(video.current);
      current()?.setSubscribed(false);
      releaseViewer(entry);
    };
  }, [api, channelId, participantId, attempt]);

  // Leaving full screen with Escape (or by closing the player) also restores the window.
  useEffect(() => {
    let windowFullscreen = false;
    const follow = (on: boolean) => {
      if (on === windowFullscreen) return;
      windowFullscreen = on;
      setWindowFullscreen(on);
    };
    const changed = () => {
      const on = container.current !== null && document.fullscreenElement === container.current;
      setFullscreen(on);
      follow(on);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (container.current !== null && document.fullscreenElement === container.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
      follow(false);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void container.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
  };
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const playing = status === "playing";
  return (
    <section
      ref={container}
      className={`stream-player${playing && idle ? " idle" : ""}`}
      aria-label={title}
      onMouseMove={wake}
      onMouseLeave={() => setIdle(true)}
      onDoubleClick={toggleFullscreen}
    >
      <video ref={video} autoPlay playsInline muted className={playing ? "" : "hidden"} />
      {!playing && (
        <div className="stream-player-message" role="status">
          <p>{message ?? MESSAGES[status as Exclude<Status, "playing" | "unsupported">]}</p>
          {status === "error" && (
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setStatus("connecting");
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <div className="stream-player-bar top">
        <span className="live-badge">LIVE</span>
        <span className="stream-player-title">{title}</span>
        {playing && stats && <span className="stream-player-stats">{formatStats(stats)}</span>}
      </div>
      <div className="stream-player-bar bottom" onDoubleClick={(e) => e.stopPropagation()}>
        {sound && <StreamVolume {...sound} />}
        <span className="spacer" />
        <IconButton
          icon={fullscreen ? Minimize : Maximize}
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        />
        <IconButton icon={X} label="Close stream" onClick={onClose} />
      </div>
    </section>
  );
}

/**
 * Stream sound: mute toggle (remembers the level) and a 0–200 % slider. The level is saved when
 * the slider is released, not on every step.
 */
function StreamVolume({ volume, setVolume }: { volume: number; setVolume: (percent: number) => void }) {
  const [value, setValue] = useState(volume);
  const [restore, setRestore] = useState(volume > 0 ? volume : 100);
  useEffect(() => setValue(volume), [volume]);
  const muted = value === 0;
  const commit = () => {
    if (value !== volume) setVolume(value);
  };
  return (
    <div className="stream-volume">
      <IconButton
        icon={muted ? VolumeX : Volume2}
        label={muted ? "Unmute stream" : "Mute stream"}
        onClick={() => {
          if (!muted) setRestore(value);
          setVolume(muted ? restore : 0);
        }}
      />
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={value}
        aria-label="Stream volume"
        aria-valuetext={`${value} percent`}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="volume-value">{value}%</span>
    </div>
  );
}
