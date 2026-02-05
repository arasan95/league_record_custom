use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::RwLock;
use std::{fmt, fs};

use anyhow::Result;
use libobs_recorder::settings::{AudioSource, Framerate, StdResolution};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle, Manager};

use crate::app::{AppEvent, AppManager, EventManager, RecordingManager};
use crate::filewatcher;

#[derive(Debug)]
pub struct SettingsFile(PathBuf);

impl SettingsFile {
    pub fn new(pathbuf: PathBuf) -> Self {
        Self(pathbuf)
    }

    pub fn get(&self) -> &Path {
        self.0.as_path()
    }
}

#[derive(Debug)]
pub struct SettingsWrapper(RwLock<Settings>);

impl SettingsWrapper {
    pub fn inner(&self) -> Settings {
        self.0.read().unwrap().clone()
    }
}

impl Display for SettingsWrapper {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_fmt(format_args!("{:?}", self.0.read().unwrap()))
    }
}

impl SettingsWrapper {
    pub fn new_from_file(settings_file: &Path) -> Result<Self> {
        let json = fs::read_to_string(settings_file)?;
        let settings = serde_json::from_str::<Settings>(json.as_str()).unwrap_or_default();
        Ok(Self(RwLock::new(settings)))
    }

    pub fn load_from_file(&self, settings_file: &Path, app_handle: &AppHandle) {
        let Ok(json) = fs::read_to_string(settings_file) else {
            return;
        };
        let mut settings = serde_json::from_str::<Settings>(json.as_str()).unwrap_or_default();

        // if recordings_folder is relative the path gets appened to the system video directory
        if settings.recordings_folder.is_relative() {
            settings.recordings_folder = app_handle
                .path()
                .video_dir()
                .expect("video_dir doesn't exist")
                .join(settings.recordings_folder);
        }
        if fs::create_dir_all(settings.recordings_folder.as_path()).is_err() {
            log::error!("unable to create recordings_folder");
        }

        if settings.clips_folder.is_relative() {
            settings.clips_folder = app_handle
                .path()
                .video_dir()
                .expect("video_dir doesn't exist")
                .join(settings.clips_folder);
        }
        if fs::create_dir_all(settings.clips_folder.as_path()).is_err() {
            log::error!("unable to create clips_folder");
        }

        *self.0.write().unwrap() = settings;
        // write parsed settings back to file so the internal settings and the content of the file stay in sync
        // to avoid confusing the user when editing the file
        self.write_to_file(settings_file);
    }

    pub fn write_to_file(&self, settings_path: &Path) {
        let json = serde_json::to_string_pretty(&*self.0.read().unwrap()).unwrap();
        if let Err(e) = fs::write(settings_path, json) {
            log::error!("failed to write settings.json: {e}");
        }
    }

    pub fn let_user_edit_settings(app_handle: &AppHandle) {
        let app_handle = app_handle.clone();

        // spawn a separate thread to avoid blocking the main thread with Command::status()
        async_runtime::spawn_blocking(move || {
            let settings_file = app_handle.state::<SettingsFile>();
            let settings_file = settings_file.get();

            if SettingsWrapper::ensure_settings_exist(settings_file) {
                // hardcode 'notepad' since league_record currently only works on windows anyways
                if let Err(e) = Command::new("notepad").arg(settings_file).status() {
                    log::error!("failed to start text editor: {e}");
                    return;
                }

                let settings = app_handle.state::<SettingsWrapper>();
                settings.update_from_file(settings_file, &app_handle);
            }
        });
    }

