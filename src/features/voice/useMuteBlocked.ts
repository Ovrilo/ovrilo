import { useEffect, useRef } from "react";

import { useBlocks } from "../friends/friends";
import { useVoice, voice, voiceAvailable } from "./voice";

/**
 * People you blocked are muted for you when they are in your voice channel (participant ids are
 * user ids). Each person is muted once per block: unmuting them from their menu is respected, and
 * unblocking undoes a mute this hook made.
 */
export function useMuteBlockedInVoice() {
  const { snapshot } = useVoice();
  const blocks = useBlocks(voiceAvailable).data;
  /** Blocked people already handled while blocked; true when this hook muted them. */
  const handled = useRef(new Map<string, boolean>());

  useEffect(() => {
    if (!voiceAvailable || !blocks) return;
    const blocked = new Set(blocks.map((b) => b.user.id));
    for (const [id, mutedByUs] of handled.current) {
      if (blocked.has(id)) continue;
      handled.current.delete(id);
      if (mutedByUs) void voice.setParticipantMuted(id, false);
    }
    for (const participant of snapshot.participants) {
      if (!blocked.has(participant.id) || handled.current.has(participant.id)) continue;
      handled.current.set(participant.id, !participant.locallyMuted);
      if (!participant.locallyMuted) void voice.setParticipantMuted(participant.id, true);
    }
  }, [blocks, snapshot.participants]);
}
