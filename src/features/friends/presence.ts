import type { Presence, PresenceEntry, RealtimeEvents } from "../../realtime/realtime";

/** How someone shows to others: their status, the game they play and since when, if any. */
export interface Shown {
  status: Presence;
  playing: string | null;
  /** When the game started (ISO time), if known. */
  since?: string | null;
}

/** Who is online, by user ID. */
export type PresenceMap = ReadonlyMap<string, Shown>;

const shownOf = (status: Presence, activity: PresenceEntry["activity"]): Shown => ({
  status,
  playing: activity?.name ?? null,
  since: activity?.startedAt ?? null,
});

export const presenceMap = (present: PresenceEntry[]): PresenceMap =>
  new Map(present.map((p) => [p.userId, shownOf(p.status, p.activity)]));

/** Applies a PresenceChanged event; returns the same map when nothing changed. */
export function applyPresence(current: PresenceMap, event: RealtimeEvents["PresenceChanged"]): PresenceMap {
  const shown = event.online ? shownOf(event.status ?? "online", event.activity) : null;
  const before = current.get(event.userId) ?? null;
  if (before?.status === shown?.status && before?.playing === shown?.playing && (before?.since ?? null) === (shown?.since ?? null)) {
    return current;
  }
  const next = new Map(current);
  if (shown) next.set(event.userId, shown);
  else next.delete(event.userId);
  return next;
}

/** Class for a presence dot: online (green), away (yellow), doNotDisturb (red), or offline. */
export function presenceClass(status: Presence | null | undefined): string {
  return status === "doNotDisturb" ? "presence-dot dnd" : status === "away" ? "presence-dot away" : status ? "presence-dot online" : "presence-dot";
}

/** How long a game has been running: "just started", "for 5 minutes", "for 2 hours 5 minutes". */
export function playingFor(since: string | null | undefined, now: number): string | null {
  if (!since) return null;
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  if (Number.isNaN(minutes)) return null;
  if (minutes < 1) return "just started";
  if (minutes < 60) return `for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? `for ${hourText}` : `for ${hourText} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
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