    pub fn update_from_file(&self, settings_file: &Path, app_handle: &AppHandle) {
        let old_recordings_path = self.get_recordings_path();
        let old_marker_flags = self.get_marker_flags();
        let old_log = self.debug_log();
        let old_hightlight_hotkey = self.hightlight_hotkey();
        let old_stop_recording_hotkey = self.stop_recording_hotkey();

        // reload settings from settings.json
        self.load_from_file(settings_file, &app_handle);
        log::info!("Settings updated: {:?}", self.inner());

        // check and update autostart if necessary
        app_handle.sync_autostart();

        // add / remove logs plugin if needed
        if old_log != self.debug_log() {
            if self.debug_log() {
                if app_handle.add_log_plugin().is_err() {
                    // retry
                    app_handle.remove_log_plugin();
                    _ = app_handle.add_log_plugin();
                }
            } else {
                app_handle.remove_log_plugin();
            }
        }

        // check if UI window needs to be updated
        let recordings_path = self.get_recordings_path();
        if recordings_path != old_recordings_path {
            filewatcher::replace(&app_handle, &recordings_path);
            if let Err(e) = app_handle.send_event(AppEvent::RecordingsChanged { payload: () }) {
                log::error!("failed to emit 'recordings_changed' event: {e}");
            }
        }

        let marker_flags = self.get_marker_flags();
        if marker_flags != old_marker_flags {
            if let Err(e) = app_handle.send_event(AppEvent::MarkerflagsChanged { payload: () }) {
                log::error!("failed to emit 'markerflags_changed' event: {e}");
            }
        }

        let hightlight_hotkey = self.hightlight_hotkey();
        let stop_recording_hotkey = self.stop_recording_hotkey();
        if hightlight_hotkey != old_hightlight_hotkey || stop_recording_hotkey != old_stop_recording_hotkey {
            app_handle.update_hotkeys();
        }

        app_handle.cleanup_recordings();
    }

    pub fn get_recordings_path(&self) -> PathBuf {
        self.0.read().unwrap().recordings_folder.clone()
    }

    pub fn get_clips_path(&self) -> PathBuf {
        self.0.read().unwrap().clips_folder.clone()
    }

    pub fn get_filename_format(&self) -> String {
        self.0.read().unwrap().filename_format.clone()
    }

    pub fn get_encoding_quality(&self) -> u32 {
        self.0.read().unwrap().encoding_quality
    }

    pub fn get_output_resolution(&self) -> Option<StdResolution> {
        self.0.read().unwrap().output_resolution
    }

    pub fn get_framerate(&self) -> Framerate {
        self.0.read().unwrap().framerate
    }

    pub fn get_audio_source(&self) -> AudioSource {
        self.0.read().unwrap().record_audio
    }

    pub fn get_marker_flags(&self) -> MarkerFlags {
        self.0.read().unwrap().marker_flags.clone()
    }

    pub fn set_marker_flags(&self, marker_flags: MarkerFlags) {
        self.0.write().unwrap().marker_flags = marker_flags;
    }

    pub fn autostart(&self) -> bool {
        self.0.read().unwrap().autostart
    }

    pub fn max_recording_age(&self) -> Option<u64> {
        self.0.read().unwrap().max_recording_age_days
    }

    pub fn max_recordings_size(&self) -> Option<u64> {
        self.0.read().unwrap().max_recordings_size_gb
    }

    pub fn debug_log(&self) -> bool {
        self.0.read().unwrap().debug_log || std::env::args().any(|e| e == "-d" || e == "--debug")
    }

    pub fn confirm_delete(&self) -> bool {
        self.0.read().unwrap().confirm_delete
    }

    pub fn set_confirm_delete(&self, confirm_delete: bool) {
        self.0.write().unwrap().confirm_delete = confirm_delete;
    }

    pub fn hightlight_hotkey(&self) -> Option<String> {
        self.0.read().unwrap().hightlight_hotkey.clone()
    }

    pub fn start_recording_hotkey(&self) -> Option<String> {
        self.0.read().unwrap().start_recording_hotkey.clone()
    }

    pub fn stop_recording_hotkey(&self) -> Option<String> {
        self.0.read().unwrap().stop_recording_hotkey.clone()
    }

    pub fn game_modes(&self) -> Option<Vec<String>> {
        self.0.read().unwrap().game_modes.clone()
    }

