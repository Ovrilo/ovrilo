import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { problemMessage } from "../../api/client";
import { ContextMenu } from "../../components/ContextMenu";
import { type DirectConversation, dmKey, type GroupConversation, groupKey, useOpenDirectMessage } from "./dms";
import { useBlocks, useFriendActions, useFriendRequests, useFriends } from "./friends";

/** Someone the menu acts on. Without a username a friend request cannot be sent. */
export interface PersonRef {
  id: string;
  displayName: string;
  username?: string | null;
}

/** Opens a direct or group conversation in the Home view. Provided by the main shell. */
export const OpenConversationContext = createContext<(conversationId: string) => void>(() => {});

/** A username Ovrilo already knows from friends, community members or conversations. */
function useKnownUsername(userId: string): string | null {
  const queryClient = useQueryClient();
  const friends = useFriends().data;
  const fromFriends = friends?.find((f) => f.user.id === userId)?.user.username;
  if (fromFriends) return fromFriends;
  for (const [, members] of queryClient.getQueriesData<{ userId: string; username: string }[]>({
    predicate: (q) => q.queryKey[0] === "communities" && q.queryKey[2] === "members",
  })) {
    const match = members?.find((m) => m.userId === userId);
    if (match) return match.username;
  }
  const dm = queryClient.getQueryData<DirectConversation[]>(dmKey)?.find((c) => c.user.id === userId);
  if (dm) return dm.user.username;
  for (const group of queryClient.getQueryData<GroupConversation[]>(groupKey) ?? []) {
    const match = group.members.find((m) => m.id === userId);
    if (match) return match.username;
  }
  return null;
}

/**
 * Social menu items for another person: message (friends), add or accept a friend request,
 * block or unblock. Each closes the menu when it has done its work.
 */
export function PersonActions({ person, onDone }: { person: PersonRef; onDone: () => void }) {
  const friends = useFriends().data;
  const requests = useFriendRequests().data;
  const blocks = useBlocks(true).data;
  const actions = useFriendActions();
  const openDm = useOpenDirectMessage();
  const openConversation = useContext(OpenConversationContext);
  const known = useKnownUsername(person.id);
  const username = person.username ?? known;

  const isFriend = friends?.some((f) => f.user.id === person.id) ?? false;
  const incoming = requests?.incoming.find((r) => r.user.id === person.id);
  const outgoing = requests?.outgoing.find((r) => r.user.id === person.id);
  const blocked = blocks?.some((b) => b.user.id === person.id) ?? false;
  const error = actions.send.error ?? actions.accept.error ?? actions.block.error ?? actions.unblock.error ?? openDm.error;

  if (blocked) {
    return (
      <>
        <button role="menuitem" className="context-menu-item" onClick={() => actions.unblock.mutate(person.id, { onSuccess: onDone })}>
          Unblock
        </button>
        {error && <p className="context-menu-hint form-error">{problemMessage(error)}</p>}
      </>
    );
  }

  return (
    <>
      {isFriend ? (
        <button
          role="menuitem"
          className="context-menu-item"
          disabled={openDm.isPending}
          onClick={() =>
            openDm.mutate(person.id, {
              onSuccess: (conversation) => {
                openConversation(conversation.id);
                onDone();
              },
            })
          }
        >
          Message
        </button>
      ) : incoming ? (
        <button role="menuitem" className="context-menu-item" onClick={() => actions.accept.mutate(incoming.id, { onSuccess: onDone })}>
          Accept friend request
        </button>
      ) : outgoing ? (
        <button role="menuitem" className="context-menu-item" disabled>
          Friend request sent
        </button>
      ) : (
        username && (
          <button
            role="menuitem"
            className="context-menu-item"
            disabled={actions.send.isPending}
            onClick={() => actions.send.mutate(username, { onSuccess: onDone })}
          >
            Add friend
          </button>
        )
      )}
      <button
        role="menuitem"
        className="context-menu-item context-menu-danger"
        onClick={() => {
          if (window.confirm(`Block ${person.displayName}? You won't see their messages, and they can't message or call you.`)) {
            actions.block.mutate(person.id, { onSuccess: onDone });
          }
        }}
      >
        Block
      </button>
      {error && <p className="context-menu-hint form-error">{problemMessage(error)}</p>}
    </>
  );
}

export interface PersonMenuTarget {
  person: PersonRef;
  x: number;
  y: number;
}

/** Right-click menu for a person in a member list. */
export function PersonMenu({ target, onClose }: { target: PersonMenuTarget; onClose: () => void }) {
  return (
    <ContextMenu x={target.x} y={target.y} label={`${target.person.displayName} options`} onClose={onClose}>
      <div className="context-menu-title">{target.person.displayName}</div>
      <PersonActions person={target.person} onDone={onClose} />
    </ContextMenu>
  );
}
