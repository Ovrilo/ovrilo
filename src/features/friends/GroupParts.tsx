import { Crown, UserMinus, Users } from "lucide-react";
import { useState } from "react";

import { Avatar } from "../../components/ui";
import type { ConversationUser, GroupConversation } from "./dms";
import { useFriendsPresence } from "./friends";
import { PersonMenu, type PersonMenuTarget } from "./PersonActions";

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
  const [menu, setMenu] = useState<PersonMenuTarget | null>(null);
  const openMenu = (member: ConversationUser, x: number, y: number) => {
    if (member.id === selfId) return;
    setMenu({ person: { id: member.id, displayName: member.displayName, username: member.username }, x, y });
  };
  return (
    <aside className="members-panel" aria-label="Group members">
      <section className="members-group">
        <h2>Members — {group.members.length}</h2>
        <ul>
          {group.members.map((member) => {
            const isOnline = member.id === selfId || online.has(member.id);
            return (
              <li
                key={member.id}
                className={`member-row avatar-hover-scope${member.id === selfId ? "" : " actionable"}`}
                tabIndex={member.id === selfId ? undefined : 0}
                aria-haspopup={member.id === selfId ? undefined : "menu"}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest(".member-remove")) return;
                  openMenu(member, e.clientX, e.clientY);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(member, e.clientX, e.clientY);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " " && e.key !== "ContextMenu")) return;
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  openMenu(member, box.left + 24, box.bottom);
                }}
              >
                <span className="presence-avatar">
                  <Avatar name={member.displayName} assetId={member.avatarAssetId} size="sm" />
                  {isOnline && <span className="presence-dot online" role="img" aria-label="Online" />}
                </span>
                <span className="member-name" title={`@${member.username}`}>
                  {member.displayName}
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
    </aside>
  );
}
