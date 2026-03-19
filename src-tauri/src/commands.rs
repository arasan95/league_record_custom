use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use chrono::Utc;

use tauri::{AppHandle, Manager, State};
use xxhash_rust::xxh64::xxh64;

use crate::app::{action, RecordingManager};
use crate::recorder::{MetadataFile, NoData};
use crate::state::{MarkerFlags, SettingsFile, SettingsWrapper};
use crate::util::compare_time;
use crate::wad::parser::{extract_file_from_wad, parse_wad_entries, WadEntry};
use crate::wad::updater::get_league_install_dir;

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

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Prefer extracting from local LCU WADs for CDragon plugin assets.
    let (local_wad_hit, local_wad_probe) =
        try_extract_lcu_asset_from_local_wad(&url, &category, &filename, &file_path, &client).await?;
    if let Some(source_detail) = local_wad_hit {
        write_image_source_marker(
            &file_path,
            serde_json::json!({
                "source": "local_wad",
                "source_detail": source_detail,
                "local_wad_probe": local_wad_probe,
                "requested_url": url,
                "category": category,
                "filename": filename,
                "saved_at_utc": Utc::now().to_rfc3339(),
            }),
        )?;
        return Ok(file_path.to_string_lossy().to_string());
    }

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }

    let status_code = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    write_image_source_marker(
        &file_path,
        serde_json::json!({
            "source": "remote_http",
            "http_status": status_code,
            "requested_url": url,
            "category": category,
            "filename": filename,
            "local_wad_probe": local_wad_probe,
            "saved_at_utc": Utc::now().to_rfc3339(),
        }),
    )?;

    Ok(file_path.to_string_lossy().to_string())
}

static LCU_WAD_ENTRIES_CACHE: OnceLock<Mutex<std::collections::HashMap<PathBuf, Arc<Vec<WadEntry>>>>> = OnceLock::new();
static ITEM_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
static SPELL_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
static TFT_ITEM_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
static TFT_TRAIT_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();

fn normalize_cdragon_asset_path(url: &str) -> Option<String> {
    // Example URLs:
    // https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/266.png
    // https://raw.communitydragon.org/latest/game/assets/characters/tft16_ahri/hud/tft16_ahri_square.tft_set16.png
    let plugin_marker = "/latest/plugins/rcp-be-lol-game-data/";
    if let Some(idx) = url.find(plugin_marker) {
        let tail = &url[idx + "/latest/".len()..];
        return Some(tail.replace('\\', "/").to_lowercase());
    }

    let game_marker = "/latest/game/";
    if let Some(idx) = url.find(game_marker) {
        let tail = &url[idx + game_marker.len()..];
        return Some(format!(
            "plugins/rcp-be-lol-game-data/global/default/{}",
            tail.replace('\\', "/").to_lowercase()
        ));
    }

    None
}

fn candidate_lcu_path_hashes_full(path: &str) -> Vec<u64> {
    let normalized = path.trim().replace('\\', "/").to_lowercase();
    let no_slash = normalized.trim_start_matches('/').to_string();
    let with_slash = format!("/{}", no_slash);
    let mut forms = vec![normalized, no_slash, with_slash];
    forms.sort();
    forms.dedup();
    let mut out: Vec<u64> = Vec::new();
    for f in forms {
        let h = xxh64(f.as_bytes(), 0);
        if !out.contains(&h) {
            out.push(h);
        }
    }
    out
}

fn normalize_icon_path_to_lcu_asset_path(icon_path: &str) -> Option<String> {
    let p = icon_path.trim().replace('\\', "/").to_lowercase();
    let p = p.trim_start_matches('/');
    let rest = p.strip_prefix("lol-game-data/assets/")?;
    Some(format!("plugins/rcp-be-lol-game-data/global/default/{}", rest))
}

fn normalize_generic_icon_path_to_lcu_asset_path(icon_path: &str) -> Option<String> {
    let mut p = icon_path.trim().replace('\\', "/").to_lowercase();
    p = p.trim_start_matches('/').to_string();
    if p.ends_with(".tex") {
        p = format!("{}.png", p.trim_end_matches(".tex"));
    }

    if let Some(rest) = p.strip_prefix("lol-game-data/assets/") {
        return Some(format!("plugins/rcp-be-lol-game-data/global/default/{}", rest));
    }
    if let Some(rest) = p.strip_prefix("game/assets/") {
        return Some(format!("plugins/rcp-be-lol-game-data/global/default/assets/{}", rest));
    }
    if p.starts_with("assets/") {
        return Some(format!("plugins/rcp-be-lol-game-data/global/default/{}", p));
    }
    None
}

