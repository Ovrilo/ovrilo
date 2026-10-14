import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useVoice, voice } from "./voice";

export interface ParticipantMenuTarget {
  participantId: string;
  x: number;
  y: number;
}

/**
 * Right-click menu for a remote participant: local volume and "mute for me" (both only affect
 * what this client hears). Reads the participant live from the voice snapshot.
 */
export function ParticipantMenu({ target, onClose }: { target: ParticipantMenuTarget; onClose: () => void }) {
  const { snapshot } = useVoice();
  const participant = snapshot.participants.find((p) => p.id === target.participantId);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const [volume, setVolume] = useState(participant?.volume ?? 100);

  useEffect(() => setVolume(participant?.volume ?? 100), [participant?.volume]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8)),
    });
    menu.querySelector<HTMLInputElement>("input")?.focus();
  }, [target.x, target.y]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // The participant left while the menu was open.
  useEffect(() => {
    if (!participant) onClose();
  }, [participant, onClose]);
  if (!participant) return null;

  const commitVolume = () => {
    if (volume !== participant.volume) void voice.setParticipantVolume(participant.id, volume);
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={`${participant.name} options`}
      style={position}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu-title">{participant.name}</div>
      <label className="context-menu-volume">
        <span>
          User volume <span className="volume-value">{volume}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={volume}
          disabled={participant.locallyMuted}
          aria-valuetext={`${volume} percent`}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
          onBlur={commitVolume}
        />
      </label>
      {volume !== 100 && !participant.locallyMuted && (
        <button
          role="menuitem"
          className="context-menu-item"
          onClick={() => {
            setVolume(100);
            void voice.setParticipantVolume(participant.id, 100);
          }}
        >
          Reset volume
        </button>
      )}
      <div className="context-menu-separator" />
      <label className="context-menu-item context-menu-check" role="menuitemcheckbox" aria-checked={participant.locallyMuted}>
        <input
          type="checkbox"
          checked={participant.locallyMuted}
          onChange={(e) => void voice.setParticipantMuted(participant.id, e.target.checked)}
        />
        Mute for me
      </label>
      <p className="context-menu-hint">Only changes what you hear.</p>
    </div>
  );
}
