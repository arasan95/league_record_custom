use std::cmp::Ordering;
use std::fs::metadata;
use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, State};

use crate::app::{action, RecordingManager};
use crate::recorder::MetadataFile;
use crate::state::{MarkerFlags, SettingsFile, SettingsWrapper};
use crate::util::compare_time;

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
    let mut size = 0;
    for file in app_handle.get_recordings() {
        if let Ok(metadata) = metadata(file) {
            size += metadata.len();
        }
    }
    size as f32 / 1_000_000_000.0 // in Gigabyte
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    video_id: String,
    metadata: Option<MetadataFile>,
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_recordings_list(app_handle: AppHandle) -> Vec<Recording> {
    let mut recordings = app_handle.get_recordings();
    // sort by time created (index 0 is newest)
    recordings.sort_by(|a, b| compare_time(a, b).unwrap_or(Ordering::Equal));
    let mut ret = Vec::new();
    for path in recordings {
        if let Some(video_id) = path.to_str().map(|s| s.to_string()) {
            let metadata = action::get_recording_metadata(&path, true).ok();
            ret.push(Recording { video_id, metadata });
        }
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
pub fn rename_video(video_id: String, new_video_id: String, _state: State<SettingsWrapper>) -> bool {
    let recording = PathBuf::from(video_id);
    action::rename_recording(recording, new_video_id).unwrap_or_else(|e| {
        log::error!("failed to rename video: {e}");
        false
    })
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn delete_video(video_id: String, _state: State<SettingsWrapper>) -> bool {
    let recording = PathBuf::from(video_id);

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
pub fn get_metadata(video_id: String, _state: State<SettingsWrapper>) -> Option<MetadataFile> {
    let path = PathBuf::from(video_id);
    action::get_recording_metadata(&path, true).ok()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn toggle_favorite(video_id: String, _state: State<SettingsWrapper>) -> Option<bool> {
    let path = PathBuf::from(video_id);

    let mut metadata = action::get_recording_metadata(&path, true).ok()?;
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
        .map(|d| d.into_path().ok())
        .flatten()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn pick_clips_folder(app_handle: AppHandle) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    app_handle
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|d| d.into_path().ok())
        .flatten()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn create_clip(
    video_id: String,
    start: f64,
    end: f64,
    state: State<'_, SettingsWrapper>,
) -> Result<String, String> {
    let recordings_path = state.get_clips_path();
    let video_path = state.get_recordings_path().join(&video_id);

    // Ensure clips directory exists
    if !recordings_path.exists() {
        std::fs::create_dir_all(&recordings_path).map_err(|e| format!("Failed to create clips directory: {}", e))?;
    }

    // Output filename
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let output_filename = format!("{}_clip_{}.mp4", video_id.replace(".mp4", ""), timestamp);
    let output_path = recordings_path.join(&output_filename);

    let duration = end - start;
    if duration <= 0.0 {
        return Err("End time must be greater than start time".into());
    }

    let ffmpeg_cmd = state.ffmpeg_path().unwrap_or_else(|| "ffmpeg".to_string());
    let mut command = Command::new(ffmpeg_cmd);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let status = command
        .arg("-ss")
        .arg(format!("{:.3}", start))
        .arg("-i")
        .arg(&video_path)
        .arg("-t")
        .arg(format!("{:.3}", duration))
        .arg("-c")
        .arg("copy")
        .arg(&output_path)
        .status();

    match status {
        Ok(s) if s.success() => Ok(output_filename),
        Ok(_) => Err("FFmpeg exited with non-zero code.".into()),
        Err(e) => Err(format!("Failed to execute ffmpeg: {}. Is FFmpeg installed?", e)),
    }
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn pick_ffmpeg_path(app_handle: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app_handle
        .dialog()
        .file()
        .add_filter("FFmpeg Executable", &["exe", ""])
        .blocking_pick_file()
        .map(|d| d.into_path().ok().map(|p| p.to_string_lossy().to_string()))
        .flatten()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn clear_cache(app_handle: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    // In Tauri v2, we use app_handle.path().app_local_data_dir()
    let app_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;

    let cache_dirs = ["img_cache", "items_cache"];

    for dir in cache_dirs {
        let path = app_dir.join(dir);
        if path.exists() {
            std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete {}: {}", dir, e))?;
        }
    }
    Ok(())
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn download_image(
    url: String,
    category: String,
    filename: String,
    app_handle: AppHandle,
) -> Result<String, String> {
    use std::io::Write;
    use tauri::Manager;

    // Validate category/filename to be safe?
    // Basic check: don't allow ".."
    if category.contains("..") || filename.contains("..") {
        return Err("Invalid path parameters".to_string());
    }

    let app_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let img_cache = app_dir.join("img_cache");
    let category_dir = img_cache.join(&category);

    if !img_cache.exists() {
        std::fs::create_dir(&img_cache).map_err(|e| e.to_string())?;
    }
    if !category_dir.exists() {
        std::fs::create_dir(&category_dir).map_err(|e| e.to_string())?;
    }

    let file_path = category_dir.join(&filename);

    // Download
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}
