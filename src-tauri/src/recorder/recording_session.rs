use super::game_listener::GameListener;
use std::fmt::Display;

#[derive(Debug, PartialEq, Eq)]
enum StopReason {
    Manual,
    GameEnded,
    LiveGameEnded,
    Disconnected,
}

use anyhow::Result;
use chrono::Utc;
use riot_datatypes::lcu::{GameData, GamePhase, SessionEventData, SubscriptionResponse};
use riot_datatypes::{GameId, MatchId};
use riot_local_auth::Credentials;

use shaco::model::ingame::GameEvent as LiveGameEvent;
use shaco::rest::LcuRestClient;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::async_runtime;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast::Receiver;
use tokio_util::sync::CancellationToken;

use super::highlight_task::HighlightTask;
use super::live_game::{apply_live_data, is_tft_queue_id, normalize_identity_key, run_info_poller};
use super::recording_finalization::finalize_metadata;
use super::recording_task::{GameCtx, RecordingTask};
use super::window;
use crate::app::{action, AppEvent, EventManager};
use crate::recorder::MetadataFile;
use crate::state::{CurrentlyRecording, RecordingPhase, SettingsWrapper};

use super::lp_helper::{fetch_current_lp, RankedLpSnapshot};

#[derive(Clone)]
pub struct ApiCtx {
    pub app_handle: AppHandle,
    pub credentials: Credentials,
    pub platform_id: String,
    pub cancel_token: CancellationToken,
}

impl ApiCtx {
    fn game_ctx(&self, game_id: GameId, is_tft: bool) -> GameCtx {
        GameCtx {
            app_handle: self.app_handle.clone(),
            match_id: MatchId {
                game_id,
                platform_id: self.platform_id.clone(),
            },
            cancel_token: self.cancel_token.child_token(),
            is_tft,
        }
    }
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    Recording(
        RecordingTask,
        HighlightTask,
        JoinHandle<Vec<LiveGameEvent>>,
        Arc<Mutex<Vec<LiveGameEvent>>>,
        Arc<Mutex<HashMap<String, i32>>>,                      // player_map
        Option<RankedLpSnapshot>,                              // start_lp
        Arc<Mutex<Option<shaco::model::ingame::AllGameData>>>, // last_game_data
        HashMap<i64, i32>,                                     // pid_to_cid (ParticipantId -> ChampionId)
    ),
}

impl Display for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            State::Idle => f.write_str("Idle"),
            State::Recording(_, _, _, _, _, _, _, _) => f.write_str("Recording"),
        }
    }
}

pub struct RecordingSession {
    ctx: ApiCtx,
    state: State,
    manual_stop_rx: Receiver<()>,
    manual_start_rx: Receiver<()>,
    last_stopped_game_id: Option<GameId>,
    missing_window_ticks: u8,
    terminal_live_event: Arc<Mutex<Option<String>>>,
    latest_session_game_id: Option<GameId>,
    latest_session_is_tft: bool,
}

