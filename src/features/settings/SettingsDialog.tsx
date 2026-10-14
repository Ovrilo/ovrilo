import { Keyboard, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useSession } from "../../auth/SessionContext";
import { Dialog } from "../../components/Dialog";
import { PicturePicker } from "../../components/PicturePicker";
import { Avatar } from "../../components/ui";
import { uploadImage } from "../../media/upload";
import { keyFromCode, keyFromMouseButton, type PushToTalkKey } from "../voice/keys";
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
      <InputMode />
      <p className="muted small">
        Changes apply immediately, also during a call. Echo cancellation, noise suppression and automatic gain are always
        on for now.
      </p>
    </div>
  );
}

function InputMode() {
  const { snapshot } = useVoice();
  const [binding, setBinding] = useState(false);
  const key = snapshot.pushToTalkKey;

  const choose = (next: PushToTalkKey) => {
    setBinding(false);
    void voice.setPushToTalk(true, next);
  };

  return (
    <fieldset className="input-mode">
      <legend>Input mode</legend>
      <label className="radio">
        <input
          type="radio"
          name="input-mode"
          checked={!snapshot.pushToTalk}
          onChange={() => void voice.setPushToTalk(false, key)}
        />
        Voice activity <span className="muted small">— your microphone is open while unmuted</span>
      </label>
      <label className="radio">
        <input
          type="radio"
          name="input-mode"
          checked={snapshot.pushToTalk}
          onChange={() => (key ? void voice.setPushToTalk(true, key) : setBinding(true))}
        />
        Push to talk <span className="muted small">— hold a key to talk, also while a game has focus</span>
      </label>
      <div className="ptt-key">
        <span className="muted small">Push-to-talk key</span>
        {binding ? (
          <KeyCapture onKey={choose} onCancel={() => setBinding(false)} />
        ) : (
          <button className="with-icon" onClick={() => setBinding(true)}>
            <Keyboard size={14} aria-hidden="true" />
            {key ? key.label : "Set a key"}
          </button>
        )}
      </div>
      <p className="muted small">
        The key still reaches your game. Mouse side buttons work too. Games running as administrator may need Ovrilo
        to run as administrator as well.
      </p>
    </fieldset>
  );
}

/** Waits for one key press or middle/side mouse button. Escape cancels. */
function KeyCapture({ onKey, onCancel }: { onKey: (key: PushToTalkKey) => void; onCancel: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") return onCancel();
      const key = keyFromCode(event.code);
      if (key) onKey(key);
    };
    const onMouseDown = (event: MouseEvent) => {
      const key = keyFromMouseButton(event.button);
      if (key) {
        event.preventDefault();
        onKey(key);
      }
    };
    // Capture phase so the dialog's own Escape handling does not close it first.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [onKey, onCancel]);

  return (
    <span className="key-capture" role="status">
      Press a key or mouse side button… <span className="muted small">(Esc to cancel)</span>
    </span>
  );
}

function AccountSettings({ user }: { user: Schemas["CurrentUserResponse"] }) {
  const { session } = useSession();
  const api = useApi();

  const setAvatar = async (file: File) => {
    const assetId = await uploadImage(api, file, "avatar");
    const { data, error } = await api.PUT("/users/me/avatar", { body: { assetId } });
    if (!data) throw error;
    session.updateUser(data);
  };
  const removeAvatar = async () => {
    const { data, error } = await api.DELETE("/users/me/avatar");
    if (!data) throw error;
    session.updateUser(data);
  };

  return (
    <div className="settings-section">
      <div className="account-card">
        <Avatar name={user.displayName} assetId={user.avatarAssetId} size="lg" animate="always" />
        <div>
          <strong>{user.displayName}</strong>
          <span className="muted">@{user.username}</span>
        </div>
      </div>
      <PicturePicker
        preview={null}
        hasPicture={user.avatarAssetId !== null}
        onUpload={setAvatar}
        onRemove={removeAvatar}
        hint="PNG, JPEG, WebP or GIF. Animated GIFs up to 8 MB play when someone points at your picture."
      />
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
