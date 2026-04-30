use std::fs;

use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result};
use log::LevelFilter;
use semver::Version;
use tauri::{async_runtime, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log::{Target, TargetKind};

use super::{RecordingManager, SystemTrayManager};
use crate::constants::{APP_NAME, CURRENT_VERSION};
use crate::state::{SettingsFile, SettingsWrapper};
use crate::{filewatcher, recorder::LeagueRecorder};
const PERF_LOG_ENABLED: bool = false;

pub trait AppManager {
    const SETTINGS_FILE: &'static str;

    fn setup(&self) -> Result<()>;

    fn initialize_settings(&self, config_folder: &Path) -> Result<tauri::State<'_, SettingsWrapper>>;

    fn add_log_plugin(&self) -> Result<()>;
    fn remove_log_plugin(&self);

    fn check_app_updated(&self);
    fn get_last_version(&self) -> Option<Version>;
    fn set_current_version(&self);
    fn handle_update(&self, previous_version: Version);

    fn sync_autostart(&self);

    fn update_hotkeys(&self);
}

impl AppManager for AppHandle {
    const SETTINGS_FILE: &'static str = "settings.json";

    fn setup(&self) -> Result<()> {
        let setup_started_at = Instant::now();
        let config_folder = self.path().app_config_dir().context("Error getting app directory")?;

        let init_settings_started_at = Instant::now();
        let settings = self.initialize_settings(&config_folder)?;
        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:initialize_settings {:.1}ms",
                init_settings_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:initialize_settings {:.1}ms",
                init_settings_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        let debug_log = settings.debug_log();
        if debug_log {
            self.add_log_plugin()?;
        }

        log::info!("{APP_NAME} v{CURRENT_VERSION}");
        log::info!("{}", chrono::Local::now().format("%d-%m-%Y %H:%M"));
        log::info!("debug_log: {}", if debug_log { "enabled" } else { "disabled" });
        if debug_log {
            log::info!("settings loaded");
        }

        async_runtime::spawn({
            let app_handle = self.clone();
            async move {
                if let Err(error) = crate::commands::prepare_ffmpeg_runtime(app_handle).await {
                    log::warn!("failed to prepare FFmpeg runtime: {error}");
                }
            }
        });

        // create system tray-icon
        self.init_tray_menu();

        self.check_app_updated();

        // make sure the system autostart setting for the app matches what is set in the settings
        let sync_autostart_started_at = Instant::now();
        self.sync_autostart();
        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:sync_autostart {:.1}ms",
                sync_autostart_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:sync_autostart {:.1}ms",
                sync_autostart_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        // Initialize Raw Input Listener (Background Thread)
        // This replaces the old windows-key-listener global hook to avoid Vanguard freezes.
        let raw_input_started_at = Instant::now();
        crate::state::RawInputListener::start(self.app_handle().clone());
        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:start_raw_input {:.1}ms",
                raw_input_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:start_raw_input {:.1}ms",
                raw_input_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        let update_hotkeys_started_at = Instant::now();
        self.update_hotkeys();
        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:update_hotkeys {:.1}ms",
                update_hotkeys_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:update_hotkeys {:.1}ms",
                update_hotkeys_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        // start watching recordings folder for changes
        let watcher_started_at = Instant::now();
        let recordings_path = settings.get_recordings_path();
        if debug_log {
            log::info!("recordings watcher initialized");
        }
        filewatcher::replace(self, &recordings_path);
        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:filewatcher_replace {:.1}ms",
                watcher_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:filewatcher_replace {:.1}ms",
                watcher_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        // start checking for LoL games to record
        let recorder_started_at = Instant::now();
        self.manage(LeagueRecorder::new(self.clone()));
        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:league_recorder_new {:.1}ms",
                recorder_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:league_recorder_new {:.1}ms",
                recorder_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        // cleanup recordings if they are too old or the total size of the recordings gets too big
        // this only happens if 'maxRecordingAge' or 'maxRecordingsSize' is configured in the settings
        async_runtime::spawn_blocking({
            let app_handle = self.clone();
            move || app_handle.cleanup_recordings()
        });

        if PERF_LOG_ENABLED {
            log::info!(
                "[perf] setup:total {:.1}ms",
                setup_started_at.elapsed().as_secs_f64() * 1000.0
            );
            println!(
                "[perf] setup:total {:.1}ms",
                setup_started_at.elapsed().as_secs_f64() * 1000.0
            );
        }

        Ok(())
    }

    fn initialize_settings(&self, config_folder: &Path) -> Result<tauri::State<'_, SettingsWrapper>> {
        let settings_file = config_folder.join(Self::SETTINGS_FILE);
        // create settings.json file if missing
        SettingsWrapper::ensure_settings_exist(&settings_file);

        let settings = SettingsWrapper::new_from_file(&settings_file)?;
        settings.load_from_file(&settings_file, self);

        self.manage::<SettingsWrapper>(settings);
        self.manage::<SettingsFile>(SettingsFile::new(settings_file));

        Ok(self.state::<SettingsWrapper>())
    }

    fn add_log_plugin(&self) -> Result<()> {
        let file_name = Some(format!("{}", chrono::Local::now().format("%Y-%m-%d_%H-%M")));
        let plugin = tauri_plugin_log::Builder::default()
            .targets([
                Target::new(TargetKind::LogDir { file_name }),
                Target::new(TargetKind::Stdout),
            ])
            .level(LevelFilter::Info)
            .format(|out, msg, record| {
                out.finish(format_args!(
                    "[{}][{}]: {}",
                    chrono::Local::now().format("%H:%M:%S"),
                    record.level(),
                    msg
                ))
            })
            .build();

        Ok(self.plugin(plugin)?)
    }

    fn remove_log_plugin(&self) {
        // the name the tauri log plugin registers itself with is currently "log"
        // maybe this will change in the future?
        self.remove_plugin("log");
    }

    fn check_app_updated(&self) {
        // self.handle_update(Version::new(1, 0, 0)); // testing
        if let Some(version) = self.get_last_version() {
            let current_version = self.app_handle().package_info().version.clone();
            if version < current_version {
                log::info!("App updated from {version} to {current_version}");
                self.handle_update(version);
            }
        }
        self.set_current_version();
    }

    fn get_last_version(&self) -> Option<Version> {
        let config_folder = self.path().app_config_dir().ok()?;
        let last_version_file = config_folder.join("last_version");

        if let Ok(version) = fs::read_to_string(&last_version_file) {
            if let Ok(version) = Version::parse(&version) {
                return Some(version);
            }
        }
        None
    }

    fn set_current_version(&self) {
        let current_version = self.app_handle().package_info().version.to_string();
        if let Ok(config_folder) = self.path().app_config_dir() {
            let last_version_file = config_folder.join("last_version");
            if let Err(e) = fs::write(&last_version_file, current_version) {
                log::warn!("failed to write last_version file: {e}");
            }
        }
    }

    fn handle_update(&self, previous_version: Version) {
        let previous_version = previous_version.to_string();
        let app_handle = self.clone();

        async_runtime::spawn(async move {
            // maybe wait a bit to give the app time to load?
            // std::thread::sleep(std::time::Duration::from_secs(1));

            let _ = app_handle
                .dialog()
                .message(format!(
                    "LeagueRecord successfully updated from v{previous_version} to v{CURRENT_VERSION}."
                ))
                .title("Update successful")
                .show(|_| {});
        });
    }

    fn sync_autostart(&self) {
        use tauri_plugin_autostart::ManagerExt;

        let settings = self.state::<SettingsWrapper>();
        let autostart_manager = self.autolaunch();

        match autostart_manager.is_enabled() {
            Ok(autostart_enabled) => {
                if settings.autostart() != autostart_enabled {
                    let result = if settings.autostart() {
                        autostart_manager.enable()
                    } else {
                        autostart_manager.disable()
                    };

                    if let Err(error) = result {
                        log::warn!("failed to set autostart to {}: {error:?}", settings.autostart());
                    }
                }
            }
            Err(error) => {
                log::warn!("unable to get current autostart state: {error:?}");
            }
        }
    }

    fn update_hotkeys(&self) {
        // Legacy: Replaced by RawInputListener
        // Keeping method stub if needed for future dynamic updates,
        // but current RawInput implementation reads settings on-the-fly.
        log::info!("Hotkeys managed by RawInputListener");
    }
}
