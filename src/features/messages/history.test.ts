import { describe, expect, it } from "vitest";

import {
  blockedRuns,
  groupRows,
  type History,
  type Message,
  newestId,
  upsertMessage,
  visibleMessages,
  withAuthorProfile,
} from "./history";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 12, minute)).toISOString();

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "c",
    clientMessageId: `client-${id}`,
    author: { id: "ada", displayName: "Ada", avatarAssetId: null },
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
      message(3, { author: { id: "bob", displayName: "Bob", avatarAssetId: null } }),
      message(20, { author: { id: "bob", displayName: "Bob", avatarAssetId: null } }),
      message(21, { author: { id: "bob", displayName: "Bob", avatarAssetId: null }, replyToMessageId: 1 }),
    ]);
    expect(rows.map((r) => r.continued)).toEqual([false, true, false, false, false]);
  });
});

describe("withAuthorProfile", () => {
  it("updates the author on loaded messages and leaves others alone", () => {
    const data = history({ ids: [1, 2], hasMore: false });
    data.pages[0]!.messages[1] = message(2, { author: { id: "bob", displayName: "Bob", avatarAssetId: null } });

    const next = withAuthorProfile(data, "ada", "Ada L.", "asset-1")!;

    expect(next.pages[0]!.messages.map((m) => m.author)).toEqual([
      { id: "ada", displayName: "Ada L.", avatarAssetId: "asset-1" },
      { id: "bob", displayName: "Bob", avatarAssetId: null },
    ]);
  });

  it("returns the same history when the user has no loaded messages", () => {
    const data = history({ ids: [1], hasMore: false });

    expect(withAuthorProfile(data, "nobody", "X", null)).toBe(data);
  });
});

describe("blockedRuns", () => {
  it("groups consecutive messages by blocked authors and leaves everyone else alone", () => {
    const eve = { id: "eve", displayName: "Eve", avatarAssetId: null };
    const mal = { id: "mal", displayName: "Mal", avatarAssetId: null };
    const runs = blockedRuns(
      [message(1), message(2, { author: eve }), message(3, { author: mal }), message(4), message(5, { author: eve })],
      new Set(["eve", "mal"]),
    );
    expect([...runs.keys()]).toEqual([2, 3, 5]);
    expect(runs.get(2)).toEqual({ start: 2, count: 2 });
    expect(runs.get(3)).toBe(runs.get(2));
    expect(runs.get(5)).toEqual({ start: 5, count: 1 });
    expect(blockedRuns([message(1)], new Set()).size).toBe(0);
  });
});
