import type { VoiceSnapshot } from "../voice/voice";
import type { SoundKind } from "./sounds";

type VoiceState = Pick<VoiceSnapshot, "connection" | "channelId" | "microphoneMuted" | "deafened" | "participants">;

/**
 * Sounds for a change in the voice engine's state: joining and leaving rooms, people arriving and
 * leaving, and the user's own mute and deafen toggles. While deafened only the deafen sounds play.
 */
export function voiceCues(previous: VoiceState, next: VoiceState): SoundKind[] {
  const cues: SoundKind[] = [];
  const wasIn = previous.connection === "connected" || previous.connection === "reconnecting";

  if (next.connection === "connected" && previous.connection === "connecting") cues.push("connect");
  if (wasIn && next.connection === "disconnected") cues.push("disconnect");

  if (previous.deafened !== next.deafened) {
    cues.push(next.deafened ? "deafen" : "undeafen");
  } else if (previous.microphoneMuted !== next.microphoneMuted && !next.deafened) {
    cues.push(next.microphoneMuted ? "mute" : "unmute");
  }

  // Arrivals and departures only within the same room while connected, so joining, switching
  // rooms or a reconnect do not chime for everyone already there.
  const sameRoom =
    previous.connection === "connected" && next.connection === "connected" && previous.channelId === next.channelId;
  if (sameRoom && !next.deafened) {
    const before = new Set(previous.participants.map((p) => p.id));
    const after = new Set(next.participants.map((p) => p.id));
    if (next.participants.some((p) => !before.has(p.id))) cues.push("join");
    if (previous.participants.some((p) => !after.has(p.id))) cues.push("leave");
  }
  return cues;
}

/** Whether a new message should make a sound: someone else, in a conversation you are not reading. */
export function messageCue(options: {
  authorId: string;
  selfId: string;
  isConversation: boolean;
  isOpen: boolean;
  windowFocused: boolean;
  blocked: boolean;
  deafened: boolean;
}): boolean {
  const { authorId, selfId, isConversation, isOpen, windowFocused, blocked, deafened } = options;
  if (authorId === selfId || !isConversation || blocked || deafened) return false;
  return !(isOpen && windowFocused);
}
