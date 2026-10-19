import type { Presence, PresenceEntry, RealtimeEvents } from "../../realtime/realtime";

/** Who is online and how, by user ID. */
export type PresenceMap = ReadonlyMap<string, Presence>;

export const presenceMap = (present: PresenceEntry[]): PresenceMap => new Map(present.map((p) => [p.userId, p.status]));

/** Applies a PresenceChanged event; returns the same map when nothing changed. */
export function applyPresence(current: PresenceMap, event: RealtimeEvents["PresenceChanged"]): PresenceMap {
  const status: Presence | null = event.online ? (event.status ?? "online") : null;
  if ((current.get(event.userId) ?? null) === status) return current;
  const next = new Map(current);
  if (status) next.set(event.userId, status);
  else next.delete(event.userId);
  return next;
}

/** Class for a presence dot: online (green), away (yellow), doNotDisturb (red), or offline. */
export function presenceClass(status: Presence | null | undefined): string {
  return status === "doNotDisturb" ? "presence-dot dnd" : status === "away" ? "presence-dot away" : status ? "presence-dot online" : "presence-dot";
}

export const PRESENCE_LABEL: Record<Presence | "offline", string> = {
  online: "Online",
  away: "Away",
  doNotDisturb: "Do not disturb",
  offline: "Offline",
};
