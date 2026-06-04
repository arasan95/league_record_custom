use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use libobs_recorder::Recorder;
use tauri::{async_runtime, AppHandle, Manager};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

use crate::app::{action, AppEvent, EventManager};
use crate::recorder::{MetadataFile, TftRoundMarker};
use crate::state::{SettingsWrapper, TftRoundOcrRegion};

const MIN_FOREGROUND_PIXELS: usize = 8;
const OFFLINE_SAMPLE_SECONDS: f64 = 2.0;
const OFFLINE_CROP_WIDTH: usize = 520;
const OFFLINE_CROP_HEIGHT: usize = 38;
const OFFLINE_STABLE_SAMPLES: u8 = 1;
const LIVE_OCR_START_DELAY: Duration = Duration::ZERO;
const LIVE_UNREADABLE_LOG_INTERVAL: u32 = 15;
const MAX_INTERPOLATED_ROUND_GAP: u32 = 10;
const ESTIMATED_STAGE_TWO_ONE_MS: f64 = 120_000.0;
const VIDEO_READY_TIMEOUT: Duration = Duration::from_secs(30);
const VIDEO_READY_POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_RECOGNIZED_TFT_STAGE: u32 = 9;
const MAX_RECOGNIZED_TFT_ROUND: u32 = 7;
const LEGACY_REGION_MIN_WIDTH: f64 = 0.10;
const ROUND_TEXT_REGION_WIDTH: f64 = 0.038;
const ROUND_SHORT_TEXT_REGION_WIDTH: f64 = 0.060;
const ROUND_WIDE_TEXT_REGION_WIDTH: f64 = 0.140;
const ROUND_TEXT_REGION_OFFSET_WITHIN_LEGACY: f64 = 0.43;
const ROUND_SHORT_TEXT_RIGHT_SHIFT: f64 = 0.012;

#[derive(Clone)]
struct Capture {
    width: usize,
    height: usize,
    bgra: Vec<u8>,
}

pub async fn run_obs_loop(
    recorder: &mut Recorder,
    app_handle: AppHandle,
    metadata_path: PathBuf,
    recording_start_offset_ms: f64,
    cancel_token: CancellationToken,
) -> Result<()> {
    let mut last_round: Option<String> = None;
    let mut stable_round: Option<String> = None;
    let mut stable_count = 0u8;
    let mut unreadable_samples = 0u32;
    let recording_started_at = Instant::now();

    loop {
        if cancel_token.is_cancelled() {
            return Ok(());
        }

        if sleep_or_cancel(LIVE_OCR_START_DELAY, &cancel_token).await {
            return Ok(());
        }

        let Some((region, interval_seconds)) = live_ocr_settings(&app_handle) else {
            return Ok(());
        };
        let regions = round_text_region_candidates(region);
        let Some(capture_region) = union_region(&regions) else {
            return Ok(());
        };
        let capture = match recorder.capture_video_region(
            capture_region.x,
            capture_region.y,
            capture_region.width,
            capture_region.height,
        ) {
            Ok(frame) => frame.map(|frame| Capture {
                width: frame.width as usize,
                height: frame.height as usize,
                bgra: frame.bgra,
            }),
            Err(e) => {
                log::warn!("TFT OBS OCR frame capture failed; retrying: {e}");
                None
            }
        };

        let mut recognized_round = None;
        if let Some(capture) = capture {
            for region in regions {
                let Some(candidate_capture) = crop_capture(&capture, &capture_region, &region) else {
                    continue;
                };
                if let Some(round) = recognize_round(&candidate_capture)? {
                    recognized_round = Some(round);
                    break;
                }
            }
        }

        match recognized_round {
            Some(round) => {
                if unreadable_samples > 0 {
                    log::info!("TFT OBS OCR recognized '{round}' after {unreadable_samples} unreadable sample(s)");
                    unreadable_samples = 0;
                }

                if stable_round.as_deref() == Some(round.as_str()) {
                    stable_count = stable_count.saturating_add(1);
                } else {
                    log::info!("TFT OBS OCR round candidate: {round}");
                    stable_round = Some(round.clone());
                    stable_count = 1;
                }

                if stable_count >= 2 && last_round.as_deref() != Some(round.as_str()) {
                    let timestamp = recording_start_offset_ms + recording_started_at.elapsed().as_secs_f64() * 1000.0;
                    record_live_marker(&app_handle, &metadata_path, &mut last_round, round, timestamp);
                }
            }
            None => note_unreadable_sample(&mut stable_round, &mut stable_count, &mut unreadable_samples, "OBS"),
        }

        let sleep_for = Duration::from_secs_f64(interval_seconds).saturating_sub(LIVE_OCR_START_DELAY);
        if sleep_or_cancel(sleep_for, &cancel_token).await {
            return Ok(());
        }
    }
}

async fn sleep_or_cancel(duration: Duration, cancel_token: &CancellationToken) -> bool {
    let mut remaining = duration;
    let step = Duration::from_millis(250);
    while !remaining.is_zero() {
        if cancel_token.is_cancelled() {
            return true;
        }
        let current = remaining.min(step);
        sleep(current).await;
        remaining = remaining.saturating_sub(current);
    }
    cancel_token.is_cancelled()
}

