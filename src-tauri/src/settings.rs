//! Desktop preferences persisted across restarts (devices, push-to-talk, noise suppression).
//!
//! Stored as JSON in the app config directory. Not secret; never holds tokens (ADR-0011).

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "settings.json";

/// Bumped when a stored value must be changed once on load (see `migrate`).
const SETTINGS_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub input_device_id: Option<String>,
    pub output_device_id: Option<String>,
    pub push_to_talk: bool,
    pub push_to_talk_key: Option<PushToTalkKey>,
    /// Playback volume per user ID (percent); 100 is not stored.
    pub participant_volumes: BTreeMap<String, u16>,
    /// Users muted for this client only (their volume is kept for unmuting).
    pub muted_participants: BTreeSet<String>,
    /// Microphone noise suppression (ADR-0018). Missing in older files: Standard.
    pub noise_suppression: NoiseSuppressionChoice,
    /// Master volumes in percent (0–200, 100 = unchanged).
    pub input_volume: Volume,
    pub output_volume: Volume,
    /// Which one-time migrations the file has been through. Missing (0) in files from 0.7.0 and
    /// older; new settings start at the current version.
    #[serde(default)]
    pub version: u16,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            input_device_id: None,
            output_device_id: None,
            push_to_talk: false,
            push_to_talk_key: None,
            participant_volumes: BTreeMap::new(),
            muted_participants: BTreeSet::new(),
            noise_suppression: NoiseSuppressionChoice::default(),
            input_volume: Volume::default(),
            output_volume: Volume::default(),
            version: SETTINGS_VERSION,
        }
    }
}

/// A volume in percent; 100 when missing from older files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Volume(pub u16);

impl Default for Volume {
    fn default() -> Self {
        Self(100)
    }
}

/// How the microphone is cleaned before it is sent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoiseSuppressionChoice {
    Off,
    #[default]
    Standard,
    Enhanced,
}

impl NoiseSuppressionChoice {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Standard => "standard",
            Self::Enhanced => "enhanced",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "standard" => Some(Self::Standard),
            "enhanced" => Some(Self::Enhanced),
            _ => None,
        }
    }
}

/// Upper bound on remembered per-user volumes, so the file cannot grow without limit.
pub const MAX_PARTICIPANT_VOLUMES: usize = 500;

/// A key or mouse button as a Windows virtual-key code plus a display label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushToTalkKey {
    pub code: u16,
    pub label: String,
}

impl PushToTalkKey {
    /// Rejects codes outside the virtual-key range and the primary mouse buttons, which would
    /// make every click transmit.
    pub fn validate(&self) -> Result<(), &'static str> {
        if !(3..=0xFE).contains(&self.code) {
            return Err("unsupported key");
        }
        if self.label.is_empty() || self.label.chars().count() > 32 {
            return Err("key label has an unexpected length");
        }
        Ok(())
    }
}

pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Mutex<DesktopSettings>,
}

