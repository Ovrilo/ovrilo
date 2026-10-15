import { type QueryClient, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";
import { type History, upsertMessage } from "./history";
import { messagesKey } from "./useChannelMessages";

export type ChannelUnread = Schemas["ChannelUnreadResponse"];
type Message = Schemas["MessageResponse"];

/** The server stops counting here; show it as "99+". */
export const UNREAD_CAP = 100;

/** Communities that are not open get no live events; refresh their badges this often. */
const BACKGROUND_REFRESH_MS = 60_000;

export const unreadKey = (communityId: string) => ["communities", communityId, "unread"] as const;

const isUnreadQuery = (key: readonly unknown[]) => key[0] === "communities" && key[2] === "unread";

/** A new message: count it unless it is our own (which also means we have read up to it). */
export function applyCreated(list: ChannelUnread[], message: Message, selfId: string): ChannelUnread[] {
  return list.map((u) => {
    if (u.channelId !== message.channelId || (u.lastMessageId ?? 0) >= message.id) return u;
    if (message.author.id === selfId) {
      return { ...u, lastMessageId: message.id, lastReadMessageId: message.id, unreadCount: 0 };
    }
    return {
      ...u,
      lastMessageId: message.id,
      unreadCount: message.id > (u.lastReadMessageId ?? 0) ? Math.min(u.unreadCount + 1, UNREAD_CAP) : u.unreadCount,
    };
  });
}

/**
 * Our read position moved forward. Returns null when the new count cannot be known locally
 * (read somewhere in the middle): the caller refetches.
 */
export function applyRead(list: ChannelUnread[], channelId: string, lastReadMessageId: number): ChannelUnread[] | null {
  const entry = list.find((u) => u.channelId === channelId);
  if (!entry || lastReadMessageId <= (entry.lastReadMessageId ?? 0)) return list;
  if (lastReadMessageId < (entry.lastMessageId ?? 0) && entry.unreadCount > 0) return null;
  return list.map((u) => (u === entry ? { ...u, lastReadMessageId, unreadCount: 0 } : u));
}

export function isUnread(entry: ChannelUnread | undefined): boolean {
  return (entry?.unreadCount ?? 0) > 0;
}

export function unreadLabel(count: number): string {
  return count >= UNREAD_CAP ? "99+" : String(count);
}

function useFetchUnread() {
  const api = useApi();
  return useCallback(
    async (communityId: string) => {
      const { data, error } = await api.GET("/communities/{communityId}/unread", {
        params: { path: { communityId } },
      });
      if (!data) throw error;
      return data;
    },
    [api],
  );
}

/** Unread state of every text channel in the open community; kept live by useUnreadSync. */
export function useUnread(communityId: string | null) {
  const fetchUnread = useFetchUnread();
  return useQuery({
    queryKey: unreadKey(communityId ?? ""),
    enabled: communityId !== null,
    queryFn: () => fetchUnread(communityId!),
  });
}

/** Which communities have something unread, for the community rail. */
export function useCommunitiesWithUnread(communityIds: string[]): Set<string> {
  const fetchUnread = useFetchUnread();
  const results = useQueries({
    queries: communityIds.map((id) => ({
      queryKey: unreadKey(id),
      queryFn: () => fetchUnread(id),
      refetchInterval: BACKGROUND_REFRESH_MS,
      refetchIntervalInBackground: false,
    })),
  });
  return new Set(communityIds.filter((_, i) => results[i]?.data?.some(isUnread)));
}

function updateUnread(queryClient: QueryClient, channelId: string, update: (list: ChannelUnread[]) => ChannelUnread[] | null) {
  for (const [key, list] of queryClient.getQueriesData<ChannelUnread[]>({ predicate: (q) => isUnreadQuery(q.queryKey) })) {
    if (!list?.some((u) => u.channelId === channelId)) continue;
    const next = update(list);
    if (next) queryClient.setQueryData(key, next);
    else void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }
}

/**
 * Live unread badges and message caches for every text channel of the open community: subscribes
 * to them all, so channels you are not looking at still update (and open instantly when visited).
 */
export function useUnreadSync(communityId: string | null, textChannelIds: string[], selfId: string) {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const channelKey = textChannelIds.join(",");

  useEffect(() => {
    if (!communityId) return;
    const ids = channelKey ? channelKey.split(",") : [];
    const unsubscribes = ids.map((id) => realtime.subscribeChannel(id));
    const cache = (message: Message) =>
      queryClient.setQueryData<History>(messagesKey(message.channelId), (data) => upsertMessage(data, message));
    const offs = [
      realtime.on("MessageCreated", (message) => {
        cache(message);
        updateUnread(queryClient, message.channelId, (list) => applyCreated(list, message, selfId));
      }),
      realtime.on("MessageEdited", cache),
      realtime.on("MessageDeleted", (message) => {
        cache(message);
        // A deleted unread message changes the count: let the server recount.
        updateUnread(queryClient, message.channelId, () => null);
      }),
      realtime.on("ReadStateUpdated", ({ channelId, lastReadMessageId }) =>
        updateUnread(queryClient, channelId, (list) => applyRead(list, channelId, lastReadMessageId)),
      ),
      // Events may have been missed while disconnected.
      realtime.onResync(() => void queryClient.invalidateQueries({ predicate: (q) => isUnreadQuery(q.queryKey) })),
    ];
    return () => {
      offs.forEach((off) => off());
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [realtime, queryClient, communityId, channelKey, selfId]);
}

/**
 * Reports how far a channel has been read. Positions only move forward, here and on the server;
 * the badge clears immediately.
 */
export function useMarkRead(channelId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const sent = useRef(0);
  return useCallback(
    (messageId: number) => {
      if (messageId <= sent.current) return;
      sent.current = messageId;
      let partial = false;
      updateUnread(queryClient, channelId, (list) => {
        partial = list.some((u) => u.channelId === channelId && messageId < (u.lastMessageId ?? 0) && u.unreadCount > 0);
        return list.map((u) =>
          u.channelId === channelId && messageId > (u.lastReadMessageId ?? 0)
            ? { ...u, lastReadMessageId: messageId, unreadCount: messageId >= (u.lastMessageId ?? 0) ? 0 : u.unreadCount }
            : u,
        );
      });
      void api
        .PUT("/channels/{channelId}/read-state", {
          params: { path: { channelId } },
          body: { lastReadMessageId: messageId },
        })
        .then(({ response }) => {
          // Not stored: allow a later attempt to send it again.
          if (!response.ok && sent.current === messageId) sent.current = 0;
          // Read up to the middle: only the server knows how many are left.
          else if (partial) {
            void queryClient.invalidateQueries({
              predicate: (q) =>
                isUnreadQuery(q.queryKey) && !!(q.state.data as ChannelUnread[] | undefined)?.some((u) => u.channelId === channelId),
            });
          }
        })
        .catch(() => {
          if (sent.current === messageId) sent.current = 0;
        });
    },
    [api, queryClient, channelId],
  );
}
