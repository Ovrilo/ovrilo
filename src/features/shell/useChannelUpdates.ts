import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useRealtime } from "../../auth/SessionContext";
import { unreadKey } from "../messages/unread";
import { voice } from "../voice/voice";
import { queryKeys } from "./queries";

/**
 * Keeps every community's channel list current (ChannelsChanged) and watches all of the user's
 * communities, so community events (channels, icons, avatars, presence) arrive even when no member
 * list is open. A deleted voice channel we are connected to is left.
 */
export function useChannelUpdates(communityIds: readonly string[], connectedChannelId: string | null) {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const connected = useRef(connectedChannelId);
  connected.current = connectedChannelId;
  const ids = communityIds.join(",");

  useEffect(() => {
    if (!ids) return;
    const unsubscribe = ids.split(",").map((id) => realtime.subscribeCommunity(id, () => undefined));
    return () => unsubscribe.forEach((off) => off());
  }, [realtime, ids]);

  useEffect(() => {
    const offChanged = realtime.on("ChannelsChanged", ({ communityId, channelId, change }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.channels(communityId) });
      // New channels need an unread entry before they can be marked read; deleted ones drop out.
      if (change !== "updated") void queryClient.invalidateQueries({ queryKey: unreadKey(communityId) });
      if (change === "deleted" && channelId === connected.current) void voice.leave();
    });
    // Changes made while disconnected were missed.
    const offResync = realtime.onResync(
      () => void queryClient.invalidateQueries({ queryKey: ["communities"], predicate: (q) => q.queryKey[2] === "channels" }),
    );
    return () => {
      offChanged();
      offResync();
    };
  }, [realtime, queryClient]);
}
