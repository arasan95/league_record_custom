use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::path_guard::resolve_clip_input_path;
use crate::recorder::{MetadataFile, NoData};
use crate::state::SettingsWrapper;

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegProvenance {
    pub source_name: String,
    pub source_url: String,
    pub version: String,
    pub license: String,
    pub sha256: String,
    pub download_url: Option<String>,
    pub archive_sha256: Option<String>,
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

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAudioTrack {
    pub index: u32,
    pub description: String,
}

const FFMPEG_DIR_NAME: &str = "ffmpeg";
const FFMPEG_ARCHIVE_NAME: &str = "ffmpeg-windows-x64.zip";
const FFMPEG_PROVENANCE_NAME: &str = "ffmpeg-provenance.json";

fn app_local_ffmpeg_dir(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_local_data_dir()
        .ok()
        .map(|p| p.join("tools").join(FFMPEG_DIR_NAME))
}

fn app_local_ffmpeg_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_local_ffmpeg_dir(app_handle).map(|p| p.join("ffmpeg.exe"))
}

fn app_local_provenance_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_local_ffmpeg_dir(app_handle).map(|p| p.join(FFMPEG_PROVENANCE_NAME))
}

fn resource_ffmpeg_candidates(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("ffmpeg").join("ffmpeg.exe"));
        candidates.push(resource_dir.join("ffmpeg.exe"));
    }

    candidates.push(PathBuf::from("src-tauri/resources/tools/ffmpeg/ffmpeg.exe"));
    candidates.push(PathBuf::from("resources/tools/ffmpeg/ffmpeg.exe"));

    candidates
}

fn resource_provenance_candidates(app_handle: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("ffmpeg").join(FFMPEG_PROVENANCE_NAME));
        candidates.push(resource_dir.join(FFMPEG_PROVENANCE_NAME));
    }

    candidates.push(PathBuf::from(format!(
        "src-tauri/resources/tools/ffmpeg/{FFMPEG_PROVENANCE_NAME}"
    )));
    candidates.push(PathBuf::from(format!(
        "resources/tools/ffmpeg/{FFMPEG_PROVENANCE_NAME}"
    )));

    candidates
}

fn bundled_ffmpeg_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_local_ffmpeg_path(app_handle)
        .filter(|p| p.is_file())
        .or_else(|| resource_ffmpeg_candidates(app_handle).into_iter().find(|p| p.is_file()))
}

fn read_json_file<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<T>(&content).ok()
}

fn read_desired_ffmpeg_provenance(app_handle: &AppHandle) -> Option<FfmpegProvenance> {
    let path = resource_provenance_candidates(app_handle)
        .into_iter()
        .find(|p| p.is_file())?;
    read_json_file(&path)
}

fn read_installed_ffmpeg_provenance(app_handle: &AppHandle) -> Option<FfmpegProvenance> {
    let path = app_local_provenance_path(app_handle)?;
    read_json_file(&path)
}

fn read_ffmpeg_provenance(app_handle: &AppHandle) -> Option<FfmpegProvenance> {
    read_installed_ffmpeg_provenance(app_handle).or_else(|| read_desired_ffmpeg_provenance(app_handle))
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open {} for hashing: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read {} for hashing: {}", path.display(), e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn local_ffmpeg_matches(path: &Path, provenance: &FfmpegProvenance) -> bool {
    if provenance.sha256.trim().is_empty() {
        return path.is_file();
    }

    file_sha256(path)
        .map(|hash| hash.eq_ignore_ascii_case(provenance.sha256.trim()))
        .unwrap_or(false)
}

fn valid_ffmpeg_download_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        && url.contains("/league_record_custom/releases/download/")
        && url.ends_with(FFMPEG_ARCHIVE_NAME)
}

fn is_allowed_ffmpeg_runtime_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "ffmpeg.exe" | "ffprobe.exe" | "ffplay.exe"
    ) || path
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("dll"))
        .unwrap_or(false)
}

