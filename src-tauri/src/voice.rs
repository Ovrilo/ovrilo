//! Voice engine host: owns the `ovrilo-voice` engine and translates it to IPC (CONTRACTS.md §4).
//!
//! The engine is authoritative. The host folds engine events into a [`VoiceSnapshot`] and emits it
//! as `voice://state-changed`; errors are emitted as `voice://error` and diagnostics (about 1 Hz
//! while in a room) as `voice://stats`, also appended to a CSV log. Audio never crosses IPC.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, PoisonError};

use ovrilo_voice::{
    AudioDevice, ConnectionState, DeviceId, ParticipantId, VoiceCommand, VoiceEngine,
    VoiceEngineHandle, VoiceErrorCode, VoiceEvent, VoiceStats,
};
use ovrilo_voice_cpal::CpalBackend;
use ovrilo_voice_livekit::{LiveKitTransport, ProcessingConfig, webrtc_processing};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::credentials::CommandError;
use crate::ptt::KeyWatcher;
use crate::settings::{MAX_PARTICIPANT_VOLUMES, PushToTalkKey, SettingsStore};
use crate::stats_log::StatsLog;

pub const STATE_CHANGED: &str = "voice://state-changed";
pub const ERROR: &str = "voice://error";
pub const STATS: &str = "voice://stats";

