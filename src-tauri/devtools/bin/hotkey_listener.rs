//! Standalone raw-input hotkey listener used by the Electron build.
//!
//! Riot Vanguard hooks the Windows input dispatch table, which prevents
//! RegisterHotKey-based global shortcuts (and GetAsyncKeyState polling) from
//! observing keys pressed while a game is focused. Raw input is delivered via
//! WM_INPUT to a registered message-only window and is not affected by those
//! hooks, which is why the Tauri build relies on the same mechanism.
//!
//! This helper registers a raw keyboard device, then reports every F1-F12
//! key-down edge to stdout as a single line: `KEY F9`. It runs until the
//! process is killed by the parent. Registration success is reported as a
//! `READY` line so the parent can confirm the listener is active.

use std::io::Write;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::{
            GetRawInputData, RegisterRawInputDevices, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
            RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD,
        },
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW,
            TranslateMessage, CS_HREDRAW, CS_VREDRAW, HWND_MESSAGE, MSG, WM_INPUT, WNDCLASSEXW,
            WS_POPUP,
        },
    },
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9,
};

#[cfg(target_os = "windows")]
const RI_KEY_BREAK: u32 = 1;

#[cfg(target_os = "windows")]
fn emit(line: &str) {
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}

#[cfg(target_os = "windows")]
fn key_name(vkey: u16) -> Option<&'static str> {
    match vkey {
        VK_F1 => Some("F1"),
        VK_F2 => Some("F2"),
        VK_F3 => Some("F3"),
        VK_F4 => Some("F4"),
        VK_F5 => Some("F5"),
        VK_F6 => Some("F6"),
        VK_F7 => Some("F7"),
        VK_F8 => Some("F8"),
        VK_F9 => Some("F9"),
        VK_F10 => Some("F10"),
        VK_F11 => Some("F11"),
        VK_F12 => Some("F12"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
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
                    // RI_KEY_BREAK = 1 (key up); Make = 0 (key down).
                    let is_key_down = (kb.Flags & RI_KEY_BREAK as u16) == 0;
                    if is_key_down {
                        if let Some(name) = key_name(kb.VKey) {
                            emit(&format!("KEY {name}"));
                        }
                    }
                }
            }
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn main() {
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class_name: Vec<u16> = "LeagueRecordHotkeyListener"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..Default::default()
        };

        if RegisterClassExW(&wc) == 0 {
            eprintln!("failed to register window class");
            std::process::exit(1);
        }

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            instance,
            std::ptr::null_mut(),
        );
        if hwnd.is_null() {
            eprintln!("failed to create message-only window");
            std::process::exit(1);
        }

        let rid = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        };
        if RegisterRawInputDevices(&rid, 1, std::mem::size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            eprintln!("failed to register raw input devices");
            std::process::exit(1);
        }

        emit("READY");

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("hotkey_listener is only supported on Windows");
    std::process::exit(1);
}