fn write_ffmpeg_provenance(path: &Path, provenance: &FfmpegProvenance) -> Result<(), String> {
    fs::write(
        path,
        serde_json::to_string_pretty(provenance)
            .map_err(|e| format!("Failed to serialize FFmpeg provenance: {}", e))?,
    )
    .map_err(|e| format!("Failed to write FFmpeg provenance: {}", e))
}

fn copy_resource_ffmpeg_to_app_local(app_handle: &AppHandle, desired: &FfmpegProvenance) -> Result<bool, String> {
    let Some(source_exe) = resource_ffmpeg_candidates(app_handle).into_iter().find(|p| p.is_file()) else {
        return Ok(false);
    };
    let source_dir = source_exe
        .parent()
        .ok_or_else(|| format!("Invalid FFmpeg resource path: {}", source_exe.display()))?;
    let target_dir =
        app_local_ffmpeg_dir(app_handle).ok_or_else(|| "Failed to resolve AppLocalData directory".to_string())?;
    fs::create_dir_all(&target_dir).map_err(|e| format!("Failed to create FFmpeg runtime directory: {}", e))?;

    for entry in fs::read_dir(source_dir).map_err(|e| format!("Failed to read FFmpeg resource directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read FFmpeg resource entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() || !is_allowed_ffmpeg_runtime_file(&path) {
            continue;
        }
        let file_name = path
            .file_name()
            .ok_or_else(|| format!("Invalid FFmpeg resource file: {}", path.display()))?;
        fs::copy(&path, target_dir.join(file_name))
            .map_err(|e| format!("Failed to copy FFmpeg runtime file {}: {}", path.display(), e))?;
    }

    let target_exe = target_dir.join("ffmpeg.exe");
    if !local_ffmpeg_matches(&target_exe, desired) {
        return Err("Copied FFmpeg binary did not match expected SHA256".to_string());
    }

    write_ffmpeg_provenance(&target_dir.join(FFMPEG_PROVENANCE_NAME), desired)?;
    Ok(true)
}

async fn download_ffmpeg_to_app_local(app_handle: &AppHandle, desired: &FfmpegProvenance) -> Result<bool, String> {
    let Some(download_url) = desired.download_url.as_deref().filter(|s| !s.trim().is_empty()) else {
        return Ok(false);
    };

    if !valid_ffmpeg_download_url(download_url) {
        return Err(format!("Refusing unexpected FFmpeg download URL: {download_url}"));
    }

    let response = reqwest::get(download_url)
        .await
        .map_err(|e| format!("Failed to download FFmpeg runtime: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Failed to download FFmpeg runtime: HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read FFmpeg runtime download: {}", e))?;

    if let Some(expected_archive_hash) = desired.archive_sha256.as_deref().filter(|s| !s.trim().is_empty()) {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected_archive_hash.trim()) {
            return Err("Downloaded FFmpeg archive did not match expected SHA256".to_string());
        }
    }

    let app_handle = app_handle.clone();
    let desired = desired.clone();
    tauri::async_runtime::spawn_blocking(move || install_ffmpeg_archive(&app_handle, &desired, bytes.to_vec()))
        .await
        .map_err(|e| format!("FFmpeg installation task failed: {}", e))?
}

