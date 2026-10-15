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
  /** They are sharing their screen; `screenAudio`: with application sound (ADR-0017). */
  screenSharing: boolean;
  screenAudio: boolean;
  /** Local playback volume of their screen-share sound, percent (0–200). */
  screenVolume: number;
}

export type SharePreset = "720p30" | "1080p30" | "1080p60";
/** What a share keeps under pressure: sharp text ("detail") or smooth movement ("motion"). */
export type ShareOptimization = "detail" | "motion";

/** The local screen share while it runs. */
export interface ScreenShare {
  sourceId: string;
  title: string;
  preset: SharePreset;
  optimization: ShareOptimization;
  /** The application's sound is shared too. */
  audio: boolean;
}

/** A screen or window that can be shared (`voice://screen-sources`). */
export interface ScreenSource {
  id: string;
  kind: "screen" | "window";
  title: string;
  application: string | null;
  audioAvailable: boolean;
}

/** How the microphone is cleaned before it is sent (ADR-0018). */
export type NoiseSuppression = "off" | "standard" | "enhanced";

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
  /** The chosen noise suppression, and the one actually running (Enhanced can fall back). */
  noiseSuppression: NoiseSuppression;
  noiseSuppressionActive: NoiseSuppression;
  /** Master microphone and speaker volume, percent (100 = unchanged, up to 200). */
  inputVolume: number;
  outputVolume: number;
  screenShare: ScreenShare | null;
  /** Participant whose screen-share sound the engine plays. */
  watchingScreen: string | null;
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
  noiseSuppression: "enhanced",
  noiseSuppressionActive: "standard",
  inputVolume: 100,
  outputVolume: 100,
  screenShare: null,
  watchingScreen: null,
};

interface VoiceStoreState {
  snapshot: VoiceSnapshot;
  lastError: VoiceError | null;
  /** Recent diagnostics for the current room, oldest first. */
  stats: readonly VoiceStats[];
  statsLogPath: string | null;
  /** Latest list from `voice.listScreenSources()`; null until it arrives. */
  screenSources: readonly ScreenSource[] | null;
  /** The API allowed screen sharing in the room we joined (join grant `canShareScreen`). */
  canShareScreen: boolean;
}

let state: VoiceStoreState = {
  snapshot: initialSnapshot,
  lastError: null,
  stats: [],
  statsLogPath: null,
  screenSources: null,
  canShareScreen: false,
};
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
  void listen<ScreenSource[]>("voice://screen-sources", (event) => setState({ screenSources: event.payload }));
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
  join: (channelId: string, serverUrl: string, token: string, canShareScreen = false) => {
    setState({ lastError: null, canShareScreen });
    return command("voice_join", { channelId, serverUrl, token });
  },
  listScreenSources: () => {
    setState({ screenSources: null });
    return command("voice_list_screen_sources");
  },
  startScreenShare: (sourceId: string, preset: SharePreset, optimization: ShareOptimization, audio: boolean) => {
    setState({ lastError: null });
    return command("voice_start_screen_share", { sourceId, preset, optimization, audio });
  },
  stopScreenShare: () => command("voice_stop_screen_share"),
  /** Plays the watched share's sound in the engine (`null` stops); video plays in the webview. */
  watchScreenShare: (participantId: string | null) => command("voice_watch_screen_share", { participantId }),
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
  /** Volume of a participant's screen-share sound (the engine's `{id}#screen` stream), 0–200 %. */
  setScreenVolume: (participantId: string, percent: number) =>
    command("voice_set_participant_volume", { participantId: `${participantId}#screen`, percent: Math.round(percent) }),
  setPushToTalk: (enabled: boolean, key: PushToTalkKey | null) => command("voice_set_push_to_talk", { enabled, key }),
  setNoiseSuppression: (mode: NoiseSuppression) => command("voice_set_noise_suppression", { mode }),
  setInputVolume: (percent: number) => command("voice_set_input_volume", { percent: Math.round(percent) }),
  setOutputVolume: (percent: number) => command("voice_set_output_volume", { percent: Math.round(percent) }),
  reportFailure,
};
