import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";

/** The status you choose for others to see (PUT /users/me/status). */
export type Availability = Schemas["Availability"];

let chosen: Availability = "online";
const listeners = new Set<() => void>();

function set(next: Availability) {
  if (next === chosen) return;
  chosen = next;
  listeners.forEach((l) => l());
}

export function useMyStatus(): Availability {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => chosen,
  );
}

/** Do not disturb silences message sounds, Windows notifications and the ringtone. */
export const isDoNotDisturb = () => chosen === "doNotDisturb";

/** Starts from the account's stored choice. */
export function useInitialStatus(availability: Availability | undefined) {
  useEffect(() => set(availability ?? "online"), [availability]);
}

/** Changes your status; shown at once, reverted if the server refuses. */
export function useSetMyStatus() {
  const api = useApi();
  return async (next: Availability) => {
    const previous = chosen;
    set(next);
    const { response } = await api.PUT("/users/me/status", { body: { availability: next } });
    if (!response.ok) set(previous);
  };
}

/** No keyboard or mouse input for this long counts as away. */
const IDLE_AFTER_SECONDS = 10 * 60;
const IDLE_CHECK_MS = 30_000;

/** Reports this computer as idle to the server after 10 minutes without input (desktop only). */
export function useIdleReporting() {
  const realtime = useRealtime();
  useEffect(() => {
    if (!isTauri()) return;
    const check = () =>
      void invoke<number>("idle_seconds")
        .then((seconds) => realtime.setIdle(seconds >= IDLE_AFTER_SECONDS))
        .catch(() => undefined);
    check();
    const timer = setInterval(check, IDLE_CHECK_MS);
    return () => {
      clearInterval(timer);
      realtime.setIdle(false);
    };
  }, [realtime]);
}