fn install_ffmpeg_archive(app_handle: &AppHandle, desired: &FfmpegProvenance, bytes: Vec<u8>) -> Result<bool, String> {
    let target_dir =
        app_local_ffmpeg_dir(app_handle).ok_or_else(|| "Failed to resolve AppLocalData directory".to_string())?;
    let parent_dir = target_dir
        .parent()
        .ok_or_else(|| "Invalid FFmpeg runtime directory".to_string())?;
    fs::create_dir_all(parent_dir).map_err(|e| format!("Failed to create FFmpeg tools directory: {}", e))?;

    let temp_dir = parent_dir.join("ffmpeg.tmp");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to remove stale FFmpeg temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create FFmpeg temp directory: {}", e))?;

    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open FFmpeg archive: {}", e))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read FFmpeg archive entry: {}", e))?;
        let Some(name) = Path::new(file.name()).file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let output_path = temp_dir.join(name);
        if !is_allowed_ffmpeg_runtime_file(&output_path) {
            continue;
        }
        let mut output = fs::File::create(&output_path)
            .map_err(|e| format!("Failed to create FFmpeg runtime file {}: {}", output_path.display(), e))?;
        std::io::copy(&mut file, &mut output)
            .map_err(|e| format!("Failed to extract FFmpeg runtime file {}: {}", output_path.display(), e))?;
    }

    let temp_exe = temp_dir.join("ffmpeg.exe");
    if !local_ffmpeg_matches(&temp_exe, desired) {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("Extracted FFmpeg binary did not match expected SHA256".to_string());
    }

    write_ffmpeg_provenance(&temp_dir.join(FFMPEG_PROVENANCE_NAME), desired)?;

    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|e| format!("Failed to replace old FFmpeg runtime: {}", e))?;
    }
    fs::rename(&temp_dir, &target_dir).map_err(|e| format!("Failed to activate FFmpeg runtime: {}", e))?;

    Ok(true)
}

async fn ensure_app_local_ffmpeg(app_handle: &AppHandle) -> Result<(), String> {
    let Some(desired) = read_desired_ffmpeg_provenance(app_handle) else {
        return Ok(());
    };
    let Some(local_exe) = app_local_ffmpeg_path(app_handle) else {
        return Ok(());
    };

    // Keep existing runtime on app updates. We only auto-provision when missing
    // so first install gets FFmpeg, while normal updates don't force replacement.
    if local_exe.is_file() {
        return Ok(());
    }

    if copy_resource_ffmpeg_to_app_local(app_handle, &desired)? {
        log::info!("FFmpeg runtime installed from bundled resource");
        return Ok(());
    }

    if download_ffmpeg_to_app_local(app_handle, &desired).await? {
        log::info!("FFmpeg runtime downloaded to AppLocalData");
    }

    Ok(())
}

