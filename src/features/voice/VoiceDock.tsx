import { PhoneOff } from "lucide-react";

import { IconButton } from "../../components/ui";
import { QualityBadge } from "./QualityBadge";
import { useVoice, useVoiceQuality, voice } from "./voice";

const STATUS = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Voice connected",
  reconnecting: "Reconnecting…",
} as const;

/** Persistent voice status above the user bar while in a room (DESIGN.md §1.2, §3). */
export function VoiceDock({ channelName, onOpen }: { channelName: string; onOpen: () => void }) {
  const { snapshot } = useVoice();
  const quality = useVoiceQuality();
  if (snapshot.connection === "disconnected") return null;

  return (
    <section className={`voice-dock status-${snapshot.connection}`} aria-label="Voice connection">
      <button className="voice-dock-info" onClick={onOpen} title="Open voice channel">
        <span className="voice-dock-status">
          {STATUS[snapshot.connection]}
          {snapshot.connection === "connected" && <QualityBadge summary={quality} compact />}
        </span>
        <span className="voice-dock-channel">{channelName}</span>
      </button>
      <IconButton icon={PhoneOff} label="Leave voice" tone="danger" onClick={() => void voice.leave()} />
    </section>
  );
}
