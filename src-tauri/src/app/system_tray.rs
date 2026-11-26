use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder};
use tauri::tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use super::{AppWindow, WindowManager};
use crate::constants::{self, menu_item};
use crate::recorder::LeagueRecorder;
use crate::state::{CurrentlyRecording, RecordingPhase, SettingsWrapper, TrayState};

pub trait SystemTrayManager {
    fn init_tray_menu(&self);

    #[allow(dead_code)]
    fn set_tray_menu_update_available(&self, update_button: bool);

    fn refresh_recording_tray(&self);
}

fn recording_icon_filled_rgba() -> (Vec<u8>, u32, u32) {
    let width = 32;
    let height = 32;
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    let center = 15.5f32;
    let radius_sq = 15.0f32 * 15.0f32;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            if dx * dx + dy * dy <= radius_sq {
                rgba.extend_from_slice(&[255, 0, 0, 255]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    (rgba, width, height)
}

fn recording_icon_outline_rgba() -> (Vec<u8>, u32, u32) {
    let width = 32;
    let height = 32;
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    let center = 15.5f32;
    let outer = 15.0f32 * 15.0f32;
    let inner = 11.0f32 * 11.0f32;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let d = dx * dx + dy * dy;
            if d <= outer && d >= inner {
                rgba.extend_from_slice(&[255, 0, 0, 255]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    (rgba, width, height)
}

fn handle_system_tray_event(tray_icon: &TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
        let app_handle = tray_icon.app_handle() as &AppHandle;
        app_handle.open_window(AppWindow::Main);
    }
}

fn handle_system_tray_menu_event(app_handle: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        menu_item::START_RECORDING => app_handle.state::<LeagueRecorder>().manual_start(),
        menu_item::STOP_RECORDING => app_handle.state::<LeagueRecorder>().manual_stop(),
        menu_item::SETTINGS => SettingsWrapper::let_user_edit_settings(app_handle),
        menu_item::OPEN => app_handle.open_window(AppWindow::Main),
        menu_item::QUIT => super::request_shutdown(app_handle),
        // menu_item::UPDATE => app_handle.update(),
        _ => {}
    }
}

impl SystemTrayManager for AppHandle {
    fn init_tray_menu(&self) {
        TrayIconBuilder::with_id(constants::TRAY_ID)
            .icon(self.default_window_icon().unwrap().clone())
            .title(constants::APP_NAME)
            .tooltip(constants::APP_NAME)
            .on_tray_icon_event(handle_system_tray_event)
            .menu(&create_tray_menu(self))
            .on_menu_event(handle_system_tray_menu_event)
            .show_menu_on_left_click(false)
            .build(self)
            .unwrap();
    }

    fn set_tray_menu_update_available(&self, update_available: bool) {
        self.state::<TrayState>().set_update_available(update_available);

        // .unwrap on everything because creating the tray-icon is always the same and should never fail
        self.tray_by_id(constants::TRAY_ID)
            .unwrap()
            .set_menu(Some(create_tray_menu(self)))
            .unwrap();
    }

    fn refresh_recording_tray(&self) {
        let Some(tray) = self.tray_by_id(constants::TRAY_ID) else { return };
        let phase = self.state::<CurrentlyRecording>().phase();
        if let Err(error) = tray.set_menu(Some(create_tray_menu(self))) {
            log::warn!("Failed to refresh recording tray menu: {error}");
        }
        let icon = match phase {
            RecordingPhase::Idle => self.default_window_icon().cloned(),
            RecordingPhase::Recording(_) => {
                let (rgba, width, height) = recording_icon_filled_rgba();
                Some(tauri::image::Image::new_owned(rgba, width, height))
            }
            _ => {
                let (rgba, width, height) = recording_icon_outline_rgba();
                Some(tauri::image::Image::new_owned(rgba, width, height))
            }
        };
        if let Err(error) = tray.set_icon(icon) {
            log::warn!("Failed to refresh recording tray icon: {error}");
        }
    }

}

fn create_tray_menu(app_handle: &AppHandle) -> Menu<Wry> {
    let tray_state = app_handle.state::<TrayState>();
    let phase = app_handle.state::<CurrentlyRecording>().phase();
    let recording = matches!(phase, RecordingPhase::Recording(_));
    let preparing = matches!(phase, RecordingPhase::Preparing(_) | RecordingPhase::Stopping(_));
    let update_available = tray_state.update_available();
    let recording_label = match phase {
        RecordingPhase::Preparing(_) => "Preparing…",
        RecordingPhase::Stopping(_) => "Stopping…",
        _ => "Recording",
    };

    let settings = MenuItemBuilder::new("Settings")
        .id(menu_item::SETTINGS)
        .build(app_handle)
        .unwrap();
    let start_recording = MenuItemBuilder::new("Start Recording")
        .id(menu_item::START_RECORDING)
        .build(app_handle)
        .unwrap();
    let stop_recording = MenuItemBuilder::new("Stop Recording")
        .id(menu_item::STOP_RECORDING)
        .build(app_handle)
        .unwrap();
    let open = MenuItemBuilder::new("Open")
        .id(menu_item::OPEN)
        .build(app_handle)
        .unwrap();
    let quit = MenuItemBuilder::new("Quit")
        .id(menu_item::QUIT)
        .build(app_handle)
        .unwrap();
    let update = MenuItemBuilder::new("Update")
        .id(menu_item::UPDATE)
        .build(app_handle)
        .unwrap();

    let tray_menu = if update_available {
        MenuBuilder::new(app_handle)
            .check(menu_item::RECORDING, recording_label)
            .separator()
            .item(&start_recording)
            .item(&stop_recording)
            .separator()
            .item(&settings)
            .item(&open)
            .item(&quit)
            .separator()
            .item(&update)
    } else {
        MenuBuilder::new(app_handle)
            .check(menu_item::RECORDING, recording_label)
            .separator()
            .item(&start_recording)
            .item(&stop_recording)
            .separator()
            .item(&settings)
            .item(&open)
            .item(&quit)
    }
    .build()
    .unwrap();

    let recording_item = tray_menu.get(menu_item::RECORDING).unwrap();
    recording_item
        .as_check_menuitem()
        .unwrap()
        .set_checked(recording || preparing)
        .unwrap();
    recording_item.as_check_menuitem().unwrap().set_enabled(false).unwrap();
    tray_menu
        .get(menu_item::START_RECORDING)
        .unwrap()
        .as_menuitem()
        .unwrap()
        .set_enabled(!(recording || preparing))
        .unwrap();
    tray_menu
        .get(menu_item::STOP_RECORDING)
        .unwrap()
        .as_menuitem()
        .unwrap()
        .set_enabled(recording || preparing)
        .unwrap();

    tray_menu
}
