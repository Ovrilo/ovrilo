import { describe, expect, it } from "vitest";

import type { Schemas } from "../../api/client";
import { dropIndex, moveChannel } from "./channelOrder";

type Channel = Schemas["ChannelResponse"];

function channel(id: string, type: Channel["type"], position: number): Channel {
  return { id, communityId: "c", name: id, type, topic: null, position, createdAt: "2026-10-15T00:00:00Z" };
}

const list = [
  channel("general", "text", 0),
  channel("clips", "text", 1),
  channel("memes", "text", 2),
  channel("General", "voice", 0),
  channel("Lobby", "voice", 1),
];

const summary = (channels: Channel[]) => channels.map((c) => `${c.id}:${c.position}`);

describe("moveChannel", () => {
  it("moves within its type and renumbers it like the server", () => {
    expect(summary(moveChannel(list, "memes", 0))).toEqual(["memes:0", "general:1", "clips:2", "General:0", "Lobby:1"]);
    expect(summary(moveChannel(list, "general", 1))).toEqual(["clips:0", "general:1", "memes:2", "General:0", "Lobby:1"]);
  });

  it("treats an index past the end as last and leaves other types alone", () => {
    expect(summary(moveChannel(list, "General", 9))).toEqual(["general:0", "clips:1", "memes:2", "Lobby:0", "General:1"]);
  });

  it("closes gaps left by deleted channels", () => {
    const gappy = [channel("a", "text", 0), channel("b", "text", 4), channel("c", "text", 7)];
    expect(summary(moveChannel(gappy, "a", 2))).toEqual(["b:0", "c:1", "a:2"]);
  });

  it("returns the list unchanged for an unknown channel", () => {
    expect(moveChannel(list, "nope", 0)).toEqual(list);
  });
});

describe("dropIndex", () => {
  it("accounts for the dragged row leaving its old place", () => {
    // [a, b, c]: drag a below c → last; drag c above a → first; drop onto itself → no move.
    expect(dropIndex(0, 2, true)).toBe(2);
    expect(dropIndex(2, 0, false)).toBe(0);
    expect(dropIndex(1, 1, false)).toBe(1);
    expect(dropIndex(1, 1, true)).toBe(1);
    // a above c → between b and c.
    expect(dropIndex(0, 2, false)).toBe(1);
  });
});
