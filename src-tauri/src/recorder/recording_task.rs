use std::{fmt::Display, path::PathBuf, time::Duration};

use anyhow::{bail, Result};
use libobs_recorder::settings::{RateControl, RecorderSettings, Resolution, StdResolution, Window};
use libobs_recorder::Recorder;
use shaco::ingame::IngameClient;
use tauri::async_runtime::{self, JoinHandle};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tokio::time::{interval, sleep};
use tokio_util::sync::CancellationToken;

use riot_datatypes::MatchId;

use crate::app::{action, AppEvent, EventManager, RecordingManager, RecordingStatus, SystemTrayManager};
use crate::cancellable;
use crate::recorder::Deferred;
use crate::state::{CurrentlyRecording, RecordingPhase, SettingsWrapper};

use super::window;
use super::MetadataFile;

#[derive(Clone)]
pub struct GameCtx {
    pub app_handle: AppHandle,
    pub match_id: MatchId,
    pub cancel_token: CancellationToken,
    pub is_tft: bool,
}

#[derive(Debug)]
pub struct Metadata {
    pub match_id: MatchId,
    pub output_filepath: PathBuf,
    pub ingame_time_rec_start_offset: f64,
}

impl Display for Metadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_fmt(format_args!(
            "match_id={}, filepath={}, rec_offset={}",
            self.match_id,
            self.output_filepath.display(),
            self.ingame_time_rec_start_offset
        ))
    }
}

static RECORDING_HELPER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct CaptureLease {
    app: AppHandle,
    _guard: tokio::sync::MutexGuard<'static, ()>,
}

impl Drop for CaptureLease {
    fn drop(&mut self) {
        RecordingTask::publish_phase(&self.app, RecordingPhase::Idle);
    }
}

struct ActiveCapture {
    recorder: Recorder,
    metadata: Metadata,
    lease: CaptureLease,
}

pub struct RecordingTask {
    join_handle: JoinHandle<Result<ActiveCapture>>,
    pub ctx: GameCtx,
}

impl RecordingTask {
    pub fn new(ctx: GameCtx) -> Self {
        let join_handle = async_runtime::spawn(Self::record(ctx.clone(), false));
        Self { join_handle, ctx }
    }

    pub fn new_manual(ctx: GameCtx) -> Self {
        let join_handle = async_runtime::spawn(Self::record(ctx.clone(), true));
        Self { join_handle, ctx }
    }

    pub(super) fn finished_without_recording(&self) -> bool {
        self.join_handle.inner().is_finished() && self.ctx.app_handle.state::<CurrentlyRecording>().get().is_none()
    }

    pub async fn stop(self) -> Result<Metadata> {
        log::debug!("recording_task::stop called");
        self.ctx.cancel_token.cancel();
        let result = self
            .join_handle
            .await
            .map_err(anyhow::Error::from)
            .and_then(|result| result);

        match result {
            Ok(ActiveCapture { mut recorder, metadata, lease }) => {
                let ctx = self.ctx;
                Self::publish_phase(
                    &ctx.app_handle,
                    RecordingPhase::Stopping(metadata.output_filepath.clone()),
                );

                // Release the game's capture source before the listener can start another helper.
                let output = metadata.output_filepath.clone();
                let shutdown_result = async_runtime::spawn_blocking(move || {
                    let stopped = recorder.stop_recording();
                    let shutdown = recorder.shutdown();
                    log::info!("stopping recording: stopped={stopped:?}, shutdown={shutdown:?}");
                    let result = match (stopped, shutdown) {
                        (Ok(()), Ok(())) => Ok(()),
                        (Ok(()), Err(error)) if has_finalized_mp4(&output) => {
                            log::warn!("Recording was finalized; helper cleanup failed: {error}");
                            Ok(())
                        }
                        (stopped, shutdown) => Err(anyhow::anyhow!("Recorder stop: {stopped:?}; shutdown: {shutdown:?}")),
                    };
                    drop(lease);
                    result
                })
                .await;
                shutdown_result??;

                async_runtime::spawn_blocking(move || {
                    ctx.app_handle.cleanup_recordings();

                    if let Err(e) = ctx.app_handle.send_event(AppEvent::RecordingsChanged { payload: () }) {
                        log::error!("RecordingTask failed to send event: {e}");
                    }
                });

                Ok(metadata)
            }
            Err(e) => {
                log::warn!("recording task failed/cancelled: {e}");
                Err(e)
            }
        }
    }

