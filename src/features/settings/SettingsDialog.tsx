import { AudioLines, Headphones, Keyboard, LogOut, type LucideIcon, Mic, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useSession } from "../../auth/SessionContext";
import { Dialog } from "../../components/Dialog";
import { PicturePicker } from "../../components/PicturePicker";
import { Avatar, Select } from "../../components/ui";
import { uploadImage } from "../../media/upload";
import { keyFromCode, keyFromMouseButton, type PushToTalkKey } from "../voice/keys";
import { AboutSettings } from "./AboutSettings";
import {
  desktopNotificationsAvailable,
  setNotificationSettings,
  useNotificationSettings,
} from "../sounds/desktopNotifications";
import { playSound, setSoundSettings, SOUND_LABELS, type SoundKind, useSoundSettings } from "../sounds/sounds";
import { type NoiseSuppression, useVoice, voice, voiceAvailable, type VoiceDevice } from "../voice/voice";

type Tab = "audio" | "notifications" | "account" | "about";

export function SettingsDialog({ user, onClose }: { user: Schemas["CurrentUserResponse"]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("audio");
  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="settings">
        <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button role="tab" aria-selected={tab === "audio"} onClick={() => setTab("audio")}>
            Voice & audio
          </button>
          <button role="tab" aria-selected={tab === "notifications"} onClick={() => setTab("notifications")}>
            Notifications
          </button>
          <button role="tab" aria-selected={tab === "account"} onClick={() => setTab("account")}>
            Account
          </button>
          <button role="tab" aria-selected={tab === "about"} onClick={() => setTab("about")}>
            About
          </button>
        </nav>
        <div className="settings-body" role="tabpanel">
          {tab === "audio" ? (
            <AudioSettings />
          ) : tab === "notifications" ? (
            <SoundSettingsPage />
          ) : tab === "about" ? (
            <AboutSettings />
          ) : (
            <AccountSettings user={user} />
          )}
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
    <div className="settings-page">
      <section className="settings-group" aria-labelledby="settings-devices">
        <div className="settings-group-head">
          <h3 id="settings-devices">Devices</h3>
          <button className="ghost small-button with-icon" onClick={() => void voice.refreshDevices()}>
            <RefreshCw size={13} aria-hidden="true" /> Refresh
          </button>
        </div>
        <div className="device-grid">
          <DevicePanel
            icon={Mic}
            title="Microphone"
            devices={snapshot.inputs}
            deviceId={snapshot.inputDeviceId}
            onDevice={(id) => void voice.setInputDevice(id)}
            volume={snapshot.inputVolume}
            onVolume={(percent) => void voice.setInputVolume(percent)}
            volumeLabel="Input volume"
          />
          <DevicePanel
            icon={Headphones}
            title="Speaker or headphones"
            devices={snapshot.outputs}
            deviceId={snapshot.outputDeviceId}
            onDevice={(id) => void voice.setOutputDevice(id)}
            volume={snapshot.outputVolume}
            onVolume={(percent) => void voice.setOutputVolume(percent)}
            volumeLabel="Output volume"
          />
        </div>
      </section>
      <InputMode />
      <NoiseSuppressionSetting />
      <p className="muted small settings-footnote">
        Changes apply right away, also during a call. Echo cancellation and automatic gain are always on.
      </p>
    </div>
  );
}

function DevicePanel({
  icon: Icon,
  title,
  devices,
  deviceId,
  onDevice,
  volume,
  onVolume,
  volumeLabel,
}: {
  icon: LucideIcon;
  title: string;
  devices: VoiceDevice[];
  deviceId: string | null;
  onDevice: (id: string | null) => void;
  volume: number;
  onVolume: (percent: number) => void;
  volumeLabel: string;
}) {
  const defaultName = devices.find((d) => d.isDefault)?.name;
  return (
    <div className="device-panel">
      <div className="device-panel-title">
        <Icon size={16} aria-hidden="true" />
        <span>{title}</span>
      </div>
      <Select aria-label={title} value={deviceId ?? ""} onChange={(e) => onDevice(e.target.value || null)}>
        <option value="">System default{defaultName ? ` (${defaultName})` : ""}</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <VolumeSlider label={volumeLabel} value={volume} onCommit={onVolume} />
    </div>
  );
}

