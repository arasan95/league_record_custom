use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::{
            GetRawInputData,
            KeyboardAndMouse::{VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9},
            RegisterRawInputDevices, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT,
            RIM_TYPEKEYBOARD,
        },
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW, TranslateMessage,
            CS_HREDRAW, CS_VREDRAW, HWND_MESSAGE, MSG, WM_INPUT, WNDCLASSEXW, WS_POPUP,
        },
    },
};

use crate::recorder::LeagueRecorder;
use crate::state::SettingsWrapper;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub struct RawInputListener;

const RI_KEY_BREAK: u32 = 1; // Manually defined as it's missing in windows-sys imports sometimes

impl RawInputListener {
    pub fn start(app_handle: AppHandle) {
        if APP_HANDLE.set(app_handle.clone()).is_err() {
            log::warn!("RawInputListener already initialized");
            return;
        }

        std::thread::spawn(move || {
            log::info!("Starting Raw Input Listener thread");
            unsafe {
                let instance = GetModuleHandleW(std::ptr::null());
                // Use explicit wide string construction for windows-sys
                let class_name_str: Vec<u16> = "LeagueRecordHotkeyListener"
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let class_name = class_name_str.as_ptr();

                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    style: CS_HREDRAW | CS_VREDRAW,
                    lpfnWndProc: Some(wnd_proc),
                    hInstance: instance,
                    lpszClassName: class_name,
                    ..Default::default()
                };

                if RegisterClassExW(&wc) == 0 {
                    log::error!("Failed to register window class for Raw Input");
                    return;
                }

                let hwnd = CreateWindowExW(
                    0,
                    class_name,
                    class_name, // Title doesn't matter
                    WS_POPUP,
                    0,
                    0,
                    0,
                    0,
                    HWND_MESSAGE,         // Constants might need casting or null reference check
                    std::ptr::null_mut(), // hMenu
                    instance,
                    std::ptr::null_mut(),
                );

                // In windows-sys 0.61, HWND is likely *mut c_void, so check against null_mut()
                if hwnd.is_null() {
                    log::error!("Failed to create message-only window");
                    return;
                }

                let rid = RAWINPUTDEVICE {
                    usUsagePage: 0x01,
                    usUsage: 0x06,
                    dwFlags: RIDEV_INPUTSINK,
                    hwndTarget: hwnd,
                };

                // RegisterRawInputDevices takes pointer to array
                if RegisterRawInputDevices(&rid, 1, std::mem::size_of::<RAWINPUTDEVICE>() as u32) == 0 {
                    log::error!("Failed to register raw input devices");
                    return;
                }

                log::info!("Raw Input Listener registered successfully");

                let mut msg: MSG = std::mem::zeroed();
                // GetMessageW second arg is HWND (can be null for all)
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        let mut size: u32 = 0;
        GetRawInputData(
            lparam as _,
            RID_INPUT,
            std::ptr::null_mut(),
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        );

        if size > 0 {
            let mut buffer = vec![0u8; size as usize];
            let bytes_read = GetRawInputData(
                lparam as _,
                RID_INPUT,
                buffer.as_mut_ptr() as _,
                &mut size,
                std::mem::size_of::<RAWINPUTHEADER>() as u32,
            );

            if bytes_read == size {
                let raw: &RAWINPUT = &*(buffer.as_ptr() as *const RAWINPUT);
                if raw.header.dwType == RIM_TYPEKEYBOARD {
                    let kb = &raw.data.keyboard;

                    // RI_KEY_BREAK = 1 (Key Up).
                    // Make = 0.
                    let is_key_down = (kb.Flags & RI_KEY_BREAK as u16) == 0;

                    if is_key_down {
                        if let Some(app) = APP_HANDLE.get() {
                            handle_hotkey(app, kb.VKey);
                        }
                    }
                }
            }
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
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
