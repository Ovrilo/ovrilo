import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";

export type Friend = Schemas["FriendResponse"];
export type FriendRequest = Schemas["FriendRequestResponse"];
export type BlockedUser = Schemas["BlockedUserResponse"];
export type SocialUser = Schemas["SocialUserResponse"];

export const friendKeys = {
  all: ["friends"] as const,
  friends: ["friends", "list"] as const,
  requests: ["friends", "requests"] as const,
  blocks: ["friends", "blocks"] as const,
};

export function useFriends() {
  const api = useApi();
  return useQuery({
    queryKey: friendKeys.friends,
    queryFn: async () => {
      const { data, error } = await api.GET("/friends");
      if (!data) throw error;
      return data;
    },
  });
}

export function useFriendRequests() {
  const api = useApi();
  return useQuery({
    queryKey: friendKeys.requests,
    queryFn: async () => {
      const { data, error } = await api.GET("/friends/requests");
      if (!data) throw error;
      return data;
    },
  });
}

export function useBlocks(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: friendKeys.blocks,
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/blocks");
      if (!data) throw error;
      return data;
    },
  });
}

/** Keeps the friend lists current: the server sends FriendsChanged to both people after any change. */
export function useFriendsSync() {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: friendKeys.all });
    const offs = [realtime.on("FriendsChanged", refresh), realtime.onResync(refresh)];
    return () => offs.forEach((off) => off());
  }, [realtime, queryClient]);
}

/** Which friends are online: a snapshot after (re)connecting and after friend changes, then PresenceChanged. */
export function useFriendsPresence(): ReadonlySet<string> {
  const realtime = useRealtime();
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let current = true;
    const snapshot = () =>
      void realtime.getFriendsPresence().then((ids) => {
        if (current && ids) setOnline(new Set(ids));
      });
    snapshot();
    const offs = [
      realtime.onResync(snapshot),
      realtime.on("FriendsChanged", snapshot),
      realtime.on("PresenceChanged", ({ userId, online: isOnline }) =>
        setOnline((previous) => {
          if (previous.has(userId) === isOnline) return previous;
          const next = new Set(previous);
          if (isOnline) next.add(userId);
          else next.delete(userId);
          return next;
        }),
      ),
    ];
    return () => {
      current = false;
      offs.forEach((off) => off());
    };
  }, [realtime]);
  return online;
}

/** Every friend action refreshes the lists right away (the realtime event may follow). */
export function useFriendActions() {
  const api = useApi();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: friendKeys.all });
  const action = <T,>(run: (input: T) => Promise<unknown>) => useMutation({ mutationFn: run, onSettled: refresh });

  return {
    send: useMutation({
      mutationFn: async (username: string) => {
        const { data, error } = await api.POST("/friends/requests", { body: { username } });
        if (!data) throw error;
        return data;
      },
      onSettled: refresh,
    }),
    accept: action(async (requestId: string) => {
      const { error, response } = await api.POST("/friends/requests/{requestId}/accept", { params: { path: { requestId } } });
      if (!response.ok) throw error;
    }),
    decline: action(async (requestId: string) => {
      const { error, response } = await api.POST("/friends/requests/{requestId}/decline", { params: { path: { requestId } } });
      if (!response.ok) throw error;
    }),
    cancel: action(async (requestId: string) => {
      const { error, response } = await api.DELETE("/friends/requests/{requestId}", { params: { path: { requestId } } });
      if (!response.ok) throw error;
    }),
    remove: action(async (userId: string) => {
      const { error, response } = await api.DELETE("/friends/{userId}", { params: { path: { userId } } });
      if (!response.ok) throw error;
    }),
    block: action(async (userId: string) => {
      const { error, response } = await api.PUT("/blocks/{userId}", { params: { path: { userId } } });
      if (!response.ok) throw error;
    }),
    unblock: action(async (userId: string) => {
      const { error, response } = await api.DELETE("/blocks/{userId}", { params: { path: { userId } } });
      if (!response.ok) throw error;
    }),
  };
}
