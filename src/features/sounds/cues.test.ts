import { describe, expect, it } from "vitest";

import type { VoiceParticipant } from "../voice/voice";
import { messageCue, voiceCues } from "./cues";

const person = (id: string): VoiceParticipant =>
  ({ id, name: id, speaking: false, volume: 100, locallyMuted: false, muted: false }) as VoiceParticipant;

const state = (over: Partial<Parameters<typeof voiceCues>[0]> = {}) => ({
  connection: "connected" as const,
  channelId: "room",
  microphoneMuted: false,
  deafened: false,
  participants: [person("ada")],
  ...over,
});

describe("voiceCues", () => {
  it("chimes when you connect and when you leave or drop", () => {
    expect(voiceCues(state({ connection: "connecting", participants: [] }), state())).toEqual(["connect"]);
    expect(voiceCues(state(), state({ connection: "disconnected", channelId: null, participants: [] }))).toEqual(["disconnect"]);
    expect(voiceCues(state({ connection: "reconnecting" }), state({ connection: "disconnected" }))).toEqual(["disconnect"]);
    // A successful reconnect is not a new connection.
    expect(voiceCues(state({ connection: "reconnecting" }), state())).toEqual([]);
  });

  it("announces people arriving and leaving the same room only", () => {
    expect(voiceCues(state(), state({ participants: [person("ada"), person("bob")] }))).toEqual(["join"]);
    expect(voiceCues(state({ participants: [person("ada"), person("bob")] }), state())).toEqual(["leave"]);
    // Switching rooms or joining does not chime for everyone already there.
    expect(voiceCues(state(), state({ channelId: "other", participants: [person("cid")] }))).toEqual([]);
    expect(voiceCues(state({ connection: "connecting", participants: [] }), state())).toEqual(["connect"]);
    // Speaking changes are not arrivals.
    expect(voiceCues(state(), state({ participants: [{ ...person("ada"), speaking: true }] }))).toEqual([]);
  });

  it("plays mute and deafen toggles, and only deafen sounds while deafened", () => {
    expect(voiceCues(state(), state({ microphoneMuted: true }))).toEqual(["mute"]);
    expect(voiceCues(state({ microphoneMuted: true }), state())).toEqual(["unmute"]);
    // Deafening also mutes: one sound, not two.
    expect(voiceCues(state(), state({ microphoneMuted: true, deafened: true }))).toEqual(["deafen"]);
    expect(voiceCues(state({ microphoneMuted: true, deafened: true }), state())).toEqual(["undeafen"]);
    expect(
      voiceCues(state({ deafened: true, microphoneMuted: true }), state({ deafened: true, microphoneMuted: true, participants: [] })),
    ).toEqual([]);
  });
});

describe("messageCue", () => {
  const base = { authorId: "bob", selfId: "me", isConversation: true, isOpen: false, windowFocused: true, blocked: false, deafened: false };

  it("sounds for others' messages in conversations you are not reading", () => {
    expect(messageCue(base)).toBe(true);
    expect(messageCue({ ...base, isOpen: true, windowFocused: false })).toBe(true);
    expect(messageCue({ ...base, isOpen: true })).toBe(false);
  });

  it("stays quiet for your own, blocked people's and community messages, and while deafened", () => {
    expect(messageCue({ ...base, authorId: "me" })).toBe(false);
    expect(messageCue({ ...base, blocked: true })).toBe(false);
    expect(messageCue({ ...base, isConversation: false })).toBe(false);
    expect(messageCue({ ...base, deafened: true })).toBe(false);
  });
});
