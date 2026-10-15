import {
  ChevronDown,
  Copy,
  Eye,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { problemMessage, type Schemas } from "../../api/client";
import { Avatar } from "../../components/ui";
import { useMemberAvatars, useVoiceStates } from "../shell/queries";
import { QualityBadge } from "./QualityBadge";
import type { QualitySummary } from "./quality";
import { ParticipantMenu, type ParticipantMenuTarget } from "./ParticipantMenu";
import { ScreenSharePicker } from "./ScreenSharePicker";
import { clearVoiceError, useVoice, useVoiceQuality, voice, voiceAvailable } from "./voice";

interface VoiceRoomProps {
  channel: Schemas["ChannelResponse"];
  user: Schemas["CurrentUserResponse"];
  /** Name of the voice channel the user is in, when it is a different one. */
  otherChannelName: string | null;
  join: { mutate: (channelId: string) => void; isPending: boolean; error: unknown };
}

const STATUS = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
} as const;

// The LiveKit web client is loaded only when someone watches a stream.
const ScreenShareViewer = lazy(() => import("./ScreenShareViewer").then((m) => ({ default: m.ScreenShareViewer })));

interface Sharer {
  id: string;
  name: string;
}

/** Main pane of a voice channel (DESIGN.md §5.2). */
export function VoiceRoom({ channel, user, otherChannelName, join }: VoiceRoomProps) {
  const { snapshot, lastError, canShareScreen } = useVoice();
  const quality = useVoiceQuality();
  const [menu, setMenu] = useState<ParticipantMenuTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [watching, setWatching] = useState<Sharer | null>(null);
  // Participants are user IDs from the voice engine; pictures come from the members list.
  const avatars = useMemberAvatars(channel.communityId);
  const voiceStates = useVoiceStates(channel.communityId);
  const here = snapshot.channelId === channel.id && snapshot.connection !== "disconnected";

  // Who is live: from the engine while we are in the room, otherwise from the server.
  const sharers: Sharer[] = here
    ? snapshot.participants.filter((p) => p.screenSharing).map((p) => ({ id: p.id, name: p.name }))
    : (voiceStates.data?.find((s) => s.channelId === channel.id)?.participants ?? [])
        .filter((p) => p.screenSharing && p.userId !== user.id)
        .map((p) => ({ id: p.userId, name: p.displayName }));

  // The watched share's sound plays in the engine (only while we are in this room).
  useEffect(() => {
    if (!here) return;
    void voice.watchScreenShare(watching?.id ?? null);
    return () => void voice.watchScreenShare(null);
  }, [here, watching?.id]);

  const stage = watching && (
    <Suspense fallback={<p className="muted">Opening the stream…</p>}>
      <ScreenShareViewer
        key={watching.id}
        channelId={channel.id}
        participantId={watching.id}
        name={watching.name}
        onClose={() => setWatching(null)}
      />
    </Suspense>
  );
  const liveList = !watching && sharers.length > 0 && (
    <ul className="live-list" aria-label="Live now">
      {sharers.map((s) => (
        <li key={s.id}>
          <span className="live-badge">LIVE</span>
          <span>{s.name} is sharing their screen</span>
          <button className="with-icon" onClick={() => setWatching(s)}>
            <Eye size={14} aria-hidden="true" /> Watch
          </button>
        </li>
      ))}
    </ul>
  );

  if (!voiceAvailable) {
    return (
      <div className="voice-room">
        {stage}
        {liveList}
        <div className="empty-state">
          <Volume2 size={32} aria-hidden="true" />
          <p className="muted">Voice needs the desktop app. Run it with `pnpm tauri dev`.</p>
        </div>
      </div>
    );
  }

  const errors = (
    <>
      {join.error ? (
        <p className="form-error" role="alert">
          {problemMessage(join.error, "Could not join voice.")}
        </p>
      ) : null}
      {lastError && (
        <p className="form-error" role="alert">
          {lastError.message}{" "}
          <button className="link" onClick={clearVoiceError}>
            Dismiss
          </button>
        </p>
      )}
    </>
  );

  if (!here) {
    return (
      <div className="voice-lobby">
        {stage}
        {liveList}
        <div className="voice-lobby-card">
          <span className="voice-lobby-icon" aria-hidden="true">
            <Volume2 size={28} />
          </span>
          <h2>{channel.name}</h2>
          <p className="muted">
            {otherChannelName
              ? `You are in ${otherChannelName}. Switching leaves that channel.`
              : "Join to talk with everyone in this channel."}
          </p>
          <button className="primary large" disabled={join.isPending} onClick={() => join.mutate(channel.id)}>
            {join.isPending ? "Joining…" : otherChannelName ? "Switch to this channel" : "Join voice"}
          </button>
          {errors}
        </div>
      </div>
    );
  }

  const selfMuted = snapshot.microphoneMuted || snapshot.deafened || !snapshot.microphoneActive;
  // Deafened also mutes; unmuting while deafened undeafens (as in Discord).
  const micOff = snapshot.microphoneMuted || snapshot.deafened;
  const toggleMute = () =>
    void (snapshot.deafened ? voice.setDeafened(false) : voice.setMuted(!snapshot.microphoneMuted));
  return (
    <div className="voice-room">
      <div className="voice-room-status">
        <span className={`status-pill status-${snapshot.connection}`}>{STATUS[snapshot.connection]}</span>
        {snapshot.connection === "connected" && <QualityBadge summary={quality} />}
        {snapshot.connection === "connected" && !snapshot.microphoneActive && (
          <span className="voice-warning">Listen-only: no microphone could be opened.</span>
        )}
      </div>
      {errors}

      {snapshot.screenShare && (
        <div className="sharing-banner" role="status">
          <span className="live-badge">LIVE</span>
          <span>
            You are sharing <strong>{snapshot.screenShare.title}</strong> · {snapshot.screenShare.preset} ·{" "}
            {snapshot.screenShare.audio ? "with sound" : "no sound"}
          </span>
          <button onClick={() => setPicking(true)}>Change</button>
          <button className="danger with-icon" onClick={() => void voice.stopScreenShare()}>
            <ScreenShareOff size={14} aria-hidden="true" /> Stop
          </button>
        </div>
      )}
      {stage}

      <ul className="participant-grid" aria-label="Participants">
        <li className={`participant-tile self${snapshot.selfSpeaking ? " speaking" : ""}`}>
          {snapshot.screenShare && <span className="live-badge tile-badge">LIVE</span>}
          <Avatar name={user.displayName} assetId={user.avatarAssetId} size="lg" speaking={snapshot.selfSpeaking} />
          <span className="participant-name">
            {user.displayName} (you)
            {snapshot.selfSpeaking && <span className="visually-hidden">, speaking</span>}
          </span>
          {selfMuted && (
            <span className="participant-state">
              {snapshot.deafened ? <HeadphoneOff size={14} aria-hidden="true" /> : <MicOff size={14} aria-hidden="true" />}
              {snapshot.deafened ? "Deafened" : snapshot.microphoneActive ? "Muted" : "No microphone"}
            </span>
          )}
        </li>
        {snapshot.participants.map((p) => (
          <li
            key={p.id}
            className={`participant-tile avatar-hover-scope${p.speaking ? (p.locallyMuted ? " speaking muted" : " speaking") : ""}`}
            title="Right-click for volume"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ participantId: p.id, x: e.clientX, y: e.clientY });
            }}
          >
            {p.screenSharing && <span className="live-badge tile-badge">LIVE</span>}
            <Avatar name={p.name} assetId={avatars.get(p.id)} size="lg" speaking={p.speaking} muted={p.locallyMuted} />
            <span className="participant-name">
              {p.name}
              {p.speaking && <span className="visually-hidden">, speaking</span>}
            </span>
            {p.locallyMuted ? (
              <span className="participant-state">
                <VolumeX size={14} aria-hidden="true" /> Muted for you
              </span>
            ) : p.muted ? (
              <span className="participant-state">
                <MicOff size={14} aria-hidden="true" /> Muted
              </span>
            ) : (
              p.volume !== 100 && <span className="participant-volume">{p.volume}%</span>
            )}
            {p.screenSharing && watching?.id !== p.id && (
              <button className="with-icon small-button" onClick={() => setWatching({ id: p.id, name: p.name })}>
                <Eye size={14} aria-hidden="true" /> Watch
              </button>
            )}
          </li>
        ))}
      </ul>
      {snapshot.participants.length === 0 && (
        <p className="muted voice-alone">Nobody else is here yet. Invite friends from the community menu.</p>
      )}

      <div className="voice-room-controls">
        <button
          className={`control ${micOff ? "is-on" : ""}`}
          aria-pressed={micOff}
          onClick={toggleMute}
        >
          {micOff ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
          {micOff ? "Unmute" : "Mute"}
        </button>
        <button
          className={`control ${snapshot.deafened ? "is-on" : ""}`}
          aria-pressed={snapshot.deafened}
          onClick={() => void voice.setDeafened(!snapshot.deafened)}
        >
          {snapshot.deafened ? (
            <HeadphoneOff size={18} aria-hidden="true" />
          ) : (
            <Headphones size={18} aria-hidden="true" />
          )}
          {snapshot.deafened ? "Undeafen" : "Deafen"}
        </button>
        {canShareScreen &&
          (snapshot.screenShare ? (
            <button className="control is-on" onClick={() => void voice.stopScreenShare()}>
              <ScreenShareOff size={18} aria-hidden="true" />
              Stop sharing
            </button>
          ) : (
            <button className="control" onClick={() => setPicking(true)}>
              <ScreenShare size={18} aria-hidden="true" />
              Share screen
            </button>
          ))}
        <button className="control danger" onClick={() => void voice.leave()}>
          <PhoneOff size={18} aria-hidden="true" />
          Leave
        </button>
      </div>

      <ConnectionDetails summary={quality} />
      {menu && <ParticipantMenu target={menu} onClose={() => setMenu(null)} />}
      {picking && <ScreenSharePicker onClose={() => setPicking(false)} />}
    </div>
  );
}

