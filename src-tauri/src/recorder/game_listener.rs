use std::ffi::OsStr;
use std::fmt::Display;

use anyhow::Result;
use futures_util::StreamExt;
use riot_datatypes::lcu::{GameData, GamePhase, SessionEventData, SubscriptionResponse};
use riot_datatypes::{GameId, MatchId, Queue};
use riot_local_auth::Credentials;

use shaco::model::ingame::GameEvent as LiveGameEvent;
use shaco::model::ws::{EventType, LcuSubscriptionType};
use shaco::{rest::LcuRestClient, ws::LcuWebsocketClient};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::async_runtime;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast::Receiver;
use tokio_util::sync::CancellationToken;

use super::highlight_task::HighlightTask;
use super::metadata;
use super::recording_task::{GameCtx, Metadata, RecordingTask};
use crate::app::{action, AppEvent, EventManager};
use crate::recorder::MetadataFile;
use crate::state::SettingsWrapper;

use super::lp_helper::fetch_current_lp;

#[derive(Clone)]
pub struct ApiCtx {
    pub app_handle: AppHandle,
    pub credentials: Credentials,
    pub platform_id: String,
    pub cancel_token: CancellationToken,
}

impl ApiCtx {
    fn game_ctx(&self, game_id: GameId) -> GameCtx {
        GameCtx {
            app_handle: self.app_handle.clone(),
            match_id: MatchId {
                game_id,
                platform_id: self.platform_id.clone(),
            },
            cancel_token: self.cancel_token.child_token(),
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
        Option<i32>, // start_lp
    ),
    EndOfGame(Metadata, Vec<LiveGameEvent>, Option<i32>), // start_lp
}

impl Display for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            State::Idle => f.write_str("Idle"),
            State::Recording(_, _, _, _, _) => f.write_str("Recording"),
            State::EndOfGame(metadata, _, _) => f.write_fmt(format_args!("EndOfGame({metadata})")),
        }
    }
}

pub struct GameListener {
    ctx: ApiCtx,
    state: State,
    manual_stop_rx: Receiver<()>,
    manual_start_rx: Receiver<()>,
    last_stopped_game_id: Option<GameId>,
}

impl GameListener {
    const GAMEFLOW_SESSION: &'static str = "/lol-gameflow/v1/session";
    const EOG_STATS_BLOCK: &'static str = "/lol-end-of-game/v1/eog-stats-block";

    pub fn new(ctx: ApiCtx, manual_stop_rx: Receiver<()>, manual_start_rx: Receiver<()>) -> Self {
        Self {
            ctx,
            state: State::Idle,
            manual_stop_rx,
            manual_start_rx,
            last_stopped_game_id: None,
        }
    }

