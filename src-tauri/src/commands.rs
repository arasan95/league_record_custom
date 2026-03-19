use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager, State};

use crate::app::{action, RecordingManager};
use crate::recorder::{MetadataFile, NoData};
use crate::state::{MarkerFlags, SettingsFile, SettingsWrapper};
use crate::util::compare_time;

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegProvenance {
    pub source_name: String,
    pub source_url: String,
    pub version: String,
    pub license: String,
    pub sha256: String,
    pub fetched_at: String,
    pub notes: Option<String>,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegRuntimeInfo {
    pub mode: String,
    pub selected_path: String,
    pub selected_exists: bool,
    pub version_line: Option<String>,
    pub provenance: Option<FfmpegProvenance>,
}

fn app_local_bundled_ffmpeg_candidates(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("ffmpeg").join("ffmpeg.exe"));
        candidates.push(resource_dir.join("ffmpeg.exe"));
    }

    candidates.push(PathBuf::from("src-tauri/resources/tools/ffmpeg/ffmpeg.exe"));
    candidates.push(PathBuf::from("resources/tools/ffmpeg/ffmpeg.exe"));

    candidates
}

fn app_local_provenance_candidates(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("ffmpeg").join("ffmpeg-provenance.json"));
        candidates.push(resource_dir.join("ffmpeg-provenance.json"));
    }

    candidates.push(PathBuf::from("src-tauri/resources/tools/ffmpeg/ffmpeg-provenance.json"));
    candidates.push(PathBuf::from("resources/tools/ffmpeg/ffmpeg-provenance.json"));

    candidates
}

fn bundled_ffmpeg_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_local_bundled_ffmpeg_candidates(app_handle)
        .into_iter()
        .find(|p| p.is_file())
}

fn read_ffmpeg_provenance(app_handle: &AppHandle) -> Option<FfmpegProvenance> {
    let path = app_local_provenance_candidates(app_handle)
        .into_iter()
        .find(|p| p.is_file())?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<FfmpegProvenance>(&content).ok()
}

