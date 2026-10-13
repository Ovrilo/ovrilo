//! Refresh-token storage in the OS credential store (Windows Credential Manager).
//!
//! The refresh token never touches web storage (ADR-0011, ADR-0012). Access tokens stay in UI memory.

use keyring::{Entry, Error as KeyringError};
use serde::Serialize;

const SERVICE: &str = "app.ovrilo.desktop";
const REFRESH_TOKEN_ACCOUNT: &str = "refresh-token";
/// Refresh tokens are `{32 hex}.{43 base64url}`; reject anything unexpectedly large.
const MAX_TOKEN_LENGTH: usize = 256;

/// IPC error shape: `{ code, message }` (docs/development/CONTRACTS.md §4).
#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl CommandError {
    fn storage(error: KeyringError) -> Self {
        Self {
            code: "credentials.storage_unavailable",
            message: error.to_string(),
        }
    }
}

fn refresh_token_entry() -> Result<Entry, CommandError> {
    Entry::new(SERVICE, REFRESH_TOKEN_ACCOUNT).map_err(CommandError::storage)
}

fn load(entry: &Entry) -> Result<Option<String>, CommandError> {
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(CommandError::storage(error)),
    }
}

fn store(entry: &Entry, token: &str) -> Result<(), CommandError> {
    if token.is_empty() || token.len() > MAX_TOKEN_LENGTH {
        return Err(CommandError {
            code: "credentials.invalid_token",
            message: "refresh token has an unexpected length".into(),
        });
    }
    entry.set_password(token).map_err(CommandError::storage)
}

fn clear(entry: &Entry) -> Result<(), CommandError> {
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(CommandError::storage(error)),
    }
}

#[tauri::command]
pub fn credentials_load_refresh_token() -> Result<Option<String>, CommandError> {
    load(&refresh_token_entry()?)
}

#[tauri::command]
pub fn credentials_store_refresh_token(token: String) -> Result<(), CommandError> {
    store(&refresh_token_entry()?, &token)
}

/// Removes the stored token. Idempotent.
#[tauri::command]
pub fn credentials_clear_refresh_token() -> Result<(), CommandError> {
    clear(&refresh_token_entry()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_tokens_without_touching_the_store() {
        let entry = Entry::new("app.ovrilo.desktop.test", "unused").unwrap();
        assert!(store(&entry, &"x".repeat(MAX_TOKEN_LENGTH + 1)).is_err());
        assert!(store(&entry, "").is_err());
    }

    /// Uses the real OS credential store. Run locally: `cargo test -- --ignored`.
    #[test]
    #[ignore = "touches the OS credential store"]
    fn round_trips_through_the_os_credential_store() {
        let entry = Entry::new("app.ovrilo.desktop.test", "round-trip").unwrap();
        clear(&entry).unwrap();

        assert_eq!(load(&entry).unwrap(), None);
        store(&entry, "session.secret").unwrap();
        assert_eq!(load(&entry).unwrap().as_deref(), Some("session.secret"));
        clear(&entry).unwrap();
        clear(&entry).unwrap();
        assert_eq!(load(&entry).unwrap(), None);
    }
}