fn live_ocr_settings(app_handle: &AppHandle) -> Option<(TftRoundOcrRegion, f64)> {
    let settings_state = app_handle.state::<SettingsWrapper>();
    let settings_wrapper: &SettingsWrapper = &settings_state;
    let settings = settings_wrapper.inner();
    if !settings.tft_round_ocr_enabled {
        return None;
    }
    Some((
        settings.tft_round_ocr_region,
        settings.tft_round_ocr_interval_seconds.clamp(0.5, 10.0),
    ))
}

fn effective_round_text_region(mut region: TftRoundOcrRegion) -> TftRoundOcrRegion {
    if region.width >= LEGACY_REGION_MIN_WIDTH {
        region.x = (region.x + region.width * ROUND_TEXT_REGION_OFFSET_WITHIN_LEGACY).clamp(0.0, 1.0);
        region.width = ROUND_TEXT_REGION_WIDTH;
    }
    region
}

fn push_unique_region(regions: &mut Vec<TftRoundOcrRegion>, region: TftRoundOcrRegion) {
    let already_exists = regions.iter().any(|existing| {
        (existing.x - region.x).abs() < 0.0005
            && (existing.y - region.y).abs() < 0.0005
            && (existing.width - region.width).abs() < 0.0005
            && (existing.height - region.height).abs() < 0.0005
    });
    if !already_exists {
        regions.push(region);
    }
}

fn round_text_region_candidates(region: TftRoundOcrRegion) -> Vec<TftRoundOcrRegion> {
    let base = effective_round_text_region(region);
    let mut regions = Vec::new();
    push_unique_region(&mut regions, base.clone());

    // Round 1-x is rendered shorter and shifts to the right because there are fewer
    // visible characters next to the round icon. Keep the normal tight crop for
    // clean 2-x+ reads, then try right-shifted crops for the short label.
    let mut right_shifted = base.clone();
    right_shifted.x = (base.x + ROUND_SHORT_TEXT_RIGHT_SHIFT).clamp(0.0, 1.0);
    right_shifted.width = base.width;
    push_unique_region(&mut regions, right_shifted);

    let mut short = base.clone();
    short.x = (base.x + ROUND_SHORT_TEXT_RIGHT_SHIFT).clamp(0.0, 1.0);
    short.width = ROUND_SHORT_TEXT_REGION_WIDTH.max(base.width);
    push_unique_region(&mut regions, short);

    // Last resort: include more of the surrounding label area in case the user's
    // resolution/UI scale places the text differently.
    let mut wide = base.clone();
    wide.x = (base.x - 0.066).clamp(0.0, 1.0);
    wide.width = ROUND_WIDE_TEXT_REGION_WIDTH.max(base.width);
    push_unique_region(&mut regions, wide);

    regions
}

fn union_region(regions: &[TftRoundOcrRegion]) -> Option<TftRoundOcrRegion> {
    let first = regions.first()?;
    let mut left = first.x;
    let mut top = first.y;
    let mut right = first.x + first.width;
    let mut bottom = first.y + first.height;
    for region in regions.iter().skip(1) {
        left = left.min(region.x);
        top = top.min(region.y);
        right = right.max(region.x + region.width);
        bottom = bottom.max(region.y + region.height);
    }
    Some(TftRoundOcrRegion {
        anchor: first.anchor.clone(),
        x: left.clamp(0.0, 1.0),
        center_offset_x: first.center_offset_x,
        y: top.clamp(0.0, 1.0),
        width: (right - left).clamp(0.01, 1.0),
        height: (bottom - top).clamp(0.01, 1.0),
    })
}

fn crop_capture(capture: &Capture, outer: &TftRoundOcrRegion, inner: &TftRoundOcrRegion) -> Option<Capture> {
    if capture.width == 0 || capture.height == 0 || outer.width <= 0.0 || outer.height <= 0.0 {
        return None;
    }

    let x1 = (((inner.x - outer.x) / outer.width) * capture.width as f64)
        .floor()
        .max(0.0) as usize;
    let y1 = (((inner.y - outer.y) / outer.height) * capture.height as f64)
        .floor()
        .max(0.0) as usize;
    let x2 = (((inner.x + inner.width - outer.x) / outer.width) * capture.width as f64)
        .ceil()
        .min(capture.width as f64) as usize;
    let y2 = (((inner.y + inner.height - outer.y) / outer.height) * capture.height as f64)
        .ceil()
        .min(capture.height as f64) as usize;
    if x1 >= x2 || y1 >= y2 {
        return None;
    }

    let width = x2 - x1;
    let height = y2 - y1;
    let mut bgra = Vec::with_capacity(width * height * 4);
    for y in y1..y2 {
        let row_start = (y * capture.width + x1) * 4;
        let row_end = row_start + width * 4;
        bgra.extend_from_slice(&capture.bgra[row_start..row_end]);
    }
    Some(Capture { width, height, bgra })
}

fn note_unreadable_sample(
    stable_round: &mut Option<String>,
    stable_count: &mut u8,
    unreadable_samples: &mut u32,
    source: &str,
) {
    *stable_round = None;
    *stable_count = 0;
    *unreadable_samples = unreadable_samples.saturating_add(1);
    if *unreadable_samples % LIVE_UNREADABLE_LOG_INTERVAL == 0 {
        log::info!(
            "TFT live OCR has not recognized a round from {source} for {unreadable_samples} sample(s); capture may be blank, obscured, or outside the configured crop"
        );
    }
}

