import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";

export type DirectConversation = Schemas["DirectConversationResponse"];

export const dmKey = ["dms"] as const;

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

/**
 * Keeps the conversation list current. Direct-message events reach both people without
 * subscribing (contracts/events/README.md); any message, read position or friend change in one of
 * them refreshes the list (order, unread counts), and an unknown conversation means a new one.
 */
export function useDirectMessagesSync() {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  useEffect(() => {
    const isDirect = (channelId: string) =>
      queryClient.getQueryData<DirectConversation[]>(dmKey)?.some((c) => c.id === channelId) ?? false;
    const isCommunityChannel = (channelId: string) =>
      queryClient
        .getQueriesData<{ channelId: string }[]>({ predicate: (q) => q.queryKey[0] === "communities" && q.queryKey[2] === "unread" })
        .some(([, list]) => list?.some((u) => u.channelId === channelId));
    const refresh = () => void queryClient.invalidateQueries({ queryKey: dmKey });
    const onMessage = ({ channelId }: { channelId: string }) => {
      if (isDirect(channelId) || !isCommunityChannel(channelId)) refresh();
    };
    const offs = [
      realtime.on("MessageCreated", onMessage),
      realtime.on("MessageDeleted", onMessage),
      realtime.on("ReadStateUpdated", ({ channelId }) => {
        if (isDirect(channelId)) refresh();
      }),
      realtime.on("FriendsChanged", refresh),
      realtime.onResync(refresh),
    ];
    return () => offs.forEach((off) => off());
  }, [realtime, queryClient]);
}