impl SettingsStore {
    /// Loads settings; a missing or unreadable file means defaults.
    pub fn load(directory: Option<PathBuf>) -> Self {
        let path = directory.map(|d| d.join(FILE_NAME));
        let current = path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str::<DesktopSettings>(&text).ok())
            .map(sanitize)
            .unwrap_or_default();
        let current = migrate(current);
        Self {
            path,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> DesktopSettings {
        self.current
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Applies a change and saves it (write to a temp file, then rename). Save errors are
    /// ignored: the preference still applies for this session.
    pub fn update(&self, change: impl FnOnce(&mut DesktopSettings)) -> DesktopSettings {
        let mut current = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        change(&mut current);
        if let Some(path) = &self.path
            && let Ok(json) = serde_json::to_string_pretty(&*current)
        {
            let temp = path.with_extension("json.tmp");
            let _ = path
                .parent()
                .map(fs::create_dir_all)
                .transpose()
                .and_then(|_| fs::write(&temp, json))
                .and_then(|()| fs::rename(&temp, path));
        }
        current.clone()
    }
}

/// One-time changes to files written by older versions. The new version is saved with the next change.
fn migrate(mut settings: DesktopSettings) -> DesktopSettings {
    if settings.version < 1 {
        // 0.7.0 made Enhanced the default, and it cut speech too often; files still on it move to
        // Standard once. Choosing Enhanced again afterwards is kept.
        if settings.noise_suppression == NoiseSuppressionChoice::Enhanced {
            settings.noise_suppression = NoiseSuppressionChoice::Standard;
        }
    }
    settings.version = SETTINGS_VERSION;
    settings
}

/// Drops values a hand-edited or older file could carry that the app would reject.
fn sanitize(mut settings: DesktopSettings) -> DesktopSettings {
    if settings
        .push_to_talk_key
        .as_ref()
        .is_some_and(|key| key.validate().is_err())
    {
        settings.push_to_talk_key = None;
    }
    if settings.push_to_talk_key.is_none() {
        settings.push_to_talk = false;
    }
    settings.participant_volumes.retain(|id, percent| {
        !id.is_empty() && id.len() <= 64 && *percent <= 200 && *percent != 100
    });
    while settings.participant_volumes.len() > MAX_PARTICIPANT_VOLUMES {
        settings.participant_volumes.pop_last();
    }
    settings
        .muted_participants
        .retain(|id| !id.is_empty() && id.len() <= 64);
    while settings.muted_participants.len() > MAX_PARTICIPANT_VOLUMES {
        settings.muted_participants.pop_last();
    }
    settings.input_volume.0 = settings.input_volume.0.min(200);
    settings.output_volume.0 = settings.output_volume.0.min(200);
    settings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ovrilo-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn round_trips_and_defaults_when_missing() {
        let dir = temp_dir("roundtrip");
        let store = SettingsStore::load(Some(dir.clone()));
        assert_eq!(store.get(), DesktopSettings::default());

        store.update(|s| {
            s.input_device_id = Some("mic".into());
            s.push_to_talk = true;
            s.push_to_talk_key = Some(PushToTalkKey {
                code: 0x05,
                label: "Mouse 4".into(),
            });
        });

        let reloaded = SettingsStore::load(Some(dir.clone()));
        assert_eq!(reloaded.get().input_device_id.as_deref(), Some("mic"));
        assert!(reloaded.get().push_to_talk);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_or_corrupt_files_fall_back_safely() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), "{not json").unwrap();
        assert_eq!(
            SettingsStore::load(Some(dir.clone())).get(),
            DesktopSettings::default()
        );

        fs::write(
            dir.join(FILE_NAME),
            r#"{"pushToTalk":true,"pushToTalkKey":{"code":1,"label":"Left click"}}"#,
        )
        .unwrap();
        let settings = SettingsStore::load(Some(dir.clone())).get();
        assert_eq!(settings.push_to_talk_key, None, "left click is rejected");
        assert!(!settings.push_to_talk, "push-to-talk needs a key");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn noise_suppression_defaults_to_standard_and_is_remembered() {
        let dir = temp_dir("noise");
        fs::create_dir_all(&dir).unwrap();
        // A file written before the setting existed.
        fs::write(dir.join(FILE_NAME), r#"{"pushToTalk":false}"#).unwrap();
        let store = SettingsStore::load(Some(dir.clone()));
        assert_eq!(
            store.get().noise_suppression,
            NoiseSuppressionChoice::Standard
        );

        store.update(|s| s.noise_suppression = NoiseSuppressionChoice::Enhanced);
        let reloaded = SettingsStore::load(Some(dir.clone()));
        assert_eq!(
            reloaded.get().noise_suppression,
            NoiseSuppressionChoice::Enhanced,
            "choosing Enhanced after the migration is kept"
        );
        assert_eq!(
            NoiseSuppressionChoice::parse("off"),
            Some(NoiseSuppressionChoice::Off)
        );
        assert_eq!(NoiseSuppressionChoice::parse("ultra"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enhanced_from_0_7_0_moves_to_standard_once() {
        let dir = temp_dir("noise-migration");
        fs::create_dir_all(&dir).unwrap();
        // 0.7.0 saved its Enhanced default with every change, without a version.
        fs::write(
            dir.join(FILE_NAME),
            r#"{"noiseSuppression":"enhanced","inputVolume":120}"#,
        )
        .unwrap();
        let store = SettingsStore::load(Some(dir.clone()));
        let settings = store.get();
        assert_eq!(settings.noise_suppression, NoiseSuppressionChoice::Standard);
        assert_eq!(
            settings.input_volume,
            Volume(120),
            "other settings are kept"
        );

        // Off is a deliberate choice and stays.
        fs::write(dir.join(FILE_NAME), r#"{"noiseSuppression":"off"}"#).unwrap();
        assert_eq!(
            SettingsStore::load(Some(dir.clone()))
                .get()
                .noise_suppression,
            NoiseSuppressionChoice::Off
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn volumes_default_to_100_and_are_clamped() {
        let dir = temp_dir("volumes");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), r#"{"outputVolume":450}"#).unwrap();
        let store = SettingsStore::load(Some(dir.clone()));
        assert_eq!(store.get().input_volume, Volume(100));
        assert_eq!(store.get().output_volume, Volume(200));
        let _ = fs::remove_dir_all(&dir);
    }
}