    fn publish_phase(app: &AppHandle, phase: RecordingPhase) {
        let status = match &phase {
            RecordingPhase::Idle => RecordingStatus::Idle,
            RecordingPhase::Preparing(_) => RecordingStatus::Preparing,
            RecordingPhase::Recording(_) => RecordingStatus::Recording,
            RecordingPhase::Stopping(_) => RecordingStatus::Stopping,
        };
        app.state::<CurrentlyRecording>().set(phase);
        if let Err(error) = app.send_event(AppEvent::RecordingPhaseChanged { payload: status }) {
            log::warn!("Could not notify WebView of recording state: {error}");
        }
        app.refresh_recording_tray();
    }

    async fn record(ctx: GameCtx, manual_mode: bool) -> Result<ActiveCapture> {
        let lease = cancellable!(async { Some(RECORDING_HELPER.lock().await) }, ctx.cancel_token, Option)
            .ok_or_else(|| anyhow::anyhow!("recording cancelled before helper start"))?;
        let lease = CaptureLease {
            app: ctx.app_handle.clone(),
            _guard: lease,
        };
        Self::publish_phase(&ctx.app_handle, RecordingPhase::Preparing(None));
        let mode_label = if manual_mode { "manual" } else { "auto" };
        let setup_started = std::time::Instant::now();
        let (mut recorder, output_filepath) =
            cancellable!(Self::setup_recorder(&ctx, manual_mode), ctx.cancel_token, Result)?;
        log::info!(
            "[record-start][{mode_label}] setup_recorder completed in {:.3}s",
            setup_started.elapsed().as_secs_f64()
        );

        // Game Mode check removed: Trusting GameListener's decision.
        // The GameListener already validated the QueueID/GameMode before starting this task.
        // Double-checking here caused issues due to string naming inconsistencies (e.g. PRACTICETOOL vs PRACTICE_TOOL).

        if !manual_mode {
            // ingame_client timeout is 200ms, so no need to make cancellable with token
            let ingame_client = IngameClient::new();

            log::info!("waiting for game to start");
            let mut timer = interval(Duration::from_millis(500));
            while !ingame_client.active_game().await {
                let cancelled = cancellable!(timer.tick(), ctx.cancel_token, ());
                if cancelled {
                    let shutdown = recorder.shutdown();
                    bail!("waiting for game cancelled - recorder shutdown: {shutdown:?}");
                }
            }
        } else {
            log::info!("manual recording mode: skipping in-game active check");
        }

        // Fetch game stats BEFORE starting recording to get a baseline for fallback.
        // This is also needed for manual mode so timeline starts from actual game time.
        let ingame_client = IngameClient::new();
        let pre_start_stats = ingame_client.game_stats().await.ok();
        let pre_start_instant = std::time::Instant::now();

        // if initial game_data is successful => start recording
        if ctx.cancel_token.is_cancelled() {
            let _ = recorder.shutdown();
            bail!("recording cancelled before capture started");
        }
        ctx.app_handle
            .state::<CurrentlyRecording>()
            .set(RecordingPhase::Preparing(Some(output_filepath.clone())));
        let obs_start = std::time::Instant::now();
        if let Err(e) = recorder.start_recording() {
            let _ = recorder.stop_recording();
            let _ = recorder.shutdown();
            bail!("failed to start recording: {e}");
        }
        log::info!(
            "[record-start][{mode_label}] recorder.start_recording completed in {:.3}s",
            obs_start.elapsed().as_secs_f64()
        );
        Self::publish_phase(&ctx.app_handle, RecordingPhase::Recording(output_filepath.clone()));

        // Emit RecordingStarted event immediately (UI feedback) - syncing happens below
        if manual_mode {
            if let Err(e) = ctx.app_handle.send_event(AppEvent::ManualRecordingStarted) {
                log::error!("failed to emit ManualRecordingStarted event: {e}");
            }
        }
        if let Err(e) = ctx.app_handle.send_event(AppEvent::RecordingStarted) {
            log::error!("failed to emit RecordingStarted event: {e}");
        }

        log::info!("Recorder started. Calculating sync offset...");

        // Calculate offset immediately after start_recording returns.
        // For manual mode, this ensures timeline starts from current in-game time (e.g. 00:27).
        let ingame_client = IngameClient::new();
        let final_stats = ingame_client.game_stats().await.ok();

        // Robust offset calculation with fallback
        let ingame_time_rec_start_offset = if let Some(stats) = final_stats {
            stats.game_time
        } else {
            // Fallback: Use pre-start stats + total elapsed time since then
            let total_elapsed = pre_start_instant.elapsed().as_secs_f64();
            log::warn!(
                "Failed to fetch final game stats. Using fallback estimate (elapsed: {:.3}s)",
                total_elapsed
            );
            pre_start_stats.map(|s| s.game_time + total_elapsed).unwrap_or(0.0)
        };

        log::info!(
            "Recording setup complete. Final Offset: {:.3}",
            ingame_time_rec_start_offset
        );

        let metadata_file = MetadataFile::Deferred(Deferred {
            favorite: false,
            match_id: ctx.match_id.clone(),
            ingame_time_rec_start_offset,
            highlights: vec![],
            tft_round_markers: vec![],
            events: vec![],
            participants: vec![],
        });
        if let Err(e) = action::save_recording_metadata(&output_filepath, &metadata_file) {
            log::info!("failed to save MetadataFile: {e}")
        }

        let live_tft_round_ocr_enabled = false;
        if live_tft_round_ocr_enabled {
            log::info!(
                "TFT round live OCR enabled for this recording; initial_tft_hint={}",
                ctx.is_tft
            );
            super::tft_round_ocr::run_obs_loop(
                &mut recorder,
                ctx.app_handle.clone(),
                output_filepath.with_extension("json"),
                ingame_time_rec_start_offset * 1000.0,
                ctx.cancel_token.child_token(),
            )
            .await?;
        }

        let metadata = Metadata {
            match_id: ctx.match_id,
            output_filepath,
            ingame_time_rec_start_offset,
        };

        Ok(ActiveCapture { recorder, metadata, lease })
    }

