//! Desktop preferences persisted across restarts (selected devices, push-to-talk).
//!
//! Stored as JSON in the app config directory. Not secret; never holds tokens (ADR-0011).

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub input_device_id: Option<String>,
    pub output_device_id: Option<String>,
    pub push_to_talk: bool,
    pub push_to_talk_key: Option<PushToTalkKey>,
}

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
}
