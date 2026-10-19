//! System tray: Ovrilo keeps running (and stays in voice) when the window is closed (DESIGN.md §1.4).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, WindowEvent};

use crate::voice::VoiceHost;

const MAIN_WINDOW: &str = "main";

pub fn install(app: &App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Ovrilo", true, None::<&str>)?;
    let mute = MenuItem::with_id(app, "mute", "Mute / unmute microphone", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Ovrilo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &mute, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Ovrilo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "mute" => app.state::<VoiceHost>().toggle_muted(),
            // Leaving the room happens when the engine handle is dropped on exit.
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Closing the main window hides it to the tray instead of quitting (and leaving voice).
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && window.label() == MAIN_WINDOW
    {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
