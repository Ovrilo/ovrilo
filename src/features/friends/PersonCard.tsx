import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ContextMenu } from "../../components/ContextMenu";
import { Avatar } from "../../components/ui";
import { PersonActions, type PersonRef } from "./PersonActions";
import { PRESENCE_LABEL, presenceClass, playingFor, type Shown } from "./presence";

export interface PersonCardTarget {
  person: PersonRef & { avatarAssetId: string | null };
  x: number;
  y: number;
}

/** The current time, refreshed every 30 s while mounted (for "playing for …"). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Someone's card, opened by clicking them in a member list: picture, name, status, the game they
 * play and for how long, and the actions for them (none for yourself).
 */
export function PersonCard({
  target,
  shown,
  self,
  onClose,
}: {
  target: PersonCardTarget;
  /** What they show now (kept live by the caller); null when offline. */
  shown: Shown | null;
  self: boolean;
  onClose: () => void;
}) {
  const now = useNow();
  const { person } = target;
  const duration = playingFor(shown?.since, now);
  return (
    <ContextMenu x={target.x} y={target.y} label={`${person.displayName}'s profile`} onClose={onClose}>
      <div className="person-card">
        <div className="person-card-head">
          <span className="presence-avatar">
            <Avatar name={person.displayName} assetId={person.avatarAssetId} size="lg" />
            <span className={presenceClass(shown?.status)} role="img" aria-label={PRESENCE_LABEL[shown?.status ?? "offline"]} />
          </span>
          <div className="person-card-names">
            <strong>{person.displayName}</strong>
            {person.username && <span className="muted small">@{person.username}</span>}
            <span className="muted small">{PRESENCE_LABEL[shown?.status ?? "offline"]}</span>
          </div>
        </div>
        {shown?.playing && (
          <section className="person-card-activity" aria-label="Activity">
            <span className="person-card-label">Playing a game</span>
            <div className="person-card-game">
              <span className="person-card-game-icon" aria-hidden="true">
                <Gamepad2 size={22} />
              </span>
              <span className="person-card-game-text">
                <strong title={shown.playing}>{shown.playing}</strong>
                {duration && <span className="muted small">{duration}</span>}
              </span>
            </div>
          </section>
        )}
      </div>
      {!self && (
        <>
          <div className="context-menu-separator" />
          <PersonActions person={person} onDone={onClose} />
        </>
      )}
    </ContextMenu>
  );
}
