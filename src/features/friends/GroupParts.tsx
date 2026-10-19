import { Crown, UserMinus, Users } from "lucide-react";
import { useState } from "react";

import { Avatar } from "../../components/ui";
import type { ConversationUser, GroupConversation } from "./dms";
import { useFriendsPresence } from "./friends";
import { useMyShown } from "../activity/activity";
import { PersonCard, type PersonCardTarget } from "./PersonCard";
import { PersonMenu, type PersonMenuTarget } from "./PersonActions";
import { PRESENCE_LABEL, presenceClass } from "./presence";

const GROUP_ICON_SIZE = { xs: 12, sm: 16, lg: 30 } as const;

/** A group's picture: a people symbol, sized like an avatar (the member list shows who is in it). */
export function GroupAvatar({ size = "xs" }: { size?: "xs" | "sm" | "lg" }) {
  return (
    <span className={`avatar avatar-${size} group-avatar`} aria-hidden="true">
      <Users size={GROUP_ICON_SIZE[size]} />
    </span>
  );
}

/**
 * Everyone in a group. Online status shows for friends (and you): presence is only shared between
 * friends and people in a community together.
 */
export function GroupMembersPanel({
  group,
  selfId,
  onRemove,
}: {
  group: GroupConversation;
  selfId: string;
  /** Owner only: remove someone. */
  onRemove?: (member: ConversationUser) => void;
}) {
  const online = useFriendsPresence();
  const me = useMyShown();
  const [menu, setMenu] = useState<PersonMenuTarget | null>(null);
  const [card, setCard] = useState<PersonCardTarget | null>(null);
  const openMenu = (member: ConversationUser, x: number, y: number) => {
    if (member.id === selfId) return;
    setMenu({ person: { id: member.id, displayName: member.displayName, username: member.username }, x, y });
  };
  const openCard = (member: ConversationUser, row: HTMLElement) => {
    const box = row.getBoundingClientRect();
    setCard({ person: { ...member }, x: box.left - 300, y: box.top });
  };
  return (
    <aside className="members-panel" aria-label="Group members">
      <section className="members-group">
        <h2>Members — {group.members.length}</h2>
        <ul>
          {group.members.map((member) => {
            const shown = member.id === selfId ? me : (online.get(member.id) ?? null);
            return (
              <li
                key={member.id}
                className="member-row avatar-hover-scope actionable"
                tabIndex={0}
                aria-haspopup="dialog"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest(".member-remove")) return;
                  openCard(member, e.currentTarget);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(member, e.clientX, e.clientY);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "ContextMenu") {
                    e.preventDefault();
                    const box = e.currentTarget.getBoundingClientRect();
                    openMenu(member, box.left + 24, box.bottom);
                  } else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openCard(member, e.currentTarget);
                  }
                }}
              >
                <span className="presence-avatar">
                  <Avatar name={member.displayName} assetId={member.avatarAssetId} size="sm" />
                  {shown && <span className={presenceClass(shown.status)} role="img" aria-label={PRESENCE_LABEL[shown.status]} />}
                </span>
                <span className="member-text">
                  <span className="member-name" title={`@${member.username}`}>
                    {member.displayName}
                  </span>
                  {shown?.playing && <span className="member-activity">Playing {shown.playing}</span>}
                </span>
                {member.id === group.ownerId && <Crown size={14} className="member-owner" aria-label="Group owner" />}
                {onRemove && member.id !== selfId && (
                  <button
                    className="icon-button member-remove"
                    aria-label={`Remove ${member.displayName}`}
                    title={`Remove ${member.displayName}`}
                    onClick={() => onRemove(member)}
                  >
                    <UserMinus size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {menu && <PersonMenu target={menu} onClose={() => setMenu(null)} />}
      {card && (
        <PersonCard
          target={card}
          shown={card.person.id === selfId ? me : (online.get(card.person.id) ?? null)}
          self={card.person.id === selfId}
          onClose={() => setCard(null)}
        />
      )}
    </aside>
  );
}
