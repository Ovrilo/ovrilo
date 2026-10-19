import { describe, expect, it } from "vitest";

import { inviteCode, inviteLink, inviteMessage, parseInvite, withoutInviteLink } from "./invites";

describe("invitation links in messages", () => {
  it("round-trips the code through the message text", () => {
    const text = inviteMessage("Raid squad", "Ab3dEf6hIj9k");
    expect(inviteCode(text)).toBe("Ab3dEf6hIj9k");
    expect(withoutInviteLink(text)).toBe("Join me in Raid squad");
  });

  it("ignores text without a valid link", () => {
    expect(inviteCode("see ovrilo://invite/short")).toBeNull();
    expect(inviteCode("ovrilo://invite/Ab3dEf6hIj9kX")).toBeNull();
    expect(inviteCode(null)).toBeNull();
  });
});

describe("parseInvite", () => {
  it("accepts a code, an ovrilo:// link and a website link", () => {
    expect(parseInvite("  Ab3dEf6hIj9k ")).toBe("Ab3dEf6hIj9k");
    expect(parseInvite("ovrilo://invite/Ab3dEf6hIj9k")).toBe("Ab3dEf6hIj9k");
    expect(parseInvite("ovrilo://invite/Ab3dEf6hIj9k/")).toBe("Ab3dEf6hIj9k");
    expect(parseInvite(inviteLink("Ab3dEf6hIj9k"))).toBe("Ab3dEf6hIj9k");
  });

  it("rejects anything else", () => {
    expect(parseInvite("hello")).toBeNull();
    expect(parseInvite("https://example.com/invite.html#Ab3dEf6hIj9kX")).toBeNull();
    expect(parseInvite("ovrilo://invite/short")).toBeNull();
  });
});
