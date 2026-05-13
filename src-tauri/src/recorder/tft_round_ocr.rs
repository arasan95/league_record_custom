use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use shaco::ingame::IngameClient;
use tauri::{async_runtime, AppHandle, Manager};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use windows_sys::Win32::Foundation::{HWND, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, RGBQUAD, SRCCOPY,
};

use crate::app::{action, AppEvent, EventManager};
use crate::recorder::{MetadataFile, TftRoundMarker};
use crate::state::{SettingsWrapper, TftRoundOcrRegion};

use super::window;

const MIN_FOREGROUND_PIXELS: usize = 8;
const OFFLINE_SAMPLE_SECONDS: f64 = 2.0;
const OFFLINE_CROP_WIDTH: usize = 520;
const OFFLINE_CROP_HEIGHT: usize = 38;

struct WindowDc {
    hwnd: HWND,
    hdc: HDC,
}

impl WindowDc {
    fn new(hwnd: HWND) -> Result<Self> {
        let hdc = unsafe { windows_sys::Win32::Graphics::Gdi::GetDC(hwnd) };
        if hdc.is_null() {
            bail!("GetDC failed");
        }
        Ok(Self { hwnd, hdc })
    }
}

impl Drop for WindowDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(self.hwnd, self.hdc);
        }
    }
}

struct MemoryDc {
    hdc: HDC,
}

impl MemoryDc {
    fn new(source: HDC) -> Result<Self> {
        let hdc = unsafe { CreateCompatibleDC(source) };
        if hdc.is_null() {
            bail!("CreateCompatibleDC failed");
        }
        Ok(Self { hdc })
    }
}

impl Drop for MemoryDc {
    fn drop(&mut self) {
        unsafe {
            DeleteDC(self.hdc);
        }
    }
}

struct Bitmap {
    handle: HBITMAP,
}

impl Bitmap {
    fn new(hdc: HDC, width: i32, height: i32) -> Result<Self> {
        let handle = unsafe { CreateCompatibleBitmap(hdc, width, height) };
        if handle.is_null() {
            bail!("CreateCompatibleBitmap failed");
        }
        Ok(Self { handle })
    }
}

impl Drop for Bitmap {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.handle as HGDIOBJ);
        }
    }
}

struct SelectedObject {
    hdc: HDC,
    previous: HGDIOBJ,
}

impl SelectedObject {
    fn new(hdc: HDC, object: HGDIOBJ) -> Result<Self> {
        let previous = unsafe { SelectObject(hdc, object) };
        if previous.is_null() {
            bail!("SelectObject failed");
        }
        Ok(Self { hdc, previous })
    }
}

impl Drop for SelectedObject {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.hdc, self.previous);
        }
    }
}

#[derive(Clone)]
struct Capture {
    width: usize,
    height: usize,
    bgra: Vec<u8>,
}

pub fn spawn(app_handle: AppHandle, metadata_path: PathBuf, cancel_token: CancellationToken) {
    async_runtime::spawn(async move {
        if let Err(e) = run_loop(app_handle, metadata_path, cancel_token).await {
            log::debug!("TFT round OCR stopped: {e}");
        }
    });
}

async fn run_loop(app_handle: AppHandle, metadata_path: PathBuf, cancel_token: CancellationToken) -> Result<()> {
    let mut last_round: Option<String> = None;
    let mut stable_round: Option<String> = None;
    let mut stable_count = 0u8;

    loop {
        if cancel_token.is_cancelled() {
            return Ok(());
        }

        let (region, interval_seconds) = {
            let settings_state = app_handle.state::<SettingsWrapper>();
            let settings_wrapper: &SettingsWrapper = &settings_state;
            let settings = settings_wrapper.inner();
            (
                settings.tft_round_ocr_region,
                settings.tft_round_ocr_interval_seconds.clamp(0.5, 10.0),
            )
        };

        match capture_round_region(&region).and_then(|capture| recognize_round(&capture)) {
            Ok(Some(round)) => {
                if stable_round.as_deref() == Some(round.as_str()) {
                    stable_count = stable_count.saturating_add(1);
                } else {
                    stable_round = Some(round.clone());
                    stable_count = 1;
                }

                if stable_count >= 1 && last_round.as_deref() != Some(round.as_str()) {
                    match append_round_marker(&metadata_path, round.clone()).await {
                        Ok(true) => {
                            last_round = Some(round.clone());
                            if let Some(video_id) =
                                metadata_path.file_stem().and_then(|s| s.to_str()).map(str::to_owned)
                            {
                                let _ = app_handle.send_event(AppEvent::MetadataChanged { payload: vec![video_id] });
                            }
                            log::info!("TFT round marker recorded: {round}");
                        }
                        Ok(false) => {
                            last_round = Some(round);
                        }
                        Err(e) => log::debug!("failed to append TFT round marker: {e}"),
                    }
                }
            }
            Ok(None) => {
                stable_round = None;
                stable_count = 0;
            }
            Err(e) => log::debug!("TFT round OCR sample failed: {e}"),
        }

        sleep(Duration::from_secs_f64(interval_seconds)).await;
    }
}

