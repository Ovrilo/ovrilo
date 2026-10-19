import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useRealtime } from "../../auth/SessionContext";
import { dmKey, type DirectConversation, type GroupConversation, groupKey } from "../friends/dms";
import { type BlockedUser, friendKeys } from "../friends/friends";
import { useVoice } from "../voice/voice";
import { messageCue, voiceCues } from "./cues";
import { playSound } from "./sounds";

/** At most one message sound in this window, so a burst of messages does not chatter. */
const MESSAGE_SOUND_GAP_MS = 1500;

/**
 * Plays notification sounds for voice changes and for new direct and group messages.
 * `openConversationId` is the conversation on screen, if any.
 */
export function useSoundCues(selfId: string, openConversationId: string | null) {
  const { snapshot } = useVoice();
  const previous = useRef(snapshot);
  useEffect(() => {
    const cues = voiceCues(previous.current, snapshot);
    previous.current = snapshot;
    new Set(cues).forEach((cue) => playSound(cue));
  }, [snapshot]);

  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const open = useRef(openConversationId);
  open.current = openConversationId;
  const deafened = useRef(snapshot.deafened);
  deafened.current = snapshot.deafened;
  useEffect(() => {
    let lastPlayed = 0;
    return realtime.on("MessageCreated", (message) => {
      const channelId = message.channelId;
      // Known conversations, or a channel no community lists: the first message of a new conversation.
      const isConversation =
        (queryClient.getQueryData<DirectConversation[]>(dmKey)?.some((c) => c.id === channelId) ?? false) ||
        (queryClient.getQueryData<GroupConversation[]>(groupKey)?.some((g) => g.id === channelId) ?? false) ||
        !queryClient
          .getQueriesData<{ channelId: string }[]>({ predicate: (q) => q.queryKey[0] === "communities" && q.queryKey[2] === "unread" })
          .some(([, list]) => list?.some((u) => u.channelId === channelId));
      const blocked =
        queryClient.getQueryData<BlockedUser[]>(friendKeys.blocks)?.some((b) => b.user.id === message.author.id) ?? false;
      const play = messageCue({
        authorId: message.author.id,
        selfId,
        isConversation,
        isOpen: open.current === channelId,
        windowFocused: document.hasFocus() && !document.hidden,
        blocked,
        deafened: deafened.current,
      });
      const now = Date.now();
      if (play && now - lastPlayed >= MESSAGE_SOUND_GAP_MS) {
        lastPlayed = now;
        playSound("message");
      }
    });
  }, [realtime, queryClient, selfId]);
}