    pub fn ffmpeg_path(&self) -> Option<String> {
        self.0.read().unwrap().ffmpeg_path.clone()
    }

    #[allow(dead_code)]
    pub fn auto_stop_playback(&self) -> bool {
        self.0.read().unwrap().auto_stop_playback
    }

    #[allow(dead_code)]
    pub fn auto_select_recording(&self) -> bool {
        self.0.read().unwrap().auto_select_recording
    }

    pub fn ensure_settings_exist(settings_file: &Path) -> bool {
        if !settings_file.is_file() {
            // get directory of settings file
            let Some(parent) = settings_file.parent() else {
                return false;
            };
            // create the whole settings_file to the directory
            let Ok(_) = fs::create_dir_all(parent) else {
                return false;
            };
            // create the settings file with the default settings json
            let Ok(_) = fs::write(settings_file, include_str!("../../default-settings.json")) else {
                return false;
            };
        }
        true
    }

    pub fn set_settings(&self, settings: Settings) {
        *self.0.write().unwrap() = settings;
    }

    pub fn get_settings(&self) -> Settings {
        self.0.read().unwrap().clone()
    }
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub marker_flags: MarkerFlags,

    pub debug_log: bool,
    pub recordings_folder: PathBuf,
    pub clips_folder: PathBuf,
    pub filename_format: String,
    pub encoding_quality: u32,
    pub output_resolution: Option<StdResolution>,
    pub framerate: Framerate,
    pub record_audio: AudioSource,

    pub autostart: bool,
    pub max_recording_age_days: Option<u64>,
    pub max_recordings_size_gb: Option<u64>,
    pub confirm_delete: bool,
    pub hightlight_hotkey: Option<String>,
    pub start_recording_hotkey: Option<String>,
    pub stop_recording_hotkey: Option<String>,
    pub game_modes: Option<Vec<String>>,
    pub autoplay_video: bool,
    pub auto_stop_playback: bool,
    pub auto_select_recording: bool,
    pub auto_popup_on_end: bool,
    pub ffmpeg_path: Option<String>,
    pub developer_mode: bool,
    pub match_history_base_url: Option<String>,
    pub scroll_frame_step_modifier: Option<String>,
    pub scoreboard_scale: Option<f64>,
}

const DEFAULT_DEBUG_LOG: bool = false;
const DEFAULT_ENCODING_QUALITY: u32 = 25;
const DEFAULT_RECORD_AUDIO: AudioSource = AudioSource::APPLICATION;

const DEFAULT_AUTOSTART: bool = false;
const DEFAULT_MAX_RECORDING_AGE_DAYS: Option<u64> = None;
const DEFAULT_MAX_RECORDINGS_SIZE_GB: Option<u64> = None;
const DEFAULT_CONFIRM_DELETE: bool = true;
const DEFAULT_GAME_MODES: Option<Vec<String>> = None;
const DEFAULT_AUTOPLAY_VIDEO: bool = false;
const DEFAULT_AUTO_STOP_PLAYBACK: bool = false;
const DEFAULT_AUTO_SELECT_RECORDING: bool = false;
const DEFAULT_AUTO_POPUP_ON_END: bool = false;
const DEFAULT_FFMPEG_PATH: Option<String> = None;
const DEFAULT_MATCH_HISTORY_BASE_URL: Option<String> = None;

#[inline]
fn default_recordings_folder() -> PathBuf {
    PathBuf::from("league_recordings")
}

#[inline]
fn default_clips_folder() -> PathBuf {
    PathBuf::from("league_recordings/clips")
}

#[inline]
fn default_filename_format() -> String {
    String::from("%Y-%m-%d_%H-%M.mp4")
}

