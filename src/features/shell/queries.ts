import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Schemas } from "../../api/client";
import { useApi } from "../../auth/SessionContext";

export const queryKeys = {
  communities: ["communities"] as const,
  channels: (communityId: string) => ["communities", communityId, "channels"] as const,
  voiceStates: (communityId: string) => ["communities", communityId, "voice-states"] as const,
  members: (communityId: string) => ["communities", communityId, "members"] as const,
};

/**
 * A community we left or that was deleted: take it out of the list first (so the shell switches to
 * another one), then drop its cached channels, members and unread state instead of refetching them.
 */
export function dropCommunity(queryClient: QueryClient, communityId: string) {
  queryClient.setQueryData<Schemas["CommunityResponse"][]>(queryKeys.communities, (list) =>
    list?.filter((c) => c.id !== communityId),
  );
  queryClient.removeQueries({ queryKey: ["communities", communityId] });
}

/** Refresh interval for voice channel occupancy until realtime push (SignalR, Phase 04) replaces it. */
const VOICE_STATES_REFRESH_MS = 5000;

/**
 * Who is in each voice channel of a community, from the server (visible without joining).
 * Polls only while the window is visible; a failed refresh keeps showing the last result.
 */
export function useVoiceStates(communityId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.voiceStates(communityId ?? ""),
    enabled: communityId !== null,
    refetchInterval: VOICE_STATES_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.GET("/communities/{communityId}/voice-states", {
        params: { path: { communityId: communityId! } },
      });
      if (!data) throw error;
      return data;
    },
  });
}

export function useCommunities() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.communities,
    queryFn: async () => {
      const { data, error } = await api.GET("/communities");
      if (!data) throw error;
      return data;
    },
  });
}

export function useChannels(communityId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.channels(communityId ?? ""),
    enabled: communityId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/communities/{communityId}/channels", {
        params: { path: { communityId: communityId! } },
      });
      if (!data) throw error;
      return data;
    },
  });
}

/**
 * Avatar asset IDs of a community's members by user ID, for views that only know user IDs (voice
 * participants come from the voice engine). Reuses the members list query.
 */
export function useMemberAvatars(communityId: string | null): ReadonlyMap<string, string | null> {
  const members = useMembers(communityId);
  return useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m.avatarAssetId])), [members.data]);
}

export function useMembers(communityId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.members(communityId ?? ""),
    enabled: communityId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/communities/{communityId}/members", {
        params: { path: { communityId: communityId! } },
      });
      if (!data) throw error;
      return data;
    },
  });
}
