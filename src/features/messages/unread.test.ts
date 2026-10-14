import { describe, expect, it } from "vitest";

import type { Message } from "./history";
import { applyCreated, applyRead, type ChannelUnread, UNREAD_CAP, unreadLabel } from "./unread";

const entry = (overrides: Partial<ChannelUnread> = {}): ChannelUnread => ({
  channelId: "general",
  lastReadMessageId: 10,
  lastMessageId: 10,
  unreadCount: 0,
  ...overrides,
});

const message = (id: number, authorId = "ada", channelId = "general"): Message => ({
  id,
  channelId,
  clientMessageId: `client-${id}`,
  author: { id: authorId, displayName: authorId },
  content: "hi",
  replyToMessageId: null,
  createdAt: new Date(0).toISOString(),
  editedAt: null,
  deletedAt: null,
});

describe("applyCreated", () => {
  it("counts other people's new messages once", () => {
    const once = applyCreated([entry()], message(11), "me");
    expect(once[0]).toMatchObject({ lastMessageId: 11, unreadCount: 1 });
    // The same event delivered twice (or after a refetch) does not count again.
    expect(applyCreated(once, message(11), "me")[0]!.unreadCount).toBe(1);
  });

  it("treats our own message as read up to it", () => {
    const next = applyCreated([entry({ lastMessageId: 12, unreadCount: 2 })], message(13, "me"), "me");
    expect(next[0]).toMatchObject({ lastReadMessageId: 13, unreadCount: 0 });
  });

  it("stops at the cap and leaves other channels alone", () => {
    const full = [entry({ lastMessageId: 50, unreadCount: UNREAD_CAP }), entry({ channelId: "other" })];
    const next = applyCreated(full, message(51), "me");
    expect(next[0]!.unreadCount).toBe(UNREAD_CAP);
    expect(next[1]).toBe(full[1]);
    expect(unreadLabel(UNREAD_CAP)).toBe("99+");
  });
});

describe("applyRead", () => {
  it("clears the count when read to the newest message", () => {
    expect(applyRead([entry({ lastMessageId: 14, unreadCount: 4 })], "general", 14)![0]).toMatchObject({
      lastReadMessageId: 14,
      unreadCount: 0,
    });
  });

  it("asks for a recount when read only part of the way", () => {
    expect(applyRead([entry({ lastMessageId: 14, unreadCount: 4 })], "general", 12)).toBeNull();
  });

  it("ignores positions that do not move forward", () => {
    const list = [entry({ lastMessageId: 14, unreadCount: 4 })];
    expect(applyRead(list, "general", 9)).toBe(list);
  });
});