    async fn run_info_poller(live_events: Arc<Mutex<Vec<LiveGameEvent>>>) -> Vec<LiveGameEvent> {
        let client = shaco::ingame::IngameClient::new();
        let mut last_event_id = 0;
        // Cache: SummonerName -> List of Items
        let mut previous_inventory: HashMap<String, Vec<shaco::model::ingame::PlayerItem>> = HashMap::new();

        loop {
            // Poll every 1 second
            tokio::time::sleep(Duration::from_secs(1)).await;

            match client.all_game_data(Some(last_event_id as u32)).await {
                Ok(data) => {
                    let game_time = data.game_data.game_time;
                    let mut new_events = Vec::new();

                    // 1. Process Standard Events (Kill, Dragon, etc.)
                    for event in data.events {
                        let eid = event.get_event_id();
                        if eid > last_event_id as u32 {
                            last_event_id = eid as i32;
                            new_events.push(event);
                        }
                    }

                    // 2. Process Inventory Diffs (Synthetic Item Events)
                    for player in &data.all_players {
                        let name = player.summoner_name.clone();
                        let current_items = player.items.clone();

                        let old_items = previous_inventory.entry(name.clone()).or_default();

                        // Simple Diff Logic:
                        // We compare counts of each itemID.
                        // Note: This doesn't track slot moves, which is fine.
                        // But we need to handle "Purchase" vs "Sell".
                        // If we just use list diff, we might miss swaps?
                        // Let's rely on itemID presence/count.

                        let mut old_counts: HashMap<i32, i32> = HashMap::new();
                        for item in old_items.iter() {
                            *old_counts.entry(item.item_id).or_default() += 1;
                        }

                        let mut new_counts: HashMap<i32, i32> = HashMap::new();
                        for item in current_items.iter() {
                            *new_counts.entry(item.item_id).or_default() += 1;
                        }

                        // Detect Sold (Old has it, New doesn't)
                        for (id, count) in &old_counts {
                            let new_c = new_counts.get(id).cloned().unwrap_or(0);
                            if *count > new_c {
                                // Sold (count - new_c) times
                                let diff = count - new_c;
                                // Find the full item struct from old_items
                                if let Some(item_struct) = old_items.iter().find(|i| i.item_id == *id) {
                                    for _ in 0..diff {
                                        // Use index-based identifier for robust bot matching
                                        // Find index of this player in data.all_players since order is fixed (0-9)
                                        let player_idx = data
                                            .all_players
                                            .iter()
                                            .position(|p| p.summoner_name == name)
                                            .unwrap_or(0);
                                        let unique_name = format!("{}#IDX:{}", name, player_idx);

                                        new_events.push(LiveGameEvent::ItemSold(shaco::model::ingame::ItemSold {
                                            event_id: 0, // Synthetic Only
                                            event_time: game_time,
                                            item: item_struct.clone(),
                                            shopper_name: unique_name,
                                        }));
                                    }
                                }
                            }
                        }

                        // Detect Purchased (New has it, Old doesn't)
                        for (id, count) in &new_counts {
                            let old_c = old_counts.get(id).cloned().unwrap_or(0);
                            if *count > old_c {
                                // Purchased (count - old_c) times
                                let diff = count - old_c;
                                // Find the full item struct
                                if let Some(item_struct) = current_items.iter().find(|i| i.item_id == *id) {
                                    for _ in 0..diff {
                                        // Use index-based identifier for robust bot matching
                                        let player_idx = data
                                            .all_players
                                            .iter()
                                            .position(|p| p.summoner_name == name)
                                            .unwrap_or(0);
                                        let unique_name = format!("{}#IDX:{}", name, player_idx);

                                        new_events.push(LiveGameEvent::ItemPurchased(
                                            shaco::model::ingame::ItemPurchased {
                                                event_id: 0, // Synthetic Only
                                                event_time: game_time,
                                                item: item_struct.clone(),
                                                shopper_name: unique_name,
                                            },
                                        ));
                                    }
                                }
                            }
                        }

                        // Update cache
                        *old_items = current_items;
                    }

                    if !new_events.is_empty() {
                        if let Ok(mut events) = live_events.lock() {
                            events.extend(new_events);
                        }
                    }
                }
                Err(_e) => {
                    // Ignore errors (game loading, etc)
                    // log::warn!("Poll failed: {}", e);
                }
            }
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let mut lcu_ws_client = LcuWebsocketClient::connect_with(&self.ctx.credentials).await?;
        lcu_ws_client
            .subscribe(LcuSubscriptionType::JsonApiEvent(Self::GAMEFLOW_SESSION.into()))
            .await?;
        lcu_ws_client
            .subscribe(LcuSubscriptionType::JsonApiEvent(Self::EOG_STATS_BLOCK.into()))
            .await?;

        let lcu_rest_client = LcuRestClient::from(&self.ctx.credentials);
        match lcu_rest_client.get::<SessionEventData>(Self::GAMEFLOW_SESSION).await {
            Ok(init_event_data) => {
                self.state_transition(SubscriptionResponse::Session(init_event_data), false)
                    .await
            }
            Err(e) => log::info!("no initial event-data: {e}"),
        }

        loop {
            tokio::select! {
                maybe_event = lcu_ws_client.next() => {
                    let Some(event) = maybe_event else { break };
                    if event.payload.event_type != EventType::Update {
                        continue;
                    }

                    match serde_json::from_value::<SubscriptionResponse>(event.payload.data) {
                        Ok(event_data) => self.state_transition(event_data, false).await,
                        Err(e) => {
                            log::error!("failed to deserialize event: {e}");
                            continue;
                        }
                    }
                }
                Ok(_) = self.manual_stop_rx.recv() => {
                    log::info!("Manual stop triggered via hotkey");
                    self.state_transition(SubscriptionResponse::Session(SessionEventData {
                        phase: GamePhase::PreEndOfGame,
                        game_data: GameData {
                            game_id: 0,
                            queue: Queue { id: 0, is_ranked: false, name: "".into() },
                            game_mode: None,
                        },
                    }), true).await;
                }
                Ok(_) = self.manual_start_rx.recv() => {
                    log::info!("Manual start triggered via hotkey");
                    match lcu_rest_client.get::<SessionEventData>(Self::GAMEFLOW_SESSION).await {
                        Ok(data) => {
                            match data.phase {
                                GamePhase::GameStart | GamePhase::InProgress => {
                                    // Allow manual start from Idle AND EndOfGame states.
                                    // If currently recording, we ignore to prevent duplicates (or could implement restart).
                                    let should_start = match self.state {
                                        State::Idle | State::EndOfGame(..) => true,
                                        State::Recording(..) => false,
                                    };

                                    if should_start {
                                        log::info!("Manual start: Game detected (ID: {}). Forcing start.", data.game_data.game_id);
                                         let live_events = Arc::new(Mutex::new(Vec::new()));
                                         let live_events_clone = live_events.clone();
                                         let live_task = async_runtime::spawn(Self::run_info_poller(live_events_clone));

                                         self.state = State::Recording(
                                            RecordingTask::new(self.ctx.game_ctx(data.game_data.game_id)),
                                            HighlightTask::new(self.ctx.app_handle.clone()),
                                            live_task,
                                            live_events,
                                            None, // start_lp (Manual start assumes no LP tracking or we could try fetch)
                                        );
                                        log::info!("recorder state: {}", self.state);
                                    } else {
                                        log::info!("Manual start ignored: Already recording.");
                                    }
                                }
                                _ => {
                                     log::info!("Manual start ignored: Not in game (Phase: {:?})", data.phase);
                                }
                            }
                        }
                        Err(e) => log::error!("Manual start failed to get session data: {e}"),
                    }
                }
                _ = self.ctx.cancel_token.cancelled() => break,
            }
        }

        if let State::Recording(recording_task, highlight_task, live_task, _, _) = std::mem::take(&mut self.state) {
            _ = recording_task.stop().await;
            _ = highlight_task.stop().await;
            live_task.abort();
        }

        Ok(())
    }

    async fn state_transition(&mut self, sub_resp: SubscriptionResponse, is_manual_stop: bool) {
        self.state = match std::mem::take(&mut self.state) {
            // wait for game to record
            State::Idle => match sub_resp {
                SubscriptionResponse::Session(SessionEventData {
                    phase: GamePhase::GameStart | GamePhase::InProgress,
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

                    let settings = self.ctx.app_handle.state::<SettingsWrapper>();

                    // Game Mode check
                    let allowed_modes = settings.game_modes();
                    log::info!("User Allowed Modes (Settings): {:?}", allowed_modes);

                    let mut is_mode_allowed = true;

                    if let Some(modes) = allowed_modes {
                        if !modes.is_empty() {
                            // Prioritize QueueID mapping for known queues to ensure consistency
                            let mode_val = match queue.id {
                                420 | 440 => "RANKED".to_string(),
                                400 | 430 | 490 => "NORMAL".to_string(),
                                450 | 100 => "ARAM".to_string(),
                                3140 => "PRACTICE_TOOL".to_string(),
                                1700 => "CHERRY".to_string(),
                                830 | 840 | 850 | 890 => "COOP_VS_AI".to_string(),
                                1090 | 1100 | 1130 | 1160 => "TFT".to_string(),
                                0 => "CUSTOM".to_string(),
                                _ => match game_mode.clone() {
                                    Some(s) => s,
                                    None => "UNKNOWN".to_string(),
                                },
                            };

                            let mode_upper = mode_val.to_uppercase();
                            is_mode_allowed = modes.iter().any(|m| m.to_uppercase() == mode_upper);

                            if !is_mode_allowed {
                                log::info!("Game Mode '{}' NOT in allowed list. Skipping recording.", mode_upper);
                            } else {
                                log::info!("Game Mode '{}' ALLOWED. Starting...", mode_upper);
                            }
                        }
                    }

                    if is_mode_allowed {
                        // reset last stopped game id if we are starting a new game (different id)
                        if Some(game_id) != self.last_stopped_game_id {
                            self.last_stopped_game_id = None;
                        }

                        let live_events = Arc::new(Mutex::new(Vec::new()));
                        let live_events_clone = live_events.clone();
                        let live_task = async_runtime::spawn(Self::run_info_poller(live_events_clone));

                        let start_lp = if queue.is_ranked {
                            fetch_current_lp(&self.ctx.credentials).await
                        } else {
                            None
                        };

                        if let Some(lp) = start_lp {
                            log::info!("Ranked Game Detected. Start LP: {}", lp);
                        }

                        State::Recording(
                            RecordingTask::new(self.ctx.game_ctx(game_id)),
                            HighlightTask::new(self.ctx.app_handle.clone()),
                            live_task,
                            live_events,
                            start_lp,
                        )
                    } else {
                        State::Idle
                    }
                }
                _ => State::Idle,
            },

            // wait for game to end => stop recording
            State::Recording(recording_task, highlight_task, live_task, live_events_arc, start_lp) => match sub_resp {
                SubscriptionResponse::Session(SessionEventData {
                    phase:
                        phase @ (GamePhase::FailedToLaunch
                        | GamePhase::Reconnect
                        | GamePhase::WaitingForStats
                        | GamePhase::PreEndOfGame),
                    ..
                }) => {
                    log::info!("stopping recording due to session event phase: {phase:?}");

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
                            let mut metadata_filepath = metadata.output_filepath.clone();
                            metadata_filepath.set_extension("json");

                            if let Ok(MetadataFile::Deferred(mut deferred)) =
                                action::get_recording_metadata(&metadata_filepath, false)
                            {
                                deferred.highlights = highlight_data;
                                if let Err(e) = action::save_recording_metadata(
                                    &metadata_filepath,
                                    &MetadataFile::Deferred(deferred),
                                ) {
                                    log::warn!("failed to write highlight data to deferred metadata file: {e}");
                                }
                            }

                            // EMIT RECORDING FINISHED
                            if let Some(video_name) = metadata.output_filepath.file_name().and_then(|n| n.to_str()) {
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

                            State::EndOfGame(metadata, collected_events, start_lp)
                        }
                        Err(e) => {
                            log::error!("stopped recording task: {e}");
                            State::Idle
                        }
                    }
                }
                _ => State::Recording(recording_task, highlight_task, live_task, live_events_arc, start_lp),
            },

            // wait for game-data to become available
            State::EndOfGame(metadata, live_events, start_lp) => match sub_resp {
                ws_msg @ (SubscriptionResponse::EogStatsBlock {}
                | SubscriptionResponse::Session(SessionEventData {
                    phase:
                        GamePhase::EndOfGame | GamePhase::TerminatedInError | GamePhase::ChampSelect | GamePhase::GameStart,
                    ..
                })) => {
                    // ... (omitted similar logic for EndOfGame processing, using self.ctx)
                    // Re-implementing the block to ensure context is correct
                    log::info!("triggered game-data collection due to msg: {ws_msg:?}");

                    let ctx = self.ctx.clone();
                    async_runtime::spawn(async move {
                        let Metadata {
                            match_id,
                            output_filepath,
                            ingame_time_rec_start_offset,
                        } = metadata;

                        let mut metadata_filepath = output_filepath;
                        let video_id = metadata_filepath.file_name().and_then(OsStr::to_str).map(str::to_owned);
                        metadata_filepath.set_extension("json");

                        match metadata::process_data_with_retry(
                            ingame_time_rec_start_offset,
                            match_id,
                            &ctx.credentials,
                            &ctx.cancel_token,
                            live_events,
                        )
                        .await
                        {
                            Ok(mut game_metadata) => {
                                if let Ok(MetadataFile::Deferred(deferred)) =
                                    action::get_recording_metadata(&metadata_filepath, false)
                                {
                                    game_metadata.favorite = deferred.favorite;
                                    game_metadata.highlights = deferred.highlights;
                                }

                                // Calculate LP Diff
                                if let Some(s_lp) = start_lp {
                                    // Wait a bit for LCU to update before fetching end LP?
                                    // Actually process_dataWithRetry already takes some time.
                                    // But user asked for "wait a few seconds after game end".
                                    // The EndOfGame state transition happens immediately on EOG session event.
                                    // process_data_with_retry does retries, but maybe we should explicitly wait/fetch here?
                                    // Let's try fetching current LP now.

                                    // Wait 3 seconds to be safe (User requested wait)
                                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

                                    if let Some(end_lp) = fetch_current_lp(&ctx.credentials).await {
                                        let diff = end_lp - s_lp;
                                        log::info!("LP Update: Start={}, End={}, Diff={}", s_lp, end_lp, diff);
                                        game_metadata.lp_diff = Some(diff);
                                    } else {
                                        log::warn!("Could not fetch End LP");
                                    }
                                }

                                let result = action::save_recording_metadata(
                                    &metadata_filepath,
                                    &crate::recorder::MetadataFile::Metadata(game_metadata),
                                );
                                log::info!("writing game metadata to ({metadata_filepath:?}): {result:?}");
                            }
                            Err(e) => log::error!("unable to process data: {e}"),
                        }

                        if let Some(video_id) = video_id {
                            if let Err(e) = ctx
                                .app_handle
                                .send_event(AppEvent::MetadataChanged { payload: vec![video_id] })
                            {
                                log::error!("GameListener failed to send event: {e}");
                            }
                        }
                    });

                    State::Idle
                }
                _ => State::EndOfGame(metadata, live_events, start_lp),
            },
        };

        log::info!("recorder state: {}", self.state);
    }
}
