import {
  type AudioCaptureOptions,
  ConnectionState,
  type LocalAudioTrack,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

import { keyFromCode, keyFromMouseButton, type PushToTalkKey } from "./keys";
import type { VoiceStats } from "./quality";
import type { NoiseSuppression, VoiceDevice, VoiceError, VoiceParticipant, VoiceSnapshot } from "./voice";

/**
 * Voice for the browser client (ADR-0019): the native engine's IPC commands (src-tauri/src/voice.rs) implemented
 * with livekit-client, so `voice.ts` and the UI stay the same. Same rooms and Opus streams as the desktop engine.
 *
 * Differences from the desktop: the browser cleans the microphone (its own noise suppression, echo cancellation and
 * gain control; no RNNoise "Enhanced" mode), push-to-talk only works while the tab has focus, there is no
 * microphone volume, and screens can be watched but not shared.
 */

export interface WebVoiceHandlers {
  onSnapshot(snapshot: VoiceSnapshot): void;
  onError(error: VoiceError): void;
  onStats(stats: VoiceStats): void;
}

/** Browsers able to run the web client's voice. */
export const webVoiceSupported =
  typeof window !== "undefined" &&
  typeof RTCPeerConnection !== "undefined" &&
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

/** Per-browser voice preferences (no secrets); the desktop engine saves the same in its settings file. */
const PREFS_KEY = "ovrilo.voice";

interface VoicePrefs {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  pushToTalk: boolean;
  pushToTalkKey: PushToTalkKey | null;
  noiseSuppression: NoiseSuppression;
  outputVolume: number;
  volumes: [string, number][];
  localMutes: string[];
}

function loadPrefs(): Partial<VoicePrefs> {
  try {
    return (JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<VoicePrefs>) ?? {};
  } catch {
    return {};
  }
}

/** Opus clock rate: concealment counters are in samples. */
const SAMPLE_RATE = 48_000;
const STATS_EVERY_MS = 1000;

const PREFERENCE_COMMANDS = new Set([
  "voice_set_input_device",
  "voice_set_output_device",
  "voice_set_participant_volume",
  "voice_set_participant_muted",
  "voice_set_output_volume",
  "voice_set_push_to_talk",
  "voice_set_noise_suppression",
]);

const voiceError = (code: string, message: string): VoiceError => ({ code, message });

/** Identities with a suffix are helper connections of a user (`{userId}#viewer` watches streams). */
const isHelper = (identity: string) => identity.includes("#");

class WebVoiceEngine {
  private handlers: WebVoiceHandlers | null = null;
  private room: Room | null = null;
  private joinAttempt = 0;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private pttHeld = false;
  private readonly volumes = new Map<string, number>();
  private readonly localMutes = new Set<string>();
  private readonly audioElements = new Map<string, HTMLMediaElement>();
  private snapshot: VoiceSnapshot = {
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
    noiseSuppression: "standard",
    noiseSuppressionActive: "standard",
    inputVolume: 100,
    outputVolume: 100,
    screenShare: null,
    watchingScreen: null,
  };

  start(handlers: WebVoiceHandlers) {
    this.handlers = handlers;
    const prefs = loadPrefs();
    const s = this.snapshot;
    s.inputDeviceId = prefs.inputDeviceId ?? null;
    s.outputDeviceId = prefs.outputDeviceId ?? null;
    s.pushToTalk = prefs.pushToTalk === true && !!prefs.pushToTalkKey;
    s.pushToTalkKey = prefs.pushToTalkKey ?? null;
    s.noiseSuppression = prefs.noiseSuppression === "off" ? "off" : "standard";
    s.noiseSuppressionActive = s.noiseSuppression;
    s.outputVolume = typeof prefs.outputVolume === "number" ? prefs.outputVolume : 100;
    prefs.volumes?.forEach(([id, percent]) => this.volumes.set(id, percent));
    prefs.localMutes?.forEach((id) => this.localMutes.add(id));
    s.transmitting = this.transmitting;
    navigator.mediaDevices.addEventListener?.("devicechange", () => void this.refreshDevices());
    window.addEventListener("keydown", this.onPttDown);
    window.addEventListener("keyup", this.onPttUp);
    window.addEventListener("mousedown", this.onPttDown);
    window.addEventListener("mouseup", this.onPttUp);
    // A key released in another window never reaches this tab.
    window.addEventListener("blur", () => this.setPttHeld(false));
    void this.refreshDevices();
    this.emit();
  }

  async invoke(name: string, args: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.run(name, args);
    } finally {
      if (PREFERENCE_COMMANDS.has(name)) this.savePrefs();
    }
  }

  private async run(name: string, args: Record<string, unknown>): Promise<void> {
    switch (name) {
      case "voice_join":
        return this.join(args.channelId as string, args.serverUrl as string, args.token as string);
      case "voice_leave":
        return this.leave();
      case "voice_set_muted":
        this.snapshot.microphoneMuted = args.muted as boolean;
        return this.applyTransmit();
      case "voice_set_deafened":
        this.snapshot.deafened = args.deafened as boolean;
        this.applyVolumes();
        return this.applyTransmit();
      case "voice_set_input_device":
        this.snapshot.inputDeviceId = (args.deviceId as string | null) ?? null;
        await this.room?.switchActiveDevice("audioinput", this.snapshot.inputDeviceId ?? "default");
        return this.emit();
      case "voice_set_output_device":
        this.snapshot.outputDeviceId = (args.deviceId as string | null) ?? null;
        await this.room?.switchActiveDevice("audiooutput", this.snapshot.outputDeviceId ?? "default");
        return this.emit();
      case "voice_refresh_devices":
        return this.refreshDevices();
      case "voice_set_participant_volume": {
        const id = args.participantId as string;
        this.volumes.set(id, args.percent as number);
        this.applyVolumes();
        return this.emitParticipants();
      }
      case "voice_set_participant_muted": {
        const id = args.participantId as string;
        if (args.muted) this.localMutes.add(id);
        else this.localMutes.delete(id);
        this.applyVolumes();
        return this.emitParticipants();
      }
      case "voice_set_output_volume":
        this.snapshot.outputVolume = args.percent as number;
        this.applyVolumes();
        return this.emit();
      case "voice_set_push_to_talk":
        this.snapshot.pushToTalk = args.enabled as boolean;
        this.snapshot.pushToTalkKey = (args.key as PushToTalkKey | null) ?? null;
        this.pttHeld = false;
        return this.applyTransmit();
      case "voice_set_noise_suppression":
        return this.setNoiseSuppression(args.mode as NoiseSuppression);
      case "voice_watch_screen_share":
        this.snapshot.watchingScreen = (args.participantId as string | null) ?? null;
        this.syncSubscriptions();
        return this.emit();
      case "voice_set_input_volume":
      case "voice_list_screen_sources":
      case "voice_start_screen_share":
      case "voice_stop_screen_share":
        throw voiceError("voice.unsupported", "This needs the Ovrilo desktop app.");
      default:
        throw voiceError("voice.unsupported", `Unknown voice command ${name}.`);
    }
  }

  private async join(channelId: string, serverUrl: string, token: string) {
    await this.leave();
    const attempt = ++this.joinAttempt;
    const room = new Room({
      // Volume above 100 % needs Web Audio gain instead of the media element's volume.
      webAudioMix: true,
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: this.captureOptions(),
      audioOutput: { deviceId: this.snapshot.outputDeviceId ?? "default" },
    });
    this.room = room;
    this.wire(room);
    Object.assign(this.snapshot, { connection: "connecting", channelId, participants: [], selfSpeaking: false });
    this.emit();

    try {
      await room.connect(serverUrl, token, { autoSubscribe: false });
    } catch (error) {
      if (attempt !== this.joinAttempt) return;
      this.room = null;
      Object.assign(this.snapshot, { connection: "disconnected", channelId: null, participants: [] });
      this.emit();
      throw voiceError("voice.transport_unavailable", `Could not connect to voice: ${String(error)}`);
    }
    if (attempt !== this.joinAttempt) return;

    // Joining is a click, so the browser lets audio start.
    await room.startAudio().catch(() => undefined);
    this.snapshot.connection = "connected";
    this.syncSubscriptions();
    this.emitParticipants();
    this.statsTimer = setInterval(() => void this.collectStats(), STATS_EVERY_MS);

    try {
      await room.localParticipant.setMicrophoneEnabled(true, this.captureOptions());
      this.snapshot.microphoneActive = true;
      await this.applyTransmit();
    } catch (error) {
      // Listen-only: the room works without a microphone.
      this.snapshot.microphoneActive = false;
      this.emit();
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      throw voiceError(
        denied ? "voice.permission_denied" : "voice.device_unavailable",
        denied
          ? "The browser blocked the microphone. Allow it in the address bar, then rejoin."
          : `The microphone could not be opened: ${String(error)}`,
      );
    }
    void this.refreshDevices();
  }

  private async leave() {
    this.joinAttempt++;
    clearInterval(this.statsTimer);
    const room = this.room;
    this.room = null;
    this.audioElements.forEach((element) => element.remove());
    this.audioElements.clear();
    Object.assign(this.snapshot, {
      connection: "disconnected",
      channelId: null,
      participants: [],
      selfSpeaking: false,
      microphoneActive: false,
      watchingScreen: null,
    });
    this.emit();
    await room?.disconnect().catch(() => undefined);
  }

  private wire(room: Room) {
    const update = () => {
      if (this.room === room) this.emitParticipants();
    };
    const resubscribe = () => {
      if (this.room !== room) return;
      this.syncSubscriptions();
      this.emitParticipants();
    };
    room
      .on(RoomEvent.ParticipantConnected, resubscribe)
      .on(RoomEvent.ParticipantDisconnected, update)
      .on(RoomEvent.ParticipantNameChanged, update)
      .on(RoomEvent.TrackPublished, resubscribe)
      .on(RoomEvent.TrackUnpublished, update)
      .on(RoomEvent.TrackMuted, update)
      .on(RoomEvent.TrackUnmuted, update)
      .on(RoomEvent.ActiveSpeakersChanged, update)
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => this.play(track, publication, participant))
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        this.audioElements.get(this.streamKey(participant, publication))?.remove();
        this.audioElements.delete(this.streamKey(participant, publication));
        track.detach();
      })
      .on(RoomEvent.Reconnecting, () => this.setConnection(room, "reconnecting"))
      .on(RoomEvent.Reconnected, () => this.setConnection(room, "connected"))
      .on(RoomEvent.Disconnected, () => {
        if (this.room !== room) return;
        void this.leave();
        this.handlers?.onError(voiceError("voice.disconnected", "Voice disconnected."));
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connected) this.setConnection(room, "connected");
      });
  }

  private setConnection(room: Room, connection: VoiceSnapshot["connection"]) {
    if (this.room !== room || this.snapshot.connection === "connecting") return;
    this.snapshot.connection = connection;
    this.emit();
  }

  /** Microphones always; screen-share sound only for the share being watched (like the desktop engine). */
  private syncSubscriptions() {
    const room = this.room;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      if (isHelper(participant.identity)) continue;
      for (const publication of participant.trackPublications.values()) {
        if (publication.source === Track.Source.Microphone) {
          if (!publication.isSubscribed) publication.setSubscribed(true);
        } else if (publication.source === Track.Source.ScreenShareAudio) {
          const wanted = this.snapshot.watchingScreen === participant.identity;
          if (publication.isSubscribed !== wanted) publication.setSubscribed(wanted);
        }
      }
    }
  }

  private play(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) {
    if (track.kind !== Track.Kind.Audio) return;
    const element = track.attach();
    element.hidden = true;
    document.body.appendChild(element);
    this.audioElements.set(this.streamKey(participant, publication), element);
    this.applyVolumes();
  }

  /** `{id}` for a microphone, `{id}#screen` for screen-share sound (the desktop engine's stream ids). */
  private streamKey(participant: Participant, publication: { source: Track.Source }) {
    return publication.source === Track.Source.ScreenShareAudio ? `${participant.identity}#screen` : participant.identity;
  }

  private applyVolumes() {
    const room = this.room;
    if (!room) return;
    const master = this.snapshot.deafened ? 0 : this.snapshot.outputVolume / 100;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        const track = publication.track as RemoteAudioTrack | undefined;
        if (!track) continue;
        const key = this.streamKey(participant, publication);
        const own = this.localMutes.has(participant.identity) ? 0 : (this.volumes.get(key) ?? 100) / 100;
        track.setVolume(master * own);
      }
    }
  }

  private get transmitting() {
    const s = this.snapshot;
    return !s.microphoneMuted && !s.deafened && (!s.pushToTalk || this.pttHeld);
  }

  private async applyTransmit() {
    this.snapshot.transmitting = this.transmitting;
    this.emit();
    const room = this.room;
    if (!room || !this.snapshot.microphoneActive) return;
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    if (!track) return;
    // Muting the track keeps the microphone open, so push-to-talk starts without a delay.
    if (this.snapshot.transmitting) await track.unmute();
    else await track.mute();
    this.emitParticipants();
  }

  private readonly onPttDown = (event: KeyboardEvent | MouseEvent) => {
    if (this.matchesPtt(event)) this.setPttHeld(true);
  };

  private readonly onPttUp = (event: KeyboardEvent | MouseEvent) => {
    if (this.matchesPtt(event)) this.setPttHeld(false);
  };

  private matchesPtt(event: KeyboardEvent | MouseEvent) {
    const key = this.snapshot.pushToTalkKey;
    if (!this.snapshot.pushToTalk || !key) return false;
    const pressed = event instanceof KeyboardEvent ? keyFromCode(event.code) : keyFromMouseButton(event.button);
    return pressed?.code === key.code;
  }

  private setPttHeld(held: boolean) {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    void this.applyTransmit();
  }

  private captureOptions(): AudioCaptureOptions {
    const cleaned = this.snapshot.noiseSuppression !== "off";
    return {
      deviceId: this.snapshot.inputDeviceId ?? "default",
      echoCancellation: true,
      noiseSuppression: cleaned,
      autoGainControl: cleaned,
      channelCount: 1,
    };
  }

  private async setNoiseSuppression(mode: NoiseSuppression) {
    this.snapshot.noiseSuppression = mode;
    // The browser has one noise suppressor; "Enhanced" (RNNoise) is desktop-only.
    this.snapshot.noiseSuppressionActive = mode === "off" ? "off" : "standard";
    this.emit();
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as
      | LocalAudioTrack
      | undefined;
    await track?.restartTrack(this.captureOptions());
  }

  private async refreshDevices() {
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    const list = (kind: MediaDeviceKind): VoiceDevice[] =>
      devices
        .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "communications")
        .map((d, i) => ({
          id: d.deviceId,
          name: d.label || (d.deviceId === "default" ? "Default" : `Device ${i + 1}`),
          isDefault: d.deviceId === "default",
        }));
    this.snapshot.inputs = list("audioinput");
    this.snapshot.outputs = list("audiooutput");
    this.emit();
  }

  private participantsOf(room: Room): VoiceParticipant[] {
    return [...room.remoteParticipants.values()]
      .filter((p) => !isHelper(p.identity))
      .map((p) => {
        const screen = p.getTrackPublication(Track.Source.ScreenShare);
        const screenAudio = p.getTrackPublication(Track.Source.ScreenShareAudio);
        return {
          id: p.identity,
          name: p.name || p.identity,
          speaking: p.isSpeaking,
          volume: this.volumes.get(p.identity) ?? 100,
          locallyMuted: this.localMutes.has(p.identity),
          muted: !p.isMicrophoneEnabled,
          screenSharing: !!screen,
          screenAudio: !!screenAudio,
          screenVolume: this.volumes.get(`${p.identity}#screen`) ?? 100,
        };
      });
  }

  private emitParticipants() {
    const room = this.room;
    if (!room) return;
    this.snapshot.participants = this.participantsOf(room);
    this.snapshot.selfSpeaking = this.snapshot.transmitting && room.localParticipant.isSpeaking;
    this.emit();
  }

  private savePrefs() {
    const s = this.snapshot;
    const prefs: VoicePrefs = {
      inputDeviceId: s.inputDeviceId,
      outputDeviceId: s.outputDeviceId,
      pushToTalk: s.pushToTalk,
      pushToTalkKey: s.pushToTalkKey,
      noiseSuppression: s.noiseSuppression,
      outputVolume: s.outputVolume,
      volumes: [...this.volumes],
      localMutes: [...this.localMutes],
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be unavailable (private mode); preferences then last for this page only.
    }
  }

  private emit() {
    this.handlers?.onSnapshot({ ...this.snapshot, participants: [...this.snapshot.participants] });
  }

  /** The desktop engine's diagnostics, from WebRTC stats (cumulative counters, like the engine's). */
  private async collectStats() {
    const room = this.room;
    if (!room || this.snapshot.connection !== "connected") return;
    const stats: VoiceStats = {
      roundTripMs: null,
      inboundPacketsReceived: 0,
      inboundPacketsLost: 0,
      inboundJitterMs: null,
      inboundConcealedMs: 0,
      outboundPacketsLost: 0,
      playoutBufferedMs: 0,
      playoutUnderruns: 0,
      playoutSkippedMs: 0,
      captureOverflowMs: 0,
      remoteFramesDropped: 0,
      microphoneFramesDropped: 0,
    };
    let rtt: number | null = null;
    const reports: Promise<RTCStatsReport | undefined>[] = [];
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.source === Track.Source.Microphone && publication.track) {
          reports.push(publication.track.getRTCStatsReport());
        }
      }
    }
    const microphone = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (microphone) reports.push(microphone.getRTCStatsReport());

    for (const report of await Promise.all(reports.map((r) => r.catch(() => undefined)))) {
      report?.forEach((entry: Record<string, unknown>) => {
        const num = (key: string) => (typeof entry[key] === "number" ? (entry[key] as number) : 0);
        if (entry.type === "inbound-rtp" && entry.kind === "audio") {
          stats.inboundPacketsReceived += num("packetsReceived");
          stats.inboundPacketsLost += Math.max(0, num("packetsLost"));
          const jitterMs = Math.round(num("jitter") * 1000);
          stats.inboundJitterMs = Math.max(stats.inboundJitterMs ?? 0, jitterMs);
          // Concealment during silence is inaudible; count only audible concealment.
          const audible = Math.max(0, num("concealedSamples") - num("silentConcealedSamples"));
          stats.inboundConcealedMs += Math.round((audible / SAMPLE_RATE) * 1000);
        } else if (entry.type === "remote-inbound-rtp" && entry.kind === "audio") {
          stats.outboundPacketsLost += Math.max(0, num("packetsLost"));
        } else if (entry.type === "candidate-pair" && entry.nominated && typeof entry.currentRoundTripTime === "number") {
          rtt = Math.max(rtt ?? 0, entry.currentRoundTripTime);
        }
      });
    }
    stats.roundTripMs = rtt === null ? null : Math.round(rtt * 1000);
    if (this.room === room) this.handlers?.onStats(stats);
  }
}

export const webVoice = new WebVoiceEngine();
