import { useQueryClient } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { useEffect, useState } from "react";

import type { Schemas } from "../../api/client";
import { useRealtime } from "../../auth/SessionContext";
import { Avatar } from "../../components/ui";
import { queryKeys, useMembers } from "./queries";

type Member = Schemas["MemberResponse"];

const byName = (a: Member, b: Member) => memberName(a).localeCompare(memberName(b), undefined, { sensitivity: "base" });

function memberName(member: Member): string {
  return member.nickname ?? member.displayName;
}

/** Who in the community is online right now, kept current over the realtime connection. */
function usePresence(communityId: string): ReadonlySet<string> {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setOnline(new Set());
    const unsubscribe = realtime.subscribeCommunity(communityId, (ids) => setOnline(new Set(ids)));
    const off = realtime.on("PresenceChanged", ({ userId, online: isOnline }) => {
      setOnline((current) => {
        if (current.has(userId) === isOnline) return current;
        const next = new Set(current);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });
      // Someone we have never listed may have just joined the community.
      const members = queryClient.getQueryData<Member[]>(queryKeys.members(communityId));
      if (isOnline && members && !members.some((m) => m.userId === userId)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members(communityId) });
      }
    });
    return () => {
      off();
      unsubscribe();
    };
  }, [realtime, queryClient, communityId]);

  return online;
}

/** The community's members split into online and offline (DESIGN.md §5.3). */
export function MembersPanel({ communityId, selfId }: { communityId: string; selfId: string }) {
  const members = useMembers(communityId);
  const online = usePresence(communityId);
  // We are online whenever we can see this list, even before the first snapshot arrives.
  const isOnline = (m: Member) => m.userId === selfId || online.has(m.userId);

  const all = members.data ?? [];
  const groups = [
    { label: "Online", items: all.filter(isOnline).sort(byName) },
    { label: "Offline", items: all.filter((m) => !isOnline(m)).sort(byName) },
  ];

  return (
    <aside className="members-panel" aria-label="Members">
      {members.isError && <p className="form-error small">Members could not be loaded.</p>}
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <section key={group.label} className="members-group">
              <h2>
                {group.label} — {group.items.length}
              </h2>
              <ul>
                {group.items.map((member) => (
                  <li
                    key={member.userId}
                    className={`member-row avatar-hover-scope${group.label === "Offline" ? " offline" : ""}`}
                  >
                    <span className="presence-avatar">
                      <Avatar name={memberName(member)} assetId={member.avatarAssetId} size="sm" />
                      <span
                        className={`presence-dot${group.label === "Online" ? " online" : ""}`}
                        role="img"
                        aria-label={group.label}
                      />
                    </span>
                    <span className="member-name" title={`@${member.username}`}>
                      {memberName(member)}
                    </span>
                    {member.role === "owner" && (
                      <Crown size={14} className="member-owner" aria-label="Community owner" />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </aside>
  );
}