pub async fn prepare_ffmpeg_runtime(app_handle: AppHandle) -> Result<(), String> {
    ensure_app_local_ffmpeg(&app_handle).await
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

pub(crate) async fn resolve_ffmpeg_command(settings: &SettingsWrapper, app_handle: &AppHandle) -> (String, String) {
    if let Err(error) = ensure_app_local_ffmpeg(app_handle).await {
        log::warn!("failed to prepare app-local FFmpeg runtime: {error}");
    }

    if let Some(path) = bundled_ffmpeg_path(app_handle) {
        let mode = if app_local_ffmpeg_path(app_handle).as_ref().is_some_and(|p| p == &path) {
            "appLocal"
        } else {
            "bundled"
        };
        return (path.to_string_lossy().to_string(), mode.to_string());
    }
    if let Some(custom_path) = settings.ffmpeg_path().filter(|s| !s.trim().is_empty()) {
        return (custom_path, "custom".to_string());
    }
    ("ffmpeg".to_string(), "path".to_string())
}

fn probe_audio_tracks(video_path: &PathBuf, ffmpeg_cmd: &str) -> Result<Vec<ClipAudioTrack>, String> {
    let mut command = Command::new(ffmpeg_cmd);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = command
        .arg("-hide_banner")
        .arg("-i")
        .arg(video_path)
        .output()
        .map_err(|e| format!("Failed to probe media streams: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = if stderr.trim().is_empty() {
        stdout.as_ref()
    } else {
        stderr.as_ref()
    };

    let mut tracks: Vec<ClipAudioTrack> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.contains("Stream #0:") || !trimmed.contains("Audio:") {
            continue;
        }
        if let Some(audio_pos) = trimmed.find("Audio:") {
            let raw_desc = trimmed[(audio_pos + "Audio:".len())..].trim();
            let description = if raw_desc.is_empty() {
                "Audio".to_string()
            } else {
                raw_desc.to_string()
            };
            tracks.push(ClipAudioTrack {
                index: tracks.len() as u32,
                description,
            });
        }
    }

    Ok(tracks)
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn get_clip_audio_tracks(
    video_id: String,
    app_handle: AppHandle,
    state: State<'_, SettingsWrapper>,
) -> Result<Vec<ClipAudioTrack>, String> {
    let video_path = resolve_clip_input_path(&video_id, &state)?;
    let (ffmpeg_cmd, _mode) = resolve_ffmpeg_command(&state, &app_handle).await;
    probe_audio_tracks(&video_path, &ffmpeg_cmd)
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn create_clip(
    video_id: String,
    start: f64,
    end: f64,
    game_audio_only: Option<bool>,
    audio_track_index: Option<u32>,
    app_handle: AppHandle,
    state: State<'_, SettingsWrapper>,
) -> Result<String, String> {
    let recordings_path = state.get_clips_path();
    let video_path = resolve_clip_input_path(&video_id, &state)?;

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

    let (ffmpeg_cmd, _mode) = resolve_ffmpeg_command(&state, &app_handle).await;
    let mut command = Command::new(ffmpeg_cmd);

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    command
        .arg("-ss")
        .arg(format!("{:.3}", start))
        .arg("-i")
        .arg(&video_path)
        .arg("-t")
        .arg(format!("{:.3}", duration));

    if let Some(track_index) = audio_track_index {
        command
            .arg("-map")
            .arg("0:v:0")
            .arg("-map")
            .arg(format!("0:a:{}", track_index))
            .arg("-c")
            .arg("copy");
    } else if game_audio_only.unwrap_or(false) {
        command
            .arg("-map")
            .arg("0:v:0")
            .arg("-map")
            .arg("0:a:1")
            .arg("-c")
            .arg("copy");
    } else {
        command.arg("-c").arg("copy");
    }

    let output = command.arg(&output_path).output();

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
            let stdout = String::from_utf8_lossy(&o.stdout);
            let code = o
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let detail = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !stdout.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                "No ffmpeg output.".to_string()
            };
            Err(format!("FFmpeg exited with non-zero code ({}): {}", code, detail))
        }
        Err(e) => Err(format!("Failed to execute ffmpeg: {}. Is FFmpeg installed?", e)),
    }
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub fn get_ffmpeg_runtime_info(app_handle: AppHandle, state: State<SettingsWrapper>) -> FfmpegRuntimeInfo {
    let (selected_path, mode) = if let Some(path) = bundled_ffmpeg_path(&app_handle) {
        let mode = if app_local_ffmpeg_path(&app_handle).as_ref().is_some_and(|p| p == &path) {
            "appLocal"
        } else {
            "bundled"
        };
        (path.to_string_lossy().to_string(), mode.to_string())
    } else if let Some(custom_path) = state.ffmpeg_path().filter(|s| !s.trim().is_empty()) {
        (custom_path, "custom".to_string())
    } else {
        ("ffmpeg".to_string(), "path".to_string())
    };
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
    clear_cache_inner(app_handle, true).await
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn clear_cache_for_patch_update(app_handle: AppHandle) -> Result<(), String> {
    // Keep tooltip_cache so existing tooltip variables remain available while new patch data is extracting.
    clear_cache_inner(app_handle, false).await
}

async fn clear_cache_inner(app_handle: AppHandle, include_tooltip_cache: bool) -> Result<(), String> {
    use tauri::Manager;
    // In Tauri v2, we use app_handle.path().app_local_data_dir()
    let app_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;

    let mut cache_dirs = vec!["img_cache", "items_cache"];
    if include_tooltip_cache {
        cache_dirs.push("tooltip_cache");
    }

    for dir in cache_dirs {
        let path = app_dir.join(dir);
        if path.exists() {
            std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete {}: {}", dir, e))?;
        }
    }
    Ok(())
}
