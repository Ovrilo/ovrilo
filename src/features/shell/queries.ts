import { useQuery } from "@tanstack/react-query";

import { useApi } from "../../auth/SessionContext";

export const queryKeys = {
  communities: ["communities"] as const,
  channels: (communityId: string) => ["communities", communityId, "channels"] as const,
  voiceStates: (communityId: string) => ["communities", communityId, "voice-states"] as const,
};

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
