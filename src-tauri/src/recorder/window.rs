use libobs_recorder::settings::Resolution;
use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowA, GetClassNameA, GetClientRect, GetWindowTextA, IsWindowVisible,
};

pub const WINDOW_TITLE: &str = "League of Legends (TM) Client";
pub const WINDOW_TITLE_PREFIX: &str = "League of Legends";
pub const WINDOW_CLASS: &str = "RiotWindowClass";
pub const WINDOW_PROCESS: &str = "League of Legends.exe";

#[derive(Debug, Clone)]
pub struct LolWindow {
    hwnd: HWND,
    title: String,
    class: String,
}

impl LolWindow {
    pub fn hwnd(&self) -> HWND {
        self.hwnd
    }

    pub fn capture_title(&self) -> &str {
        &self.title
    }

    pub fn capture_class(&self) -> &str {
        &self.class
    }
}

fn window_text(hwnd: HWND) -> String {
    let mut buffer = [0u8; 512];
    let len = unsafe { GetWindowTextA(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf8_lossy(&buffer[..len.max(0) as usize]).into_owned()
}

fn window_class(hwnd: HWND) -> String {
    let mut buffer = [0u8; 256];
    let len = unsafe { GetClassNameA(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf8_lossy(&buffer[..len.max(0) as usize]).into_owned()
}

fn is_lol_window(title: &str, class: &str) -> bool {
    class == WINDOW_CLASS && title.contains(WINDOW_TITLE_PREFIX)
}

pub fn get_lol_window() -> Option<HWND> {
    get_lol_window_info().map(|window| window.hwnd())
}

pub fn get_lol_window_info() -> Option<LolWindow> {
    let mut window_title = WINDOW_TITLE.to_owned();
    window_title.push('\0'); // null terminate
    let mut window_class = WINDOW_CLASS.to_owned();
    window_class.push('\0'); // null terminate

    let title_ptr = window_title.as_ptr();
    let class_ptr = window_class.as_ptr();

    unsafe {
        let hwnd = FindWindowA(class_ptr, title_ptr);
        if !hwnd.is_null() {
            return Some(LolWindow {
                hwnd,
                title: WINDOW_TITLE.to_string(),
                class: WINDOW_CLASS.to_string(),
            });
        }
    }

    let mut found: Option<LolWindow> = None;
    unsafe {
        EnumWindows(Some(enum_lol_windows), &mut found as *mut Option<LolWindow> as LPARAM);
    }
    found
}

unsafe extern "system" fn enum_lol_windows(hwnd: HWND, lparam: LPARAM) -> i32 {
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }

    let title = window_text(hwnd);
    let class = window_class(hwnd);
    if is_lol_window(&title, &class) {
        let found = unsafe { &mut *(lparam as *mut Option<LolWindow>) };
        *found = Some(LolWindow { hwnd, title, class });
        return 0;
    }

    1
}

pub fn get_lol_window_capture_target() -> (String, String, String) {
    if let Some(window) = get_lol_window_info() {
        log::info!(
            "LoL capture window resolved: title='{}', class='{}'",
            window.capture_title(),
            window.capture_class()
        );
        (
            window.capture_title().to_string(),
            window.capture_class().to_string(),
            WINDOW_PROCESS.to_string(),
        )
    } else {
        log::warn!(
            "LoL capture window not found while configuring recorder. Falling back to legacy title '{}'",
            WINDOW_TITLE
        );
        (
            WINDOW_TITLE.to_string(),
            WINDOW_CLASS.to_string(),
            WINDOW_PROCESS.to_string(),
        )
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