fn ffmpeg_version_line(ffmpeg_cmd: &str) -> Option<String> {
    let output = Command::new(ffmpeg_cmd).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn resolve_ffmpeg_command(settings: &SettingsWrapper, app_handle: &AppHandle) -> (String, String) {
    if let Some(path) = bundled_ffmpeg_path(app_handle) {
        return (path.to_string_lossy().to_string(), "bundled".to_string());
    }
    if let Some(custom_path) = settings.ffmpeg_path().filter(|s| !s.trim().is_empty()) {
        return (custom_path, "custom".to_string());
    }
    ("ffmpeg".to_string(), "path".to_string())
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
    let mut size = 0;
    for file in app_handle.get_recordings() {
        if let Ok(metadata) = std::fs::metadata(file.with_extension("mp4")) {
            size += metadata.len();
        }
        if let Ok(metadata) = std::fs::metadata(file.with_extension("json")) {
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
    video_exists: bool,
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
            let mut mp4_path = path.clone();
            mp4_path.set_extension("mp4");
            let video_exists = mp4_path.exists();

            match action::get_recording_metadata(&path, true) {
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
pub fn delete_video_only(video_id: String, _state: State<SettingsWrapper>) -> bool {
    let recording = PathBuf::from(video_id);

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
    app_handle: AppHandle,
    state: State<'_, SettingsWrapper>,
) -> Result<String, String> {
    let recordings_path = state.get_clips_path();
    let input_id = video_id.trim().trim_end_matches('.');

    // video_id can be absolute or relative, with or without extension.
    let mut video_path = PathBuf::from(input_id);
    if video_path.is_relative() {
        video_path = state.get_recordings_path().join(&video_path);
    }
    if video_path.extension().is_none() {
        video_path.set_extension("mp4");
    }

    // Fallback: if not found in recordings path, also try clips path for relative IDs.
    if !video_path.exists() {
        let mut alt_path = PathBuf::from(input_id);
        if alt_path.is_relative() {
            alt_path = state.get_clips_path().join(&alt_path);
        }
        if alt_path.extension().is_none() {
            alt_path.set_extension("mp4");
        }
        if alt_path.exists() {
            video_path = alt_path;
        } else {
            return Err(format!("Input video not found: {}", video_path.display()));
        }
    }

    // Ensure clips directory exists
    if !recordings_path.exists() {
        std::fs::create_dir_all(&recordings_path).map_err(|e| format!("Failed to create clips directory: {}", e))?;
    }

    // Output filename
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let stem = video_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("clip");
    let output_filename = format!("{}_clip_{}.mp4", stem, timestamp);
    let output_path = recordings_path.join(&output_filename);

    let duration = end - start;
    if duration <= 0.0 {
        return Err("End time must be greater than start time".into());
    }

    let (ffmpeg_cmd, _mode) = resolve_ffmpeg_command(&state, &app_handle);
    let mut command = Command::new(ffmpeg_cmd);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = command
        .arg("-ss")
        .arg(format!("{:.3}", start))
        .arg("-i")
        .arg(&video_path)
        .arg("-t")
        .arg(format!("{:.3}", duration))
        .arg("-c")
        .arg("copy")
        .arg(&output_path)
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let src_json = video_path.with_extension("json");
            let dst_json = output_path.with_extension("json");

            if src_json.exists() {
                std::fs::copy(&src_json, &dst_json)
                    .map_err(|e| format!("Clip was created, but failed to copy metadata json: {}", e))?;
            } else {
                let fallback = MetadataFile::NoData(NoData { favorite: false });
                let content = serde_json::to_string_pretty(&fallback).map_err(|e| {
                    format!(
                        "Clip was created, but failed to serialize fallback metadata json: {}",
                        e
                    )
                })?;
                std::fs::write(&dst_json, content)
                    .map_err(|e| format!("Clip was created, but failed to create fallback metadata json: {}", e))?;
            }

            Ok(output_filename)
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            if stderr.trim().is_empty() {
                Err("FFmpeg exited with non-zero code.".into())
            } else {
                Err(format!("FFmpeg exited with non-zero code: {}", stderr.trim()))
            }
        }
        Err(e) => Err(format!("Failed to execute ffmpeg: {}. Is FFmpeg installed?", e)),
    }
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_ffmpeg_runtime_info(app_handle: AppHandle, state: State<SettingsWrapper>) -> FfmpegRuntimeInfo {
    let (selected_path, mode) = resolve_ffmpeg_command(&state, &app_handle);
    let selected_exists = if mode == "path" {
        true
    } else {
        PathBuf::from(&selected_path).is_file()
    };
    let version_line = ffmpeg_version_line(&selected_path);
    let provenance = read_ffmpeg_provenance(&app_handle);

    FfmpegRuntimeInfo {
        mode,
        selected_path,
        selected_exists,
        version_line,
        provenance,
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

    let cache_dirs = ["img_cache", "items_cache", "tooltip_cache"];

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
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
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

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn update_champion_data(app_handle: AppHandle) -> Result<String, String> {
    use crate::wad::updater::{extract_all_champions_to_json, get_league_install_dir};
    use tauri::Manager;

    let install_dir = get_league_install_dir().ok_or("League of Legends install not found")?;

    let app_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_dir.join("tooltip_cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }

    let output_path = cache_dir.join("tooltip_variable_fallback.json");

    // Perform the heavy extraction in a background task
    let result = tokio::task::spawn_blocking(move || {
        extract_all_champions_to_json(&install_dir, &output_path).map(|_| output_path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    match result {
        Ok(path) => Ok(path.to_string_lossy().into_owned()),
        Err(e) => Err(format!("Extraction error: {}", e)),
    }
}

fn ensure_tooltip_db_installed(app_handle: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data_dir.join("tooltip_db");
    if !db_dir.exists() {
        std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    let target_db = db_dir.join("tooltip_data.db");
    if target_db.exists() {
        // Recover from corrupted/empty user DB by refreshing from bundled resource DB.
        if !tooltip_db_has_rows(&target_db) {
            copy_bundled_tooltip_db(app_handle, &target_db)?;
        }
        return Ok(target_db);
    }

    let source_db = find_bundled_tooltip_db(app_handle)?;
    std::fs::copy(source_db, &target_db).map_err(|e| format!("Failed to copy tooltip DB from resources: {}", e))?;
    Ok(target_db)
}

fn find_bundled_tooltip_db(app_handle: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let resource_dir = app_handle.path().resource_dir().map_err(|e| e.to_string())?;
    let source_candidates = [
        resource_dir.join("tooltip_data.db"),
        resource_dir.join("resources").join("tooltip_data.db"),
    ];

    source_candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| "Bundled tooltip_data.db not found in resources".to_string())
}

fn copy_bundled_tooltip_db(app_handle: &AppHandle, target_db: &PathBuf) -> Result<(), String> {
    let source_db = find_bundled_tooltip_db(app_handle)?;
    std::fs::copy(source_db, target_db).map_err(|e| format!("Failed to copy tooltip DB from resources: {}", e))?;
    Ok(())
}

fn read_tooltip_locale_json(db_path: &PathBuf, locale: &str) -> Result<Option<String>, String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open tooltip DB ({}): {}", db_path.display(), e))?;
    let mut stmt = conn
        .prepare("SELECT data_json FROM champion_tooltips WHERE locale = ?1 LIMIT 1")
        .map_err(|e| format!("Failed to prepare tooltip DB query: {}", e))?;
    let mut rows = stmt
        .query([locale])
        .map_err(|e| format!("Failed to execute tooltip DB query: {}", e))?;

    if let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to read tooltip DB row: {}", e))?
    {
        let data_json: String = row
            .get(0)
            .map_err(|e| format!("Failed to decode tooltip DB row: {}", e))?;
        Ok(Some(data_json))
    } else {
        Ok(None)
    }
}

fn is_tooltip_locale_payload_valid(data_json: &str) -> bool {
    let parsed = match serde_json::from_str::<serde_json::Value>(data_json) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let root = match parsed.as_object() {
        Some(obj) => obj,
        None => return false,
    };
    if root.len() < 120 {
        return false;
    }

    let mut champions = 0usize;
    let mut with_spell_map = 0usize;
    let mut with_champion_local = 0usize;
    for v in root.values() {
        let Some(champ) = v.as_object() else {
            continue;
        };
        champions += 1;
        if champ.get("spell_map").and_then(|x| x.as_object()).is_some() {
            with_spell_map += 1;
        }
        if champ
            .get("champion_local")
            .and_then(|x| x.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            with_champion_local += 1;
        }
    }

    // Legacy payloads can pass the old spell_map ratio check but still miss important
    // champion-specific detailed blocks (notably Aphelios weapon summary/bonus lines).
    // Treat such payloads as invalid so we refresh from bundled tooltip_data.db.
    let aphelios_has_extra_block = root
        .get("Aphelios")
        .and_then(|x| x.as_object())
        .map(|aphelios| {
            let has_summary = aphelios
                .get("Extra_ApheliosWeaponSummary")
                .and_then(|x| x.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            let has_bonus_vars = aphelios
                .get("Extra_ApheliosRWeaponBonusVars")
                .and_then(|x| x.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            has_summary || has_bonus_vars
        })
        .unwrap_or(true);

    let enough_spell_map = with_spell_map * 100 >= champions * 60;
    let enough_modern_schema = with_champion_local * 100 >= champions * 60;
    champions >= 120 && (enough_spell_map || enough_modern_schema) && aphelios_has_extra_block
}

fn tooltip_db_has_rows(db_path: &PathBuf) -> bool {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let count: i64 = match conn.query_row("SELECT COUNT(*) FROM champion_tooltips", [], |row| row.get(0))
    {
        Ok(v) => v,
        Err(_) => return false,
    };
    count > 0
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn load_tooltip_locale_db(locale: String, app_handle: AppHandle) -> Result<Option<String>, String> {
    let db_path = ensure_tooltip_db_installed(&app_handle)?;
    let mut data_json = read_tooltip_locale_json(&db_path, &locale)?;

    // If locale row is missing (e.g. stale empty DB), restore bundled DB and retry once.
    if data_json.is_none() {
        copy_bundled_tooltip_db(&app_handle, &db_path)?;
        data_json = read_tooltip_locale_json(&db_path, &locale)?;
    }

    if let Some(ref payload) = data_json {
        if !is_tooltip_locale_payload_valid(payload) {
            eprintln!(
                "[tooltip-db] invalid payload detected for locale {}. restoring bundled tooltip_data.db",
                locale
            );
            copy_bundled_tooltip_db(&app_handle, &db_path)?;
            data_json = read_tooltip_locale_json(&db_path, &locale)?;
        }
    }

    Ok(data_json)
}
