//! Ovrilo desktop host.
//!
//! Tauri commands carry coarse control messages only; audio data never crosses UI IPC (ADR-0002).

mod credentials;

/// Returns the desktop application version for diagnostics and API compatibility reporting.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_version,
            credentials::credentials_load_refresh_token,
            credentials::credentials_store_refresh_token,
            credentials::credentials_clear_refresh_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
