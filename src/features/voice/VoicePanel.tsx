import { useMutation } from "@tanstack/react-query";

import { type Schemas, problemMessage } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { clearVoiceError, useVoice, voice, voiceAvailable, type VoiceDevice } from "./voice";

const connectionLabel = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
} as const;

/** Main pane of a voice channel: join/leave, participants, mute/deafen and device selection. */
export function VoicePanel({ channel }: { channel: Schemas["ChannelResponse"] }) {
  const api = useApi();
  const { snapshot, lastError } = useVoice();
  const inThisChannel = snapshot.channelId === channel.id && snapshot.connection !== "disconnected";
  const elsewhere = snapshot.channelId !== null && snapshot.channelId !== channel.id;

  const join = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/channels/{channelId}/voice/join", {
        params: { path: { channelId: channel.id } },
      });
      if (!data) throw error;
      await voice.join(channel.id, data.serverUrl, data.token);
    },
  });

  if (!voiceAvailable) {
    return (
      <div className="empty-state">
        <p className="muted">Voice needs the desktop app. Run it with `pnpm tauri dev`.</p>
      </div>
    );
  }

  return (
    <div className="voice-panel">
      <section className="voice-status">
        <span className={`voice-dot ${inThisChannel ? snapshot.connection : "disconnected"}`} aria-hidden="true" />
        <strong>{inThisChannel ? connectionLabel[snapshot.connection] : "Not connected"}</strong>
        {inThisChannel && snapshot.connection === "connected" && !snapshot.microphoneActive && (
          <span className="voice-warning">Listen-only: no microphone could be opened.</span>
        )}
      </section>

      {join.isError && <p className="form-error">{problemMessage(join.error, "Could not join voice.")}</p>}
      {lastError && (
        <p className="form-error" role="alert">
          {lastError.message}{" "}
          <button className="ghost" onClick={clearVoiceError}>
            Dismiss
          </button>
        </p>
      )}

      {inThisChannel ? (
        <>
          <section>
            <h3 className="voice-heading">In this channel</h3>
            <ul className="voice-participants">
              <li>
                You {snapshot.microphoneMuted || snapshot.deafened ? <span className="muted">(muted)</span> : null}
              </li>
              {snapshot.participants.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          </section>
          <div className="voice-controls">
            <button aria-pressed={snapshot.microphoneMuted} onClick={() => void voice.setMuted(!snapshot.microphoneMuted)}>
              {snapshot.microphoneMuted ? "Unmute" : "Mute"}
            </button>
            <button aria-pressed={snapshot.deafened} onClick={() => void voice.setDeafened(!snapshot.deafened)}>
              {snapshot.deafened ? "Undeafen" : "Deafen"}
            </button>
            <button className="danger" onClick={() => void voice.leave()}>
              Leave
            </button>
          </div>
        </>
      ) : (
        <div className="voice-controls">
          <button className="primary" disabled={join.isPending} onClick={() => join.mutate()}>
            {join.isPending ? "Joining…" : elsewhere ? "Switch to this channel" : "Join voice"}
          </button>
        </div>
      )}

      <section className="voice-devices">
        <h3 className="voice-heading">Devices</h3>
        <DeviceSelect
          label="Microphone"
          devices={snapshot.inputs}
          value={snapshot.inputDeviceId}
          onChange={(id) => void voice.setInputDevice(id)}
        />
        <DeviceSelect
          label="Speaker / headphones"
          devices={snapshot.outputs}
          value={snapshot.outputDeviceId}
          onChange={(id) => void voice.setOutputDevice(id)}
        />
        <button className="ghost" onClick={() => void voice.refreshDevices()}>
          Refresh devices
        </button>
      </section>
    </div>
  );
}

function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: VoiceDevice[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const defaultName = devices.find((d) => d.isDefault)?.name;
  return (
    <label>
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">System default{defaultName ? ` (${defaultName})` : ""}</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
