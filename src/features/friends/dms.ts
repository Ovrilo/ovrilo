import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";

export type DirectConversation = Schemas["DirectConversationResponse"];
export type GroupConversation = Schemas["GroupConversationResponse"];
export type ConversationUser = Schemas["ConversationUserResponse"];

/** Groups hold up to this many people, the creator included (API limit). */
export const GROUP_MAX_MEMBERS = 10;

/** A direct or group conversation, in the shape the Home sidebar and views use. */
export interface Conversation {
  id: string;
  kind: "direct" | "group";
  /** The other person's name, the group's name, or its members' names. */
  title: string;
  /** Everyone else in the conversation. */
  others: ConversationUser[];
  /** Set for groups. */
  group: GroupConversation | null;
  lastActivityAt: string;
  lastMessageId: number | null;
  lastReadMessageId: number | null;
  unreadCount: number;
}

export const dmKey = ["dms"] as const;
export const groupKey = ["groups"] as const;

/** Your direct conversations, most recently active first, with unread counts. */
export function useDirectMessages() {
  const api = useApi();
  return useQuery({
    queryKey: dmKey,
    queryFn: async () => {
      const { data, error } = await api.GET("/dms");
      if (!data) throw error;
      return data;
    },
  });
}

/** Your group conversations, with members and unread counts. */
export function useGroups() {
  const api = useApi();
  return useQuery({
    queryKey: groupKey,
    queryFn: async () => {
      const { data, error } = await api.GET("/groups");
      if (!data) throw error;
      return data;
    },
  });
}

/** Unnamed groups show their members' first names: "Ada, Bob and Cid". */
export function groupTitle(group: GroupConversation, meId: string): string {
  if (group.name) return group.name;
  const names = group.members.filter((m) => m.id !== meId).map((m) => m.displayName);
  if (names.length === 0) return "Empty group";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Direct and group conversations together, most recently active first. */
export function useConversations(meId: string) {
  const direct = useDirectMessages();
  const groups = useGroups();
  const data = useMemo<Conversation[] | undefined>(() => {
    if (!direct.data && !groups.data) return undefined;
    const all: Conversation[] = [
      ...(direct.data ?? []).map((c) => ({
        id: c.id,
        kind: "direct" as const,
        title: c.user.displayName,
        others: [c.user],
        group: null,
        lastActivityAt: c.lastActivityAt,
        lastMessageId: c.lastMessageId ?? null,
        lastReadMessageId: c.lastReadMessageId ?? null,
        unreadCount: c.unreadCount,
      })),
      ...(groups.data ?? []).map((g) => ({
        id: g.id,
        kind: "group" as const,
        title: groupTitle(g, meId),
        others: g.members.filter((m) => m.id !== meId),
        group: g,
        lastActivityAt: g.lastActivityAt,
        lastMessageId: g.lastMessageId ?? null,
        lastReadMessageId: g.lastReadMessageId ?? null,
        unreadCount: g.unreadCount,
      })),
    ];
    return all.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [direct.data, groups.data, meId]);
  return { data, isPending: direct.isPending && groups.isPending };
}

/** Opens (or finds) the conversation with a friend. */
export function useOpenDirectMessage() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await api.POST("/dms", { body: { userId } });
      if (!data) throw error;
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: dmKey }),
  });
}

/** Creating, renaming, adding to and leaving groups. Every change refreshes the group list. */
export function useGroupActions() {
  const api = useApi();
  const queryClient = useQueryClient();
  const onSuccess = () => void queryClient.invalidateQueries({ queryKey: groupKey });

  const create = useMutation({
    mutationFn: async (body: { userIds: string[]; name: string | null }) => {
      const { data, error } = await api.POST("/groups", { body });
      if (!data) throw error;
      return data;
    },
    onSuccess,
  });
  const rename = useMutation({
    mutationFn: async ({ groupId, name }: { groupId: string; name: string | null }) => {
      const { data, error } = await api.PATCH("/groups/{groupId}", { params: { path: { groupId } }, body: { name } });
      if (!data) throw error;
      return data;
    },
    onSuccess,
  });
  const add = useMutation({
    mutationFn: async ({ groupId, userIds }: { groupId: string; userIds: string[] }) => {
      for (const userId of userIds) {
        const { data, error } = await api.POST("/groups/{groupId}/members", { params: { path: { groupId } }, body: { userId } });
        if (!data) throw error;
      }
    },
    onSettled: onSuccess,
  });
  const remove = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      const { error, response } = await api.DELETE("/groups/{groupId}/members/{userId}", {
        params: { path: { groupId, userId } },
      });
      if (!response.ok) throw error;
    },
    onSuccess,
  });
  return { create, rename, add, remove };
}

/**
 * Keeps the conversation lists current. Direct and group message events reach every member
 * without subscribing (contracts/events/README.md); any message, read position, friend or group
 * change in one of them refreshes the lists (order, unread counts), and an unknown conversation
 * means a new one.
 */
export function useDirectMessagesSync() {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  useEffect(() => {
    const isConversation = (channelId: string) =>
      (queryClient.getQueryData<DirectConversation[]>(dmKey)?.some((c) => c.id === channelId) ?? false) ||
      (queryClient.getQueryData<GroupConversation[]>(groupKey)?.some((g) => g.id === channelId) ?? false);
    const isCommunityChannel = (channelId: string) =>
      queryClient
        .getQueriesData<{ channelId: string }[]>({ predicate: (q) => q.queryKey[0] === "communities" && q.queryKey[2] === "unread" })
        .some(([, list]) => list?.some((u) => u.channelId === channelId));
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: dmKey });
      void queryClient.invalidateQueries({ queryKey: groupKey });
    };
    const onMessage = ({ channelId }: { channelId: string }) => {
      if (isConversation(channelId) || !isCommunityChannel(channelId)) refresh();
    };
    const offs = [
      realtime.on("MessageCreated", onMessage),
      realtime.on("MessageDeleted", onMessage),
      realtime.on("ReadStateUpdated", ({ channelId }) => {
        if (isConversation(channelId)) refresh();
      }),
      realtime.on("FriendsChanged", refresh),
      realtime.on("GroupChanged", () => void queryClient.invalidateQueries({ queryKey: groupKey })),
      realtime.onResync(refresh),
    ];
    return () => offs.forEach((off) => off());
  }, [realtime, queryClient]);
}
