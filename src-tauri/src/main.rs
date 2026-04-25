// 'windows_subsystem = "windows/console"' decides if the executable should launch in a console window or not
// but only add this for release builds (debug_assertions disabled)
// gets ignored on all other targets
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod app;
mod commands;
mod constants;
mod filewatcher;
mod generate_bindings;
mod recorder;
mod state;
mod util;
mod wad;

fn main() {
    #[cfg(feature = "tokio-console")]
    console_subscriber::init();

    #[cfg(feature = "av-minimal")]
    {
        run_app_minimal();
        return;
    }

    #[cfg(not(feature = "av-minimal"))]
    run_app_default();
}

#[cfg(not(feature = "av-minimal"))]
fn run_app_default() {
    use app::{AppManager, AppWindow, WindowManager};
    use state::{CurrentlyRecording, Shutdown, TrayState, WindowState};
    use tauri::Manager;

    #[cfg(not(feature = "av-no-plugins"))]
    let app = tauri::Builder::default();

    #[cfg(all(not(feature = "av-no-plugins"), not(feature = "av-disable-clipboard")))]
    let app = app.plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(all(not(feature = "av-no-plugins"), not(feature = "av-disable-single-instance")))]
    let app = app.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        app.open_window(AppWindow::Main)
    }));

    #[cfg(all(not(feature = "av-no-plugins"), not(feature = "av-disable-dialog")))]
    let app = app.plugin(tauri_plugin_dialog::init());

    #[cfg(all(not(feature = "av-no-plugins"), not(feature = "av-disable-fs")))]
    let app = app.plugin(tauri_plugin_fs::init());

    #[cfg(all(
        not(feature = "av-no-plugins"),
        not(feature = "av-safe-plugins"),
        not(feature = "av-disable-process")
    ))]
    let app = app.plugin(tauri_plugin_process::init());

    #[cfg(all(
        not(feature = "av-no-plugins"),
        not(feature = "av-safe-plugins"),
        not(feature = "av-disable-autostart")
    ))]
    let app = app.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        None,
    ));

    #[cfg(all(
        not(feature = "av-no-plugins"),
        not(feature = "av-safe-plugins"),
        not(feature = "av-disable-shell")
    ))]
    let app = app.plugin(tauri_plugin_shell::init());

    #[cfg(all(
        not(feature = "av-no-plugins"),
        not(feature = "av-safe-plugins"),
        not(feature = "av-disable-updater")
    ))]
    let app = app.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(feature = "av-no-plugins")]
    let app = tauri::Builder::default();

    let app = app
        .manage(WindowState::default())
        .manage(CurrentlyRecording::default())
        .manage(TrayState::default())
        //.manage(windows_key_listener::KeyListener::new())
        .manage(Shutdown::default());

    #[cfg(all(not(feature = "av-no-invoke"), feature = "av-empty-invoke"))]
    let app = app.invoke_handler(tauri::generate_handler![]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        feature = "av-invoke-one"
    ))]
    let app = app.invoke_handler(tauri::generate_handler![commands::get_recordings_path]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        feature = "av-invoke-triple-settings"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_recordings_path,
            commands::create_clip,
            commands::get_settings
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        feature = "av-invoke-triple-tooltip"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_recordings_path,
            commands::create_clip,
            commands::load_tooltip_locale_db,
            commands::perf_log
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        feature = "av-invoke-pair"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_recordings_path,
            commands::create_clip
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        feature = "av-invoke-mix-small"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_recordings_path,
            commands::get_settings,
            commands::create_clip,
            commands::load_tooltip_locale_db,
            commands::perf_log
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        not(feature = "av-invoke-mix-small"),
        feature = "av-invoke-mix-medium"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_recordings_path,
            commands::get_recordings_list,
            commands::rename_video,
            commands::get_metadata,
            commands::save_settings,
            commands::create_clip,
            commands::get_ffmpeg_runtime_info,
            commands::download_image,
            commands::load_scoreboard_cache,
            commands::load_tooltip_locale_db,
            commands::perf_log
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        not(feature = "av-invoke-mix-small"),
        not(feature = "av-invoke-mix-medium"),
        feature = "av-invoke-group-a"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_marker_flags,
            commands::set_marker_flags,
            commands::get_recordings_path,
            commands::get_recordings_size,
            commands::get_recordings_list,
            commands::open_recordings_folder,
            commands::delete_video,
            commands::delete_video_only,
            commands::rename_video,
            commands::get_metadata,
            commands::toggle_favorite,
            commands::confirm_delete,
            commands::disable_confirm_delete,
            commands::get_settings,
            commands::save_settings,
            commands::pick_recordings_folder,
            commands::pick_clips_folder
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        not(feature = "av-invoke-mix-small"),
        not(feature = "av-invoke-mix-medium"),
        not(feature = "av-invoke-group-a"),
        feature = "av-invoke-group-b"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::create_clip,
            commands::pick_ffmpeg_path,
            commands::get_ffmpeg_runtime_info,
            commands::clear_cache,
            commands::clear_cache_for_patch_update,
            commands::download_image,
            commands::save_scoreboard_cache,
            commands::load_scoreboard_cache,
            commands::update_champion_data,
            commands::load_tooltip_locale_db,
            commands::perf_log
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        not(feature = "av-invoke-mix-small"),
        not(feature = "av-invoke-mix-medium"),
        not(feature = "av-invoke-group-a"),
        not(feature = "av-invoke-group-b"),
        not(feature = "av-safe-invoke"),
        not(feature = "av-disable-tooltip-db")
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_marker_flags,
            commands::set_marker_flags,
            commands::get_recordings_path,
            commands::get_recordings_size,
            commands::get_recordings_list,
            commands::open_recordings_folder,
            commands::delete_video,
            commands::delete_video_only,
            commands::rename_video,
            commands::get_metadata,
            commands::toggle_favorite,
            commands::confirm_delete,
            commands::disable_confirm_delete,
            commands::get_settings,
            commands::save_settings,
            commands::pick_recordings_folder,
            commands::create_clip,
            commands::pick_clips_folder,
            commands::pick_ffmpeg_path,
            commands::get_ffmpeg_runtime_info,
            commands::clear_cache,
            commands::clear_cache_for_patch_update,
            commands::download_image,
            commands::save_scoreboard_cache,
            commands::load_scoreboard_cache,
            commands::update_champion_data,
            commands::load_tooltip_locale_db,
            commands::perf_log
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        not(feature = "av-invoke-mix-small"),
        not(feature = "av-invoke-mix-medium"),
        not(feature = "av-invoke-group-a"),
        not(feature = "av-invoke-group-b"),
        not(feature = "av-safe-invoke"),
        feature = "av-disable-tooltip-db"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_marker_flags,
            commands::set_marker_flags,
            commands::get_recordings_path,
            commands::get_recordings_size,
            commands::get_recordings_list,
            commands::open_recordings_folder,
            commands::delete_video,
            commands::delete_video_only,
            commands::rename_video,
            commands::get_metadata,
            commands::toggle_favorite,
            commands::confirm_delete,
            commands::disable_confirm_delete,
            commands::get_settings,
            commands::save_settings,
            commands::pick_recordings_folder,
            commands::create_clip,
            commands::pick_clips_folder,
            commands::pick_ffmpeg_path,
            commands::get_ffmpeg_runtime_info,
            commands::clear_cache,
            commands::clear_cache_for_patch_update,
            commands::download_image,
            commands::save_scoreboard_cache,
            commands::load_scoreboard_cache,
            commands::update_champion_data,
            commands::perf_log
        ]);

    #[cfg(all(
        not(feature = "av-no-invoke"),
        not(feature = "av-empty-invoke"),
        not(feature = "av-invoke-one"),
        not(feature = "av-invoke-triple-settings"),
        not(feature = "av-invoke-triple-tooltip"),
        not(feature = "av-invoke-pair"),
        not(feature = "av-invoke-mix-small"),
        not(feature = "av-invoke-mix-medium"),
        not(feature = "av-invoke-group-a"),
        not(feature = "av-invoke-group-b"),
        feature = "av-safe-invoke"
    ))]
    let app = app
        .invoke_handler(tauri::generate_handler![
            commands::get_marker_flags,
            commands::set_marker_flags,
            commands::get_recordings_path,
            commands::get_recordings_size,
            commands::get_recordings_list,
            commands::delete_video,
            commands::delete_video_only,
            commands::rename_video,
            commands::get_metadata,
            commands::toggle_favorite,
            commands::confirm_delete,
            commands::disable_confirm_delete,
            commands::get_settings,
            commands::save_settings,
            commands::clear_cache,
            commands::clear_cache_for_patch_update,
            commands::save_scoreboard_cache,
            commands::load_scoreboard_cache,
            commands::load_tooltip_locale_db,
            commands::perf_log
        ]);

    #[cfg(feature = "av-no-invoke")]
    let app = app;

    #[cfg(not(feature = "av-no-setup"))]
    let app = app.setup(|app| app.app_handle().setup().map_err(anyhow::Error::into));

    #[cfg(feature = "av-no-setup")]
    let app = app;

    let app = app
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(app::process_app_event),
        Err(e) => {
            println!("error starting LeagueRecord: {e:?}");
            log::error!("error starting LeagueRecord: {e:?}");
        }
    }
}

#[cfg(feature = "av-minimal")]
fn run_app_minimal() {
    let app = tauri::Builder::default()
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|_, _| {}),
        Err(e) => {
            println!("error starting LeagueRecord (minimal): {e:?}");
            log::error!("error starting LeagueRecord (minimal): {e:?}");
        }
    }
}

#[cfg(test)]
mod parse_tests {
    // Tests containing personal hardcoded paths have been removed.
}
