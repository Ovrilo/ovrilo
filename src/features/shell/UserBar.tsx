import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from "lucide-react";

import type { Schemas } from "../../api/client";
import { Avatar, IconButton } from "../../components/ui";
import { useVoice, voice, voiceAvailable } from "../voice/voice";

/** Own profile with always-available mute/deafen and settings (DESIGN.md §1.2). */
export function UserBar({ user, onSettings }: { user: Schemas["CurrentUserResponse"]; onSettings: () => void }) {
  const { snapshot } = useVoice();
  return (
    <footer className="user-bar">
      <Avatar name={user.displayName} size="sm" speaking={snapshot.selfSpeaking} />
      <div className="user-bar-name">
        <strong>{user.displayName}</strong>
        <span className="muted">@{user.username}</span>
      </div>
      {voiceAvailable && (
        <>
          <IconButton
            icon={snapshot.microphoneMuted ? MicOff : Mic}
            label={snapshot.microphoneMuted ? "Unmute microphone" : "Mute microphone"}
            tone={snapshot.microphoneMuted ? "danger" : "default"}
            aria-pressed={snapshot.microphoneMuted}
            onClick={() => void voice.setMuted(!snapshot.microphoneMuted)}
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
