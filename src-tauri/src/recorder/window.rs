use libobs_recorder::settings::Resolution;
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowA, GetClientRect};

pub const WINDOW_TITLE: &str = "League of Legends (TM) Client";
pub const WINDOW_CLASS: &str = "RiotWindowClass";
pub const WINDOW_PROCESS: &str = "League of Legends.exe";

pub fn get_lol_window() -> Option<HWND> {
    let mut window_title = WINDOW_TITLE.to_owned();
    window_title.push('\0'); // null terminate
    let mut window_class = WINDOW_CLASS.to_owned();
    window_class.push('\0'); // null terminate

    let title_ptr = window_title.as_ptr();
    let class_ptr = window_class.as_ptr();

    unsafe {
        let hwnd = FindWindowA(class_ptr, title_ptr);
        if hwnd.is_null() {
            None
        } else {
            Some(hwnd)
        }
    }
}

pub fn get_window_size(hwnd: HWND) -> Option<Resolution> {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    let success = unsafe { GetClientRect(hwnd, &mut rect) };

    if success == 0 {
        // BOOL FALSE is 0
        return None;
    }

    // when the LoL ingame window is created windows reports the size as (1, 1) for a short time
    // this is only the case when the DPI-AwarenessContent is set to PER-MONITOR and PER-MONITOR(V2)
    // which are necessary to the properly scaled screen resolution for hidpi screens
    if rect.right > 1 && rect.bottom > 1 {
        Some(Resolution::new(rect.right as u32, rect.bottom as u32))
    } else {
        None
    }
}
