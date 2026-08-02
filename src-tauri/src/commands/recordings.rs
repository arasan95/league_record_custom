use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;

use riot_datatypes::{GameId, MatchId};
use serde_json::json;
use shaco::ingame::IngameClient;
use shaco::rest::LcuRestClient;
use tauri::{AppHandle, State};
use tokio::time::{sleep, Duration};

use crate::app::{action, RecordingManager};
use crate::recorder::{MetadataFile, TftRoundMarker};
use crate::state::{CurrentlyRecording, MarkerFlags, SettingsFile, SettingsWrapper};
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
        log::info!(
            "[perf] get_recordings_size: {:.1}ms (records={})",
            elapsed_ms,
            file_count
        );
        println!(
            "[perf] get_recordings_size: {:.1}ms (records={})",
            elapsed_ms, file_count
        );
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

fn replay_match_id_for_video(video_id: &str, state: &SettingsWrapper) -> Result<MatchId, String> {
    let path = resolve_existing_video_base(video_id, state).map_err(|e| e.to_string())?;
    let metadata = action::get_recording_metadata(&path, false).map_err(|e| e.to_string())?;
    let match_id = match metadata {
        MetadataFile::Metadata(metadata) => metadata.match_id,
        MetadataFile::Deferred(deferred) => deferred.match_id,
        MetadataFile::NoData(_) => {
            return Err("Replay is not available for recordings without match metadata.".to_string())
        }
    };

    if match_id.game_id <= 0 {
        return Err("Replay is not available for this recording.".to_string());
    }

    Ok(match_id)
}

fn lcu_client() -> Result<LcuRestClient, String> {
    LcuRestClient::new().map_err(|_| "League Client is not running or the LCU API is not ready.".to_string())
}

fn replay_context_data() -> serde_json::Value {
    json!({
        "componentType": "replay-button_match-history",
    })
}

fn replay_request_bodies(game_id: GameId) -> Vec<serde_json::Value> {
    vec![json!({ "gameId": game_id }), json!({}), replay_context_data()]
}

async fn watch_replay(client: &LcuRestClient, game_id: GameId) -> Result<(), reqwest::Error> {
    let path = format!("/lol-replays/v1/rofls/{game_id}/watch");
    let mut first_error = None;

    for body in replay_request_bodies(game_id) {
        match client.post_no_response(&path, body).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
    }

    Err(first_error.expect("watch replay request bodies should not be empty"))
}

async fn wait_for_replay_watch(client: &LcuRestClient, game_id: GameId) -> Result<(), String> {
    const MAX_ATTEMPTS: usize = 90;
    let mut last_error = None;

    for _ in 0..MAX_ATTEMPTS {
        match watch_replay(client, game_id).await {
            Ok(()) => {
                return Ok(());
            }
            Err(e) => {
                last_error = Some(e.to_string());
            }
        }

        sleep(Duration::from_secs(1)).await;
    }

    if let Some(error) = last_error {
        Err(format!("Failed to start replay playback after download: {error}"))
    } else {
        Err("Failed to start replay playback after download.".to_string())
    }
}

async fn start_replay_download(client: &LcuRestClient, game_id: GameId) -> Result<(), String> {
    let endpoints = [
        format!("/lol-replays/v1/rofls/{game_id}/download/graceful"),
        format!("/lol-replays/v1/rofls/{game_id}/download"),
    ];
    let mut saw_success = false;
    let mut saw_conflict = false;
    let mut errors = Vec::new();

    for endpoint in endpoints {
        for body in replay_request_bodies(game_id) {
            match client.post_no_response(&endpoint, body).await {
                Ok(()) => saw_success = true,
                Err(e) => {
                    let message = e.to_string();
                    if message.contains("409") {
                        saw_conflict = true;
                    } else {
                        errors.push(format!("{endpoint}: {message}"));
                    }
                }
            }
        }
    }

    if saw_success || saw_conflict {
        return Ok(());
    }

    Err(format!("Failed to start ROFL download: {}", errors.join(" | ")))
}

