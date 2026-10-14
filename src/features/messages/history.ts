import type { InfiniteData } from "@tanstack/react-query";

import type { Schemas } from "../../api/client";

export type Message = Schemas["MessageResponse"];
export type MessagePage = Schemas["MessagePageResponse"];
/** pages[0] is the newest page; later pages are older. Each page is in ascending id order. */
export type History = InfiniteData<MessagePage, number | null>;

/**
 * Applies a message from the server (event, send response or catch-up). Idempotent: an existing
 * id is replaced (edit/delete); a new one is added to the newest page in id order. Messages older
 * than everything loaded are ignored; they arrive when that history is paged in.
 */
export function upsertMessage(history: History | undefined, message: Message): History | undefined {
  if (!history || history.pages.length === 0) return history;

  let found = false;
  const pages = history.pages.map((page) => {
    const index = page.messages.findIndex((m) => m.id === message.id);
    if (index === -1) return page;
    found = true;
    const messages = page.messages.slice();
    messages[index] = message;
    return { ...page, messages };
  });
  if (found) return { ...history, pages };

  const oldestLoaded = oldestId(history);
  const hasOlder = history.pages[history.pages.length - 1]?.hasMore ?? false;
  if (hasOlder && oldestLoaded !== null && message.id < oldestLoaded) return history;

  const newest = pages[0]!;
  const messages = [...newest.messages, message].sort((a, b) => a.id - b.id);
  pages[0] = { ...newest, messages };
  return { ...history, pages };
}

/** Shows someone's new name/picture on messages already loaded. Returns the same object when nothing changed. */
export function withAuthorProfile(
  history: History | undefined,
  userId: string,
  displayName: string,
  avatarAssetId: string | null,
): History | undefined {
  if (!history) return history;
  let changed = false;
  const pages = history.pages.map((page) => {
    if (!page.messages.some((m) => m.author.id === userId)) return page;
    changed = true;
    return {
      ...page,
      messages: page.messages.map((m) => (m.author.id === userId ? { ...m, author: { id: userId, displayName, avatarAssetId } } : m)),
    };
  });
  return changed ? { ...history, pages } : history;
}

/** All loaded, non-deleted messages in ascending order. */
export function visibleMessages(history: History | undefined): Message[] {
  if (!history) return [];
  return history.pages
    .slice()
    .reverse()
    .flatMap((page) => page.messages)
    .filter((m) => !m.deletedAt);
}

export function newestId(history: History | undefined): number | null {
  const newest = history?.pages[0]?.messages;
  return newest && newest.length > 0 ? newest[newest.length - 1]!.id : null;
}

function oldestId(history: History): number | null {
  const oldest = history.pages[history.pages.length - 1]?.messages;
  return oldest && oldest.length > 0 ? oldest[0]!.id : null;
}

/** Consecutive messages by the same author within this window are shown without a repeated header. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

export interface MessageRow {
  message: Message;
  /** Same author as the previous row, close in time: render compactly. */
  continued: boolean;
}

export function groupRows(messages: Message[]): MessageRow[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const continued =
      previous !== undefined &&
      previous.author.id === message.author.id &&
      message.replyToMessageId == null &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS;
    return { message, continued };
  });
}
