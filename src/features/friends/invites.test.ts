import { describe, expect, it } from "vitest";

import { inviteCode, inviteMessage, withoutInviteLink } from "./invites";

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