fn extract_basename_no_ext(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    match base.rsplit_once('.') {
        Some((stem, _ext)) => stem.to_string(),
        None => base.to_string(),
    }
}

fn normalize_icon_key(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn normalize_spell_lookup_key(base: &str) -> String {
    let key = normalize_icon_key(base);
    match key.as_str() {
        // Legacy DataDragon spell names that differ from current LCU icon names.
        "summonerdot" => "summonerignite".to_string(),
        _ => key,
    }
}

async fn load_item_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = ITEM_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "item cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(arr) = data.as_array() {
        for row in arr {
            let id = row.get("id").and_then(|v| v.as_i64()).map(|x| x.to_string());
            let icon = row.get("iconPath").and_then(|v| v.as_str());
            if let (Some(id), Some(icon)) = (id, icon) {
                if let Some(asset_path) = normalize_icon_path_to_lcu_asset_path(icon) {
                    map.insert(id, asset_path);
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "item cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn load_spell_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = SPELL_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "spell cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-spells.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(arr) = data.as_array() {
        for row in arr {
            if let Some(icon) = row.get("iconPath").and_then(|v| v.as_str()) {
                if let Some(asset_path) = normalize_icon_path_to_lcu_asset_path(icon) {
                    let base = extract_basename_no_ext(icon);
                    map.insert(normalize_icon_key(&base), asset_path);
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "spell cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn load_tft_item_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = TFT_ITEM_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "tft item cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(arr) = data.get("items").and_then(|v| v.as_array()) {
        for row in arr {
            let api_name = row.get("apiName").and_then(|v| v.as_str());
            let icon = row.get("icon").and_then(|v| v.as_str());
            if let (Some(api_name), Some(icon)) = (api_name, icon) {
                if let Some(asset_path) = normalize_generic_icon_path_to_lcu_asset_path(icon) {
                    map.insert(normalize_icon_key(api_name), asset_path);
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "tft item cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn load_tft_trait_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = TFT_TRAIT_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "tft trait cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(sets) = data.get("sets").and_then(|v| v.as_object()) {
        for set_obj in sets.values() {
            if let Some(traits) = set_obj.get("traits").and_then(|v| v.as_array()) {
                for row in traits {
                    let icon = row.get("icon").and_then(|v| v.as_str());
                    if let Some(icon) = icon {
                        if let Some(asset_path) = normalize_generic_icon_path_to_lcu_asset_path(icon) {
                            let base = extract_basename_no_ext(icon);
                            let key = format!("{}.png", base.to_lowercase());
                            map.insert(key, asset_path);
                        }
                    }
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "tft trait cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn build_local_asset_candidates_from_url(
    url: &str,
    category: &str,
    filename: &str,
    client: &reqwest::Client,
) -> Result<Vec<String>, String> {
    let mut out = Vec::new();

    if let Some(path) = normalize_cdragon_asset_path(url) {
        out.push(path);
    }

    if category.eq_ignore_ascii_case("item") {
        let id = filename.strip_suffix(".png").unwrap_or(filename);
        if id.chars().all(|c| c.is_ascii_digit()) {
            let map = load_item_icon_paths(client).await?;
            if let Some(path) = map.get(id) {
                out.push(path.clone());
            }
        }
    }

    if category.eq_ignore_ascii_case("spell") {
        let base = filename.strip_suffix(".png").unwrap_or(filename);
        let key = normalize_spell_lookup_key(base);
        let map = load_spell_icon_paths(client).await?;
        if let Some(path) = map.get(&key) {
            out.push(path.clone());
        } else if let Some((_, path)) = map.iter().find(|(k, _)| k.starts_with(&key) || key.starts_with(*k)) {
            // Example: SummonerTeleport -> Summoner_Teleport_New in latest game assets.
            out.push(path.clone());
        }
    }

    if category.eq_ignore_ascii_case("tft_item") {
        let base = filename.strip_suffix(".png").unwrap_or(filename);
        let key = normalize_icon_key(base);
        let map = load_tft_item_icon_paths(client).await?;
        if let Some(path) = map.get(&key) {
            out.push(path.clone());
        }
    }

    if category.eq_ignore_ascii_case("tft_trait") {
        let key = filename.to_lowercase();
        let map = load_tft_trait_icon_paths(client).await?;
        if let Some(path) = map.get(&key) {
            out.push(path.clone());
        }
    }

    out.sort();
    out.dedup();
    Ok(out)
}

fn get_wad_entries_cached(wad_path: &PathBuf) -> Result<Arc<Vec<WadEntry>>, String> {
    let cache = LCU_WAD_ENTRIES_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    {
        let guard = cache.lock().map_err(|_| "WAD cache lock poisoned".to_string())?;
        if let Some(v) = guard.get(wad_path) {
            return Ok(Arc::clone(v));
        }
    }

    let parsed = parse_wad_entries(wad_path).map_err(|e| format!("Failed to parse WAD {}: {}", wad_path.display(), e))?;
    let parsed = Arc::new(parsed);

    let mut guard = cache.lock().map_err(|_| "WAD cache lock poisoned".to_string())?;
    guard.insert(wad_path.clone(), Arc::clone(&parsed));
    Ok(parsed)
}

fn find_lcu_wad_bundles(install_dir: &std::path::Path) -> Vec<PathBuf> {
    let plugin_dir = install_dir.join("Plugins").join("rcp-be-lol-game-data");
    if !plugin_dir.exists() {
        return Vec::new();
    }
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(plugin_dir) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if name.ends_with("-assets.wad") {
                out.push(p);
            }
        }
    }
    out
}

fn preferred_lcu_wad_bundles(install_dir: &std::path::Path) -> Vec<PathBuf> {
    let plugin_dir = install_dir.join("Plugins").join("rcp-be-lol-game-data");
    vec![
        plugin_dir.join("default-assets.wad"),
        plugin_dir.join("default-assets2.wad"),
        plugin_dir.join("ja_JP-assets.wad"),
    ]
}

async fn try_extract_lcu_asset_from_local_wad(
    url: &str,
    category: &str,
    filename: &str,
    out_file: &PathBuf,
    client: &reqwest::Client,
) -> Result<(Option<String>, String), String> {
    let asset_paths = build_local_asset_candidates_from_url(url, category, filename, client).await?;
    if asset_paths.is_empty() {
        return Ok((None, "not_applicable".to_string()));
    }

    let Some(install_dir) = get_league_install_dir() else {
        return Ok((None, "league_install_not_found".to_string()));
    };
    let mut wads = preferred_lcu_wad_bundles(&install_dir)
        .into_iter()
        .filter(|p| p.exists())
        .collect::<Vec<_>>();
    // Keep compatibility with non-standard locales/install layouts.
    if wads.is_empty() {
        wads = find_lcu_wad_bundles(&install_dir);
    }
    if wads.is_empty() {
        return Ok((None, "no_lcu_wads_found".to_string()));
    }

    for asset_path in &asset_paths {
        let target_hashes = candidate_lcu_path_hashes_full(asset_path);
        for wad_path in &wads {
            let entries = get_wad_entries_cached(wad_path)?;
            for target_hash in &target_hashes {
                if let Some(entry) = entries.iter().find(|e| e.path_hash == *target_hash) {
                    let bytes = extract_file_from_wad(wad_path, entry)
                        .map_err(|e| format!("Failed to extract local asset from {}: {}", wad_path.display(), e))?;
                    let mut file = std::fs::File::create(out_file).map_err(|e| e.to_string())?;
                    use std::io::Write as _;
                    file.write_all(&bytes).map_err(|e| e.to_string())?;
                    let detail = format!(
                        "{}#path_hash={:016x} path={}",
                        wad_path.display(),
                        target_hash,
                        asset_path
                    );
                    return Ok((Some(detail), "hit".to_string()));
                }
            }
        }
    }
    Ok((None, format!("hash_not_found_for_paths:{:?}", asset_paths)))
}

fn write_image_source_marker(file_path: &PathBuf, payload: serde_json::Value) -> Result<(), String> {
    // Opt-in only: avoid writing marker files unless explicitly enabled.
    let enabled = std::env::var("LEAGUERECORD_WRITE_IMAGE_MARKERS")
        .map(|v| v == "1")
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let sidecar = PathBuf::from(format!("{}.source.json", file_path.display()));
    let body = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(sidecar, body).map_err(|e| e.to_string())?;
    Ok(())
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
