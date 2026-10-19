import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useRealtime } from "../../auth/SessionContext";
import { dmKey, type DirectConversation, type GroupConversation, groupKey, groupTitle } from "../friends/dms";
import { type BlockedUser, friendKeys } from "../friends/friends";
import { isDoNotDisturb } from "../friends/myStatus";
import { useVoice } from "../voice/voice";
import { messageCue } from "./cues";

export interface NotificationSettings {
  /** Windows notifications for messages and calls. */
  enabled: boolean;
  /** Show the message text, not just who wrote. */
  preview: boolean;
}

const STORAGE_KEY = "ovrilo.notifications";
const DEFAULTS: NotificationSettings = { enabled: true, preview: true };
/** At most one notification per conversation in this window. */
const PER_CONVERSATION_GAP_MS = 5000;
/** Long messages are cut so the notification stays short. */
const PREVIEW_LENGTH = 140;

function load(): NotificationSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<NotificationSettings> | null;
    return { enabled: saved?.enabled ?? DEFAULTS.enabled, preview: saved?.preview ?? DEFAULTS.preview };
  } catch {
    return DEFAULTS;
  }
}

let settings = load();
const listeners = new Set<() => void>();

export function setNotificationSettings(next: NotificationSettings) {
  settings = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Applies for this session only.
  }
  listeners.forEach((l) => l());
}

export function useNotificationSettings(): NotificationSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

/** Windows notifications exist only in the desktop app. */
export const desktopNotificationsAvailable = isTauri();

function show(title: string, body: string, conversationId: string | null) {
  if (!desktopNotificationsAvailable) return;
  void invoke("notify_show", { title, body, conversationId }).catch(() => {
    // Notifications turned off in Windows, or Focus Assist: nothing to do.
  });
}

/**
 * Windows notifications for new direct and group messages (same rules as the message sound) and
 * incoming calls while the window is in the background. Clicking one calls `onOpen` with its
 * conversation.
 */
export function useDesktopNotifications(selfId: string, openConversationId: string | null, onOpen: (conversationId: string) => void) {
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const { snapshot } = useVoice();
  const state = useRef({ open: openConversationId, deafened: snapshot.deafened, onOpen });
  state.current = { open: openConversationId, deafened: snapshot.deafened, onOpen };

  useEffect(() => {
    if (!desktopNotificationsAvailable) return;
    const lastShown = new Map<string, number>();
    const focused = () => document.hasFocus() && !document.hidden;

    const offMessage = realtime.on("MessageCreated", (message) => {
      if (!settings.enabled || isDoNotDisturb()) return;
      const channelId = message.channelId;
      const dm = queryClient.getQueryData<DirectConversation[]>(dmKey)?.find((c) => c.id === channelId);
      const group = queryClient.getQueryData<GroupConversation[]>(groupKey)?.find((g) => g.id === channelId);
      const blocked =
        queryClient.getQueryData<BlockedUser[]>(friendKeys.blocks)?.some((b) => b.user.id === message.author.id) ?? false;
      const due = messageCue({
        authorId: message.author.id,
        selfId,
        isConversation: Boolean(dm || group),
        isOpen: state.current.open === channelId,
        windowFocused: focused(),
        blocked,
        deafened: state.current.deafened,
      });
      const now = Date.now();
      if (!due || now - (lastShown.get(channelId) ?? 0) < PER_CONVERSATION_GAP_MS) return;
      lastShown.set(channelId, now);
      const author = message.author.displayName ?? "Someone";
      const title = group ? `${author} in ${groupTitle(group, selfId)}` : author;
      const text = message.content ?? "";
      const body = settings.preview
        ? text.length > PREVIEW_LENGTH
          ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
          : text
        : "Sent you a message";
      show(title, body, channelId);
    });

    const offCall = realtime.on("CallRinging", (ring) => {
      if (!settings.enabled || isDoNotDisturb() || focused()) return;
      const where = ring.isGroup ? (ring.groupName ?? "your group") : "you";
      show(`${ring.caller.displayName} is calling ${where}`, "Open Ovrilo to answer.", ring.conversationId);
    });

    const activated = listen<string | null>("notification-activated", (event) => {
      if (event.payload) state.current.onOpen(event.payload);
    });

    return () => {
      offMessage();
      offCall();
      void activated.then((off) => off());
    };
  }, [realtime, queryClient, selfId]);
}
