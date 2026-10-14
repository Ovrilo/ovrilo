import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from "lucide-react";

import type { Schemas } from "../../api/client";
import { Avatar, IconButton } from "../../components/ui";
import { useVoice, voice, voiceAvailable } from "../voice/voice";

/** Own profile with always-available mute/deafen and settings (DESIGN.md §1.2). */
export function UserBar({ user, onSettings }: { user: Schemas["CurrentUserResponse"]; onSettings: () => void }) {
  const { snapshot } = useVoice();
  const micOff = snapshot.microphoneMuted || snapshot.deafened;
  return (
    <footer className="user-bar">
      <Avatar name={user.displayName} assetId={user.avatarAssetId} size="sm" speaking={snapshot.selfSpeaking} />
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
