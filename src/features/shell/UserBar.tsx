import { Check, HeadphoneOff, Headphones, Mic, MicOff, Settings } from "lucide-react";
import { useRef, useState } from "react";

import type { Schemas } from "../../api/client";
import { ContextMenu } from "../../components/ContextMenu";
import { Avatar, IconButton } from "../../components/ui";
import { type Availability, useMyStatus, useSetMyStatus } from "../friends/myStatus";
import { PRESENCE_LABEL, presenceClass } from "../friends/presence";
import { useVoice, voice, voiceAvailable } from "../voice/voice";

/** Own profile with always-available mute/deafen and settings (DESIGN.md §1.2). */
export function UserBar({ user, onSettings }: { user: Schemas["CurrentUserResponse"]; onSettings: () => void }) {
  const { snapshot } = useVoice();
  const micOff = snapshot.microphoneMuted || snapshot.deafened;
  const status = useMyStatus();
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <footer className="user-bar">
      <button
        ref={anchor}
        className="user-bar-status"
        aria-haspopup="menu"
        aria-expanded={picker !== null}
        title={`Status: ${STATUS_LABEL[status]}`}
        onClick={(e) => {
          if (picker) return setPicker(null);
          const box = e.currentTarget.getBoundingClientRect();
          setPicker({ x: box.left, y: box.top - 8 });
        }}
      >
        <span className="presence-avatar">
          <Avatar name={user.displayName} assetId={user.avatarAssetId} size="sm" speaking={snapshot.selfSpeaking} />
          <span className={presenceClass(status === "invisible" ? null : status)} role="img" aria-label={STATUS_LABEL[status]} />
        </span>
      </button>
      {picker && <StatusPicker x={picker.x} y={picker.y} anchor={anchor.current} onClose={() => setPicker(null)} />}
      <div className="user-bar-name">
        <strong>{user.displayName}</strong>
        {snapshot.pushToTalk && snapshot.pushToTalkKey ? (
          <span className={snapshot.transmitting ? "ptt-live" : "muted"}>
            {snapshot.transmitting ? "Talking" : `Push to talk: ${snapshot.pushToTalkKey.label}`}
          </span>
        ) : (
          <span className="muted">@{user.username}</span>
        )}
      </div>
      {voiceAvailable && (
        <>
          <IconButton
            icon={micOff ? MicOff : Mic}
            label={micOff ? "Unmute microphone" : "Mute microphone"}
            tone={micOff ? "danger" : "default"}
            aria-pressed={micOff}
            // Deafened also mutes; unmuting while deafened undeafens (as in Discord).
            onClick={() =>
              void (snapshot.deafened ? voice.setDeafened(false) : voice.setMuted(!snapshot.microphoneMuted))
            }
          />
          <IconButton
            icon={snapshot.deafened ? HeadphoneOff : Headphones}
            label={snapshot.deafened ? "Undeafen" : "Deafen"}
            tone={snapshot.deafened ? "danger" : "default"}
            aria-pressed={snapshot.deafened}
            onClick={() => void voice.setDeafened(!snapshot.deafened)}
          />
        </>
      )}
      <IconButton icon={Settings} label="Settings" onClick={onSettings} />
    </footer>
  );
}

const STATUS_LABEL: Record<Availability, string> = { ...PRESENCE_LABEL, invisible: "Invisible" };

const STATUS_OPTIONS: { value: Availability; hint: string }[] = [
  { value: "online", hint: "Away by itself after 10 minutes without input." },
  { value: "away", hint: "Until you change it." },
  { value: "doNotDisturb", hint: "Mutes message sounds, notifications and ringing." },
  { value: "invisible", hint: "You look offline, but use Ovrilo as usual." },
];

/** Choose the status others see; stored on your account. */
function StatusPicker({ x, y, anchor, onClose }: { x: number; y: number; anchor: HTMLElement | null; onClose: () => void }) {
  const status = useMyStatus();
  const setStatus = useSetMyStatus();
  return (
    <ContextMenu x={x} y={y} label="Set status" anchor={anchor} onClose={onClose}>
      <div className="context-menu-title">Status</div>
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          role="menuitemradio"
          aria-checked={status === option.value}
          className="context-menu-item status-option"
          onClick={() => {
            void setStatus(option.value);
            onClose();
          }}
        >
          <span className={`status-swatch ${presenceClass(option.value === "invisible" ? null : option.value)}`} aria-hidden="true" />
          <span className="status-option-text">
            <span>{STATUS_LABEL[option.value]}</span>
            <span className="muted small">{option.hint}</span>
          </span>
          {status === option.value && <Check size={14} aria-hidden="true" />}
        </button>
      ))}
    </ContextMenu>
  );
}
