import { describe, expect, it } from "vitest";

import { type GroupConversation, groupTitle } from "./dms";

const member = (id: string, displayName: string) => ({ id, username: displayName.toLowerCase(), displayName, avatarAssetId: null });

function group(name: string | null, ...names: string[]): GroupConversation {
  return {
    id: "g",
    name,
    ownerId: "me",
    members: [member("me", "Me"), ...names.map((n) => member(n, n))],
    lastMessageId: null,
    lastActivityAt: "2026-10-17T00:00:00Z",
    lastReadMessageId: null,
    unreadCount: 0,
  };
}

describe("groupTitle", () => {
  it("uses the group's name when it has one", () => {
    expect(groupTitle(group("Raid night", "Ada"), "me")).toBe("Raid night");
  });

  it("lists the other members otherwise", () => {
    expect(groupTitle(group(null, "Ada"), "me")).toBe("Ada");
    expect(groupTitle(group(null, "Ada", "Bob"), "me")).toBe("Ada and Bob");
    expect(groupTitle(group(null, "Ada", "Bob", "Cid"), "me")).toBe("Ada, Bob and Cid");
  });

  it("names a group everyone else left", () => {
    expect(groupTitle(group(null), "me")).toBe("Empty group");
  });
});