fn record_live_marker(
    app_handle: &AppHandle,
    metadata_path: &PathBuf,
    last_round: &mut Option<String>,
    round: String,
    timestamp: f64,
) {
    match append_round_marker(metadata_path, round.clone(), timestamp) {
        Ok(true) => {
            *last_round = Some(round.clone());
            if let Some(video_id) = metadata_path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) {
                let _ = app_handle.send_event(AppEvent::MetadataChanged { payload: vec![video_id] });
            }
            log::info!("TFT round marker recorded: {round}");
        }
        Ok(false) => {
            log::info!("TFT live OCR stable candidate rejected: {round}");
            *last_round = Some(round);
        }
        Err(e) => log::debug!("failed to append TFT round marker: {e}"),
    }
}

fn append_round_marker(path: &PathBuf, round: String, timestamp: f64) -> Result<bool> {
    let mut metadata = action::get_recording_metadata(path, false)?;
    let marker = TftRoundMarker { round, timestamp };
    let appended = match &mut metadata {
        MetadataFile::Metadata(m) => append_marker(&mut m.tft_round_markers, marker),
        MetadataFile::Deferred(d) => append_marker(&mut d.tft_round_markers, marker),
        MetadataFile::NoData(_) => false,
    };

    if appended {
        action::save_recording_metadata(path, &metadata)?;
    }
    Ok(appended)
}

pub async fn backfill_from_recording(
    app_handle: AppHandle,
    video_path: PathBuf,
    metadata_path: PathBuf,
) -> Result<usize> {
    let settings_state = app_handle.state::<SettingsWrapper>();
    let settings_wrapper: &SettingsWrapper = &settings_state;
    let (ffmpeg_cmd, ffmpeg_mode) = crate::commands::resolve_ffmpeg_command(settings_wrapper, &app_handle).await;
    log::info!("TFT recording OCR backfill FFmpeg runtime: mode={ffmpeg_mode}");

    async_runtime::spawn_blocking(move || {
        backfill_from_recording_blocking(app_handle, video_path, metadata_path, ffmpeg_cmd)
    })
    .await?
}

fn backfill_from_recording_blocking(
    app_handle: AppHandle,
    video_path: PathBuf,
    metadata_path: PathBuf,
    ffmpeg_cmd: String,
) -> Result<usize> {
    if !video_path.is_file() {
        bail!("video file not found: {}", video_path.display());
    }
    let settings_state = app_handle.state::<SettingsWrapper>();
    let settings_wrapper: &SettingsWrapper = &settings_state;
    let settings = settings_wrapper.inner();
    if !settings.tft_round_ocr_enabled {
        return Ok(0);
    }
    wait_for_video_file_ready(&ffmpeg_cmd, &video_path)?;

    let mut metadata = action::get_recording_metadata(&metadata_path, false)?;
    let (offset_ms, existing_markers) = match &metadata {
        MetadataFile::Metadata(m) => (m.ingame_time_rec_start_offset * 1000.0, m.tft_round_markers.clone()),
        MetadataFile::Deferred(d) => (d.ingame_time_rec_start_offset * 1000.0, d.tft_round_markers.clone()),
        MetadataFile::NoData(_) => return Ok(0),
    };

    let mut scanned_markers = Vec::new();
    let mut sampled_frames = 0usize;
    let mut recognized_frames = 0usize;
    let mut stable_candidates = 0usize;
    let regions = round_text_region_candidates(settings.tft_round_ocr_region);
    let region_count = regions.len();
    for (index, region) in regions.into_iter().enumerate() {
        let scan = scan_recording_region(&ffmpeg_cmd, &video_path, region, offset_ms)
            .with_context(|| format!("failed to scan TFT round OCR region #{index}"))?;
        sampled_frames = sampled_frames.max(scan.sampled_frames);
        recognized_frames += scan.recognized_frames;
        stable_candidates += scan.stable_candidates;
        scanned_markers.extend(scan.markers);
    }
    log::info!(
        "TFT recording OCR scan: regions={}, sampled={sampled_frames}, recognized={recognized_frames}, stable_candidates={stable_candidates}, scanned_markers={}",
        region_count,
        scanned_markers.len()
    );

    let appended = match &mut metadata {
        MetadataFile::Metadata(m) => {
            m.tft_round_markers = merge_markers(existing_markers, scanned_markers, offset_ms);
            m.tft_round_markers.len()
        }
        MetadataFile::Deferred(d) => {
            d.tft_round_markers = merge_markers(existing_markers, scanned_markers, offset_ms);
            d.tft_round_markers.len()
        }
        MetadataFile::NoData(_) => 0,
    };

    if appended > 0 {
        action::save_recording_metadata(&metadata_path, &metadata)?;
        log::info!("TFT round markers backfilled from recording: {appended}");
    }
    Ok(appended)
}

fn wait_for_video_file_ready(ffmpeg_cmd: &str, video_path: &PathBuf) -> Result<()> {
    let started = Instant::now();
    let mut previous_size = None;
    let mut stable_samples = 0u8;

    loop {
        let size = std::fs::metadata(video_path)
            .with_context(|| format!("video file not readable yet: {}", video_path.display()))?
            .len();
        if Some(size) == previous_size && size > 0 {
            stable_samples = stable_samples.saturating_add(1);
            if stable_samples >= 2 && ffmpeg_can_read_video(ffmpeg_cmd, video_path) {
                return Ok(());
            }
        } else {
            previous_size = Some(size);
            stable_samples = 0;
        }

        if started.elapsed() >= VIDEO_READY_TIMEOUT {
            log::warn!(
                "TFT round backfill proceeding before video size fully stabilized: {}",
                video_path.display()
            );
            return Ok(());
        }
        std::thread::sleep(VIDEO_READY_POLL_INTERVAL);
    }
}

