//! How long the computer has had no keyboard or mouse input, for the automatic Away status.

/// Seconds since the last keyboard or mouse input anywhere on the computer (0 elsewhere than Windows).
#[tauri::command]
pub fn idle_seconds() -> u32 {
    seconds_since_input()
}

#[cfg(windows)]
fn seconds_since_input() -> u32 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a valid, correctly sized LASTINPUTINFO for the duration of the call.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return 0;
    }
    // Both are milliseconds since boot in 32 bits; wrapping_sub stays right across the 49-day wrap.
    // SAFETY: GetTickCount has no preconditions.
    let now = unsafe { GetTickCount() };
    now.wrapping_sub(info.dwTime) / 1000
}

#[cfg(not(windows))]
fn seconds_since_input() -> u32 {
    0
}