    async fn setup_recorder(ctx: &GameCtx, manual_mode: bool) -> Result<(Recorder, PathBuf)> {
        let settings_state = ctx.app_handle.state::<SettingsWrapper>();

        let window_size = if manual_mode {
            // Safety first: avoid starting with a guessed resolution.
            // A guessed fallback can produce black-video/audio-only recordings on some systems.
            Self::get_window_size(20, Duration::from_millis(200)).await?
        } else {
            Self::get_window_size(60, Duration::from_millis(500)).await?
        };
        let output_resolution = settings_state
            .get_output_resolution()
            .unwrap_or_else(|| StdResolution::closest_std_resolution(&window_size));

        log::info!("Using resolution ({output_resolution:?}) for window ({window_size:?})");

        let mut filename = settings_state.get_filename_format();
        if !filename.ends_with(".mp4") {
            filename.push_str(".mp4");
        }
        let formatted_filename = format!("{}", chrono::Local::now().format(&filename))
            .replace(":", "-")
            .replace("/", "-")
            .replace("\\", "-");

        let filename_path = settings_state.get_recordings_path().join(formatted_filename);

        let (capture_title, capture_class, capture_process) = window::get_lol_window_capture_target();
        let mut settings = RecorderSettings::new(
            Window::new(capture_title, Some(capture_class), Some(capture_process)),
            window_size,
            output_resolution,
            &filename_path,
        );
        settings.set_framerate(settings_state.get_framerate());
        settings.set_rate_control(RateControl::CQP(settings_state.get_encoding_quality()));
        settings.set_audio_source(settings_state.get_audio_source());
        settings.set_application_audio_tracks(settings_state.get_application_audio_tracks());

        let mut recorder = Recorder::new_with_paths(
            ctx.app_handle
                .path()
                .resolve("libobs/extprocess_recorder.exe", BaseDirectory::Executable)
                .ok(),
            None,
            None,
            None,
        )?;

        log::info!("recorder settings: {settings:?}");
        recorder.configure(&settings)?;
        log::info!("recorder configured");

        log::info!("Selected adapter: {:?}", recorder.adapter_info());
        log::info!("Available encoders for adapter: {:?}", recorder.available_encoders());
        log::info!("Selected encoder: {:?}", recorder.selected_encoder());

        Ok((recorder, filename_path))
    }

