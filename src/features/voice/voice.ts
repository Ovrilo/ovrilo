import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

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
}

export interface VoiceSnapshot {
  connection: VoiceConnection;
  channelId: string | null;
  microphoneMuted: boolean;
  deafened: boolean;
  /** False while in a room means listen-only (no microphone could be opened). */
  microphoneActive: boolean;
  participants: VoiceParticipant[];
  inputs: VoiceDevice[];
  outputs: VoiceDevice[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
}

export interface VoiceError {
  code: string;
  message: string;
}

/** Voice needs the native host; plain-browser development (`pnpm dev`) has none. */
export const voiceAvailable = isTauri();

const initialSnapshot: VoiceSnapshot = {
  connection: "disconnected",
  channelId: null,
  microphoneMuted: false,
  deafened: false,
  microphoneActive: false,
  participants: [],
  inputs: [],
  outputs: [],
  inputDeviceId: null,
  outputDeviceId: null,
};

interface VoiceStoreState {
  snapshot: VoiceSnapshot;
  lastError: VoiceError | null;
}

let state: VoiceStoreState = { snapshot: initialSnapshot, lastError: null };
const listeners = new Set<() => void>();
let started = false;

function setState(next: Partial<VoiceStoreState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

/** The engine (in Rust) owns voice state; this store only mirrors its events. */
function start() {
  if (started || !voiceAvailable) return;
  started = true;
  void listen<VoiceSnapshot>("voice://state-changed", (event) => setState({ snapshot: event.payload }));
  void listen<VoiceError>("voice://error", (event) => setState({ lastError: event.payload }));
  void invoke<VoiceSnapshot>("voice_get_state").then((snapshot) => setState({ snapshot }));
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoice(): VoiceStoreState {
  return useSyncExternalStore(subscribe, () => state);
}

export function clearVoiceError() {
  setState({ lastError: null });
}

function reportFailure(error: unknown) {
  const ipc = error as Partial<VoiceError> | undefined;
  setState({ lastError: { code: ipc?.code ?? "voice.internal", message: ipc?.message ?? String(error) } });
}

function command(name: string, args?: Record<string, unknown>): Promise<void> {
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
  reportFailure,
};
