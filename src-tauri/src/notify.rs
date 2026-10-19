//! Windows notifications for messages and calls. The frontend decides when one is due; clicking it
//! shows the window and tells the frontend which conversation to open.

use tauri::{AppHandle, Emitter};

/// Event sent to the frontend when the user clicks a notification; the payload is the
/// conversation ID it was about, if any.
pub const ACTIVATED_EVENT: &str = "notification-activated";

/// Shows a notification without Windows' own sound (the app plays its own).
#[tauri::command]
pub fn notify_show(
    app: AppHandle,
    title: String,
    body: String,
    conversation_id: Option<String>,
) -> Result<(), String> {
    show(&app, &title, &body, conversation_id)
}

#[cfg(windows)]
fn show(
    app: &AppHandle,
    title: &str,
    body: &str,
    conversation_id: Option<String>,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;

    // Installed builds are registered under the bundle identifier (the installer's Start menu
    // shortcut); development builds have no registration, so they borrow PowerShell's.
    let app_id = if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID.to_owned()
    } else {
        app.config().identifier.clone()
    };
    let handle = app.clone();
    Toast::new(&app_id)
        .title(title)
        .text1(body)
        .sound(None)
        .on_activated(move |_| {
            crate::tray::show_main_window(&handle);
            let _ = handle.emit(ACTIVATED_EVENT, conversation_id.clone());
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn show(
    _app: &AppHandle,
    _title: &str,
    _body: &str,
    _conversation_id: Option<String>,
) -> Result<(), String> {
    Ok(())
}
