//! Voice engine host: owns the `ovrilo-voice` engine and translates it to IPC (CONTRACTS.md §4).
//!
//! The engine is authoritative. The host folds engine events into a [`VoiceSnapshot`] and emits it
//! as `voice://state-changed`; errors are emitted as `voice://error`. Audio never crosses IPC.

use std::sync::{Arc, Mutex, PoisonError};

use ovrilo_voice::{
    AudioDevice, ConnectionState, DeviceId, VoiceCommand, VoiceEngine, VoiceEngineHandle,
    VoiceErrorCode, VoiceEvent,
};
use ovrilo_voice_cpal::CpalBackend;
use ovrilo_voice_livekit::{LiveKitTransport, ProcessingConfig, webrtc_processing};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::credentials::CommandError;

pub const STATE_CHANGED: &str = "voice://state-changed";
pub const ERROR: &str = "voice://error";

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
    participants: Vec<ParticipantDto>,
    inputs: Vec<DeviceDto>,
    outputs: Vec<DeviceDto>,
    /// Selected devices; `None` follows the system default.
    input_device_id: Option<String>,
    output_device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantDto {
    /// SFU identity: the user ID issued by the API.
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDto {
    id: String,
    name: String,
    is_default: bool,
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
            participants: Vec::new(),
            inputs: Vec::new(),
            outputs: Vec::new(),
            input_device_id: None,
            output_device_id: None,
        }
    }
}

pub struct VoiceHost {
    engine: VoiceEngineHandle,
    snapshot: Arc<Mutex<VoiceSnapshot>>,
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
        let snapshot = Arc::new(Mutex::new(VoiceSnapshot::default()));

        let shared = snapshot.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
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

        engine.send(VoiceCommand::RefreshDevices);
        Self { engine, snapshot }
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
            }
        }
        VoiceEvent::MicrophoneMutedChanged(muted) => state.microphone_muted = muted,
        VoiceEvent::DeafenedChanged(deafened) => state.deafened = deafened,
        VoiceEvent::MicrophoneActiveChanged(active) => state.microphone_active = active,
        VoiceEvent::ParticipantJoined { id, name } => {
            state.participants.retain(|p| p.id != id.0);
            state.participants.push(ParticipantDto { id: id.0, name });
        }
        VoiceEvent::ParticipantLeft { id } => state.participants.retain(|p| p.id != id.0),
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