fn ffmpeg_can_read_video(ffmpeg_cmd: &str, video_path: &PathBuf) -> bool {
    let mut command = Command::new(ffmpeg_cmd);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut output = command;
    output
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(video_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-f")
        .arg("null");
    #[cfg(target_os = "windows")]
    output.arg("NUL");
    #[cfg(not(target_os = "windows"))]
    output.arg("/dev/null");
    output.status().is_ok_and(|status| status.success())
}

struct RecordingRegionScan {
    markers: Vec<TftRoundMarker>,
    sampled_frames: usize,
    recognized_frames: usize,
    stable_candidates: usize,
}

fn scan_recording_region(
    ffmpeg_cmd: &str,
    video_path: &PathBuf,
    region: TftRoundOcrRegion,
    offset_ms: f64,
) -> Result<RecordingRegionScan> {
    let filter = format!(
        "fps=1/{OFFLINE_SAMPLE_SECONDS},crop=min(iw\\,ih*16/9)*{w}:ih*{h}:min(iw\\,ih*16/9)*{x}:ih*{y},scale={OFFLINE_CROP_WIDTH}:{OFFLINE_CROP_HEIGHT}:flags=neighbor,format=rgb24",
        w = region.width.clamp(0.01, 1.0),
        h = region.height.clamp(0.01, 1.0),
        x = region.x.clamp(0.0, 1.0),
        y = region.y.clamp(0.0, 1.0),
    );

    let mut command = Command::new(ffmpeg_cmd);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(video_path)
        .arg("-vf")
        .arg(filter)
        .arg("-f")
        .arg("rawvideo")
        .arg("pipe:1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("failed to run ffmpeg for TFT round backfill")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("ffmpeg TFT round backfill failed: {}", stderr.trim());
    }

    let frame_size = OFFLINE_CROP_WIDTH * OFFLINE_CROP_HEIGHT * 3;
    let mut markers = Vec::new();
    let mut last_round: Option<String> = None;
    let mut last_key = (0u32, 0u32);
    let mut stable_round: Option<String> = None;
    let mut stable_count = 0u8;
    let mut stable_first_index = 0usize;
    let mut sampled_frames = 0usize;
    let mut recognized_frames = 0usize;
    let mut stable_candidates = 0usize;
    for (frame_index, frame) in output.stdout.chunks_exact(frame_size).enumerate() {
        sampled_frames += 1;
        let capture = capture_from_rgb_frame(OFFLINE_CROP_WIDTH, OFFLINE_CROP_HEIGHT, frame);
        let Some(round) = recognize_round(&capture)? else {
            stable_round = None;
            stable_count = 0;
            continue;
        };
        recognized_frames += 1;
        if stable_round.as_deref() == Some(round.as_str()) {
            stable_count = stable_count.saturating_add(1);
        } else {
            stable_round = Some(round.clone());
            stable_count = 1;
            stable_first_index = frame_index;
        }
        if stable_count < OFFLINE_STABLE_SAMPLES {
            continue;
        }
        stable_candidates += 1;
        if last_round.as_deref() == Some(round.as_str()) {
            continue;
        }
        let Some(key) = round_key(&round) else {
            continue;
        };
        if key < last_key {
            continue;
        }

        let timestamp = offset_ms + stable_first_index as f64 * OFFLINE_SAMPLE_SECONDS * 1000.0;
        markers.push(TftRoundMarker {
            round: round.clone(),
            timestamp,
        });
        last_round = Some(round);
        last_key = key;
    }

    Ok(RecordingRegionScan {
        markers,
        sampled_frames,
        recognized_frames,
        stable_candidates,
    })
}

fn capture_from_rgb_frame(width: usize, height: usize, rgb: &[u8]) -> Capture {
    let mut bgra = Vec::with_capacity(width * height * 4);
    for px in rgb.chunks_exact(3) {
        bgra.push(px[2]);
        bgra.push(px[1]);
        bgra.push(px[0]);
        bgra.push(255);
    }
    Capture { width, height, bgra }
}

fn round_key(round: &str) -> Option<(u32, u32)> {
    let (stage, round) = round.split_once('-')?;
    let key = (stage.parse().ok()?, round.parse().ok()?);
    round_sequence_index(key)?;
    Some(key)
}

fn round_sequence_index(key: (u32, u32)) -> Option<u32> {
    let (stage, round) = key;
    if stage == 1 {
        (1..=4).contains(&round).then_some(round - 1)
    } else if (2..=MAX_RECOGNIZED_TFT_STAGE).contains(&stage) && (1..=MAX_RECOGNIZED_TFT_ROUND).contains(&round) {
        Some(4 + (stage - 2) * 7 + (round - 1))
    } else {
        None
    }
}

fn round_from_sequence_index(index: u32) -> Option<String> {
    if index < 4 {
        return Some(format!("1-{}", index + 1));
    }
    let adjusted = index - 4;
    Some(format!("{}-{}", adjusted / 7 + 2, adjusted % 7 + 1))
}

fn interpolate_markers(markers: Vec<TftRoundMarker>) -> Vec<TftRoundMarker> {
    let mut expanded = Vec::new();
    let mut iter = markers.into_iter();
    let Some(first) = iter.next() else {
        return expanded;
    };

    expanded.push(first);
    for marker in iter {
        if let Some(previous) = expanded.last().cloned() {
            if let (Some(previous_index), Some(next_index)) = (
                round_key(&previous.round).and_then(round_sequence_index),
                round_key(&marker.round).and_then(round_sequence_index),
            ) {
                let gap = next_index.saturating_sub(previous_index);
                let elapsed = marker.timestamp - previous.timestamp;
                if gap > 1 && gap <= MAX_INTERPOLATED_ROUND_GAP && elapsed > 0.0 {
                    for step in 1..gap {
                        let Some(round) = round_from_sequence_index(previous_index + step) else {
                            continue;
                        };
                        if expanded.iter().any(|existing| existing.round == round) {
                            continue;
                        }
                        let timestamp = previous.timestamp + elapsed * f64::from(step) / f64::from(gap);
                        expanded.push(TftRoundMarker { round, timestamp });
                    }
                }
            }
        }
        expanded.push(marker);
    }
    expanded
}

fn prepend_initial_markers(markers: Vec<TftRoundMarker>, recording_start_ms: f64) -> Vec<TftRoundMarker> {
    let Some(first) = markers.first() else {
        return markers;
    };
    let Some(first_index) = round_key(&first.round).and_then(round_sequence_index) else {
        return markers;
    };
    if first_index == 0 || markers.iter().any(|marker| marker.round.starts_with("1-")) {
        return markers;
    }

    let mut prefix = Vec::new();
    if first_index < 4 {
        let early_gap = (first.timestamp - recording_start_ms).max(0.0);
        for index in 0..first_index {
            let Some(round) = round_from_sequence_index(index) else {
                continue;
            };
            prefix.push(TftRoundMarker {
                round,
                timestamp: recording_start_ms + early_gap * f64::from(index) / f64::from(first_index),
            });
        }
        prefix.extend(markers);
        return prefix;
    }

    let stage_two_one_ms = if first_index >= 4 {
        first
            .timestamp
            .min(ESTIMATED_STAGE_TWO_ONE_MS.max(recording_start_ms))
            .max(recording_start_ms)
    } else {
        first.timestamp
    };
    let one_one_ms = recording_start_ms.min(stage_two_one_ms);
    let early_gap = (stage_two_one_ms - one_one_ms).max(0.0);
    for index in 0..4 {
        let Some(round) = round_from_sequence_index(index) else {
            continue;
        };
        prefix.push(TftRoundMarker {
            round,
            timestamp: one_one_ms + early_gap * f64::from(index) / 4.0,
        });
    }

    if first_index >= 4 && markers.iter().all(|marker| marker.round != "2-1") {
        prefix.push(TftRoundMarker {
            round: "2-1".to_string(),
            timestamp: stage_two_one_ms,
        });
    }

    prefix.extend(markers);
    prefix
}

fn is_plausible_first_marker(key: (u32, u32), timestamp: f64) -> bool {
    if timestamp < 90_000.0 {
        return key.0 == 1 && key.1 <= 4;
    }
    if timestamp < 420_000.0 {
        return key.0 <= 2;
    }
    if timestamp < 900_000.0 {
        return key.0 <= 3;
    }
    true
}

fn is_plausible_transition(previous: (u32, u32), next: (u32, u32), elapsed_ms: f64) -> bool {
    if next <= previous {
        return false;
    }
    let nearby = (next.0 == previous.0 && next.1 <= previous.1 + 2)
        || (next.0 == previous.0 + 1 && previous.1 >= 3 && next.1 <= 2);
    let late_recovery = elapsed_ms >= 300_000.0 && next.0 <= previous.0 + 2;
    nearby || late_recovery
}

fn merge_markers(
    mut existing: Vec<TftRoundMarker>,
    scanned: Vec<TftRoundMarker>,
    recording_start_ms: f64,
) -> Vec<TftRoundMarker> {
    existing.extend(scanned);
    existing.sort_by(|a, b| {
        a.timestamp
            .partial_cmp(&b.timestamp)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut seen = Vec::<String>::new();
    let mut merged: Vec<TftRoundMarker> = Vec::new();
    for marker in existing {
        let Some(key) = round_key(&marker.round) else {
            continue;
        };
        if seen.iter().any(|round| round == &marker.round) {
            continue;
        }
        if let Some(last) = merged.last() {
            let Some(last_key) = round_key(&last.round) else {
                continue;
            };
            if !is_plausible_transition(last_key, key, marker.timestamp - last.timestamp) {
                continue;
            }
        } else if !is_plausible_first_marker(key, marker.timestamp) {
            continue;
        }
        seen.push(marker.round.clone());
        merged.push(marker);
    }
    prepend_initial_markers(interpolate_markers(merged), recording_start_ms)
}

fn append_marker(markers: &mut Vec<TftRoundMarker>, marker: TftRoundMarker) -> bool {
    if markers.last().map(|last| last.round.as_str()) == Some(marker.round.as_str()) {
        log::info!(
            "TFT round marker rejected: round={}, reason=duplicate last round",
            marker.round
        );
        return false;
    }
    let Some(next_key) = round_key(&marker.round) else {
        log::info!(
            "TFT round marker rejected: round={}, reason=invalid round key",
            marker.round
        );
        return false;
    };
    if let Some(last) = markers.last() {
        let Some(last_key) = round_key(&last.round) else {
            log::info!(
                "TFT round marker rejected: round={}, reason=invalid previous round key {}",
                marker.round,
                last.round
            );
            return false;
        };
        if !is_plausible_transition(last_key, next_key, marker.timestamp - last.timestamp) {
            log::info!(
                "TFT round marker rejected: round={}, reason=implausible transition from {}",
                marker.round,
                last.round
            );
            return false;
        }
    } else if !is_plausible_first_marker(next_key, marker.timestamp) {
        log::info!(
            "TFT round marker rejected: round={}, reason=implausible first marker at {:.0}ms",
            marker.round,
            marker.timestamp
        );
        return false;
    } else if let Some(next_index) = round_sequence_index(next_key) {
        if next_index > 0 {
            let initial_markers = prepend_initial_markers(vec![marker.clone()], 0.0);
            if initial_markers.len() > 1 {
                markers.extend(initial_markers);
                return true;
            }
        }
    }

    if let Some(last) = markers.last().cloned() {
        let gap = round_key(&last.round)
            .and_then(round_sequence_index)
            .zip(round_key(&marker.round).and_then(round_sequence_index))
            .map(|(previous_index, next_index)| next_index.saturating_sub(previous_index))
            .unwrap_or(0);
        if gap > 1 {
            let additions = interpolate_markers(vec![last, marker.clone()]);
            for interpolated in additions.into_iter().skip(1) {
                if markers.iter().all(|existing| existing.round != interpolated.round) {
                    markers.push(interpolated);
                }
            }
            return true;
        }
    }

    markers.push(marker);
    true
}

fn recognize_round(capture: &Capture) -> Result<Option<String>> {
    let mask = foreground_mask(capture);
    if mask.iter().filter(|&&v| v).count() < MIN_FOREGROUND_PIXELS {
        return Ok(None);
    }

    let Some((left, top, right, bottom)) = bounding_box(&mask, capture.width, capture.height) else {
        return Ok(None);
    };
    let components = split_components(&mask, capture.width, capture.height, left, top, right, bottom);
    if components.len() < 3 {
        return Ok(None);
    }

    if let Some(round) = recognize_round_components(&mask, capture.width, capture.height, &components) {
        return Ok(Some(round));
    }

    let mut chars = Vec::new();
    for (x1, y1, x2, y2) in components {
        let glyph = normalize_glyph(&mask, capture.width, x1, y1, x2, y2);
        let ch = recognize_glyph(&glyph, x2.saturating_sub(x1) + 1, y2.saturating_sub(y1) + 1);
        if let Some(ch) = ch {
            chars.push(ch);
        }
    }

    let text: String = chars.into_iter().collect();
    let normalized = normalize_round_text(&text);
    Ok(normalized)
}

fn foreground_mask(capture: &Capture) -> Vec<bool> {
    let mut mask = vec![false; capture.width * capture.height];
    for y in 0..capture.height {
        for x in 0..capture.width {
            let i = (y * capture.width + x) * 4;
            let b = capture.bgra[i] as i32;
            let g = capture.bgra[i + 1] as i32;
            let r = capture.bgra[i + 2] as i32;
            let max = r.max(g).max(b);
            let min = r.min(g).min(b);
            let lum = (r * 30 + g * 59 + b * 11) / 100;

            mask[y * capture.width + x] =
                (r > 120 && g > 105 && b < 150 && r >= g - 25 && r > b + 25 && max - min > 20)
                    || (r > 185 && g > 170 && b > 130 && b < 235)
                    || lum > 220
                    || (lum > 65 && r + 15 >= g && r >= b + 5 && g >= b - 10);
        }
    }
    mask
}

fn bounding_box(mask: &[bool], width: usize, height: usize) -> Option<(usize, usize, usize, usize)> {
    let mut left = width;
    let mut top = height;
    let mut right = 0;
    let mut bottom = 0;

    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] {
                left = left.min(x);
                top = top.min(y);
                right = right.max(x);
                bottom = bottom.max(y);
            }
        }
    }

    (left <= right && top <= bottom).then_some((left, top, right, bottom))
}