    async fn get_window_size(max_attempts: usize, interval_duration: Duration) -> Result<Resolution> {
        for _ in 0..max_attempts {
            if let Some(window_size) = window::get_lol_window().and_then(window::get_window_size) {
                return Ok(window_size);
            }

            sleep(interval_duration).await;
        }

        bail!("unable to get window size");
    }
}

// A normal MP4 recording has both a complete media-data box and a movie index.
fn has_finalized_mp4(path: &std::path::Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};

    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let Ok(info) = file.metadata() else { return false };
    let len = info.len();
    let mut offset = 0u64;
    let (mut media, mut index) = (false, false);
    while len.saturating_sub(offset) >= 8 {
        let mut header = [0u8; 8];
        if file.seek(SeekFrom::Start(offset)).and_then(|_| file.read_exact(&mut header)).is_err() {
            return false;
        }
        let (size, header_size) = match u32::from_be_bytes(header[..4].try_into().unwrap()) {
            0 => (len - offset, 8),
            1 => {
                let mut extended = [0u8; 8];
                if file.read_exact(&mut extended).is_err() { return false; }
                (u64::from_be_bytes(extended), 16)
            }
            size => (u64::from(size), 8),
        };
        if size < header_size || size > len - offset { return false; }
        media |= &header[4..] == b"mdat" && size > header_size;
        index |= &header[4..] == b"moov" && size > header_size;
        offset += size;
    }
    offset == len && media && index
}

#[cfg(test)]
mod tests {
    use super::RECORDING_HELPER;

    #[test]
    fn completed_mp4_requires_media_and_a_complete_movie_index() {
        let path = std::env::temp_dir().join(format!("leaguerecord-mp4-box-test-{}.mp4", std::process::id()));
        let media = b"\x00\x00\x00\x09mdatX";
        let index = b"\x00\x00\x00\x09moovY";
        std::fs::write(&path, media).unwrap();
        assert!(!super::has_finalized_mp4(&path));
        std::fs::write(&path, [media.as_slice(), &index[..8]].concat()).unwrap();
        assert!(!super::has_finalized_mp4(&path));
        std::fs::write(&path, [media.as_slice(), index.as_slice()].concat()).unwrap();
        assert!(super::has_finalized_mp4(&path));
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn next_capture_waits_for_manual_shutdown_and_failed_start_can_retry() {
        let manual = RECORDING_HELPER.lock().await;
        let mut automatic = std::pin::pin!(RECORDING_HELPER.lock());
        assert!(futures_util::poll!(automatic.as_mut()).is_pending());

        drop(manual);
        let failed_start = automatic.await;
        assert!(RECORDING_HELPER.try_lock().is_err());
        drop(failed_start);

        assert!(RECORDING_HELPER.try_lock().is_ok());
    }
}
