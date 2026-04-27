use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, State};

use crate::app::{action, RecordingManager};
use crate::recorder::MetadataFile;
use crate::state::{MarkerFlags, SettingsFile, SettingsWrapper};
use crate::util::compare_time;

use super::path_guard::resolve_existing_video_base;
const PERF_LOG_ENABLED: bool = false;

#[cfg_attr(test, derive(specta::Type))]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    video_id: String,
    metadata: Option<MetadataFile>,
    video_exists: bool,
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_marker_flags(settings: State<SettingsWrapper>) -> MarkerFlags {
    settings.get_marker_flags()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn set_marker_flags(
    marker_flags: MarkerFlags,
    settings: State<SettingsWrapper>,
    settings_file: State<SettingsFile>,
) {
    settings.set_marker_flags(marker_flags);
    settings.write_to_file(settings_file.get());
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_recordings_path(settings: State<SettingsWrapper>) -> PathBuf {
    settings.get_recordings_path().to_path_buf()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_recordings_size(app_handle: AppHandle) -> f32 {
    let started_at = std::time::Instant::now();
    let mut size = 0;
    let mut file_count = 0usize;
    for file in app_handle.get_recordings() {
        file_count += 1;
        if let Ok(metadata) = std::fs::metadata(file.with_extension("mp4")) {
            size += metadata.len();
        }
        if let Ok(metadata) = std::fs::metadata(file.with_extension("json")) {
            size += metadata.len();
        }
    }
    let elapsed_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    if PERF_LOG_ENABLED {
        log::info!("[perf] get_recordings_size: {:.1}ms (records={})", elapsed_ms, file_count);
        println!("[perf] get_recordings_size: {:.1}ms (records={})", elapsed_ms, file_count);
    }
    size as f32 / 1_000_000_000.0
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_recordings_list(app_handle: AppHandle) -> Vec<Recording> {
    let started_at = std::time::Instant::now();
    let mut recordings = app_handle.get_recordings();
    recordings.sort_by(|a, b| compare_time(a, b).unwrap_or(Ordering::Equal));
    let scanned = recordings.len();

    let mut ret = Vec::new();
    for path in recordings {
        if let Some(video_id) = path.to_str().map(|s| s.to_string()) {
            let mut mp4_path = path.clone();
            mp4_path.set_extension("mp4");
            let video_exists = mp4_path.exists();

            // Keep list loading fast: avoid parsing heavy timeline/event payloads.
            match action::get_recording_metadata_for_list(&path) {
                Ok(metadata) => {
                    ret.push(Recording {
                        video_id,
                        metadata: Some(metadata),
                        video_exists,
                    });
                }
                Err(e) => {
                    println!("Error parsing {}: {}", video_id, e);
                    ret.push(Recording {
                        video_id,
                        metadata: None,
                        video_exists,
                    });
                }
            }
        }
    }

    let elapsed_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    if PERF_LOG_ENABLED {
        log::info!(
            "[perf] get_recordings_list: {:.1}ms (scanned={}, returned={})",
            elapsed_ms,
            scanned,
            ret.len()
        );
        println!(
            "[perf] get_recordings_list: {:.1}ms (scanned={}, returned={})",
            elapsed_ms,
            scanned,
            ret.len()
        );
    }
    ret
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn open_recordings_folder(state: State<SettingsWrapper>) {
    if let Err(e) = state
        .get_recordings_path()
        .canonicalize()
        .and_then(|path| Command::new("explorer").arg(path).spawn())
    {
        log::error!("failed to open recordings-folder: {e:?}");
    }
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn rename_video(video_id: String, new_video_id: String, state: State<SettingsWrapper>) -> bool {
    let recording = match resolve_existing_video_base(&video_id, &state) {
        Ok(path) => path,
        Err(e) => {
            log::error!("failed to resolve recording for rename: {e}");
            return false;
        }
    };

    action::rename_recording(recording, new_video_id).unwrap_or_else(|e| {
        log::error!("failed to rename video: {e}");
        false
    })
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn delete_video(video_id: String, state: State<SettingsWrapper>) -> bool {
    let recording = match resolve_existing_video_base(&video_id, &state) {
        Ok(path) => path,
        Err(e) => {
            log::error!("failed to resolve recording for delete: {e}");
            return false;
        }
    };

    match action::delete_recording(recording) {
        Ok(_) => true,
        Err(e) => {
            log::error!("failed to delete video: {e}");
            false
        }
    }
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn delete_video_only(video_id: String, state: State<SettingsWrapper>) -> bool {
    let recording = match resolve_existing_video_base(&video_id, &state) {
        Ok(path) => path,
        Err(e) => {
            log::error!("failed to resolve recording for delete_video_only: {e}");
            return false;
        }
    };

    match action::delete_video_file_only(recording) {
        Ok(_) => true,
        Err(e) => {
            log::error!("failed to delete video file only: {e}");
            false
        }
    }
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_metadata(video_id: String, state: State<SettingsWrapper>) -> Option<MetadataFile> {
    let path = resolve_existing_video_base(&video_id, &state).ok()?;
    action::get_recording_metadata(&path, false).ok()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn toggle_favorite(video_id: String, state: State<SettingsWrapper>) -> Option<bool> {
    let path = resolve_existing_video_base(&video_id, &state).ok()?;

    let mut metadata = action::get_recording_metadata(&path, false).ok()?;
    let favorite = !metadata.is_favorite();
    metadata.set_favorite(favorite);
    action::save_recording_metadata(&path, &metadata).ok()?;

    Some(favorite)
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn confirm_delete(settings: State<SettingsWrapper>) -> bool {
    settings.confirm_delete()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn disable_confirm_delete(settings: State<SettingsWrapper>, settings_file: State<SettingsFile>) {
    settings.set_confirm_delete(false);
    settings.write_to_file(settings_file.get());
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_settings(settings: State<SettingsWrapper>) -> crate::state::Settings {
    settings.get_settings()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn save_settings(
    settings: crate::state::Settings,
    state: State<'_, SettingsWrapper>,
    settings_file: State<'_, SettingsFile>,
    app_handle: AppHandle,
) -> Result<(), ()> {
    state.set_settings(settings);
    state.write_to_file(settings_file.get());
    state.update_from_file(settings_file.get(), &app_handle);
    Ok(())
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn pick_recordings_folder(app_handle: AppHandle) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    app_handle
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|d| d.into_path().ok())
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn pick_clips_folder(app_handle: AppHandle) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    app_handle
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|d| d.into_path().ok())
}


#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn get_running_applications() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("tasklist").args(["/fo", "csv", "/nh"]).output();
        let Ok(output) = output else { return vec![] };
        if !output.status.success() {
            return vec![];
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut apps = BTreeSet::new();
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let image_name = if trimmed.starts_with('"') {
                trimmed
                    .trim_start_matches('"')
                    .split("\",\"")
                    .next()
                    .map(str::to_string)
            } else {
                trimmed.split(',').next().map(|v| v.trim_matches('"').to_string())
            };
            let Some(image_name) = image_name else { continue };
            let lower = image_name.to_ascii_lowercase();
            if !lower.ends_with(".exe") {
                continue;
            }
            if lower == "system idle process" || lower == "system" {
                continue;
            }
            apps.insert(image_name);
        }
        apps.into_iter().collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![]
    }
}
#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn save_scoreboard_cache(video_id: String, content: String) -> Result<(), String> {
    use std::io::Write;

    let video_path = PathBuf::from(&video_id);
    let cache_path = video_path.with_extension("sb.json");

    let mut file = std::fs::File::create(&cache_path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn load_scoreboard_cache(video_id: String) -> Result<String, String> {
    let video_path = PathBuf::from(&video_id);
    let cache_path = video_path.with_extension("sb.json");

    if !cache_path.exists() {
        return Err("Cache file not found".to_string());
    }

    let content = std::fs::read_to_string(cache_path).map_err(|e| e.to_string())?;
    Ok(content)
}