#[inline]
fn default_framerate() -> Framerate {
    Framerate::new(30, 1)
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            marker_flags: MarkerFlags::default(),
            debug_log: DEFAULT_DEBUG_LOG,
            recordings_folder: default_recordings_folder(),
            clips_folder: default_clips_folder(),
            filename_format: default_filename_format(),
            encoding_quality: DEFAULT_ENCODING_QUALITY,
            output_resolution: None,
            framerate: default_framerate(),
            record_audio: DEFAULT_RECORD_AUDIO,

            autostart: DEFAULT_AUTOSTART,
            max_recording_age_days: DEFAULT_MAX_RECORDING_AGE_DAYS,
            max_recordings_size_gb: DEFAULT_MAX_RECORDINGS_SIZE_GB,
            confirm_delete: DEFAULT_CONFIRM_DELETE,
            hightlight_hotkey: None,
            start_recording_hotkey: Some("F9".to_string()),
            stop_recording_hotkey: Some("F12".to_string()),
            game_modes: DEFAULT_GAME_MODES,
            autoplay_video: DEFAULT_AUTOPLAY_VIDEO,
            auto_stop_playback: DEFAULT_AUTO_STOP_PLAYBACK,
            auto_select_recording: DEFAULT_AUTO_SELECT_RECORDING,
            auto_popup_on_end: DEFAULT_AUTO_POPUP_ON_END,
            ffmpeg_path: DEFAULT_FFMPEG_PATH,
            developer_mode: false,
            match_history_base_url: DEFAULT_MATCH_HISTORY_BASE_URL,
            scroll_frame_step_modifier: Some("Shift".to_string()),
            scoreboard_scale: None,
        }
    }
}

// custom deserializer that uses default values on deserialization errors instead of failing
impl<'de> Deserialize<'de> for Settings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct SettingsVisitor;
        impl<'de> Visitor<'de> for SettingsVisitor {
            type Value = Settings;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("struct Settings")
            }

            fn visit_map<V>(self, mut map: V) -> Result<Settings, V::Error>
            where
                V: MapAccess<'de>,
            {
                let mut settings = Settings::default();

                while let Some(key) = map.next_key()? {
                    match key {
                        "markerFlags" => {
                            settings.marker_flags = map.next_value().unwrap_or_default();
                        }
                        "debugLog" => settings.debug_log = map.next_value().unwrap_or(DEFAULT_DEBUG_LOG),
                        "recordingsFolder" => {
                            settings.recordings_folder =
                                map.next_value().unwrap_or_else(|_| default_recordings_folder());
                        }
                        "clipsFolder" => {
                            settings.clips_folder = map.next_value().unwrap_or_else(|_| default_clips_folder());
                        }
                        "filenameFormat" => {
                            settings.filename_format = map.next_value().unwrap_or_else(|_| default_filename_format());
                        }
                        "encodingQuality" => {
                            settings.encoding_quality = map.next_value().unwrap_or(DEFAULT_ENCODING_QUALITY);
                        }
                        "outputResolution" => {
                            settings.output_resolution = map.next_value().unwrap_or(None);
                        }
                        "framerate" => {
                            settings.framerate = map.next_value().unwrap_or_else(|_| default_framerate());
                        }
                        "recordAudio" => {
                            settings.record_audio = map.next_value().unwrap_or(DEFAULT_RECORD_AUDIO);
                        }
                        "autostart" => {
                            settings.autostart = map.next_value().unwrap_or(DEFAULT_AUTOSTART);
                        }
                        "maxRecordingAgeDays" => {
                            settings.max_recording_age_days =
                                map.next_value().unwrap_or(DEFAULT_MAX_RECORDING_AGE_DAYS);
                        }
                        "maxRecordingsSizeGb" => {
                            settings.max_recordings_size_gb =
                                map.next_value().unwrap_or(DEFAULT_MAX_RECORDINGS_SIZE_GB);
                        }
                        "confirmDelete" => {
                            settings.confirm_delete = map.next_value().unwrap_or(DEFAULT_CONFIRM_DELETE);
                        }
                        "hightlightHotkey" => {
                            settings.hightlight_hotkey = map.next_value().ok();
                        }
                        "startRecordingHotkey" => {
                            settings.start_recording_hotkey = map.next_value().ok();
                        }
                        "stopRecordingHotkey" => {
                            settings.stop_recording_hotkey = map.next_value().ok();
                        }
                        "gameModes" => {
                            settings.game_modes = map.next_value().unwrap_or(DEFAULT_GAME_MODES);
                        }
                        "autoplayVideo" => {
                            settings.autoplay_video = map.next_value().unwrap_or(DEFAULT_AUTOPLAY_VIDEO);
                        }
                        "autoStopPlayback" => {
                            settings.auto_stop_playback = map.next_value().unwrap_or(DEFAULT_AUTO_STOP_PLAYBACK);
                        }
                        "autoSelectRecording" => {
                            settings.auto_select_recording = map.next_value().unwrap_or(DEFAULT_AUTO_SELECT_RECORDING);
                        }
                        "autoPopupOnEnd" => {
                            settings.auto_popup_on_end = map.next_value().unwrap_or(DEFAULT_AUTO_POPUP_ON_END);
                        }
                        "ffmpegPath" => {
                            settings.ffmpeg_path = map.next_value().ok();
                        }
                        "developerMode" => {
                            settings.developer_mode = map.next_value().unwrap_or(false);
                        }
                        "matchHistoryBaseUrl" => {
                            settings.match_history_base_url = map.next_value().ok();
                        }
                        "scrollFrameStepModifier" => {
                            settings.scroll_frame_step_modifier = map.next_value().ok();
                        }
                        "scoreboardScale" => {
                            settings.scoreboard_scale = map.next_value().ok();
                        }
                        _ => { /* ignored */ }
                    }
                }

                Ok(settings)
            }
        }

        deserializer.deserialize_map(SettingsVisitor)
    }
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MarkerFlags {
    kill: bool,
    death: bool,
    assist: bool,
    structure: bool,
    dragon: bool,
    voidgrub: bool,
    herald: bool,
    baron: bool,
}

