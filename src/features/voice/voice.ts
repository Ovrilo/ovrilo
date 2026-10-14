import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMemo, useSyncExternalStore } from "react";

import type { PushToTalkKey } from "./keys";
import { summarize, type QualitySummary, type VoiceStats } from "./quality";

/** IPC payloads mirrored from src-tauri/src/voice.rs (docs/development/CONTRACTS.md §4). */
export type VoiceConnection = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface VoiceDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface VoiceParticipant {
  /** SFU identity: the participant's user ID. */
  id: string;
  name: string;
  speaking: boolean;
  /** Local playback volume, percent (100 = unchanged, 0–200). */
  volume: number;
  /** Muted for this client only. */
  locallyMuted: boolean;
  /** The participant muted their own microphone. */
  muted: boolean;
}

export interface VoiceSnapshot {
  connection: VoiceConnection;
  channelId: string | null;
  microphoneMuted: boolean;
  deafened: boolean;
  /** False while in a room means listen-only (no microphone could be opened). */
  microphoneActive: boolean;
  /** The local user is talking (never while muted or deafened). */
  selfSpeaking: boolean;
  participants: VoiceParticipant[];
  inputs: VoiceDevice[];
  outputs: VoiceDevice[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Push-to-talk mode as confirmed by the engine, and the saved key. */
  pushToTalk: boolean;
  pushToTalkKey: PushToTalkKey | null;
  /** Microphone audio is allowed out right now (not muted/deafened; PTT key held in PTT mode). */
  transmitting: boolean;
}

export interface VoiceError {
  code: string;
  message: string;
}

/** Voice needs the native host; plain-browser development (`pnpm dev`) has none. */
export const voiceAvailable = isTauri();

/** Stats samples kept for the quality window (~1 per second). */
const STATS_WINDOW = 11;

const initialSnapshot: VoiceSnapshot = {
  connection: "disconnected",
  channelId: null,
  microphoneMuted: false,
  deafened: false,
  microphoneActive: false,
  selfSpeaking: false,
  participants: [],
  inputs: [],
  outputs: [],
  inputDeviceId: null,
  outputDeviceId: null,
  pushToTalk: false,
  pushToTalkKey: null,
  transmitting: true,
};

interface VoiceStoreState {
  snapshot: VoiceSnapshot;
  lastError: VoiceError | null;
  /** Recent diagnostics for the current room, oldest first. */
  stats: readonly VoiceStats[];
  statsLogPath: string | null;
}

let state: VoiceStoreState = { snapshot: initialSnapshot, lastError: null, stats: [], statsLogPath: null };
const listeners = new Set<() => void>();
let started = false;

function setState(next: Partial<VoiceStoreState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function onSnapshot(snapshot: VoiceSnapshot) {
  const leftRoom = snapshot.connection === "disconnected" || snapshot.channelId !== state.snapshot.channelId;
  setState({ snapshot, stats: leftRoom ? [] : state.stats });
}

/** The engine (in Rust) owns voice state; this store only mirrors its events. */
function start() {
  if (started || !voiceAvailable) return;
  started = true;
  void listen<VoiceSnapshot>("voice://state-changed", (event) => onSnapshot(event.payload));
  void listen<VoiceError>("voice://error", (event) => setState({ lastError: event.payload }));
  void listen<VoiceStats>("voice://stats", (event) =>
    setState({ stats: [...state.stats, event.payload].slice(-STATS_WINDOW) }),
  );
  void invoke<VoiceSnapshot>("voice_get_state").then(onSnapshot);
  void invoke<string | null>("voice_stats_log_path").then((statsLogPath) => setState({ statsLogPath }));
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoice(): VoiceStoreState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Connection health of the current room over the last ~10 seconds. */
export function useVoiceQuality(): QualitySummary {
  const { stats } = useVoice();
  return useMemo(() => summarize(stats), [stats]);
}

export function clearVoiceError() {
  setState({ lastError: null });
}

function reportFailure(error: unknown) {
  const ipc = error as Partial<VoiceError> | undefined;
  setState({ lastError: { code: ipc?.code ?? "voice.internal", message: ipc?.message ?? String(error) } });
}

function command(name: string, args?: Record<string, unknown>): Promise<void> {
  if (!voiceAvailable) return Promise.resolve();
  return invoke<void>(name, args).catch(reportFailure);
}

export const voice = {
  join: (channelId: string, serverUrl: string, token: string) => {
    setState({ lastError: null });
    return command("voice_join", { channelId, serverUrl, token });
  },
  leave: () => command("voice_leave"),
  setMuted: (muted: boolean) => command("voice_set_muted", { muted }),
  setDeafened: (deafened: boolean) => command("voice_set_deafened", { deafened }),
  setInputDevice: (deviceId: string | null) => command("voice_set_input_device", { deviceId }),
  setOutputDevice: (deviceId: string | null) => command("voice_set_output_device", { deviceId }),
  refreshDevices: () => command("voice_refresh_devices"),
  setParticipantVolume: (participantId: string, percent: number) =>
    command("voice_set_participant_volume", { participantId, percent: Math.round(percent) }),
  setParticipantMuted: (participantId: string, muted: boolean) =>
    command("voice_set_participant_muted", { participantId, muted }),
  setPushToTalk: (enabled: boolean, key: PushToTalkKey | null) => command("voice_set_push_to_talk", { enabled, key }),
  reportFailure,
};
