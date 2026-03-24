use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::{
    Foundation::{HWND, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT, VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5,
            VK_F6, VK_F7, VK_F8, VK_F9,
        },
        WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY},
    },
};

use crate::recorder::LeagueRecorder;
use crate::state::SettingsWrapper;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub struct RawInputListener;

const HOTKEY_VKEYS: [u16; 12] = [VK_F1, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_F10, VK_F11, VK_F12];
const HOTKEY_ID_BASE: i32 = 1000;

impl RawInputListener {
    pub fn start(app_handle: AppHandle) {
        if APP_HANDLE.set(app_handle.clone()).is_err() {
            log::warn!("RawInputListener already initialized");
            return;
        }

        std::thread::spawn(move || {
            log::info!("Starting global hotkey listener thread");
            unsafe {
                let mut registered_ids = Vec::new();
                for (idx, vkey) in HOTKEY_VKEYS.iter().enumerate() {
                    let hotkey_id = HOTKEY_ID_BASE + idx as i32;
                    let ok = RegisterHotKey(std::ptr::null_mut() as HWND, hotkey_id, MOD_NOREPEAT, *vkey as u32);
                    if ok == 0 {
                        log::warn!("Failed to register global hotkey: F{}", idx + 1);
                    } else {
                        registered_ids.push(hotkey_id);
                    }
                }

                if registered_ids.is_empty() {
                    log::error!("No global hotkeys registered. Hotkey listener will not run.");
                    return;
                }

                log::info!("Global hotkeys registered successfully");

                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) != 0 {
                    if msg.message == WM_HOTKEY {
                        if let Some(app) = APP_HANDLE.get() {
                            let hotkey_id = msg.wParam as i32;
                            if let Some(vkey) = vkey_from_hotkey_id(hotkey_id) {
                                handle_hotkey(app, vkey as u16);
                            }
                        }
                    }
                }

                for id in registered_ids {
                    let _ = UnregisterHotKey(std::ptr::null_mut() as HWND, id);
                }
            }
        });
    }
}

fn vkey_from_hotkey_id(hotkey_id: i32) -> Option<WPARAM> {
    let idx = hotkey_id - HOTKEY_ID_BASE;
    if idx < 0 || idx as usize >= HOTKEY_VKEYS.len() {
        return None;
    }
    Some(HOTKEY_VKEYS[idx as usize] as WPARAM)
}

fn handle_hotkey(app: &AppHandle, vkey: u16) {
    let key_name = match vkey {
        k if k == VK_F1 => "F1",
        k if k == VK_F2 => "F2",
        k if k == VK_F3 => "F3",
        k if k == VK_F4 => "F4",
        k if k == VK_F5 => "F5",
        k if k == VK_F6 => "F6",
        k if k == VK_F7 => "F7",
        k if k == VK_F8 => "F8",
        k if k == VK_F9 => "F9",
        k if k == VK_F10 => "F10",
        k if k == VK_F11 => "F11",
        k if k == VK_F12 => "F12",
        _ => return,
    };

    let recording_state = app.state::<crate::state::CurrentlyRecording>();
    let settings = app.state::<SettingsWrapper>();

    // Check if key matches start recording hotkey
    let is_start_hotkey = settings
        .start_recording_hotkey()
        .map(|h| h.eq_ignore_ascii_case(key_name))
        .unwrap_or(false);

    // If not recording and not start hotkey, ignore
    if recording_state.get().is_none() && !is_start_hotkey {
        return;
    }

    if is_start_hotkey {
        // Only trigger start if NOT recording (though GameListener handles idempotency, better to check here too?)
        // Actually, if we are already recording, maybe user wants to restart?
        // But manual_start logic in GameListener checks for State::Idle.
        log::info!("RawInput: Start Recording Hotkey Triggered ({})", key_name);
        app.state::<LeagueRecorder>().manual_start();
    }

    if let Some(hotkey) = settings.stop_recording_hotkey() {
        if hotkey.eq_ignore_ascii_case(key_name) {
            log::info!("RawInput: Stop Recording Hotkey Triggered ({})", key_name);
            app.state::<LeagueRecorder>().manual_stop();
        }
    }

    if let Some(hotkey) = settings.hightlight_hotkey() {
        if hotkey.eq_ignore_ascii_case(key_name) {
            log::info!("RawInput: Highlight Hotkey Triggered ({})", key_name);
            let _ = app.emit("shortcut-event", "");
        }
    }
}
