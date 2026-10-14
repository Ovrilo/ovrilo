import { LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { Schemas } from "../../api/client";
import { useSession } from "../../auth/SessionContext";
import { Dialog } from "../../components/Dialog";
import { Avatar } from "../../components/ui";
import { useVoice, voice, voiceAvailable, type VoiceDevice } from "../voice/voice";

type Tab = "audio" | "account";

export function SettingsDialog({ user, onClose }: { user: Schemas["CurrentUserResponse"]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("audio");
  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="settings">
        <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button role="tab" aria-selected={tab === "audio"} onClick={() => setTab("audio")}>
            Audio
          </button>
          <button role="tab" aria-selected={tab === "account"} onClick={() => setTab("account")}>
            Account
          </button>
        </nav>
        <div className="settings-body" role="tabpanel">
          {tab === "audio" ? <AudioSettings /> : <AccountSettings user={user} />}
        </div>
      </div>
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function AudioSettings() {
  const { snapshot } = useVoice();
  if (!voiceAvailable) {
    return <p className="muted">Audio devices are available in the desktop app.</p>;
  }
  return (
    <div className="settings-section">
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
      <button className="ghost with-icon" onClick={() => void voice.refreshDevices()}>
        <RefreshCw size={14} aria-hidden="true" /> Refresh devices
      </button>
      <p className="muted small">
        Changes apply immediately, also during a call. Echo cancellation, noise suppression and automatic gain are always
        on for now.
      </p>
    </div>
  );
}

function AccountSettings({ user }: { user: Schemas["CurrentUserResponse"] }) {
  const { session } = useSession();
  return (
    <div className="settings-section">
      <div className="account-card">
        <Avatar name={user.displayName} size="lg" />
        <div>
          <strong>{user.displayName}</strong>
          <span className="muted">@{user.username}</span>
        </div>
      </div>
      <button
        className="danger with-icon"
        onClick={() => {
          // The room grant belongs to this account; never stay connected after signing out.
          void voice.leave();
          void session.signOut();
        }}
      >
        <LogOut size={16} aria-hidden="true" /> Sign out
      </button>
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