// Infallible
// custom deserializer that uses default values on deserialization errors instead of failing
impl<'de> Deserialize<'de> for MarkerFlags {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct MarkerFlagsVisitor;
        impl<'de> Visitor<'de> for MarkerFlagsVisitor {
            type Value = MarkerFlags;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("struct MarkerFlags")
            }

            fn visit_map<V>(self, mut map: V) -> Result<MarkerFlags, V::Error>
            where
                V: MapAccess<'de>,
            {
                let mut marker_flags = MarkerFlags::default();

                while let Some(key) = map.next_key()? {
                    match key {
                        "kill" => {
                            marker_flags.kill = map.next_value().unwrap_or(true);
                        }
                        "death" => {
                            marker_flags.death = map.next_value().unwrap_or(true);
                        }
                        "assist" => {
                            marker_flags.assist = map.next_value().unwrap_or(true);
                        }
                        "structure" => {
                            marker_flags.structure = map.next_value().unwrap_or(true);
                        }
                        "dragon" => {
                            marker_flags.dragon = map.next_value().unwrap_or(true);
                        }
                        "voidgrub" => {
                            marker_flags.voidgrub = map.next_value().unwrap_or(true);
                        }
                        "herald" => {
                            marker_flags.herald = map.next_value().unwrap_or(true);
                        }

                        "baron" => {
                            marker_flags.baron = map.next_value().unwrap_or(true);
                        }
                        _ => { /* ignored */ }
                    }
                }

                Ok(marker_flags)
            }
        }

        deserializer.deserialize_map(MarkerFlagsVisitor)
    }
}

impl Default for MarkerFlags {
    fn default() -> Self {
        MarkerFlags {
            kill: true,
            death: true,
            assist: true,
            structure: true,

            dragon: true,
            voidgrub: true,
            herald: true,
            baron: true,
        }
    }
}
