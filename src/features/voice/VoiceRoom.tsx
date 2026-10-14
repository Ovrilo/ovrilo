import { ChevronDown, Copy, Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { useState } from "react";

import { problemMessage, type Schemas } from "../../api/client";
import { Avatar } from "../../components/ui";
import { QualityBadge } from "./QualityBadge";
import type { QualitySummary } from "./quality";
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

/** Main pane of a voice channel (DESIGN.md §5.2). */
export function VoiceRoom({ channel, user, otherChannelName, join }: VoiceRoomProps) {
  const { snapshot, lastError } = useVoice();
  const quality = useVoiceQuality();
  const here = snapshot.channelId === channel.id && snapshot.connection !== "disconnected";

  if (!voiceAvailable) {
    return (
      <div className="empty-state">
        <Volume2 size={32} aria-hidden="true" />
        <p className="muted">Voice needs the desktop app. Run it with `pnpm tauri dev`.</p>
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

      <ul className="participant-grid" aria-label="Participants">
        <li className={`participant-tile self${snapshot.selfSpeaking ? " speaking" : ""}`}>
          <Avatar name={user.displayName} size="lg" speaking={snapshot.selfSpeaking} />
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
          <li key={p.id} className={`participant-tile${p.speaking ? " speaking" : ""}`}>
            <Avatar name={p.name} size="lg" speaking={p.speaking} />
            <span className="participant-name">
              {p.name}
              {p.speaking && <span className="visually-hidden">, speaking</span>}
            </span>
          </li>
        ))}
      </ul>
      {snapshot.participants.length === 0 && (
        <p className="muted voice-alone">Nobody else is here yet. Invite friends from the community menu.</p>
      )}

      <div className="voice-room-controls">
        <button
          className={`control ${snapshot.microphoneMuted ? "is-on" : ""}`}
          aria-pressed={snapshot.microphoneMuted}
          onClick={() => void voice.setMuted(!snapshot.microphoneMuted)}
        >
          {snapshot.microphoneMuted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
          {snapshot.microphoneMuted ? "Unmute" : "Mute"}
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
        <button className="control danger" onClick={() => void voice.leave()}>
          <PhoneOff size={18} aria-hidden="true" />
          Leave
        </button>
      </div>

      <ConnectionDetails summary={quality} />
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
