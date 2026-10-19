import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";

import { useRealtime } from "../../auth/SessionContext";
import { useMyStatus } from "../friends/myStatus";
import type { Shown } from "../friends/presence";

/** A program the user marked as a game (exe file name, shown name). */
export interface CustomGame {
  exe: string;
  name: string;
}

export interface ActivitySettings {
  /** Share the game you play with friends and community members. */
  share: boolean;
  games: readonly CustomGame[];
}

/** A running program, and the game Ovrilo already sees in it (games_running_programs). */
export interface RunningProgram {
  exe: string;
  detected: string | null;
}

const STORAGE_KEY = "ovrilo.activity";
const DEFAULTS: ActivitySettings = { share: true, games: [] };
/** How often running programs are checked. */
const DETECT_EVERY_MS = 15_000;

function load(): ActivitySettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ActivitySettings> | null;
    const games = Array.isArray(saved?.games)
      ? saved.games.filter((g): g is CustomGame => typeof g?.exe === "string" && typeof g?.name === "string")
      : [];
    return { share: saved?.share ?? DEFAULTS.share, games };
  } catch {
    return DEFAULTS;
  }
}

/** Settings and the game detected on this computer right now, in one small store. */
let state = { settings: load(), playing: null as string | null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setActivitySettings(settings: ActivitySettings) {
  state = { ...state, settings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Applies for this session only.
  }
  emit();
}

export const useActivitySettings = () => useSyncExternalStore(subscribe, () => state.settings);

/** The game this computer plays now, whether or not it is shared. */
export const useDetectedGame = () => useSyncExternalStore(subscribe, () => state.playing);

/** How you appear in lists yourself: what others see (nothing while invisible). */
export function useMyShown(): Shown | null {
  const status = useMyStatus();
  const settings = useActivitySettings();
  const playing = useDetectedGame();
  return status === "invisible" ? null : { status, playing: settings.share ? playing : null };
}

/** Game detection runs only in the desktop app. */
export const activityAvailable = isTauri();

export const listRunningPrograms = (games: readonly CustomGame[]) =>
  invoke<RunningProgram[]>("games_running_programs", { custom: games });

/**
 * Checks running programs every 15 s and shares the game through presence while sharing is on and
 * you are not invisible. Nothing but the game's name leaves the computer.
 */
export function useGameActivity() {
  const realtime = useRealtime();
  const settings = useActivitySettings();
  const status = useMyStatus();
  const share = settings.share && status !== "invisible";

  useEffect(() => {
    if (!activityAvailable) return;
    let current = true;
    const detect = () =>
      void invoke<string | null>("games_detect", { custom: settings.games })
        .then((playing) => {
          if (!current) return;
          if (playing !== state.playing) {
            state = { ...state, playing };
            emit();
          }
          realtime.setActivity(share ? playing : null);
        })
        .catch(() => undefined);
    detect();
    const timer = setInterval(detect, DETECT_EVERY_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [realtime, settings.games, share]);

  // Signing out or turning sharing off clears what others see.
  useEffect(() => () => realtime.setActivity(null), [realtime]);
}
