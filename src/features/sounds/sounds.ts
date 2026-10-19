import { useSyncExternalStore } from "react";

/** Short interface sounds, synthesized with Web Audio so no sound file ships with the app. */
export type SoundKind = "message" | "join" | "leave" | "connect" | "disconnect" | "mute" | "unmute" | "deafen" | "undeafen";

export interface SoundSettings {
  /** Loudness of all sounds, percent (0–100). */
  volume: number;
  /** Sounds turned off by the user; everything is on by default. */
  off: readonly SoundKind[];
}

/** One note: frequency (Hz), start offset and length (s), and its share of the overall loudness. */
interface Note {
  hz: number;
  at: number;
  length: number;
  level?: number;
}

const SOUNDS: Record<SoundKind, { notes: Note[]; wave: OscillatorType }> = {
  // Two soft rising notes: a message arrived.
  message: { wave: "sine", notes: [{ hz: 880, at: 0, length: 0.12 }, { hz: 1318.5, at: 0.09, length: 0.18 }] },
  // Rising pair for arrivals, falling pair for departures.
  join: { wave: "triangle", notes: [{ hz: 587.3, at: 0, length: 0.11 }, { hz: 880, at: 0.08, length: 0.16 }] },
  leave: { wave: "triangle", notes: [{ hz: 880, at: 0, length: 0.11 }, { hz: 587.3, at: 0.08, length: 0.16 }] },
  // A short chord up when you are in, down when you are out.
  connect: {
    wave: "sine",
    notes: [
      { hz: 523.3, at: 0, length: 0.12 },
      { hz: 659.3, at: 0.07, length: 0.12 },
      { hz: 784, at: 0.14, length: 0.22 },
    ],
  },
  disconnect: {
    wave: "sine",
    notes: [
      { hz: 784, at: 0, length: 0.12 },
      { hz: 659.3, at: 0.07, length: 0.12 },
      { hz: 523.3, at: 0.14, length: 0.22 },
    ],
  },
  // Single blips: low for off, higher for on.
  mute: { wave: "sine", notes: [{ hz: 392, at: 0, length: 0.1 }] },
  unmute: { wave: "sine", notes: [{ hz: 698.5, at: 0, length: 0.1 }] },
  deafen: { wave: "sine", notes: [{ hz: 440, at: 0, length: 0.09 }, { hz: 329.6, at: 0.08, length: 0.13 }] },
  undeafen: { wave: "sine", notes: [{ hz: 329.6, at: 0, length: 0.09 }, { hz: 523.3, at: 0.08, length: 0.13 }] },
};

export const SOUND_LABELS: Record<SoundKind, string> = {
  message: "New direct or group message",
  join: "Someone joins your voice room",
  leave: "Someone leaves your voice room",
  connect: "You connect to voice",
  disconnect: "You disconnect from voice",
  mute: "You mute your microphone",
  unmute: "You unmute your microphone",
  deafen: "You deafen",
  undeafen: "You undeafen",
};

const STORAGE_KEY = "ovrilo.sounds";
/** Peak gain of a note at 100 %; quiet enough not to startle over a game. */
const PEAK = 0.16;
const DEFAULTS: SoundSettings = { volume: 70, off: [] };

function load(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SoundSettings> | null;
    if (!saved) return DEFAULTS;
    const volume = typeof saved.volume === "number" ? Math.min(100, Math.max(0, Math.round(saved.volume))) : DEFAULTS.volume;
    const off = Array.isArray(saved.off) ? saved.off.filter((k): k is SoundKind => k in SOUNDS) : [];
    return { volume, off };
  } catch {
    return DEFAULTS;
  }
}

let settings = load();
const listeners = new Set<() => void>();

export function setSoundSettings(next: SoundSettings) {
  settings = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not remembered; it still applies for this session.
  }
  listeners.forEach((l) => l());
}

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

let context: AudioContext | null = null;

/**
 * Plays a sound unless the user turned it off. `force` plays it anyway (settings preview).
 * Silently does nothing where Web Audio is unavailable.
 */
export function playSound(kind: SoundKind, { force = false }: { force?: boolean } = {}) {
  if (!force && settings.off.includes(kind)) return;
  const gainLevel = (settings.volume / 100) * PEAK;
  if (gainLevel <= 0) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const ctx = context;
    const start = ctx.currentTime + 0.01;
    const { notes, wave } = SOUNDS[kind];
    for (const note of notes) {
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = start + note.at;
      const peak = gainLevel * (note.level ?? 1);
      tone.type = wave;
      tone.frequency.value = note.hz;
      // Fast attack, smooth exponential release: no clicks.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.length);
      tone.connect(gain).connect(ctx.destination);
      tone.start(t);
      tone.stop(t + note.length + 0.02);
    }
  } catch {
    // No audio output available.
  }
}
