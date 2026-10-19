import { describe, expect, it } from "vitest";

import { applyPresence, presenceClass, presenceLine, presenceMap } from "./presence";

describe("applyPresence", () => {
  const start = presenceMap([{ userId: "ada", status: "online" }]);

  it("tracks status changes, arrivals and departures", () => {
    const away = applyPresence(start, { userId: "ada", online: true, status: "away" });
    expect(away.get("ada")).toEqual({ status: "away", playing: null });
    const bob = applyPresence(away, { userId: "bob", online: true, status: "doNotDisturb" });
    expect(bob.get("bob")?.status).toBe("doNotDisturb");
    expect(applyPresence(bob, { userId: "ada", online: false, status: null }).has("ada")).toBe(false);
  });

  it("tracks the game people play", () => {
    const playing = applyPresence(start, { userId: "ada", online: true, status: "online", activity: { type: "playing", name: "Valorant" } });
    expect(playing.get("ada")).toEqual({ status: "online", playing: "Valorant" });
    expect(applyPresence(playing, { userId: "ada", online: true, status: "online", activity: null }).get("ada")?.playing).toBeNull();
    expect(presenceMap([{ userId: "cid", status: "away", activity: { type: "playing", name: "Minecraft" } }]).get("cid")).toEqual({
      status: "away",
      playing: "Minecraft",
    });
  });

  it("keeps the same map when nothing changed", () => {
    expect(applyPresence(start, { userId: "ada", online: true, status: "online" })).toBe(start);
    expect(applyPresence(start, { userId: "cid", online: false })).toBe(start);
  });

  it("reads events from servers without statuses as online", () => {
    expect(applyPresence(new Map(), { userId: "ada", online: true }).get("ada")).toEqual({ status: "online", playing: null });
  });
});

describe("presenceClass and presenceLine", () => {
  it("colours each status", () => {
    expect(presenceClass("online")).toBe("presence-dot online");
    expect(presenceClass("away")).toBe("presence-dot away");
    expect(presenceClass("doNotDisturb")).toBe("presence-dot dnd");
    expect(presenceClass(null)).toBe("presence-dot");
  });

  it("says what someone plays before their status", () => {
    expect(presenceLine({ status: "away", playing: "Valorant" })).toBe("Playing Valorant");
    expect(presenceLine({ status: "doNotDisturb", playing: null })).toBe("Do not disturb");
    expect(presenceLine(null)).toBe("Offline");
  });
});
