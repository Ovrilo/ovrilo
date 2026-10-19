import type { Presence, PresenceEntry, RealtimeEvents } from "../../realtime/realtime";

/** How someone shows to others: their status and the game they play, if any. */
export interface Shown {
  status: Presence;
  playing: string | null;
}

/** Who is online, by user ID. */
export type PresenceMap = ReadonlyMap<string, Shown>;

export const presenceMap = (present: PresenceEntry[]): PresenceMap =>
  new Map(present.map((p) => [p.userId, { status: p.status, playing: p.activity?.name ?? null }]));

/** Applies a PresenceChanged event; returns the same map when nothing changed. */
export function applyPresence(current: PresenceMap, event: RealtimeEvents["PresenceChanged"]): PresenceMap {
  const shown: Shown | null = event.online ? { status: event.status ?? "online", playing: event.activity?.name ?? null } : null;
  const before = current.get(event.userId) ?? null;
  if (before?.status === shown?.status && before?.playing === shown?.playing) return current;
  const next = new Map(current);
  if (shown) next.set(event.userId, shown);
  else next.delete(event.userId);
  return next;
}

/** Class for a presence dot: online (green), away (yellow), doNotDisturb (red), or offline. */
export function presenceClass(status: Presence | null | undefined): string {
  return status === "doNotDisturb" ? "presence-dot dnd" : status === "away" ? "presence-dot away" : status ? "presence-dot online" : "presence-dot";
}

/** The line under a name: "Playing X", or the status. */
export const presenceLine = (shown: Shown | null): string =>
  shown ? (shown.playing ? `Playing ${shown.playing}` : PRESENCE_LABEL[shown.status]) : PRESENCE_LABEL.offline;

export const PRESENCE_LABEL: Record<Presence | "offline", string> = {
  online: "Online",
  away: "Away",
  doNotDisturb: "Do not disturb",
  offline: "Offline",
};
