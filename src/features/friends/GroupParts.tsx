import { Crown, UserMinus } from "lucide-react";

import { Avatar } from "../../components/ui";
import type { ConversationUser, GroupConversation } from "./dms";
import { useFriendsPresence } from "./friends";

/** Two members' pictures, overlapped: how a group shows in lists and headers. */
export function GroupAvatar({ others, size = "xs" }: { others: readonly ConversationUser[]; size?: "xs" | "sm" | "lg" }) {
  const [first, second] = others;
  if (!first) return <Avatar name="?" assetId={null} size={size} />;
  if (!second) return <Avatar name={first.displayName} assetId={first.avatarAssetId} size={size} />;
  return (
    <span className={`group-avatar group-avatar-${size}`} aria-hidden="true">
      <Avatar name={first.displayName} assetId={first.avatarAssetId} size={size} />
      <Avatar name={second.displayName} assetId={second.avatarAssetId} size={size} />
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
  return (
    <aside className="members-panel" aria-label="Group members">
      <section className="members-group">
        <h2>Members — {group.members.length}</h2>
        <ul>
          {group.members.map((member) => {
            const isOnline = member.id === selfId || online.has(member.id);
            return (
              <li key={member.id} className="member-row avatar-hover-scope">
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
    </aside>
  );
}
