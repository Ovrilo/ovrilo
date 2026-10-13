//! Ovrilo desktop host.
//!
//! Tauri commands carry coarse control messages only; audio data never crosses UI IPC (ADR-0002).

mod credentials;
mod voice;

use tauri::Manager;

/// Returns the desktop application version for diagnostics and API compatibility reporting.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(voice::VoiceHost::start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            credentials::credentials_load_refresh_token,
            credentials::credentials_store_refresh_token,
            credentials::credentials_clear_refresh_token,
            voice::voice_get_state,
            voice::voice_join,
            voice::voice_leave,
            voice::voice_set_muted,
            voice::voice_set_deafened,
            voice::voice_set_input_device,
            voice::voice_set_output_device,
            voice::voice_refresh_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
