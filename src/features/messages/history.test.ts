import { describe, expect, it } from "vitest";

import { groupRows, type History, type Message, newestId, upsertMessage, visibleMessages } from "./history";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 12, minute)).toISOString();

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "c",
    clientMessageId: `client-${id}`,
    author: { id: "ada", displayName: "Ada" },
    content: `message ${id}`,
    replyToMessageId: null,
    createdAt: at(id),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function history(...pages: { ids: number[]; hasMore: boolean }[]): History {
  return {
    pages: pages.map((p) => ({ messages: p.ids.map((id) => message(id)), hasMore: p.hasMore })),
    pageParams: pages.map(() => null),
  };
}

describe("upsertMessage", () => {
  it("appends new messages to the newest page in id order", () => {
    const next = upsertMessage(history({ ids: [4, 5], hasMore: true }, { ids: [1, 2], hasMore: false }), message(7));
    expect(next!.pages[0]!.messages.map((m) => m.id)).toEqual([4, 5, 7]);
    expect(newestId(next)).toBe(7);
  });

  it("replaces existing messages wherever they are (edits, deletes, duplicate delivery)", () => {
    const start = history({ ids: [4, 5], hasMore: true }, { ids: [1, 2], hasMore: false });
    const edited = upsertMessage(start, message(2, { content: "edited" }));
    expect(edited!.pages[1]!.messages[1]!.content).toBe("edited");
    const again = upsertMessage(edited, message(2, { content: "edited" }));
    expect(visibleMessages(again).map((m) => m.id)).toEqual([1, 2, 4, 5]);
  });

  it("ignores messages older than the loaded window", () => {
    const start = history({ ids: [10, 11], hasMore: true });
    expect(upsertMessage(start, message(3))).toBe(start);
  });

  it("does nothing before the first page has loaded", () => {
    expect(upsertMessage(undefined, message(1))).toBeUndefined();
  });
});

describe("visibleMessages", () => {
  it("flattens oldest first and hides tombstones", () => {
    const start = history({ ids: [4, 5], hasMore: true }, { ids: [1, 2], hasMore: false });
    const deleted = upsertMessage(start, message(4, { content: null, deletedAt: at(30) }));
    expect(visibleMessages(deleted).map((m) => m.id)).toEqual([1, 2, 5]);
  });
});

describe("groupRows", () => {
  it("groups consecutive messages by the same author close in time", () => {
    const rows = groupRows([
      message(1),
      message(2),
      message(3, { author: { id: "bob", displayName: "Bob" } }),
      message(20, { author: { id: "bob", displayName: "Bob" } }),
      message(21, { author: { id: "bob", displayName: "Bob" }, replyToMessageId: 1 }),
    ]);
    expect(rows.map((r) => r.continued)).toEqual([false, true, false, false, false]);
  });
});