impl RecordingSession {
    pub fn new(ctx: ApiCtx, manual_stop_rx: Receiver<()>, manual_start_rx: Receiver<()>) -> Self {
        Self {
            ctx,
            state: State::Idle,
            manual_stop_rx,
            manual_start_rx,
            last_stopped_game_id: None,
            missing_window_ticks: 0,
            terminal_live_event: Arc::new(Mutex::new(None)),
            latest_session_game_id: None,
            latest_session_is_tft: false,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let mut listener = super::game_listener::GameListener::connect(&self.ctx.credentials).await?;
        if let Some(initial) = listener.initial_session(&self.ctx.credentials).await {
            self.handle_gameflow(SubscriptionResponse::Session(initial)).await;
        }

        let mut health_tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                event = listener.next_event() => {
                    let Some(event) = event else { break };
                    self.handle_gameflow(event).await;
                }
                Ok(_) = self.manual_stop_rx.recv() => {
                    self.stop_recording(StopReason::Manual).await;
                }
                Ok(_) = self.manual_start_rx.recv() => {
                    self.clear_failed_capture().await;
                    log::info!("Manual recording requested");
                    // Manual mode must be immediate: do not block on LCU requests here.
                    let should_start = match self.state {
                        State::Idle => true,
                        State::Recording(..) => false,
                    };

                    if should_start {
                        let game_id = self.latest_session_game_id.unwrap_or_else(|| Utc::now().timestamp_millis());
                        let live_events = Arc::new(Mutex::new(Vec::new()));
                        let player_map = Arc::new(Mutex::new(HashMap::new()));
                        let live_events_clone = live_events.clone();
                        let player_map_clone = player_map.clone();
                        let last_game_data = Arc::new(Mutex::new(None));
                        if let Ok(mut terminal) = self.terminal_live_event.lock() {
                            *terminal = None;
                        }
                        let live_task = async_runtime::spawn(run_info_poller(
                            live_events_clone,
                            player_map_clone,
                            last_game_data.clone(),
                            self.terminal_live_event.clone(),
                            self.ctx.app_handle.clone(),
                        ));

                        self.state = State::Recording(
                            RecordingTask::new_manual(self.ctx.game_ctx(game_id, self.latest_session_is_tft)),
                            HighlightTask::new(self.ctx.app_handle.clone()),
                            live_task,
                            live_events,
                            player_map,
                            None,
                            last_game_data,
                            HashMap::new(),
                        );
                        log::info!("recorder state: {}", self.state);
                    } else {
                        log::info!("Manual start ignored: Already recording.");
                    }
                }
                _ = health_tick.tick() => {
                    if self.clear_failed_capture().await {
                        continue;
                    }
                    if let State::Recording(..) = self.state {
                        let terminal_reason = self.terminal_live_event.lock().ok().and_then(|mut terminal| terminal.take());
                        if let Some(reason) = terminal_reason {
                            log::info!("Stopping recording due to terminal live event: {reason}");
                            self.stop_recording(StopReason::LiveGameEnded).await;
                            continue;
                        }

                        // Missing LoL window can happen when the game client drops mid-match.
                        // Keep recording until LCU or Live Client reports the actual game end.
                        let is_actually_recording = matches!(self.ctx.app_handle.state::<CurrentlyRecording>().phase(), RecordingPhase::Recording(_));
                        if !is_actually_recording {
                            self.missing_window_ticks = 0;
                            continue;
                        }

                        if window::get_lol_window().is_none() {
                            self.missing_window_ticks = self.missing_window_ticks.saturating_add(1);
                            if self.missing_window_ticks == 3 {
                                log::warn!(
                                    "LoL window missing for {}s during recording. Keeping recording until LCU/live event reports game end.",
                                    self.missing_window_ticks
                                );
                            }
                        } else {
                            self.missing_window_ticks = 0;
                        }
                    } else {
                        self.missing_window_ticks = 0;
                    }

                }
                _ = self.ctx.cancel_token.cancelled() => break,
            }
        }

