use std::fs;
use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager, State};

use crate::recorder::{MetadataFile, NoData};
use crate::state::SettingsWrapper;
use super::path_guard::resolve_clip_input_path;

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

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAudioTrack {
    pub index: u32,
    pub description: String,
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
    let text = if stderr.trim().is_empty() { stdout.as_ref() } else { stderr.as_ref() };

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
    let (ffmpeg_cmd, _mode) = resolve_ffmpeg_command(&state, &app_handle);
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

    let (ffmpeg_cmd, _mode) = resolve_ffmpeg_command(&state, &app_handle);
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
            let code = o.status.code().map(|c| c.to_string()).unwrap_or_else(|| "unknown".to_string());
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