fn split_components(
    mask: &[bool],
    width: usize,
    image_height: usize,
    left: usize,
    top: usize,
    right: usize,
    bottom: usize,
) -> Vec<(usize, usize, usize, usize)> {
    let mut columns = Vec::new();
    for x in left..=right {
        let count = (top..=bottom).filter(|&y| mask[y * width + x]).count();
        columns.push((x, count));
    }

    let mut runs = Vec::new();
    let mut start = None;
    let mut last = left;
    let min_column_pixels = 1usize;

    for (x, count) in columns {
        if count >= min_column_pixels.max(1) {
            if start.is_none() {
                start = Some(x);
            }
            last = x;
        } else if let Some(s) = start.take() {
            runs.push((s, last));
        }
    }
    if let Some(s) = start {
        runs.push((s, last));
    }

    let mut merged: Vec<(usize, usize)> = Vec::new();
    for run in runs {
        if let Some(prev) = merged.last_mut() {
            let gap = run.0.saturating_sub(prev.1);
            let prev_width = prev.1.saturating_sub(prev.0) + 1;
            let run_width = run.1.saturating_sub(run.0) + 1;
            if gap <= 1 || (gap <= 5 && (prev_width <= 5 || run_width <= 5)) {
                prev.1 = run.1;
                continue;
            }
        }
        merged.push(run);
    }

    merged
        .into_iter()
        .filter_map(|(x1, x2)| {
            if x2.saturating_sub(x1) + 1 < 2 {
                return None;
            }
            let mut y1 = bottom;
            let mut y2 = top;
            let mut pixels = 0usize;
            for y in top..=bottom {
                for x in x1..=x2 {
                    if mask[y * width + x] {
                        y1 = y1.min(y);
                        y2 = y2.max(y);
                        pixels += 1;
                    }
                }
            }

            let component_w = x2.saturating_sub(x1) + 1;
            let component_h = y2.saturating_sub(y1) + 1;
            let is_hyphen = component_h <= 3 && component_w >= 2 && pixels >= 4;
            let is_icon_like =
                component_h as f64 > image_height as f64 * 0.75 && component_w as f64 > component_h as f64 * 0.45;
            if is_icon_like
                || (!is_hyphen && (pixels < MIN_FOREGROUND_PIXELS || component_h < 5 || component_w > component_h * 3))
            {
                return None;
            }

            Some((x1, y1, x2, y2))
        })
        .collect()
}