        self.stop_recording(StopReason::Disconnected).await;
        Ok(())
    }

    async fn clear_failed_capture(&mut self) -> bool {
        if !matches!(&self.state, State::Recording(task, ..) if task.finished_without_recording()) {
            return false;
        }
        if let State::Recording(recording_task, highlight_task, live_task, ..) = std::mem::take(&mut self.state) {
            live_task.abort();
            let _ = highlight_task.stop().await;
            let _ = recording_task.stop().await;
        }
        true
    }

    async fn handle_gameflow(&mut self, sub_resp: SubscriptionResponse) {
        if let SubscriptionResponse::Session(session) = &sub_resp {
            if session.game_data.game_id > 0 {
                self.latest_session_game_id = Some(session.game_data.game_id);
                self.latest_session_is_tft = is_tft_queue_id(session.game_data.queue.id)
                    || session.game_data.game_mode.as_deref() == Some("TFT");
            }
        }
        let reason = match &sub_resp {
            SubscriptionResponse::EogStatsBlock {} => Some(StopReason::GameEnded),
            SubscriptionResponse::Session(SessionEventData {
                phase:
                    GamePhase::FailedToLaunch
                    | GamePhase::WaitingForStats
                    | GamePhase::PreEndOfGame
                    | GamePhase::EndOfGame
                    | GamePhase::TerminatedInError,
                ..
            }) => Some(StopReason::GameEnded),
            _ => None,
        };
        if let Some(reason) = reason {
            self.stop_recording(reason).await;
            return;
        }
        self.clear_failed_capture().await;
        self.state = match std::mem::take(&mut self.state) {
            // wait for game to record
            State::Idle => match sub_resp {
                SubscriptionResponse::Session(SessionEventData {
                    phase: _phase @ (GamePhase::GameStart | GamePhase::InProgress),
                    game_data: GameData { queue, game_id, game_mode },
                }) if Some(game_id) != self.last_stopped_game_id => {
                    log::info!("LCU Session Event detected. GameID: {}", game_id);
                    log::info!(
                        "Raw GameData: queue_id={}, queue_name='{}', is_ranked={}, game_mode='{:?}'",
                        queue.id,
                        queue.name,
                        queue.is_ranked,
                        game_mode
                    );
                    let is_tft_game = is_tft_queue_id(queue.id) || game_mode.as_deref() == Some("TFT");

                    let settings = self.ctx.app_handle.state::<SettingsWrapper>();

                    // Game Mode check
                    let allowed_modes = settings.game_modes();
                    log::info!("User Allowed Modes (Settings): {:?}", allowed_modes);

                    // Emit GameDetected event regardless of allowed mode
                    if let Err(e) = self.ctx.app_handle.send_event(AppEvent::GameDetected) {
                        log::error!("Failed to emit GameDetected event: {}", e);
                    }

                    let mut is_mode_allowed = true;

                    if let Some(modes) = allowed_modes {
                        // Prioritize QueueID mapping for known queues to ensure consistency
                        let mode_val = match queue.id {
                            420 | 440 => "RANKED".to_string(),
                            400 | 430 => "NORMAL".to_string(), // Removed 480/490 from NORMAL
                            480 | 490 => "SWIFTPLAY".to_string(), // Explicit Swiftplay mapping
                            450 | 100 => "ARAM".to_string(),
                            3140 => "PRACTICE_TOOL".to_string(),
                            1700 => "CHERRY".to_string(),
                            318 | 900 | 1010 | 1900 => "URF".to_string(),
                            830 | 840 | 850 | 890 => "COOP_VS_AI".to_string(),
                            1090 | 1100 | 1130 | 1160 => "TFT".to_string(),
                            0 => "CUSTOM".to_string(),
                            _ => match game_mode.clone() {
                                Some(s) => s,
                                None => "UNKNOWN".to_string(),
                            },
                        };

                        let mode_upper = mode_val.to_uppercase();

                        // Check if allowed directly
                        is_mode_allowed = modes.iter().any(|m| m.to_uppercase() == mode_upper);

                        // Check "OTHER" category
                        if !is_mode_allowed {
                            let standard_modes = [
                                "RANKED",
                                "NORMAL",
                                "ARAM",
                                "URF",
                                "PRACTICE_TOOL",
                                "CHERRY",
                                "COOP_VS_AI",
                                "TFT",
                                "CUSTOM",
                                "SWIFTPLAY",
                            ];
                            let is_standard = standard_modes.contains(&mode_upper.as_str());

                            if !is_standard && modes.iter().any(|m| m == "OTHER") {
                                is_mode_allowed = true;
                                log::info!("Game Mode '{}' allowed via OTHER category.", mode_upper);
                            }
                        }

                        if !is_mode_allowed {
                            log::info!("Game Mode '{}' NOT in allowed list. Skipping recording.", mode_upper);
                        } else {
                            log::info!("Game Mode '{}' ALLOWED. Starting...", mode_upper);
                        }
                    }
                    if is_mode_allowed {
                        // reset last stopped game id if we are starting a new game (different id)
                        if Some(game_id) != self.last_stopped_game_id {
                            self.last_stopped_game_id = None;
                        }
                        let live_events = Arc::new(Mutex::new(Vec::new()));
                        let player_map = Arc::new(Mutex::new(HashMap::new()));
                        let live_events_clone = live_events.clone();
                        let player_map_clone = player_map.clone();
                        let last_game_data = Arc::new(Mutex::new(None));
                        if let Ok(mut terminal) = self.terminal_live_event.lock() {
                            *terminal = None;
                        }

                        // Fetch Session for PID->CID
                        let mut pid_to_cid = HashMap::new();
                        let lcu_rest_client = LcuRestClient::from(&self.ctx.credentials);
                        // We use a raw Value here to avoid dependency on incomplete GameData struct
                        match lcu_rest_client
                            .get::<serde_json::Value>(GameListener::GAMEFLOW_SESSION)
                            .await
                        {
                            Ok(v) => {
                                if let Some(game_data) = v.get("gameData") {
                                    for team_key in &["teamOne", "teamTwo"] {
                                        let team_id = if *team_key == "teamOne" { 100 } else { 200 };
                                        if let Some(team) = game_data.get(team_key).and_then(|t| t.as_array()) {
                                            for p in team {
                                                if let (Some(pid), Some(cid)) = (
                                                    p.get("participantId").and_then(|v| v.as_i64()),
                                                    p.get("championId").and_then(|v| v.as_i64()),
                                                ) {
                                                    pid_to_cid.insert(pid, cid as i32);

                                                    if let Ok(mut map) = player_map.lock() {
                                                        let pid32 = pid as i32;
                                                        map.insert(format!("pid:{pid}"), pid32);

                                                        let summoner_name = p
                                                            .get("summonerName")
                                                            .or_else(|| p.get("gameName"))
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .trim();
                                                        if !summoner_name.is_empty() {
                                                            let summoner_key = normalize_identity_key(summoner_name);
                                                            map.insert(summoner_name.to_string(), pid32);
                                                            map.insert(format!("summoner:{}", summoner_key), pid32);
                                                            map.insert(
                                                                format!("team:{}|summoner:{}", team_id, summoner_key),
                                                                pid32,
                                                            );
                                                        }

                                                        let riot_id_full = p
                                                            .get("riotId")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .trim();
                                                        if !riot_id_full.is_empty() {
                                                            let riot_key = normalize_identity_key(riot_id_full);
                                                            map.insert(format!("riot:{}", riot_key), pid32);
                                                            map.insert(
                                                                format!("team:{}|riot:{}", team_id, riot_key),
                                                                pid32,
                                                            );
                                                        }

                                                        let riot_game_name = p
                                                            .get("riotIdGameName")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .trim();
                                                        let riot_tag_line = p
                                                            .get("riotIdTagLine")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .trim();
                                                        if !riot_game_name.is_empty() && !riot_tag_line.is_empty() {
                                                            let riot_joined =
                                                                format!("{}#{}", riot_game_name, riot_tag_line);
                                                            let riot_key = normalize_identity_key(&riot_joined);
                                                            map.insert(format!("riot:{}", riot_key), pid32);
                                                            map.insert(
                                                                format!("team:{}|riot:{}", team_id, riot_key),
                                                                pid32,
                                                            );
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => log::warn!("Failed to fetch session data for PID->CID: {}", e),
                        }

                        let live_task = async_runtime::spawn(run_info_poller(
                            live_events_clone,
                            player_map_clone,
                            last_game_data.clone(),
                            self.terminal_live_event.clone(),
                            self.ctx.app_handle.clone(),
                        ));

                        // Try to fetch LP
                        let start_lp = fetch_current_lp(&self.ctx.credentials, queue.id).await;
                        if let Some(lp) = &start_lp {
                            log::info!(
                                "Fetched initial LP: queue={}, rank={} {}, lp={}",
                                lp.queue_type,
                                lp.tier,
                                lp.division,
                                lp.league_points
                            );
                        }

                        State::Recording(
                            RecordingTask::new(self.ctx.game_ctx(game_id, is_tft_game)),
                            HighlightTask::new(self.ctx.app_handle.clone()),
                            live_task,
                            live_events,
                            player_map,
                            start_lp,
                            last_game_data,
                            pid_to_cid,
                        )
                    } else {
                        // Game mode is not recorded, but we still need to fire GameStarted
                        // so that Auto Stop works regardless of recording mode.
                        let app_handle_clone = self.ctx.app_handle.clone();
                        async_runtime::spawn(async move {
                            let client = shaco::ingame::IngameClient::new();
                            loop {
                                tokio::time::sleep(Duration::from_secs(1)).await;
                                if client.all_game_data(None).await.is_ok() {
                                    log::info!(
                                        "In-game API responded (non-recorded mode). Emitting GameStarted for Auto Stop."
                                    );
                                    if let Err(e) = app_handle_clone.send_event(AppEvent::GameStarted) {
                                        log::error!("Failed to emit GameStarted (non-recorded): {}", e);
                                    }
                                    break; // fire once and exit
                                }
                            }
                        });
                        State::Idle
                    }
                }
                SubscriptionResponse::Session(SessionEventData {
                    phase: GamePhase::ReadyCheck, ..
                }) => {
                    // Auto-accept feature is intentionally disabled.
                    State::Idle
                }
                _ => State::Idle,
            },

            active => active,
        };
    }

    async fn stop_recording(&mut self, reason: StopReason) {
        let State::Recording(
            recording_task,
            highlight_task,
            live_task,
            live_events_arc,
            player_map,
            start_lp,
            last_game_data_arc,
            pid_to_cid,
        ) = std::mem::take(&mut self.state)
        else {
            return;
        };
        let is_manual_stop = reason == StopReason::Manual;

        log::info!("Stopping recording: {reason:?}");
        // Capture game_id before consuming recording_task
        let stopped_game_id = recording_task.ctx.match_id.game_id;
        self.last_stopped_game_id = Some(stopped_game_id);

        // make sure the task stops
        let highlight_data = highlight_task.stop().await;

        // Abort live task and get events (best effort, or we could signal it to stop)
        // Abort live task
        live_task.abort();

        // Since we share the Arc<Mutex<Vec>>, we can just read from the Arc we stored in State
        let collected_events = if let Ok(events) = live_events_arc.lock() {
            events.clone()
        } else {
            vec![]
        };

        // Re-match to get access to fields safely
        // Actually `live_task.await` returns Result<Vec<_>> but if aborted it returns RequestCancelled error.
        // So we should rely on the Arc.
        // Let's modify the match arm to capture the Arc.

        match recording_task.stop().await {
            Ok(metadata) => {
                if is_manual_stop {
                    let _ = self.ctx.app_handle.send_event(AppEvent::ManualRecordingStopped);
                }
                let mut metadata_filepath = metadata.output_filepath.clone();
                metadata_filepath.set_extension("json");

                if let Err(error) = action::update_recording_metadata(&metadata_filepath, |current| {
                    if let MetadataFile::Deferred(deferred) = current {
                        apply_live_data(
                            deferred,
                            &collected_events,
                            &player_map,
                            &last_game_data_arc,
                            &pid_to_cid,
                        );
                        deferred.highlights = highlight_data;
                    }
                }) {
                    log::warn!("failed to write deferred metadata: {error}");
                    let _ = self.ctx.app_handle.send_event(AppEvent::RecordingMetadataSaveFailed { payload: error.to_string() });

                }

                // EMIT RECORDING FINISHED
                if let Some(video_name) = metadata
                    .output_filepath
                    .to_str()
                    .filter(|_| reason != StopReason::Disconnected)
                {
                    if let Err(e) = self.ctx.app_handle.send_event(AppEvent::RecordingFinished {
                        payload: (video_name.to_string(), is_manual_stop),
                    }) {
                        log::error!("failed to emit RecordingFinished: {e}");
                    }

                    // Auto PopUp Logic (Server-side reliability)
                    if !is_manual_stop {
                        let settings_state = self.ctx.app_handle.state::<SettingsWrapper>();
                        // wrapper: &SettingsWrapper explicitly to bypass State::inner() collision
                        let wrapper: &SettingsWrapper = &settings_state;
                        let inner_settings = wrapper.inner();

                        if inner_settings.auto_popup_on_end {
                            log::info!("Auto-popup triggered (Backend)");
                            if let Some(window) = self.ctx.app_handle.get_webview_window("Main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                }

                finalize_metadata(self.ctx.clone(), metadata, collected_events, start_lp);
            }
            Err(e) => {
                log::error!("stopped recording task: {e}");
                let _ = self
                    .ctx
                    .app_handle
                    .send_event(AppEvent::RecordingFailed { payload: e.to_string() });
                let _ = self
                    .ctx
                    .app_handle
                    .send_event(AppEvent::RecordingsChanged { payload: () });
            }
        }
    }
}
