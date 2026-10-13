import { useQuery } from "@tanstack/react-query";

import { useApi } from "../../auth/SessionContext";

export const queryKeys = {
  communities: ["communities"] as const,
  channels: (communityId: string) => ["communities", communityId, "channels"] as const,
};

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
