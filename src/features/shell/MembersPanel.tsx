import { useQueryClient } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { useEffect, useState } from "react";

import { PersonCard, type PersonCardTarget } from "../friends/PersonCard";
import { PersonMenu, type PersonMenuTarget } from "../friends/PersonActions";
import { useMyShown } from "../activity/activity";
import { applyPresence, PRESENCE_LABEL, type PresenceMap, presenceMap, presenceClass } from "../friends/presence";

import type { Schemas } from "../../api/client";
import { useRealtime } from "../../auth/SessionContext";
import { Avatar } from "../../components/ui";
import { queryKeys, useMembers } from "./queries";

type Member = Schemas["MemberResponse"];

const byName = (a: Member, b: Member) => memberName(a).localeCompare(memberName(b), undefined, { sensitivity: "base" });

function memberName(member: Member): string {
  return member.nickname ?? member.displayName;
}

/** Who in the community is online right now and how, kept current over the realtime connection. */
function usePresence(communityId: string): PresenceMap {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState<PresenceMap>(() => new Map());

  useEffect(() => {
    setOnline(new Map());
    const unsubscribe = realtime.subscribeCommunity(communityId, (present) => setOnline(presenceMap(present)));
    const off = realtime.on("PresenceChanged", (event) => {
      const { userId, online: isOnline } = event;
      setOnline((current) => applyPresence(current, event));
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
  const [menu, setMenu] = useState<PersonMenuTarget | null>(null);
  const [card, setCard] = useState<PersonCardTarget | null>(null);
  const personOf = (member: Member) => ({ id: member.userId, displayName: memberName(member), username: member.username });
  const openMenu = (member: Member, x: number, y: number) => {
    if (member.userId === selfId) return;
    setMenu({ person: personOf(member), x, y });
  };
  // The card opens beside the row, to the left of the member list.
  const openCard = (member: Member, row: HTMLElement) => {
    const box = row.getBoundingClientRect();
    setCard({ person: { ...personOf(member), avatarAssetId: member.avatarAssetId }, x: box.left - 300, y: box.top });
  };
  // You appear as you chose (others' view of you may lag a moment); invisible looks offline.
  const me = useMyShown();
  const shownOf = (m: Member) => (m.userId === selfId ? me : (online.get(m.userId) ?? null));
  const isOnline = (m: Member) => shownOf(m) !== null;

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
                    className={`member-row avatar-hover-scope actionable${group.label === "Offline" ? " offline" : ""}`}
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={(e) => openCard(member, e.currentTarget)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(member, e.clientX, e.clientY);
                    }}
                    onKeyDown={(e) => {
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
                      <Avatar name={memberName(member)} assetId={member.avatarAssetId} size="sm" />
                      <span
                        className={presenceClass(shownOf(member)?.status)}
                        role="img"
                        aria-label={PRESENCE_LABEL[shownOf(member)?.status ?? "offline"]}
                      />
                    </span>
                    <span className="member-text">
                      <span className="member-name" title={`@${member.username}`}>
                        {memberName(member)}
                      </span>
                      {shownOf(member)?.playing && <span className="member-activity">Playing {shownOf(member)?.playing}</span>}
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
