import { describe, expect, it } from "vitest";

import { applyPresence, presenceClass, presenceMap } from "./presence";

describe("applyPresence", () => {
  const start = presenceMap([{ userId: "ada", status: "online" }]);

  it("tracks status changes, arrivals and departures", () => {
    const away = applyPresence(start, { userId: "ada", online: true, status: "away" });
    expect(away.get("ada")).toBe("away");
    const bob = applyPresence(away, { userId: "bob", online: true, status: "doNotDisturb" });
    expect(bob.get("bob")).toBe("doNotDisturb");
    expect(applyPresence(bob, { userId: "ada", online: false, status: null }).has("ada")).toBe(false);
  });

  it("keeps the same map when nothing changed", () => {
    expect(applyPresence(start, { userId: "ada", online: true, status: "online" })).toBe(start);
    expect(applyPresence(start, { userId: "cid", online: false })).toBe(start);
  });

  it("reads events from servers without statuses as online", () => {
    expect(applyPresence(new Map(), { userId: "ada", online: true }).get("ada")).toBe("online");
  });
});

describe("presenceClass", () => {
  it("colours each status", () => {
    expect(presenceClass("online")).toBe("presence-dot online");
    expect(presenceClass("away")).toBe("presence-dot away");
    expect(presenceClass("doNotDisturb")).toBe("presence-dot dnd");
    expect(presenceClass(null)).toBe("presence-dot");
  });
});