fn normalize_glyph(mask: &[bool], width: usize, x1: usize, y1: usize, x2: usize, y2: usize) -> [[bool; 5]; 7] {
    let mut out = [[false; 5]; 7];
    let source_w = x2.saturating_sub(x1) + 1;
    let source_h = y2.saturating_sub(y1) + 1;

    for gy in 0..7 {
        for gx in 0..5 {
            let sx_start = x1 + gx * source_w / 5;
            let sx_end = x1 + ((gx + 1) * source_w / 5).saturating_sub(1).min(source_w - 1);
            let sy_start = y1 + gy * source_h / 7;
            let sy_end = y1 + ((gy + 1) * source_h / 7).saturating_sub(1).min(source_h - 1);
            let mut filled = 0usize;
            let mut total = 0usize;
            for sy in sy_start..=sy_end {
                for sx in sx_start..=sx_end {
                    total += 1;
                    if mask[sy * width + sx] {
                        filled += 1;
                    }
                }
            }
            out[gy][gx] = filled * 3 >= total;
        }
    }

    out
}

fn recognize_glyph(glyph: &[[bool; 5]; 7], source_w: usize, source_h: usize) -> Option<char> {
    if source_h <= 3 && source_w >= 2 {
        return Some('-');
    }
    if source_w >= source_h * 2 {
        return Some('-');
    }
    if source_w * 100 < source_h * 60 {
        return Some('1');
    }

    let mut best = None;
    let mut best_score = usize::MAX;
    for (ch, template) in templates() {
        let score = glyph_distance(glyph, &template);
        if score < best_score {
            best = Some(ch);
            best_score = score;
        }
    }

    if best_score > 15 {
        return None;
    }
    best
}

