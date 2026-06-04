#[cfg(target_os = "windows")]
use std::sync::OnceLock;
#[cfg(target_os = "windows")]
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::recorder::LeagueRecorder;
use crate::state::{CurrentlyRecording, SettingsWrapper};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9,
};

#[cfg(target_os = "windows")]
static FUNCTION_KEY_POLLER_STARTED: OnceLock<()> = OnceLock::new();

fn parse_shortcut(label: &str, value: &str) -> Option<Shortcut> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    match trimmed.parse::<Shortcut>() {
        Ok(shortcut) => Some(shortcut),
        Err(err) => {
            log::warn!("Invalid {label} hotkey '{trimmed}': {err}");
            None
        }
    }
}

fn setting_matches_shortcut(setting: Option<String>, shortcut: &Shortcut) -> bool {
    setting
        .and_then(|value| value.parse::<Shortcut>().ok())
        .is_some_and(|configured| configured == *shortcut)
}

fn is_plain_function_key(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_uppercase().as_str(),
        "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12"
    )
}

fn setting_matches_function_key(setting: Option<String>, key_name: &str) -> bool {
    setting
        .map(|value| value.trim().to_ascii_uppercase())
        .is_some_and(|configured| configured == key_name)
}

fn handle_function_key_press(app_handle: &AppHandle, key_name: &str) {
    let settings = app_handle.state::<SettingsWrapper>();
    let is_start_hotkey = setting_matches_function_key(settings.start_recording_hotkey(), key_name);

    let recording_state = app_handle.state::<CurrentlyRecording>();
    if recording_state.get().is_none() && !is_start_hotkey {
        return;
    }

    if is_start_hotkey {
        log::info!("FunctionKeyPoller: Start Recording Triggered ({key_name})");
        app_handle.state::<LeagueRecorder>().manual_start();
    }

    if setting_matches_function_key(settings.stop_recording_hotkey(), key_name) {
        log::info!("FunctionKeyPoller: Stop Recording Triggered ({key_name})");
        app_handle.state::<LeagueRecorder>().manual_stop();
    }

    if setting_matches_function_key(settings.hightlight_hotkey(), key_name) {
        log::info!("FunctionKeyPoller: Highlight Triggered ({key_name})");
        if let Err(err) = app_handle.emit("shortcut-event", "") {
            log::warn!("Failed to emit shortcut-event: {err}");
        }
    }
}

#[cfg(target_os = "windows")]
pub fn start_function_key_poller(app_handle: AppHandle) {
    if FUNCTION_KEY_POLLER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(move || {
        let keys: [(&str, i32); 12] = [
            ("F1", VK_F1 as i32),
            ("F2", VK_F2 as i32),
            ("F3", VK_F3 as i32),
            ("F4", VK_F4 as i32),
            ("F5", VK_F5 as i32),
            ("F6", VK_F6 as i32),
            ("F7", VK_F7 as i32),
            ("F8", VK_F8 as i32),
            ("F9", VK_F9 as i32),
            ("F10", VK_F10 as i32),
            ("F11", VK_F11 as i32),
            ("F12", VK_F12 as i32),
        ];

        let mut previous_down = [false; 12];
        loop {
            for (idx, (name, vk)) in keys.iter().enumerate() {
                let is_down = (unsafe { GetAsyncKeyState(*vk) } as u16 & 0x8000) != 0;
                if is_down && !previous_down[idx] {
                    handle_function_key_press(&app_handle, name);
                }
                previous_down[idx] = is_down;
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_function_key_poller(_app_handle: AppHandle) {}

pub fn register_shortcuts_from_settings(app_handle: &AppHandle) {
    let global_shortcut = app_handle.global_shortcut();
    if let Err(err) = global_shortcut.unregister_all() {
        log::warn!("Failed to unregister existing global shortcuts: {err}");
    }

    let settings = app_handle.state::<SettingsWrapper>();
    let mut shortcuts = Vec::<Shortcut>::new();

    for (label, value) in [
        ("startRecordingHotkey", settings.start_recording_hotkey()),
        ("stopRecordingHotkey", settings.stop_recording_hotkey()),
        ("hightlightHotkey", settings.hightlight_hotkey()),
    ] {
        let Some(value) = value else {
            continue;
        };
        let Some(shortcut) = parse_shortcut(label, &value) else {
            continue;
        };

        if is_plain_function_key(&value) {
            log::info!("Skipping global shortcut register for '{value}' ({label}); handled by FunctionKeyPoller");
            continue;
        }

        if shortcuts.contains(&shortcut) {
            continue;
        }

        shortcuts.push(shortcut);
    }

    for shortcut in shortcuts {
        if let Err(err) = global_shortcut.register(shortcut.clone()) {
            log::warn!("Failed to register global shortcut '{}': {err}", shortcut);
            continue;
        }
        log::info!("Registered global shortcut '{}'", shortcut);
    }
}

pub fn handle_global_shortcut_event(app_handle: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }

    let settings = app_handle.state::<SettingsWrapper>();
    let is_start_hotkey = setting_matches_shortcut(settings.start_recording_hotkey(), shortcut);

    let recording_state = app_handle.state::<CurrentlyRecording>();
    if recording_state.get().is_none() && !is_start_hotkey {
        return;
    }

    if is_start_hotkey {
        log::info!("GlobalShortcut: Start Recording Triggered ({shortcut})");
        app_handle.state::<LeagueRecorder>().manual_start();
    }

    if setting_matches_shortcut(settings.stop_recording_hotkey(), shortcut) {
        log::info!("GlobalShortcut: Stop Recording Triggered ({shortcut})");
        app_handle.state::<LeagueRecorder>().manual_stop();
    }

    if setting_matches_shortcut(settings.hightlight_hotkey(), shortcut) {
        log::info!("GlobalShortcut: Highlight Triggered ({shortcut})");
        if let Err(err) = app_handle.emit("shortcut-event", "") {
            log::warn!("Failed to emit shortcut-event: {err}");
        }
    }
}
