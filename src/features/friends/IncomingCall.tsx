import { Phone, PhoneOff } from "lucide-react";
import { useEffect } from "react";

import { Avatar } from "../../components/ui";

export interface IncomingCallInfo {
  conversationId: string;
  caller: { id: string; displayName: string; avatarAssetId: string | null };
}

/** Two short tones every two seconds, made with Web Audio so no sound file ships with the app. */
function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      return;
    }
    const ring = () => {
      const start = context.currentTime;
      [0, 0.25].forEach((offset, i) => {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.frequency.value = i === 0 ? 660 : 880;
        gain.gain.setValueAtTime(0, start + offset);
        gain.gain.linearRampToValueAtTime(0.12, start + offset + 0.02);
        gain.gain.linearRampToValueAtTime(0, start + offset + 0.2);
        tone.connect(gain).connect(context.destination);
        tone.start(start + offset);
        tone.stop(start + offset + 0.22);
      });
    };
    ring();
    const timer = setInterval(ring, 2000);
    return () => {
      clearInterval(timer);
      void context.close();
    };
  }, [active]);
}

/** Someone is calling: answer or decline. Stays on top of everything until the call is answered or ends. */
export function IncomingCall({
  call,
  busy,
  onAccept,
  onDecline,
}: {
  call: IncomingCallInfo;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  useRingtone(true);
  return (
    <div className="incoming-call" role="alertdialog" aria-label={`${call.caller.displayName} is calling`}>
      <Avatar name={call.caller.displayName} assetId={call.caller.avatarAssetId} size="lg" />
      <div className="incoming-call-text">
        <strong>{call.caller.displayName}</strong>
        <span className="muted small">is calling you…</span>
      </div>
      <div className="incoming-call-actions">
        <button className="call-round decline" aria-label="Decline" title="Decline" onClick={onDecline}>
          <PhoneOff size={18} aria-hidden="true" />
        </button>
        <button className="call-round accept" aria-label="Accept" title="Accept" disabled={busy} onClick={onAccept}>
          <Phone size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