function ConnectionDetails({ summary }: { summary: QualitySummary }) {
  const { stats, statsLogPath } = useVoice();
  const [copied, setCopied] = useState(false);
  const last = stats[stats.length - 1];
  const fmt = (value: number | null | undefined, unit: string) => (value == null ? "—" : `${Math.round(value)} ${unit}`);

  return (
    <details className="connection-details">
      <summary>
        <ChevronDown size={14} aria-hidden="true" /> Connection details
      </summary>
      <p className="muted small">Last 10 seconds. Counters reset when you rejoin.</p>
      <dl>
        <dt>Latency (round trip)</dt>
        <dd>{fmt(summary.roundTripMs, "ms")}</dd>
        <dt>Jitter</dt>
        <dd>{fmt(summary.jitterMs, "ms")}</dd>
        <dt>Incoming packet loss</dt>
        <dd>{summary.lossPercent.toFixed(1)} %</dd>
        <dt>Robotic audio (network concealment)</dt>
        <dd>{fmt(summary.concealedMsPerSecond, "ms/s")}</dd>
        <dt>Playout gaps / skipped audio</dt>
        <dd>
          {summary.underruns} / {summary.skippedMs} ms
        </dd>
        <dt>Dropped frames</dt>
        <dd>{summary.droppedFrames}</dd>
        <dt>Playout buffer</dt>
        <dd>{fmt(last?.playoutBufferedMs, "ms")}</dd>
        <dt>Our packets lost (total)</dt>
        <dd>{last?.outboundPacketsLost ?? "—"}</dd>
      </dl>
      {statsLogPath && (
        <div className="log-path">
          <span className="muted small">Diagnostics are also saved to</span>
          <code title={statsLogPath}>{statsLogPath}</code>
          <button
            className="link"
            onClick={() =>
              void navigator.clipboard.writeText(statsLogPath).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            <Copy size={12} aria-hidden="true" /> {copied ? "Copied" : "Copy path"}
          </button>
        </div>
      )}
    </details>
  );
}
