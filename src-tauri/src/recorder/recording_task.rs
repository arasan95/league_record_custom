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

use crate::app::{action, AppEvent, EventManager, RecordingManager, SystemTrayManager};
use crate::cancellable;
use crate::recorder::Deferred;
use crate::state::{CurrentlyRecording, SettingsWrapper};

use super::window::{self, WINDOW_CLASS, WINDOW_PROCESS, WINDOW_TITLE};
use super::MetadataFile;

#[derive(Clone)]
pub struct GameCtx {
    pub app_handle: AppHandle,
    pub match_id: MatchId,
    pub cancel_token: CancellationToken,
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

pub struct RecordingTask {
    join_handle: JoinHandle<Result<(Recorder, Metadata)>>,
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

    pub async fn prewarm(ctx: GameCtx) -> Result<()> {
        let started = std::time::Instant::now();
        let mode_label = "manual-prewarm";
        let (recorder, output_filepath) = Self::setup_recorder(&ctx, true).await?;
        log::info!(
            "[record-start][{mode_label}] setup_recorder completed in {:.3}s",
            started.elapsed().as_secs_f64()
        );

        let shutdown = recorder.shutdown();
        log::info!("[record-start][{mode_label}] recorder.shutdown: {shutdown:?}");

        if output_filepath.exists() {
            if let Err(e) = std::fs::remove_file(&output_filepath) {
                log::warn!(
                    "[record-start][{mode_label}] failed to remove warmup output '{}': {e}",
                    output_filepath.display()
                );
            }
        }

        Ok(())
    }

    pub async fn stop(self) -> Result<Metadata> {
        log::debug!("recording_task::stop called");
        self.ctx.cancel_token.cancel();
        let result = self.join_handle.await?;

        match result {
            Ok((mut recorder, metadata)) => {
                let ctx = self.ctx;
                async_runtime::spawn_blocking(move || {
                    log::debug!("Stopping recorder process...");

                    // Update state immediately to prevent UI hang if shutdown crashes
                    ctx.app_handle.state::<CurrentlyRecording>().set(None);
                    ctx.app_handle.set_tray_menu_recording(false);
                    ctx.app_handle.set_tray_menu_preparing(false);

                    let stopped = recorder.stop_recording();
                    let shutdown = recorder.shutdown();
                    log::info!("stopping recording: stopped={stopped:?}, shutdown={shutdown:?}");

                    ctx.app_handle.cleanup_recordings();

                    if let Err(e) = ctx.app_handle.send_event(AppEvent::RecordingsChanged { payload: () }) {
                        log::error!("RecordingTask failed to send event: {e}");
                    }

                    Ok(metadata)
                })
                .await?
            }
            Err(e) => {
                log::warn!("recording task failed/cancelled: {e}");
                self.ctx.app_handle.state::<CurrentlyRecording>().set(None);
                self.ctx.app_handle.set_tray_menu_recording(false);
                self.ctx.app_handle.set_tray_menu_preparing(false);
                Err(e)
            }
        }
    }

    async fn record(ctx: GameCtx, manual_mode: bool) -> Result<(Recorder, Metadata)> {
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

        ctx.app_handle
            .state::<CurrentlyRecording>()
            .set(Some(output_filepath.clone()));

        // Fetch game stats BEFORE starting recording to get a baseline for fallback.
        // This is also needed for manual mode so timeline starts from actual game time.
        let ingame_client = IngameClient::new();
        let pre_start_stats = ingame_client.game_stats().await.ok();
        let pre_start_instant = std::time::Instant::now();

        // if initial game_data is successful => start recording
        let obs_start = std::time::Instant::now();
        if let Err(e) = recorder.start_recording() {
            ctx.app_handle.state::<CurrentlyRecording>().set(None);
            ctx.app_handle.set_tray_menu_recording(false);
            ctx.app_handle.set_tray_menu_preparing(false);
            let _ = recorder.stop_recording();
            bail!("failed to start recording: {e}");
        }
        log::info!(
            "[record-start][{mode_label}] recorder.start_recording completed in {:.3}s",
            obs_start.elapsed().as_secs_f64()
        );
        ctx.app_handle.set_tray_menu_preparing(false);
        ctx.app_handle.set_tray_menu_recording(true);

        // Emit RecordingStarted event immediately (UI feedback) - syncing happens below
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
            events: vec![],
            participants: vec![],
        });
        if let Err(e) = action::save_recording_metadata(&output_filepath, &metadata_file) {
            log::info!("failed to save MetadataFile: {e}")
        }

        let metadata = Metadata {
            match_id: ctx.match_id,
            output_filepath,
            ingame_time_rec_start_offset,
        };

        Ok((recorder, metadata))
    }

    async fn setup_recorder(ctx: &GameCtx, manual_mode: bool) -> Result<(Recorder, PathBuf)> {
        let settings_state = ctx.app_handle.state::<SettingsWrapper>();

        let window_size = if manual_mode {
            // Manual start should be immediate. Don't block for long window discovery.
            // If the LoL window isn't ready yet, use a sane fallback and continue.
            match Self::get_window_size(2, Duration::from_millis(100)).await {
                Ok(size) => size,
                Err(_) => {
                    log::warn!("Manual mode: LoL window size not ready. Using fallback 1920x1080.");
                    Resolution::new(1920, 1080)
                }
            }
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

        let mut settings = RecorderSettings::new(
            Window::new(WINDOW_TITLE, Some(WINDOW_CLASS.into()), Some(WINDOW_PROCESS.into())),
            window_size,
            output_resolution,
            &filename_path,
        );
        settings.set_framerate(settings_state.get_framerate());
        settings.set_rate_control(RateControl::CQP(settings_state.get_encoding_quality()));
        settings.set_audio_source(settings_state.get_audio_source());

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
