mod event;
mod manager;
pub(crate) mod playback;
pub(crate) mod recording_paths;
mod recordings;
mod system_tray;
mod window;

pub use event::{AppEvent, EventManager, RecordingStatus};
pub use manager::AppManager;
pub use recordings::{action, Recording, RecordingLibrary, RecordingManager, RecordingSnapshot};
pub use system_tray::SystemTrayManager;
pub use window::{AppWindow, WindowManager};

fn request_shutdown(app_handle: &tauri::AppHandle) {
    use crate::{constants::EXIT_SUCCESS, recorder::LeagueRecorder, state::Shutdown};
    use tauri::{async_runtime, Manager};

    if !app_handle.state::<Shutdown>().begin() {
        return;
    }
    if let Some(window) = app_handle.get_webview_window(AppWindow::Main.into()) {
        app_handle.save_window_state(&window);
    }

    let app_handle = app_handle.clone();
    async_runtime::spawn(async move {
        app_handle.state::<LeagueRecorder>().stop().await;
        app_handle.exit(EXIT_SUCCESS);
    });
}

pub fn process_app_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    use crate::state::{SettingsWrapper, Shutdown};
    use tauri::{Manager, RunEvent, WindowEvent};

    match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == String::from(AppWindow::Main) => {
            api.prevent_close();
            if app_handle.state::<Shutdown>().get() {
                return;
            }
            if app_handle.state::<SettingsWrapper>().close_to_tray() {
                if let Some(window) = app_handle.get_webview_window(&label) {
                    app_handle.save_window_state(&window);
                    if let Err(error) = window.hide() {
                        log::warn!("Could not hide the main window: {error}");
                    }
                }
            } else {
                request_shutdown(app_handle);
            }
        }
        RunEvent::ExitRequested { api, .. } => {
            if !app_handle.state::<Shutdown>().get() {
                api.prevent_exit();
            }
        }
        _ => {}
    }
}
