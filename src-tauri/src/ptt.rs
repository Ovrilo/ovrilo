//! Global push-to-talk key watcher (ADR-0002: the Rust host owns global input).
//!
//! Polls the key's async state every 10 ms instead of registering a hotkey: the key keeps
//! reaching the game (RegisterHotKey would swallow it), mouse side buttons work, and no input
//! hook is installed. Only state transitions are sent to the engine.

use std::sync::Arc;
use std::sync::atomic::{AtomicU16, Ordering};
use std::thread;
use std::time::Duration;

use ovrilo_voice::{VoiceCommand, VoiceEngineHandle};

const POLL: Duration = Duration::from_millis(10);
const IDLE: Duration = Duration::from_millis(100);

pub struct KeyWatcher {
    /// Windows virtual-key code being watched; 0 = push-to-talk off.
    key: Arc<AtomicU16>,
}

impl KeyWatcher {
    pub fn start(engine: VoiceEngineHandle) -> Self {
        let key = Arc::new(AtomicU16::new(0));
        let watched = key.clone();
        let _ = thread::Builder::new()
            .name("ovrilo-ptt".into())
            .spawn(move || {
                let mut pressed = false;
                loop {
                    let code = watched.load(Ordering::Relaxed);
                    let now = code != 0 && is_down(code);
                    if now != pressed {
                        pressed = now;
                        if !engine.send(VoiceCommand::SetPushToTalkPressed(pressed)) {
                            return;
                        }
                    }
                    thread::sleep(if code == 0 { IDLE } else { POLL });
                }
            });
        Self { key }
    }

    /// Watches `code`, or stops watching with `None`.
    pub fn watch(&self, code: Option<u16>) {
        self.key.store(code.unwrap_or(0), Ordering::Relaxed);
    }
}

#[cfg(windows)]
fn is_down(code: u16) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    // SAFETY: GetAsyncKeyState only reads global key state for a virtual-key code.
    let state = unsafe { GetAsyncKeyState(i32::from(code)) };
    (state as u16 & 0x8000) != 0
}

#[cfg(not(windows))]
fn is_down(_code: u16) -> bool {
    false
}