fn recognize_digit_glyph(glyph: &[[bool; 5]; 7]) -> Option<char> {
    let mut best = None;
    let mut best_score = usize::MAX;
    for (ch, template) in templates() {
        if ch == '-' {
            continue;
        }
        let score = glyph_distance(glyph, &template);
        if score < best_score {
            best = Some(ch);
            best_score = score;
        }
    }

    (best_score <= 18).then_some(best?).filter(|ch| ch.is_ascii_digit())
}

fn recognize_round_components(
    mask: &[bool],
    width: usize,
    height: usize,
    components: &[(usize, usize, usize, usize)],
) -> Option<String> {
    let text_mid_y = height as f64 * 0.55;
    let mut candidates = Vec::new();
    for (hyphen_index, &(hx1, hy1, hx2, hy2)) in components.iter().enumerate() {
        let hyphen_w = hx2.saturating_sub(hx1) + 1;
        let hyphen_h = hy2.saturating_sub(hy1) + 1;
        let hyphen_mid_y = (hy1 + hy2) as f64 / 2.0;
        let looks_like_hyphen = hyphen_h <= (height / 6).max(3)
            && hyphen_w >= 3
            && hyphen_w <= (width / 12).max(8)
            && hyphen_mid_y > height as f64 * 0.25
            && hyphen_mid_y < height as f64 * 0.8;
        if !looks_like_hyphen {
            continue;
        }

        let Some(left) = components[..hyphen_index].iter().rev().find(|&&(x1, y1, x2, y2)| {
            let w = x2.saturating_sub(x1) + 1;
            let h = y2.saturating_sub(y1) + 1;
            let mid_y = (y1 + y2) as f64 / 2.0;
            h >= 5
                && w >= 2
                && w < h * 2
                && x2 < hx1
                && hx1.saturating_sub(x2) <= width / 8
                && (mid_y - text_mid_y).abs() < height as f64 * 0.45
        }) else {
            continue;
        };
        let Some(right) = components[hyphen_index + 1..].iter().find(|&&(x1, y1, x2, y2)| {
            let w = x2.saturating_sub(x1) + 1;
            let h = y2.saturating_sub(y1) + 1;
            let mid_y = (y1 + y2) as f64 / 2.0;
            h >= 5
                && w >= 2
                && w < h * 2
                && x1 > hx2
                && x1.saturating_sub(hx2) <= width / 8
                && (mid_y - text_mid_y).abs() < height as f64 * 0.45
        }) else {
            continue;
        };

        let left_glyph = normalize_glyph(mask, width, left.0, left.1, left.2, left.3);
        let right_glyph = normalize_glyph(mask, width, right.0, right.1, right.2, right.3);
        let Some(stage) = recognize_digit_glyph(&left_glyph).and_then(|ch| ch.to_digit(10)) else {
            continue;
        };
        let Some(round) = recognize_digit_glyph(&right_glyph).and_then(|ch| ch.to_digit(10)) else {
            continue;
        };
        if round_sequence_index((stage, round)).is_some() {
            candidates.push((hyphen_mid_y, format!("{stage}-{round}")));
        }
    }
    candidates
        .into_iter()
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, round)| round)
}

