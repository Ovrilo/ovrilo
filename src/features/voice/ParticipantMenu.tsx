import { useEffect, useState } from "react";

import { ContextMenu } from "../../components/ContextMenu";
import { PersonActions } from "../friends/PersonActions";
import { useVoice, voice } from "./voice";

export interface ParticipantMenuTarget {
  participantId: string;
  x: number;
  y: number;
}

/**
 * Right-click menu for a remote participant: local volume and "mute for me" (both only affect
 * what this client hears), then message / add friend / block. Reads the participant live from
 * the voice snapshot.
 */
export function ParticipantMenu({ target, onClose }: { target: ParticipantMenuTarget; onClose: () => void }) {
  const { snapshot } = useVoice();
  const participant = snapshot.participants.find((p) => p.id === target.participantId);
  const [volume, setVolume] = useState(participant?.volume ?? 100);

  useEffect(() => setVolume(participant?.volume ?? 100), [participant?.volume]);

  // The participant left while the menu was open.
  useEffect(() => {
    if (!participant) onClose();
  }, [participant, onClose]);
  if (!participant) return null;

  const commitVolume = () => {
    if (volume !== participant.volume) void voice.setParticipantVolume(participant.id, volume);
  };

  return (
    <ContextMenu x={target.x} y={target.y} label={`${participant.name} options`} onClose={onClose}>
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
      <div className="context-menu-separator" />
      <PersonActions person={{ id: participant.id, displayName: participant.name }} onDone={onClose} />
    </ContextMenu>
  );
}