/** 0–200 %; shows the value while dragging and applies it when released (saved once, not per step). */
function VolumeSlider({ label, value, onCommit }: { label: string; value: number; onCommit: (percent: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="volume-slider">
      <span className="volume-slider-head">
        <span>{label}</span>
        <span className="volume-value">{draft}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={draft}
        aria-valuetext={`${draft} percent`}
        style={{ "--fill": `${draft / 2}%` } as React.CSSProperties}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
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
    <fieldset className="settings-group">
      <legend>Input mode</legend>
      <div className="choice-grid">
        <label className={`choice${!snapshot.pushToTalk ? " selected" : ""}`}>
          <input
            type="radio"
            name="input-mode"
            className="visually-hidden"
            checked={!snapshot.pushToTalk}
            onChange={() => void voice.setPushToTalk(false, key)}
          />
          <AudioLines size={18} aria-hidden="true" />
          <strong>Voice activity</strong>
          <span className="muted small">Your microphone is open while you are unmuted.</span>
        </label>
        <label className={`choice${snapshot.pushToTalk ? " selected" : ""}`}>
          <input
            type="radio"
            name="input-mode"
            className="visually-hidden"
            checked={snapshot.pushToTalk}
            onChange={() => (key ? void voice.setPushToTalk(true, key) : setBinding(true))}
          />
          <Keyboard size={18} aria-hidden="true" />
          <strong>Push to talk</strong>
          <span className="muted small">Hold a key to talk, also while a game has focus.</span>
        </label>
      </div>
      <div className="ptt-key">
        <span>Push-to-talk key</span>
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
        The key still reaches your game, and mouse side buttons work too. Games running as administrator may need
        Ovrilo to run as administrator as well.
      </p>
    </fieldset>
  );
}

const NOISE_OPTIONS: { value: NoiseSuppression; label: string; hint: string }[] = [
  { value: "standard", label: "Standard", hint: "Reduces steady noise such as fans and hum. Clicks still come through." },
  {
    value: "enhanced",
    label: "Enhanced (beta)",
    hint: "Also removes keyboard and mouse clicks and keeps your microphone silent between words. Still being tuned: it can cut off parts of what you say.",
  },
  { value: "off", label: "Off", hint: "Sends your microphone as it is." },
];

function NoiseSuppressionSetting() {
  const { snapshot } = useVoice();
  const chosen = snapshot.noiseSuppression;
  const fellBack = chosen === "enhanced" && snapshot.noiseSuppressionActive !== "enhanced";
  const hint = NOISE_OPTIONS.find((o) => o.value === chosen)?.hint;

  return (
    <fieldset className="settings-group">
      <legend>Noise suppression</legend>
      <div className="segmented" role="radiogroup" aria-label="Noise suppression">
        {NOISE_OPTIONS.map((option) => (
          <label key={option.value} className={chosen === option.value ? "selected" : undefined}>
            <input
              type="radio"
              name="noise-suppression"
              className="visually-hidden"
              checked={chosen === option.value}
              onChange={() => void voice.setNoiseSuppression(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="muted small">{hint}</p>
      {fellBack && (
        <p className="form-error small" role="status">
          Enhanced is not running: this computer could not keep up, so Standard is used. Choose Enhanced again to retry.
        </p>
      )}
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

const SOUND_GROUPS: { title: string; kinds: SoundKind[] }[] = [
  { title: "Messages", kinds: ["message"] },
  { title: "Voice rooms", kinds: ["join", "leave", "connect", "disconnect"] },
  { title: "Your microphone", kinds: ["mute", "unmute", "deafen", "undeafen"] },
];

/** Which sounds play and how loud; saved on this computer. */
function SoundSettingsPage() {
  const settings = useSoundSettings();
  const notifications = useNotificationSettings();
  const toggle = (kind: SoundKind, on: boolean) =>
    setSoundSettings({ ...settings, off: on ? settings.off.filter((k) => k !== kind) : [...settings.off, kind] });

  return (
    <div className="settings-page">
      {desktopNotificationsAvailable && (
        <fieldset className="settings-group">
          <legend>Windows notifications</legend>
          <ul className="sound-list">
            <li className="sound-row">
              <label className="sound-toggle">
                <input
                  type="checkbox"
                  checked={notifications.enabled}
                  onChange={(e) => setNotificationSettings({ ...notifications, enabled: e.target.checked })}
                />
                <span>Show a notification for new direct and group messages and for calls</span>
              </label>
            </li>
            <li className="sound-row">
              <label className="sound-toggle">
                <input
                  type="checkbox"
                  checked={notifications.preview}
                  disabled={!notifications.enabled}
                  onChange={(e) => setNotificationSettings({ ...notifications, preview: e.target.checked })}
                />
                <span>Include the message text</span>
              </label>
            </li>
          </ul>
          <p className="muted small">
            Only while Ovrilo is in the background or that conversation is not open. Click one to open the conversation.
          </p>
        </fieldset>
      )}
      <section className="settings-group" aria-labelledby="settings-sound-volume">
        <h3 id="settings-sound-volume">Sounds</h3>
        <label className="sound-volume">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.volume}
            onChange={(e) => setSoundSettings({ ...settings, volume: Number(e.target.value) })}
            onPointerUp={() => playSound("message", { force: true })}
            onKeyUp={() => playSound("message", { force: true })}
          />
          <output>{settings.volume}%</output>
        </label>
        <p className="muted small">
          A new message sounds only while Ovrilo is in the background or that conversation is not open. While you are
          deafened, only the deafen sounds play.
        </p>
      </section>
      {SOUND_GROUPS.map((group) => (
        <fieldset key={group.title} className="settings-group">
          <legend>{group.title}</legend>
          <ul className="sound-list">
            {group.kinds.map((kind) => (
              <li key={kind} className="sound-row">
                <label className="sound-toggle">
                  <input
                    type="checkbox"
                    checked={!settings.off.includes(kind)}
                    onChange={(e) => toggle(kind, e.target.checked)}
                  />
                  <span>{SOUND_LABELS[kind]}</span>
                </label>
                <button
                  className="icon-button small"
                  aria-label={`Play: ${SOUND_LABELS[kind]}`}
                  title="Play"
                  onClick={() => playSound(kind, { force: true })}
                >
                  <Play size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <p className="muted small settings-footnote">Sounds play on Windows' default speaker or headphones.</p>
    </div>
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