fn glyph_distance(a: &[[bool; 5]; 7], b: &[[bool; 5]; 7]) -> usize {
    let mut score = 0;
    for y in 0..7 {
        for x in 0..5 {
            if a[y][x] != b[y][x] {
                score += if b[y][x] { 2 } else { 1 };
            }
        }
    }
    score
}

fn normalize_round_text(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().filter(|c| c.is_ascii_digit() || *c == '-').collect();
    for i in 0..chars.len().saturating_sub(2) {
        if chars[i].is_ascii_digit() && chars[i + 1] == '-' && chars[i + 2].is_ascii_digit() {
            let stage = chars[i].to_digit(10)?;
            let mut round_text = chars[i + 2].to_string();
            if chars.get(i + 3).is_some_and(|c| c.is_ascii_digit()) {
                round_text.push(chars[i + 3]);
            }
            let round = round_text.parse::<u32>().ok()?;
            if round_sequence_index((stage, round)).is_some() {
                return Some(format!("{}-{}", chars[i], round_text));
            }
        }
    }
    None
}

fn template(rows: [&str; 7]) -> [[bool; 5]; 7] {
    let mut out = [[false; 5]; 7];
    for (y, row) in rows.iter().enumerate() {
        for (x, ch) in row.chars().enumerate().take(5) {
            out[y][x] = ch == '#';
        }
    }
    out
}

fn templates() -> Vec<(char, [[bool; 5]; 7])> {
    vec![
        (
            '0',
            template(["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"]),
        ),
        (
            '1',
            template(["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."]),
        ),
        (
            '2',
            template(["#####", "##.##", "##.##", "...#.", "..##.", ".##..", ".####"]),
        ),
        (
            '2',
            template([".###.", "#....", "#..##", "...#.", "..#..", "..#..", ".####"]),
        ),
        (
            '2',
            template([".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
        ),
        (
            '2',
            template([".###.", "....#", "....#", "...#.", "..#..", ".#...", "#####"]),
        ),
        (
            '3',
            template([".####", "...#.", "..#..", ".####", "...##", "#..##", "####."]),
        ),
        (
            '3',
            template([".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."]),
        ),
        (
            '3',
            template(["#####", "..##.", "..#..", "#####", "....#", "....#", "####."]),
        ),
        (
            '3',
            template(["####.", "...#.", ".##..", "...#.", "...##", "....#", "####."]),
        ),
        (
            '3',
            template([".####", "...#.", ".....", "...##", ".....", "....#", "####."]),
        ),
        (
            '3',
            template(["...##", "...#.", "..#..", ".###.", "....#", "....#", "##.##"]),
        ),
        (
            '3',
            template(["....#", "...#.", "..#..", "....#", "....#", "#....", "#.#.."]),
        ),
        (
            '4',
            template(["#...#", "#...#", "#...#", "#####", "....#", "....#", "....#"]),
        ),
        (
            '4',
            template(["...#.", ".####", ".#.##", "...##", "#####", ".####", "...##"]),
        ),
        (
            '5',
            template(["#####", "#....", "#....", "#####", "....#", "....#", "#####"]),
        ),
        (
            '5',
            template(["#####", "#....", "####.", "....#", "....#", "#...#", ".###."]),
        ),
        (
            '5',
            template([".###.", "#...#", "#...#", "....#", "...#.", "..##.", ".####"]),
        ),
        (
            '6',
            template(["#####", "#....", "#....", "#####", "#...#", "#...#", "#####"]),
        ),
        (
            '6',
            template([".###.", "#....", "####.", "#...#", "#...#", "#...#", ".###."]),
        ),
        (
            '6',
            template(["...#.", "..#..", ".#...", ".#.##", "##..#", ".#..#", ".####"]),
        ),
        (
            '7',
            template(["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."]),
        ),
        (
            '7',
            template(["#####", "....#", "...#.", "..#..", ".#...", ".#...", "#...."]),
        ),
        (
            '8',
            template(["#####", "#...#", "#...#", "#####", "#...#", "#...#", "#####"]),
        ),
        (
            '8',
            template([".###.", "#..##", "#..##", ".###.", "##.##", "##.##", "####."]),
        ),
        (
            '0',
            template(["..##.", ".#..#", ".#..#", ".#..#", "##..#", ".#..#", "..##."]),
        ),
        (
            '9',
            template(["#####", "#...#", "#...#", "#####", "....#", "....#", "#####"]),
        ),
        (
            '-',
            template([".....", ".....", ".....", ".###.", ".....", ".....", "....."]),
        ),
    ]
}