async fn replay_file_path(client: &LcuRestClient, match_id: &MatchId) -> Option<PathBuf> {
    let Ok(replay_dir) = client.get::<PathBuf>("/lol-replays/v1/rofls/path").await else {
        return None;
    };

    let platform_id = match_id.platform_id.trim();
    let game_id = match_id.game_id;
    for filename in [
        format!("{platform_id}-{game_id}.rofl"),
        format!("{platform_id}_{game_id}.rofl"),
        format!("{game_id}.rofl"),
    ] {
        let path = replay_dir.join(filename);
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn is_league_client_available() -> bool {
    lcu_client().is_ok()
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn download_recording_replay(video_id: String, state: State<'_, SettingsWrapper>) -> Result<(), String> {
    let game_id = replay_match_id_for_video(&video_id, &state)?.game_id;
    let client = lcu_client()?;

    start_replay_download(&client, game_id).await
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn play_recording_replay(video_id: String, state: State<'_, SettingsWrapper>) -> Result<(), String> {
    let match_id = replay_match_id_for_video(&video_id, &state)?;
    let game_id = match_id.game_id;
    let client = lcu_client()?;

    if replay_file_path(&client, &match_id).await.is_some() {
        return watch_replay(&client, game_id)
            .await
            .map_err(|e| format!("Failed to start replay playback: {e}"));
    }

    start_replay_download(&client, game_id).await?;
    sleep(Duration::from_secs(3)).await;

    wait_for_replay_watch(&client, game_id).await
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
pub async fn append_tft_round_marker(
    round: String,
    timestamp: f64,
    recording: State<'_, CurrentlyRecording>,
) -> Result<(), String> {
    let path = recording.get().ok_or_else(|| "not currently recording".to_string())?;
    let mut metadata = action::get_recording_metadata(&path, false).map_err(|e| e.to_string())?;
    let resolved_timestamp = if timestamp > 0.0 {
        timestamp
    } else {
        IngameClient::new()
            .game_stats()
            .await
            .map(|stats| stats.game_time * 1000.0)
            .map_err(|e| e.to_string())?
    };
    let marker = TftRoundMarker {
        round,
        timestamp: resolved_timestamp,
    };

    match &mut metadata {
        MetadataFile::Metadata(m) => {
            if m.tft_round_markers.last().map(|last| last.round.as_str()) != Some(marker.round.as_str()) {
                m.tft_round_markers.push(marker);
            }
        }
        MetadataFile::Deferred(d) => {
            if d.tft_round_markers.last().map(|last| last.round.as_str()) != Some(marker.round.as_str()) {
                d.tft_round_markers.push(marker);
            }
        }
        MetadataFile::NoData(_) => return Err("current recording has no writable metadata".to_string()),
    }

    action::save_recording_metadata(&path, &metadata).map_err(|e| e.to_string())
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
        let mut command = Command::new("tasklist");
        command.args(["/fo", "csv", "/nh"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let output = command.output();
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
pub async fn save_scoreboard_cache(
    video_id: String,
    content: String,
    state: State<'_, SettingsWrapper>,
) -> Result<(), String> {
    use std::io::Write;

    let video_path = resolve_existing_video_base(&video_id, &state)?;
    let cache_path = video_path.with_extension("sb.json");

    let mut file = std::fs::File::create(&cache_path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn load_scoreboard_cache(
    video_id: String,
    state: State<'_, SettingsWrapper>,
) -> Result<String, String> {
    let video_path = resolve_existing_video_base(&video_id, &state)?;
    let cache_path = video_path.with_extension("sb.json");

    if !cache_path.exists() {
        return Err("Cache file not found".to_string());
    }

    let content = std::fs::read_to_string(cache_path).map_err(|e| e.to_string())?;
    Ok(content)
}