async fn append_round_marker(path: &PathBuf, round: String) -> Result<bool> {
    let timestamp = IngameClient::new()
        .game_stats()
        .await
        .map(|stats| stats.game_time * 1000.0)
        .context("failed to read in-game time")?;

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
    async_runtime::spawn_blocking(move || backfill_from_recording_blocking(app_handle, video_path, metadata_path))
        .await?
}

fn backfill_from_recording_blocking(
    app_handle: AppHandle,
    video_path: PathBuf,
    metadata_path: PathBuf,
) -> Result<usize> {
    if !video_path.is_file() {
        bail!("video file not found: {}", video_path.display());
    }

    let mut metadata = action::get_recording_metadata(&metadata_path, false)?;
    let (offset_ms, existing_markers) = match &metadata {
        MetadataFile::Metadata(m) => (m.ingame_time_rec_start_offset * 1000.0, m.tft_round_markers.clone()),
        MetadataFile::Deferred(d) => (d.ingame_time_rec_start_offset * 1000.0, d.tft_round_markers.clone()),
        MetadataFile::NoData(_) => return Ok(0),
    };

    let settings_state = app_handle.state::<SettingsWrapper>();
    let settings_wrapper: &SettingsWrapper = &settings_state;
    let ffmpeg_cmd = settings_wrapper
        .ffmpeg_path()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string());
    let region = settings_wrapper.inner().tft_round_ocr_region;
    let filter = format!(
        "fps=1/{OFFLINE_SAMPLE_SECONDS},crop=iw*{w}:ih*{h}:iw*{x}:ih*{y},scale={OFFLINE_CROP_WIDTH}:{OFFLINE_CROP_HEIGHT}:flags=neighbor,format=rgb24",
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
        .arg(&video_path)
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
    if frame_size == 0 {
        return Ok(0);
    }

    let mut scanned_markers = Vec::new();
    let mut last_round: Option<String> = None;
    let mut last_key = (0u32, 0u32);
    for (frame_index, frame) in output.stdout.chunks_exact(frame_size).enumerate() {
        let capture = capture_from_rgb_frame(OFFLINE_CROP_WIDTH, OFFLINE_CROP_HEIGHT, frame);
        let Some(round) = recognize_round(&capture)? else {
            continue;
        };
        if last_round.as_deref() == Some(round.as_str()) {
            continue;
        }
        let Some(key) = round_key(&round) else {
            continue;
        };
        if key < last_key {
            continue;
        }

        let timestamp = offset_ms + frame_index as f64 * OFFLINE_SAMPLE_SECONDS * 1000.0;
        scanned_markers.push(TftRoundMarker {
            round: round.clone(),
            timestamp,
        });
        last_round = Some(round);
        last_key = key;
    }

    let appended = match &mut metadata {
        MetadataFile::Metadata(m) => {
            m.tft_round_markers = merge_markers(existing_markers, scanned_markers);
            m.tft_round_markers.len()
        }
        MetadataFile::Deferred(d) => {
            d.tft_round_markers = merge_markers(existing_markers, scanned_markers);
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
    Some((stage.parse().ok()?, round.parse().ok()?))
}

fn merge_markers(mut existing: Vec<TftRoundMarker>, scanned: Vec<TftRoundMarker>) -> Vec<TftRoundMarker> {
    existing.extend(scanned);
    existing.sort_by(|a, b| {
        a.timestamp
            .partial_cmp(&b.timestamp)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut seen = Vec::<String>::new();
    let mut last_key = (0u32, 0u32);
    let mut merged = Vec::new();
    for marker in existing {
        let Some(key) = round_key(&marker.round) else {
            continue;
        };
        if key < last_key || seen.iter().any(|round| round == &marker.round) {
            continue;
        }
        seen.push(marker.round.clone());
        last_key = key;
        merged.push(marker);
    }
    merged
}

fn append_marker(markers: &mut Vec<TftRoundMarker>, marker: TftRoundMarker) -> bool {
    if markers.last().map(|last| last.round.as_str()) == Some(marker.round.as_str()) {
        return false;
    }
    let Some(next_key) = round_key(&marker.round) else {
        return false;
    };
    if markers
        .last()
        .and_then(|last| round_key(&last.round))
        .is_some_and(|last_key| next_key <= last_key)
    {
        return false;
    }

    markers.push(marker);
    true
}

fn capture_round_region(region: &TftRoundOcrRegion) -> Result<Capture> {
    let hwnd = window::get_lol_window().context("League window not found")?;
    let size = window::get_window_size(hwnd).context("League window size unavailable")?;
    let mut client_origin = POINT { x: 0, y: 0 };
    let converted = unsafe { ClientToScreen(hwnd, &mut client_origin) };
    if converted == 0 {
        bail!("ClientToScreen failed");
    }

    let source_x = (region.x.clamp(0.0, 1.0) * size.width() as f64).round() as i32;
    let source_y = (region.y.clamp(0.0, 1.0) * size.height() as f64).round() as i32;
    let width = (region.width.clamp(0.01, 1.0) * size.width() as f64).round().max(8.0) as i32;
    let height = (region.height.clamp(0.01, 1.0) * size.height() as f64).round().max(8.0) as i32;

    // Capture from the desktop compositor instead of the LoL window DC. DirectX
    // windows can return blank/stale pixels through their own DC, while the
    // desktop DC matches what OBS/window capture sees on screen.
    let desktop_dc = WindowDc::new(std::ptr::null_mut())?;
    let memory_dc = MemoryDc::new(desktop_dc.hdc)?;
    let bitmap = Bitmap::new(desktop_dc.hdc, width, height)?;
    let _selection = SelectedObject::new(memory_dc.hdc, bitmap.handle as HGDIOBJ)?;

    let copied = unsafe {
        BitBlt(
            memory_dc.hdc,
            0,
            0,
            width,
            height,
            desktop_dc.hdc,
            client_origin.x + source_x,
            client_origin.y + source_y,
            SRCCOPY,
        )
    };
    if copied == 0 {
        bail!("BitBlt failed");
    }

    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }],
    };
    let mut bgra = vec![0u8; width as usize * height as usize * 4];
    let rows = unsafe {
        GetDIBits(
            memory_dc.hdc,
            bitmap.handle,
            0,
            height as u32,
            bgra.as_mut_ptr().cast(),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if rows == 0 {
        bail!("GetDIBits failed");
    }

    Ok(Capture {
        width: width as usize,
        height: height as usize,
        bgra,
    })
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

            mask[y * capture.width + x] = (r > 120
                && g > 105
                && b < 150
                && r >= g - 25
                && r > b + 25
                && max - min > 20)
                || (r > 185 && g > 170 && b > 130 && b < 235)
                || lum > 220;
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
            if run.0.saturating_sub(prev.1) <= 2 {
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
            let is_icon_like = component_h as f64 > image_height as f64 * 0.55;
            if is_icon_like
                || (!is_hyphen
                    && (pixels < MIN_FOREGROUND_PIXELS || component_h < 5 || component_w > component_h * 3))
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
    if source_w * 100 < source_h * 45 {
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

    if best_score > 12 {
        return None;
    }
    best
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
    if (1..=7).contains(&stage) && (1..=10).contains(&round) {
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
            '3',
            template([".####", "...#.", "..#..", ".####", "...##", "#..##", "####."]),
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
            '4',
            template(["#...#", "#...#", "#...#", "#####", "....#", "....#", "....#"]),
        ),
        (
            '5',
            template(["#####", "#....", "#....", "#####", "....#", "....#", "#####"]),
        ),
        (
            '6',
            template(["#####", "#....", "#....", "#####", "#...#", "#...#", "#####"]),
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
