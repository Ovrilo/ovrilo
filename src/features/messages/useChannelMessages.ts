import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { problemMessage } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";
import { type History, type Message, newestId, upsertMessage, visibleMessages } from "./history";
import { retryAfterSeconds, sendThrottle } from "./throttle";

const PAGE_SIZE = 50;

export const messagesKey = (channelId: string) => ["channels", channelId, "messages"] as const;

/** A message typed locally that the server has not confirmed yet. */
export interface PendingMessage {
  clientMessageId: string;
  content: string;
  status: "sending" | "failed";
  error?: string;
}

/**
 * History, live updates and sending for one text channel. The server is authoritative: pending
 * messages are replaced by the stored message (matched by clientMessageId) from either the send
 * response or the realtime event, whichever arrives first.
 */
export function useChannelMessages(channelId: string) {
  const api = useApi();
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const key = messagesKey(channelId);
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const history = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET("/channels/{channelId}/messages", {
        params: { path: { channelId }, query: { limit: PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) } },
      });
      if (!data) throw error;
      return data;
    },
    // Older pages: before the oldest message of the last loaded page.
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.messages[0]?.id ?? undefined) : undefined),
    // Live events keep it fresh; refetching would drop older pages the user scrolled to.
    staleTime: Infinity,
  });

  const apply = useCallback(
    (message: Message) => {
      queryClient.setQueryData<History>(key, (data) => upsertMessage(data, message));
      setPending((list) => list.filter((p) => p.clientMessageId !== message.clientMessageId));
    },
    [queryClient, channelId],
  );

  // Live events for this channel.
  useEffect(() => {
    const forThisChannel = (message: Message) => message.channelId === channelId && apply(message);
    const unsubscribe = realtime.subscribeChannel(channelId);
    const offs = [
      realtime.on("MessageCreated", forThisChannel),
      realtime.on("MessageEdited", forThisChannel),
      realtime.on("MessageDeleted", forThisChannel),
    ];
    return () => {
      offs.forEach((off) => off());
      unsubscribe();
    };
  }, [realtime, channelId, apply]);

  // Fetch everything newer than what we have: after a reconnect (events may have been missed), and
  // when reopening a channel whose cached history went stale while nobody was subscribed to it.
  const catchUp = useCallback(async () => {
    let after = newestId(queryClient.getQueryData<History>(key));
    while (after !== null) {
      const { data } = await api.GET("/channels/{channelId}/messages", {
        params: { path: { channelId }, query: { after, limit: 100 } },
      });
      if (!data) return;
      data.messages.forEach(apply);
      after = data.hasMore ? (data.messages[data.messages.length - 1]?.id ?? null) : null;
    }
  }, [api, queryClient, channelId, apply]);

  useEffect(() => {
    void catchUp();
    return realtime.onResync(() => void catchUp());
  }, [realtime, catchUp]);

  const deliver = useCallback(
    async (clientMessageId: string, content: string) => {
      setPending((list) =>
        list.some((p) => p.clientMessageId === clientMessageId)
          ? list.map((p) => (p.clientMessageId === clientMessageId ? { ...p, status: "sending", error: undefined } : p))
          : [...list, { clientMessageId, content, status: "sending" }],
      );
      try {
        const { data, error, response } = await api.POST("/channels/{channelId}/messages", {
          params: { path: { channelId } },
          body: { clientMessageId, content, replyToMessageId: null },
        });
        if (data) return apply(data);
        if (response.status === 429) sendThrottle.penalize(Date.now(), retryAfterSeconds(response.headers.get("Retry-After")));
        const message = response.status === 429 ? "Not sent: you were sending messages too fast." : problemMessage(error);
        setPending((list) =>
          list.map((p) => (p.clientMessageId === clientMessageId ? { ...p, status: "failed", error: message } : p)),
        );
      } catch {
        setPending((list) =>
          list.map((p) =>
            p.clientMessageId === clientMessageId
              ? { ...p, status: "failed", error: "Not sent. Check your connection and retry." }
              : p,
          ),
        );
      }
    },
    [api, channelId, apply],
  );

  return {
    messages: visibleMessages(history.data as History | undefined),
    pending,
    isLoading: history.isPending,
    isError: history.isError,
    hasOlder: history.hasNextPage,
    loadingOlder: history.isFetchingNextPage,
    loadOlder: () => void history.fetchNextPage(),
    /**
     * Sends a new message, or returns false (sending nothing) while the send cooldown runs. The same
     * clientMessageId is reused when retrying, so a message is never duplicated.
     */
    send: (content: string): boolean => {
      if (!sendThrottle.tryAcquire(Date.now())) return false;
      void deliver(crypto.randomUUID(), content);
      return true;
    },
    retry: (p: PendingMessage) => {
      if (sendThrottle.tryAcquire(Date.now())) void deliver(p.clientMessageId, p.content);
    },
    discard: (p: PendingMessage) => setPending((list) => list.filter((x) => x.clientMessageId !== p.clientMessageId)),
    edit: async (messageId: number, content: string) => {
      const { data, error } = await api.PATCH("/messages/{messageId}", {
        params: { path: { messageId } },
        body: { content },
      });
      if (!data) throw error;
      apply(data);
    },
    remove: async (messageId: number) => {
      const { error, response } = await api.DELETE("/messages/{messageId}", { params: { path: { messageId } } });
      if (!response.ok) throw error;
      // The MessageDeleted event updates the list; also hide it now in case events are delayed.
      const current = visibleMessages(queryClient.getQueryData<History>(key)).find((m) => m.id === messageId);
      if (current) apply({ ...current, content: null, deletedAt: new Date().toISOString() });
    },
  };
}