/// Bounds for values the UI passes through to the engine.
const MAX_TOKEN_LENGTH: usize = 4096;
const MAX_ID_LENGTH: usize = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSnapshot {
    /// `disconnected` | `connecting` | `connected` | `reconnecting`
    connection: &'static str,
    /// Channel of the current room; set when the engine starts connecting, cleared on disconnect.
    channel_id: Option<String>,
    /// Channel of the latest join request, adopted on the next `Connecting` event so that the
    /// `Disconnected` event of a previous room cannot clear it.
    #[serde(skip)]
    pending_channel_id: Option<String>,
    microphone_muted: bool,
    deafened: bool,
    /// False while in a room means listen-only (no microphone could be opened).
    microphone_active: bool,
    /// The local user is talking (never while muted or deafened).
    self_speaking: bool,
    participants: Vec<ParticipantDto>,
    inputs: Vec<DeviceDto>,
    outputs: Vec<DeviceDto>,
    /// Selected devices; `None` follows the system default.
    input_device_id: Option<String>,
    output_device_id: Option<String>,
    /// Push-to-talk mode as confirmed by the engine, and the configured key (if any).
    push_to_talk: bool,
    push_to_talk_key: Option<PushToTalkKey>,
    /// Microphone audio is allowed out right now (see `TransmittingChanged`).
    transmitting: bool,
    /// Per-user preferences (host-owned, persisted): volume and local mute. The engine gets the
    /// effective volume (0 while locally muted).
    #[serde(skip)]
    volumes: BTreeMap<String, u16>,
    #[serde(skip)]
    locally_muted: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantDto {
    /// SFU identity: the user ID issued by the API.
    id: String,
    name: String,
    speaking: bool,
    /// Local playback volume, percent (100 = unchanged).
    volume: u16,
    /// Muted for this client only.
    locally_muted: bool,
    /// The participant muted their own microphone.
    muted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDto {
    id: String,
    name: String,
    is_default: bool,
}

/// Diagnostics for the current room; counters are cumulative since joining.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatsDto {
    pub round_trip_ms: Option<u32>,
    pub inbound_packets_received: u64,
    pub inbound_packets_lost: u64,
    pub inbound_jitter_ms: Option<u32>,
    /// Audible concealment: remote audio synthesized to hide loss (sounds robotic).
    pub inbound_concealed_ms: u64,
    pub outbound_packets_lost: u64,
    pub playout_buffered_ms: u32,
    pub playout_underruns: u64,
    pub playout_skipped_ms: u64,
    pub capture_overflow_ms: u64,
    pub remote_frames_dropped: u64,
    pub microphone_frames_dropped: u64,
}

impl From<&VoiceStats> for VoiceStatsDto {
    fn from(stats: &VoiceStats) -> Self {
        let network = &stats.network;
        Self {
            round_trip_ms: network.round_trip_ms,
            inbound_packets_received: network.inbound_packets_received,
            inbound_packets_lost: network.inbound_packets_lost,
            inbound_jitter_ms: network.inbound_jitter_ms,
            inbound_concealed_ms: network.inbound_concealed_ms,
            outbound_packets_lost: network.outbound_packets_lost,
            playout_buffered_ms: stats.playout_buffered_ms,
            playout_underruns: stats.playout_underruns,
            playout_skipped_ms: stats.playout_skipped_ms,
            capture_overflow_ms: stats.capture_overflow_ms,
            remote_frames_dropped: stats.remote_frames_dropped,
            microphone_frames_dropped: stats.microphone_frames_dropped,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceErrorDto {
    code: &'static str,
    message: String,
}

impl Default for VoiceSnapshot {
    fn default() -> Self {
        Self {
            connection: "disconnected",
            channel_id: None,
            pending_channel_id: None,
            microphone_muted: false,
            deafened: false,
            microphone_active: false,
            self_speaking: false,
            participants: Vec::new(),
            inputs: Vec::new(),
            outputs: Vec::new(),
            input_device_id: None,
            output_device_id: None,
            push_to_talk: false,
            push_to_talk_key: None,
            transmitting: true,
            volumes: BTreeMap::new(),
            locally_muted: BTreeSet::new(),
        }
    }
}

pub struct VoiceHost {
    engine: VoiceEngineHandle,
    snapshot: Arc<Mutex<VoiceSnapshot>>,
    stats_log_path: Option<String>,
    settings: SettingsStore,
    keys: KeyWatcher,
}

impl VoiceHost {
    /// Starts the engine on Tauri's Tokio runtime and forwards its events to the UI.
    pub fn start(app: AppHandle) -> Self {
        let (engine, mut events) = tauri::async_runtime::block_on(async {
            VoiceEngine::spawn(
                CpalBackend::default(),
                LiveKitTransport,
                webrtc_processing(ProcessingConfig::default()),
            )
        });
        let settings = SettingsStore::load(app.path().app_config_dir().ok());
        let saved = settings.get();
        let snapshot = Arc::new(Mutex::new(VoiceSnapshot {
            input_device_id: saved.input_device_id.clone(),
            output_device_id: saved.output_device_id.clone(),
            push_to_talk_key: saved.push_to_talk_key.clone(),
            volumes: saved.participant_volumes.clone(),
            locally_muted: saved.muted_participants.clone(),
            ..VoiceSnapshot::default()
        }));
        let mut stats_log = app.path().app_log_dir().ok().map(StatsLog::new);
        let stats_log_path = stats_log
            .as_ref()
            .map(|log| log.path().display().to_string());

        let shared = snapshot.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if let VoiceEvent::StatsUpdated(stats) = &event {
                    let dto = VoiceStatsDto::from(stats);
                    if let Some(log) = stats_log.as_mut() {
                        let channel = shared
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .channel_id
                            .clone();
                        // Small buffered append about once per second.
                        log.write(channel.as_deref(), &dto);
                    }
                    let _ = app.emit(STATS, dto);
                    continue;
                }
                if let VoiceEvent::Error { code, message } = &event {
                    let _ = app.emit(
                        ERROR,
                        VoiceErrorDto {
                            code: error_code(*code),
                            message: message.clone(),
                        },
                    );
                    continue;
                }
                let changed = {
                    let mut state = shared.lock().unwrap_or_else(PoisonError::into_inner);
                    apply(&mut state, event).then(|| state.clone())
                };
                if let Some(state) = changed {
                    let _ = app.emit(STATE_CHANGED, state);
                }
            }
        });

        // Restore saved preferences. A saved device that is gone fails when opened and is reported
        // as a device error, so the user can pick another.
        engine.send(VoiceCommand::SetInputDevice(
            saved.input_device_id.map(DeviceId),
        ));
        engine.send(VoiceCommand::SetOutputDevice(
            saved.output_device_id.map(DeviceId),
        ));
        let known: BTreeSet<&String> = saved
            .participant_volumes
            .keys()
            .chain(&saved.muted_participants)
            .collect();
        for participant in known {
            let percent = if saved.muted_participants.contains(participant) {
                0
            } else {
                saved
                    .participant_volumes
                    .get(participant)
                    .copied()
                    .unwrap_or(100)
            };
            engine.send(VoiceCommand::SetParticipantVolume {
                participant: ParticipantId(participant.clone()),
                percent,
            });
        }
        let keys = KeyWatcher::start(engine.clone());
        let ptt_key = saved.push_to_talk_key.filter(|_| saved.push_to_talk);
        keys.watch(ptt_key.as_ref().map(|k| k.code));
        engine.send(VoiceCommand::SetPushToTalk(ptt_key.is_some()));
        engine.send(VoiceCommand::RefreshDevices);
        Self {
            engine,
            snapshot,
            stats_log_path,
            settings,
            keys,
        }
    }

    fn send(&self, command: VoiceCommand) -> Result<(), CommandError> {
        if self.engine.send(command) {
            Ok(())
        } else {
            Err(CommandError::new(
                "voice.engine_stopped",
                "the voice engine is not running",
            ))
        }
    }

    /// Leaves the room and waits briefly for the engine to confirm (app exit).
    pub fn leave_before_exit(&self) {
        let connected = || {
            self.snapshot
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .connection
                != "disconnected"
        };
        if !connected() || self.send(VoiceCommand::Leave).is_err() {
            return;
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while connected() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    /// Flips the microphone mute (tray menu). The engine confirms via `MicrophoneMutedChanged`.
    pub fn toggle_muted(&self) {
        let muted = self
            .snapshot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .microphone_muted;
        let _ = self.send(VoiceCommand::SetMicrophoneMuted(!muted));
    }

    fn update(&self, change: impl FnOnce(&mut VoiceSnapshot)) {
        change(&mut self.snapshot.lock().unwrap_or_else(PoisonError::into_inner));
    }
}

/// Folds an engine event into the snapshot; returns whether anything visible changed.
fn apply(state: &mut VoiceSnapshot, event: VoiceEvent) -> bool {
    match event {
        VoiceEvent::ConnectionStateChanged(connection) => {
            state.connection = match connection {
                ConnectionState::Disconnected => "disconnected",
                ConnectionState::Connecting => "connecting",
                ConnectionState::Connected => "connected",
                ConnectionState::Reconnecting => "reconnecting",
            };
            if state.connection == "connecting" {
                state.channel_id = state.pending_channel_id.take();
            } else if state.connection == "disconnected" {
                state.channel_id = None;
                state.participants.clear();
                state.microphone_active = false;
                state.self_speaking = false;
            }
        }
        VoiceEvent::MicrophoneMutedChanged(muted) => state.microphone_muted = muted,
        VoiceEvent::DeafenedChanged(deafened) => state.deafened = deafened,
        VoiceEvent::PushToTalkChanged(enabled) => state.push_to_talk = enabled,
        // Volume and local mute are host preferences, updated by their commands; the engine's
        // confirmation carries the effective volume only.
        VoiceEvent::ParticipantVolumeChanged { .. } => return false,
        VoiceEvent::TransmittingChanged(transmitting) => state.transmitting = transmitting,
        VoiceEvent::MicrophoneActiveChanged(active) => state.microphone_active = active,
        VoiceEvent::ParticipantJoined { id, name } => {
            state.participants.retain(|p| p.id != id.0);
            let volume = state.volumes.get(&id.0).copied().unwrap_or(100);
            let locally_muted = state.locally_muted.contains(&id.0);
            state.participants.push(ParticipantDto {
                id: id.0,
                name,
                speaking: false,
                volume,
                locally_muted,
                muted: false,
            });
        }
        VoiceEvent::ParticipantLeft { id } => state.participants.retain(|p| p.id != id.0),
        VoiceEvent::ParticipantMutedChanged { participant, muted } => {
            match state
                .participants
                .iter_mut()
                .find(|p| p.id == participant.0)
            {
                Some(p) if p.muted != muted => p.muted = muted,
                _ => return false,
            }
        }
        VoiceEvent::SpeakingChanged {
            participant: None,
            speaking,
        } => {
            if state.self_speaking == speaking {
                return false;
            }
            state.self_speaking = speaking;
        }
        VoiceEvent::SpeakingChanged {
            participant: Some(id),
            speaking,
        } => match state.participants.iter_mut().find(|p| p.id == id.0) {
            // Events can trail a ParticipantLeft; unknown participants are ignored.
            Some(p) if p.speaking != speaking => p.speaking = speaking,
            _ => return false,
        },
        VoiceEvent::DevicesChanged { inputs, outputs } => {
            state.inputs = inputs.into_iter().map(device).collect();
            state.outputs = outputs.into_iter().map(device).collect();
        }
        _ => return false,
    }
    true
}

fn device(device: AudioDevice) -> DeviceDto {
    DeviceDto {
        id: device.id.0,
        name: device.name,
        is_default: device.is_default,
    }
}

fn error_code(code: VoiceErrorCode) -> &'static str {
    match code {
        VoiceErrorCode::InvalidState => "voice.invalid_state",
        VoiceErrorCode::PermissionDenied => "voice.permission_denied",
        VoiceErrorCode::DeviceUnavailable => "voice.device_unavailable",
        VoiceErrorCode::TransportUnavailable => "voice.transport_unavailable",
        _ => "voice.internal",
    }
}

fn check_length(value: &str, max: usize, name: &str) -> Result<(), CommandError> {
    if value.is_empty() || value.len() > max {
        return Err(CommandError::new(
            "voice.invalid_argument",
            format!("{name} has an unexpected length"),
        ));
    }
    Ok(())
}

/// Where diagnostics are written, so testers can find and share the file.
#[tauri::command]
pub fn voice_stats_log_path(host: State<'_, VoiceHost>) -> Option<String> {
    host.stats_log_path.clone()
}

#[tauri::command]
pub fn voice_get_state(host: State<'_, VoiceHost>) -> VoiceSnapshot {
    host.snapshot
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

/// Joins a voice room with a grant from `POST /channels/{id}/voice/join`. Leaves any current room first.
#[tauri::command]
pub fn voice_join(
    host: State<'_, VoiceHost>,
    channel_id: String,
    server_url: String,
    token: String,
) -> Result<(), CommandError> {
    check_length(&channel_id, MAX_ID_LENGTH, "channel id")?;
    check_length(&token, MAX_TOKEN_LENGTH, "token")?;
    if !(server_url.starts_with("ws://") || server_url.starts_with("wss://")) {
        return Err(CommandError::new(
            "voice.invalid_argument",
            "server URL must be ws:// or wss://",
        ));
    }
    // Commands run in order, so the engine is disconnected again before the join is processed.
    host.send(VoiceCommand::Leave)?;
    host.update(|s| s.pending_channel_id = Some(channel_id));
    host.send(VoiceCommand::Join { server_url, token })
}

#[tauri::command]
pub fn voice_leave(host: State<'_, VoiceHost>) -> Result<(), CommandError> {
    host.send(VoiceCommand::Leave)
}

#[tauri::command]
pub fn voice_set_muted(host: State<'_, VoiceHost>, muted: bool) -> Result<(), CommandError> {
    host.send(VoiceCommand::SetMicrophoneMuted(muted))
}

#[tauri::command]
pub fn voice_set_deafened(host: State<'_, VoiceHost>, deafened: bool) -> Result<(), CommandError> {
    host.send(VoiceCommand::SetDeafened(deafened))
}

#[tauri::command]
pub fn voice_set_input_device(
    app: AppHandle,
    host: State<'_, VoiceHost>,
    device_id: Option<String>,
) -> Result<(), CommandError> {
    select_device(app, host, device_id, true)
}

#[tauri::command]
pub fn voice_set_output_device(
    app: AppHandle,
    host: State<'_, VoiceHost>,
    device_id: Option<String>,
) -> Result<(), CommandError> {
    select_device(app, host, device_id, false)
}

fn select_device(
    app: AppHandle,
    host: State<'_, VoiceHost>,
    device_id: Option<String>,
    input: bool,
) -> Result<(), CommandError> {
    if let Some(id) = &device_id {
        check_length(id, MAX_ID_LENGTH, "device id")?;
    }
    let engine_id = device_id.clone().map(DeviceId);
    host.send(if input {
        VoiceCommand::SetInputDevice(engine_id)
    } else {
        VoiceCommand::SetOutputDevice(engine_id)
    })?;
    // The engine reports device failures as errors; the selection itself has no engine event.
    host.settings.update(|s| {
        if input {
            s.input_device_id = device_id.clone();
        } else {
            s.output_device_id = device_id.clone();
        }
    });
    host.update(|s| {
        if input {
            s.input_device_id = device_id;
        } else {
            s.output_device_id = device_id;
        }
    });
    let _ = app.emit(STATE_CHANGED, voice_get_state(host));
    Ok(())
}

/// Sets how loud one participant plays locally (0–200 %), remembered across restarts.
#[tauri::command]
pub fn voice_set_participant_volume(
    app: AppHandle,
    host: State<'_, VoiceHost>,
    participant_id: String,
    percent: u16,
) -> Result<(), CommandError> {
    check_length(&participant_id, 64, "participant id")?;
    if percent > 200 {
        return Err(CommandError::new(
            "voice.invalid_argument",
            "volume must be 0-200 %",
        ));
    }
    host.settings.update(|s| {
        if percent == 100 {
            s.participant_volumes.remove(&participant_id);
        } else if s.participant_volumes.len() < MAX_PARTICIPANT_VOLUMES
            || s.participant_volumes.contains_key(&participant_id)
        {
            s.participant_volumes
                .insert(participant_id.clone(), percent);
        }
    });
    host.update(|s| set_participant_preference(s, &participant_id, Some(percent), None));
    apply_participant_preference(&app, &host, participant_id)
}

/// Mutes or unmutes one participant for this client only (others still hear them).
#[tauri::command]
pub fn voice_set_participant_muted(
    app: AppHandle,
    host: State<'_, VoiceHost>,
    participant_id: String,
    muted: bool,
) -> Result<(), CommandError> {
    check_length(&participant_id, 64, "participant id")?;
    host.settings.update(|s| {
        if !muted {
            s.muted_participants.remove(&participant_id);
        } else if s.muted_participants.len() < MAX_PARTICIPANT_VOLUMES {
            s.muted_participants.insert(participant_id.clone());
        }
    });
    host.update(|s| set_participant_preference(s, &participant_id, None, Some(muted)));
    apply_participant_preference(&app, &host, participant_id)
}

fn set_participant_preference(
    state: &mut VoiceSnapshot,
    id: &str,
    volume: Option<u16>,
    muted: Option<bool>,
) {
    if let Some(percent) = volume {
        if percent == 100 {
            state.volumes.remove(id);
        } else {
            state.volumes.insert(id.to_owned(), percent);
        }
    }
    if let Some(muted) = muted {
        if muted {
            state.locally_muted.insert(id.to_owned());
        } else {
            state.locally_muted.remove(id);
        }
    }
    let volume = state.volumes.get(id).copied().unwrap_or(100);
    let locally_muted = state.locally_muted.contains(id);
    if let Some(p) = state.participants.iter_mut().find(|p| p.id == id) {
        p.volume = volume;
        p.locally_muted = locally_muted;
    }
}

/// Sends the effective volume (0 while locally muted) and publishes the updated snapshot.
fn apply_participant_preference(
    app: &AppHandle,
    host: &State<'_, VoiceHost>,
    participant_id: String,
) -> Result<(), CommandError> {
    let percent = {
        let state = host.snapshot.lock().unwrap_or_else(PoisonError::into_inner);
        if state.locally_muted.contains(&participant_id) {
            0
        } else {
            state.volumes.get(&participant_id).copied().unwrap_or(100)
        }
    };
    host.send(VoiceCommand::SetParticipantVolume {
        participant: ParticipantId(participant_id),
        percent,
    })?;
    let snapshot = host
        .snapshot
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    let _ = app.emit(STATE_CHANGED, snapshot);
    Ok(())
}

/// Turns push-to-talk on (with a key) or off. Saved for the next start; the engine confirms the
/// mode with `PushToTalkChanged`.
#[tauri::command]
pub fn voice_set_push_to_talk(
    app: AppHandle,
    host: State<'_, VoiceHost>,
    enabled: bool,
    key: Option<PushToTalkKey>,
) -> Result<(), CommandError> {
    if let Some(key) = &key {
        key.validate()
            .map_err(|message| CommandError::new("voice.invalid_argument", message))?;
    }
    if enabled && key.is_none() {
        return Err(CommandError::new(
            "voice.invalid_argument",
            "choose a push-to-talk key first",
        ));
    }
    host.settings.update(|s| {
        s.push_to_talk = enabled;
        s.push_to_talk_key = key.clone();
    });
    host.keys
        .watch(key.as_ref().filter(|_| enabled).map(|k| k.code));
    host.send(VoiceCommand::SetPushToTalk(enabled))?;
    host.update(|s| s.push_to_talk_key = key);
    let _ = app.emit(STATE_CHANGED, voice_get_state(host));
    Ok(())
}

#[tauri::command]
pub fn voice_refresh_devices(host: State<'_, VoiceHost>) -> Result<(), CommandError> {
    host.send(VoiceCommand::RefreshDevices)
}

#[cfg(test)]
mod tests {
    use ovrilo_voice::ParticipantId;

    use super::*;

    #[test]
    fn disconnect_clears_room_state_but_keeps_preferences() {
        let mut state = VoiceSnapshot {
            channel_id: Some("c".into()),
            microphone_muted: true,
            ..Default::default()
        };
        apply(
            &mut state,
            VoiceEvent::ConnectionStateChanged(ConnectionState::Connected),
        );
        apply(&mut state, VoiceEvent::MicrophoneActiveChanged(true));
        apply(
            &mut state,
            VoiceEvent::ParticipantJoined {
                id: ParticipantId("u1".into()),
                name: "Ada".into(),
            },
        );
        assert_eq!(state.participants.len(), 1);

        apply(
            &mut state,
            VoiceEvent::ConnectionStateChanged(ConnectionState::Disconnected),
        );
        assert_eq!(state.connection, "disconnected");
        assert_eq!(state.channel_id, None);
        assert!(state.participants.is_empty());
        assert!(!state.microphone_active);
        assert!(state.microphone_muted);
    }

    #[test]
    fn switching_rooms_keeps_the_new_channel() {
        let mut state = VoiceSnapshot {
            channel_id: Some("old".into()),
            connection: "connected",
            ..Default::default()
        };
        // voice_join: Leave + Join queued after recording the requested channel.
        state.pending_channel_id = Some("new".into());
        apply(
            &mut state,
            VoiceEvent::ConnectionStateChanged(ConnectionState::Disconnected),
        );
        apply(
            &mut state,
            VoiceEvent::ConnectionStateChanged(ConnectionState::Connecting),
        );
        assert_eq!(state.channel_id.as_deref(), Some("new"));
    }

    #[test]
    fn rejoining_participant_is_not_duplicated() {
        let mut state = VoiceSnapshot::default();
        for _ in 0..2 {
            apply(
                &mut state,
                VoiceEvent::ParticipantJoined {
                    id: ParticipantId("u1".into()),
                    name: "Ada".into(),
                },
            );
        }
        assert_eq!(state.participants.len(), 1);
    }
}

#[cfg(test)]
mod speaking_tests {
    use ovrilo_voice::ParticipantId;

    use super::*;

    #[test]
    fn speaking_updates_known_participants_and_self_only() {
        let mut state = VoiceSnapshot::default();
        apply(
            &mut state,
            VoiceEvent::ParticipantJoined {
                id: ParticipantId("u1".into()),
                name: "Ada".into(),
            },
        );
        let speak = |id: Option<&str>, speaking| VoiceEvent::SpeakingChanged {
            participant: id.map(|id| ParticipantId(id.into())),
            speaking,
        };

        assert!(apply(&mut state, speak(Some("u1"), true)));
        assert!(state.participants[0].speaking);
        assert!(
            !apply(&mut state, speak(Some("u1"), true)),
            "no-op is not a change"
        );
        assert!(!apply(&mut state, speak(Some("ghost"), true)));
        assert!(apply(&mut state, speak(None, true)));
        assert!(state.self_speaking);

        apply(
            &mut state,
            VoiceEvent::ConnectionStateChanged(ConnectionState::Disconnected),
        );
        assert!(!state.self_speaking);
    }
}

#[cfg(test)]
mod volume_tests {
    use ovrilo_voice::ParticipantId;

    use super::*;

    fn join(state: &mut VoiceSnapshot, id: &str) {
        apply(
            state,
            VoiceEvent::ParticipantJoined {
                id: ParticipantId(id.into()),
                name: id.into(),
            },
        );
    }

    #[test]
    fn preferences_apply_to_participants_who_join_later() {
        let mut state = VoiceSnapshot::default();
        set_participant_preference(&mut state, "u1", Some(40), None);
        set_participant_preference(&mut state, "u2", None, Some(true));
        join(&mut state, "u1");
        join(&mut state, "u2");
        assert_eq!(state.participants[0].volume, 40);
        assert!(!state.participants[0].locally_muted);
        assert!(state.participants[1].locally_muted);
        assert_eq!(state.participants[1].volume, 100, "mute keeps the volume");
    }

    #[test]
    fn unmuting_restores_the_volume_and_defaults_are_not_stored() {
        let mut state = VoiceSnapshot::default();
        join(&mut state, "u1");
        set_participant_preference(&mut state, "u1", Some(150), Some(true));
        set_participant_preference(&mut state, "u1", None, Some(false));
        assert_eq!(state.participants[0].volume, 150);
        assert!(!state.participants[0].locally_muted);

        set_participant_preference(&mut state, "u1", Some(100), None);
        assert!(state.volumes.is_empty() && state.locally_muted.is_empty());
    }

    #[test]
    fn engine_volume_echo_does_not_overwrite_preferences() {
        let mut state = VoiceSnapshot::default();
        join(&mut state, "u1");
        set_participant_preference(&mut state, "u1", Some(150), Some(true));
        let changed = apply(
            &mut state,
            VoiceEvent::ParticipantVolumeChanged {
                participant: ParticipantId("u1".into()),
                percent: 0,
            },
        );
        assert!(!changed);
        assert_eq!(state.participants[0].volume, 150);
    }
}
