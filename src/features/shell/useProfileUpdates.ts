import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime, useSession } from "../../auth/SessionContext";
import { type History, withAuthorProfile } from "../messages/history";
import { queryKeys } from "./queries";

/**
 * Keeps names and pictures current when someone changes their avatar or an owner changes a
 * community icon (UserUpdated / CommunityUpdated). New asset IDs load new images; old ones stay
 * cached until sign-out.
 */
export function useProfileUpdates(selfId: string) {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const api = useApi();
  const { session } = useSession();

  useEffect(() => {
    const offUser = realtime.on("UserUpdated", ({ userId, displayName, avatarAssetId }) => {
      queryClient.setQueriesData<History>({ queryKey: ["channels"] }, (data) =>
        withAuthorProfile(data, userId, displayName, avatarAssetId),
      );
      // Member lists: ["communities", id, "members"]. Voice occupancy refreshes by itself.
      queryClient.setQueriesData<Schemas["MemberResponse"][]>(
        { queryKey: ["communities"], predicate: (query) => query.queryKey[2] === "members" },
        (data) => data?.map((m) => (m.userId === userId ? { ...m, displayName, avatarAssetId } : m)),
      );
      // Our own change made on another device.
      if (userId === selfId) {
        void api.GET("/users/me").then(({ data }) => data && session.updateUser(data));
      }
    });
    const offCommunity = realtime.on("CommunityUpdated", ({ communityId, name, description, iconAssetId }) => {
      queryClient.setQueryData<Schemas["CommunityResponse"][]>(queryKeys.communities, (data) =>
        data?.map((c) => (c.id === communityId ? { ...c, name, description, iconAssetId } : c)),
      );
    });
    return () => {
      offUser();
      offCommunity();
    };
  }, [realtime, queryClient, api, session, selfId]);
}
