import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useApi, useRealtime } from "../../auth/SessionContext";
import { voice } from "../voice/voice";

export const callKey = (conversationId: string) => ["dms", conversationId, "call"] as const;

/** Refresh interval for who is in a call while its conversation is open (the SFU is the source of truth). */
const CALL_STATE_REFRESH_MS = 5000;

/** Whether the conversation's call rings and who is in it; refreshed while the conversation is open. */
export function useCallState(conversationId: string | null) {
  const api = useApi();
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: callKey(conversationId ?? ""),
    enabled: conversationId !== null,
    refetchInterval: CALL_STATE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.GET("/dms/{conversationId}/call", {
        params: { path: { conversationId: conversationId! } },
      });
      if (!data) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!conversationId) return;
    const refresh = (event: { conversationId: string }) => {
      if (event.conversationId === conversationId) void queryClient.invalidateQueries({ queryKey: callKey(conversationId) });
    };
    const offs = [realtime.on("CallRinging", refresh), realtime.on("CallAccepted", refresh), realtime.on("CallEnded", refresh)];
    return () => offs.forEach((off) => off());
  }, [realtime, queryClient, conversationId]);
  return query;
}

/**
 * Starts a call (rings the other person) or joins one (answers, or comes back), then connects the
 * voice engine to the conversation's room. Joining leaves any voice channel, as joining another
 * channel does.
 */
export function useCallActions() {
  const api = useApi();
  const queryClient = useQueryClient();
  const refresh = (conversationId: string) => void queryClient.invalidateQueries({ queryKey: callKey(conversationId) });

  const connect = useMutation({
    mutationFn: async ({ conversationId, answer }: { conversationId: string; answer: boolean }) => {
      const params = { params: { path: { conversationId } } };
      const { data, error } = answer
        ? await api.POST("/dms/{conversationId}/call/join", params)
        : await api.POST("/dms/{conversationId}/call", params);
      if (!data) throw error;
      await voice.join(conversationId, data.serverUrl, data.token, data.canShareScreen);
    },
    onSettled: (_data, _error, { conversationId }) => refresh(conversationId),
  });

  const decline = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error, response } = await api.POST("/dms/{conversationId}/call/decline", {
        params: { path: { conversationId } },
      });
      if (!response.ok) throw error;
    },
    onSettled: (_data, _error, conversationId) => refresh(conversationId),
  });

  return { connect, decline };
}
