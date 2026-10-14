//! Ovrilo desktop host.
//!
//! Tauri commands carry coarse control messages only; audio data never crosses UI IPC (ADR-0002).

mod credentials;
mod ptt;
mod settings;
mod stats_log;
mod tray;
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
            tray::install(app)?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
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
            voice::voice_stats_log_path,
            voice::voice_set_push_to_talk,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Leave cleanly so others see us go now, not after the server's timeout.
                app.state::<voice::VoiceHost>().leave_before_exit();
            }
        });
}
