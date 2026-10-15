import {
  Copy,
  Headphones,
  HeadphoneOff,
  type LucideIcon,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { lazy, type MouseEvent, Suspense, useEffect, useState } from "react";

import { problemMessage, type Schemas } from "../../api/client";
import { Dialog } from "../../components/Dialog";
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

/** A focused stream that went away is kept this long: changing quality republishes the share. */
const ENDED_STREAM_GRACE_MS = 4000;

// The LiveKit web client is loaded only when someone watches a stream.
const StreamPlayer = lazy(() => import("./StreamPlayer").then((m) => ({ default: m.StreamPlayer })));

/** A live screen share, shown as its own tile next to the people (ADR-0017). */
interface Stream {
  /** The sharer's user ID. */
  id: string;
  name: string;
  /** Your own share (watched as a preview, its sound never played back). */
  self: boolean;
  /** Shares the application's sound. */
  audio: boolean;
  /** What your own share shows, for its tile and player. */
  detail?: string;
}

interface Person {
  id: string;
  name: string;
  assetId: string | null | undefined;
  speaking: boolean;
  /** Muted for this client only (a speaking ring turns red). */
  mutedForMe: boolean;
  state: "muted" | "deafened" | "no-mic" | "muted-for-me" | null;
  live: boolean;
  volume: number;
  self: boolean;
}

const PERSON_STATE: Record<NonNullable<Person["state"]>, { icon: LucideIcon; label: string }> = {
  muted: { icon: MicOff, label: "Muted" },
  deafened: { icon: HeadphoneOff, label: "Deafened" },
  "no-mic": { icon: MicOff, label: "No microphone" },
  "muted-for-me": { icon: VolumeX, label: "Muted for you" },
};

/** Main pane of a voice channel (DESIGN.md §5.2): people and streams as tiles, one stream in focus. */
export function VoiceRoom({ channel, user, otherChannelName, join }: VoiceRoomProps) {
  const { snapshot, lastError, canShareScreen } = useVoice();
  const quality = useVoiceQuality();
  const [menu, setMenu] = useState<ParticipantMenuTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const [focused, setFocused] = useState<Stream | null>(null);
  // Participants are user IDs from the voice engine; pictures come from the members list.
  const avatars = useMemberAvatars(channel.communityId);
  const voiceStates = useVoiceStates(channel.communityId);
  const here = voiceAvailable && snapshot.channelId === channel.id && snapshot.connection !== "disconnected";

  // Who is live: from the engine while we are in the room, otherwise from the server.
  const share = here ? snapshot.screenShare : null;
  const streams: Stream[] = here
    ? [
        ...(share
          ? [{ id: user.id, name: user.displayName, self: true, audio: share.audio, detail: `${share.title} · ${share.preset}` }]
          : []),
        ...snapshot.participants
          .filter((p) => p.screenSharing)
          .map((p) => ({ id: p.id, name: p.name, self: false, audio: p.screenAudio })),
      ]
    : (voiceStates.data?.find((s) => s.channelId === channel.id)?.participants ?? [])
        .filter((p) => p.screenSharing && p.userId !== user.id)
        .map((p) => ({ id: p.userId, name: p.displayName, self: false, audio: false }));

  // A focused stream that ended returns to the grid (after a grace period for quality changes).
  const focusedLive = focused !== null && streams.some((s) => s.id === focused.id);
  useEffect(() => {
    if (focused === null || focusedLive) return;
    const timer = setTimeout(() => setFocused(null), ENDED_STREAM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [focused, focusedLive]);

  // The watched share's sound plays in the engine (only while we are in this room, never our own).
  const watchedSound = here && focused && !focused.self ? focused.id : null;
  useEffect(() => {
    if (!here) return;
    void voice.watchScreenShare(watchedSound);
    return () => void voice.watchScreenShare(null);
  }, [here, watchedSound]);

  const sharer = focused && !focused.self ? snapshot.participants.find((p) => p.id === focused.id) : undefined;
  const player = focused && (
    <Suspense
      fallback={
        <section className="stream-player">
          <div className="stream-player-message">Opening the stream…</div>
        </section>
      }
    >
      <StreamPlayer
        key={focused.id}
        channelId={channel.id}
        participantId={focused.id}
        title={focused.self ? `Your stream${focused.detail ? ` · ${focused.detail}` : ""}` : focused.name}
        sound={
          here && sharer?.screenAudio
            ? { volume: sharer.screenVolume, setVolume: (percent) => void voice.setScreenVolume(sharer.id, percent) }
            : null
        }
        onClose={() => setFocused(null)}
      />
    </Suspense>
  );
  const streamTiles = (compact: boolean) =>
    streams.map((s) => (
      <StreamTile
        key={`stream-${s.id}`}
        stream={s}
        compact={compact}
        active={focused?.id === s.id}
        onWatch={() => setFocused(focused?.id === s.id ? null : s)}
      />
    ));

  if (!voiceAvailable) {
    return (
      <div className="call">
        <p className="call-note">
          <Volume2 size={16} aria-hidden="true" /> Voice chat needs the Ovrilo desktop app. You can still watch screen
          shares here.
        </p>
        {player ? (
          <div className="call-focus">
            {player}
            {streams.length > 1 && <ul className="call-strip">{streamTiles(true)}</ul>}
          </div>
        ) : streams.length > 0 ? (
          <ul className="call-grid">{streamTiles(false)}</ul>
        ) : (
          <div className="empty-state">
            <Monitor size={32} aria-hidden="true" />
            <p className="muted">Nobody is sharing their screen right now.</p>
          </div>
        )}
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
    const card = (
      <div className={`voice-lobby-card${player ? " compact" : ""}`}>
        {!player && (
          <span className="voice-lobby-icon" aria-hidden="true">
            <Volume2 size={28} />
          </span>
        )}
        {!player && <h2>{channel.name}</h2>}
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
    );
    return player ? (
      <div className="call">
        <div className="call-focus">
          {player}
          {streams.length > 1 && <ul className="call-strip">{streamTiles(true)}</ul>}
        </div>
        {card}
      </div>
    ) : (
      <div className="voice-lobby">
        {streams.length > 0 && (
          <section className="lobby-streams" aria-label="Live now">
            <ul className="call-grid">{streamTiles(false)}</ul>
          </section>
        )}
        {card}
      </div>
    );
  }

  const micOff = snapshot.microphoneMuted || snapshot.deafened;
  // Deafened also mutes; unmuting while deafened undeafens (as in Discord).
  const toggleMute = () =>
    void (snapshot.deafened ? voice.setDeafened(false) : voice.setMuted(!snapshot.microphoneMuted));
  const people: Person[] = [
    {
      id: user.id,
      name: user.displayName,
      assetId: user.avatarAssetId,
      speaking: snapshot.selfSpeaking,
      mutedForMe: false,
      state: snapshot.deafened
        ? "deafened"
        : snapshot.microphoneMuted
          ? "muted"
          : snapshot.microphoneActive
            ? null
            : "no-mic",
      live: share !== null,
      volume: 100,
      self: true,
    },
    ...snapshot.participants.map(
      (p): Person => ({
        id: p.id,
        name: p.name,
        assetId: avatars.get(p.id),
        speaking: p.speaking,
        mutedForMe: p.locallyMuted,
        state: p.locallyMuted ? "muted-for-me" : p.muted ? "muted" : null,
        live: p.screenSharing,
        volume: p.volume,
        self: false,
      }),
    ),
  ];
  const openMenu = (person: Person) =>
    person.self
      ? undefined
      : (e: MouseEvent) => {
          e.preventDefault();
          setMenu({ participantId: person.id, x: e.clientX, y: e.clientY });
        };
  const tiles = (compact: boolean) => [
    ...streamTiles(compact),
    ...people.map((p) => <PersonTile key={p.id} person={p} compact={compact} onContextMenu={openMenu(p)} />),
  ];

  return (
    <div className="call">
      <header className="call-header">
        <span className={`status-pill status-${snapshot.connection}`}>{STATUS[snapshot.connection]}</span>
        {snapshot.connection === "connected" && (
          <button className="quality-button" onClick={() => setDetails(true)} title="Connection details">
            <QualityBadge summary={quality} />
          </button>
        )}
        {snapshot.connection === "connected" && !snapshot.microphoneActive && (
          <span className="voice-warning">Listen-only: no microphone could be opened.</span>
        )}
      </header>
      {errors}

      {player ? (
        <div className="call-focus">
          {player}
          <ul className="call-strip" aria-label="Participants">
            {tiles(true)}
          </ul>
        </div>
      ) : (
        <ul className="call-grid" aria-label="Participants">
          {tiles(false)}
        </ul>
      )}
      {snapshot.participants.length === 0 && !player && (
        <p className="muted voice-alone">Nobody else is here yet. Invite friends from the community menu.</p>
      )}

      <div className="call-controls" role="toolbar" aria-label="Voice controls">
        <RoundButton icon={micOff ? MicOff : Mic} label={micOff ? "Unmute" : "Mute"} pressed={micOff} onClick={toggleMute} />
        <RoundButton
          icon={snapshot.deafened ? HeadphoneOff : Headphones}
          label={snapshot.deafened ? "Undeafen" : "Deafen"}
          pressed={snapshot.deafened}
          onClick={() => void voice.setDeafened(!snapshot.deafened)}
        />
        {canShareScreen && (
          <RoundButton
            icon={ScreenShare}
            label={share ? "Change what you share" : "Share your screen"}
            tone={share ? "live" : "default"}
            onClick={() => setPicking(true)}
          />
        )}
        {share && <RoundButton icon={ScreenShareOff} label="Stop sharing" onClick={() => void voice.stopScreenShare()} />}
        <RoundButton icon={PhoneOff} label="Leave voice" tone="danger" onClick={() => void voice.leave()} />
      </div>

      {details && <ConnectionDetails summary={quality} onClose={() => setDetails(false)} />}
      {menu && <ParticipantMenu target={menu} onClose={() => setMenu(null)} />}
      {picking && <ScreenSharePicker onClose={() => setPicking(false)} />}
    </div>
  );
}

function StreamTile({
  stream,
  compact,
  active,
  onWatch,
}: {
  stream: Stream;
  compact: boolean;
  active: boolean;
  onWatch: () => void;
}) {
  const action = active ? "Watching" : stream.self ? "Preview your stream" : "Watch stream";
  return (
    <li className={`call-tile stream-tile${compact ? " compact" : ""}${active ? " active" : ""}`}>
      <button
        type="button"
        className="stream-tile-button"
        aria-pressed={active}
        aria-label={`${action}: ${stream.self ? "your screen" : `${stream.name}'s screen`}`}
        title={stream.detail}
        onClick={onWatch}
      >
        <Monitor size={compact ? 20 : 32} aria-hidden="true" />
        {!compact && <span className="stream-tile-action">{action}</span>}
      </button>
      <span className="live-badge call-tile-corner">LIVE</span>
      <span className="call-tile-label">
        {stream.audio && <Volume2 size={12} aria-hidden="true" />}
        <span className="call-tile-name">{stream.self ? "Your stream" : stream.name}</span>
      </span>
    </li>
  );
}

function PersonTile({
  person,
  compact,
  onContextMenu,
}: {
  person: Person;
  compact: boolean;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const ring = person.speaking ? (person.mutedForMe ? " speaking muted" : " speaking") : "";
  const state = person.state ? PERSON_STATE[person.state] : null;
  return (
    <li
      className={`call-tile person-tile avatar-hover-scope${compact ? " compact" : ""}${ring}`}
      title={onContextMenu ? "Right-click for volume" : undefined}
      onContextMenu={onContextMenu}
    >
      <Avatar
        name={person.name}
        assetId={person.assetId}
        size={compact ? "md" : "lg"}
        speaking={person.speaking}
        muted={person.mutedForMe}
      />
      {person.live && <span className="live-badge call-tile-corner">LIVE</span>}
      <span className="call-tile-label">
        {state && (
          <span className="call-tile-state" title={state.label}>
            <state.icon size={12} aria-hidden="true" />
            <span className="visually-hidden">{state.label}, </span>
          </span>
        )}
        <span className="call-tile-name">
          {person.name}
          {person.self && " (you)"}
        </span>
        {!person.self && !person.mutedForMe && person.volume !== 100 && (
          <span className="participant-volume">{person.volume}%</span>
        )}
        {person.speaking && <span className="visually-hidden">, speaking</span>}
      </span>
    </li>
  );
}

function RoundButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  tone?: "default" | "danger" | "live";
}) {
  return (
    <button
      type="button"
      className={`round-control tone-${tone}${pressed ? " is-on" : ""}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

function ConnectionDetails({ summary, onClose }: { summary: QualitySummary; onClose: () => void }) {
  const { stats, statsLogPath } = useVoice();
  const [copied, setCopied] = useState(false);
  const last = stats[stats.length - 1];
  const fmt = (value: number | null | undefined, unit: string) => (value == null ? "—" : `${Math.round(value)} ${unit}`);

  return (
    <Dialog title="Connection details" onClose={onClose}>
      <div className="connection-details">
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
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
