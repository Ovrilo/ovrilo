import { useMutation } from "@tanstack/react-query";

import { useApi } from "../../auth/SessionContext";
import { voice } from "./voice";

/** Requests an authorized SFU grant from the API and hands it to the native engine. */
export function useJoinVoice() {
  const api = useApi();
  return useMutation({
    mutationFn: async (channelId: string) => {
      const { data, error } = await api.POST("/channels/{channelId}/voice/join", {
        params: { path: { channelId } },
      });
      if (!data) throw error;
      await voice.join(channelId, data.serverUrl, data.token, data.canShareScreen);
    },
  });
}
