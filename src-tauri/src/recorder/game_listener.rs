use std::ffi::OsStr;
use std::fmt::Display;

use anyhow::Result;
use chrono::Utc;
use futures_util::StreamExt;
use riot_datatypes::lcu::{GameData, GamePhase, SessionEventData, SubscriptionResponse};
use riot_datatypes::{GameId, MatchId, Queue};
use riot_local_auth::Credentials;

use shaco::model::ingame::GameEvent as LiveGameEvent;
use shaco::model::ws::{EventType, LcuSubscriptionType};
use shaco::{rest::LcuRestClient, ws::LcuWebsocketClient};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::async_runtime;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast::Receiver;
use tokio_util::sync::CancellationToken;

use super::highlight_task::HighlightTask;
use super::metadata;
use super::recording_task::{GameCtx, Metadata, RecordingTask};
use super::window;
use crate::app::{AppEvent, EventManager, SystemTrayManager, action};
use crate::recorder::MetadataFile;
use crate::state::{CurrentlyRecording, SettingsWrapper};

use super::lp_helper::fetch_current_lp;

fn normalize_identity_key(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn team_id_str(team: &shaco::model::ingame::TeamId) -> &'static str {
    match team {
        shaco::model::ingame::TeamId::Chaos => "200",
        shaco::model::ingame::TeamId::Order => "100",
        _ => "100",
    }
}

fn build_live_player_fallback_key(player: &shaco::model::ingame::Player) -> String {
    let riot_key = player
        .riot_id
        .riot_id
        .as_deref()
        .map(normalize_identity_key)
        .unwrap_or_default();
    format!(
        "fallback:{}|{}|{}|{}",
        team_id_str(&player.team),
        normalize_identity_key(&player.summoner_name),
        normalize_identity_key(&player.champion_name),
        riot_key
    )
}

fn terminal_live_event_reason(event: &LiveGameEvent) -> Option<String> {
    match event {
        LiveGameEvent::GameEnd(e) => Some(format!("Live Client GameEnd ({:?})", e.result)),
        _ => None,
    }
}

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
        Arc<Mutex<HashMap<String, i32>>>,                      // player_map
        Option<i32>,                                           // start_lp
        Arc<Mutex<Option<shaco::model::ingame::AllGameData>>>, // last_game_data
        HashMap<i64, i32>,                                     // pid_to_cid (ParticipantId -> ChampionId)
    ),
    EndOfGame(Metadata, Vec<LiveGameEvent>, Option<i32>), // start_lp
}

impl Display for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            State::Idle => f.write_str("Idle"),
            State::Recording(_, _, _, _, _, _, _, _) => f.write_str("Recording"),
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
    last_manual_prewarm_game_id: Option<GameId>,
    missing_window_ticks: u8,
    terminal_live_event: Arc<Mutex<Option<String>>>,
    latest_session_game_id: Option<GameId>,
    end_of_game_since: Option<Instant>,
    end_of_game_finalize_requested: bool,
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
            last_manual_prewarm_game_id: None,
            missing_window_ticks: 0,
            terminal_live_event: Arc::new(Mutex::new(None)),
            latest_session_game_id: None,
            end_of_game_since: None,
            end_of_game_finalize_requested: false,
        }
    }

    async fn maybe_trigger_end_of_game_finalize(&mut self) {
        if !self.end_of_game_finalize_requested {
            return;
        }
        self.end_of_game_finalize_requested = false;
        if !matches!(self.state, State::EndOfGame(..)) {
            return;
        }

        log::info!("EndOfGame entered. Triggering immediate metadata finalization.");
        self.state_transition(
            SubscriptionResponse::Session(SessionEventData {
                phase: GamePhase::GameStart,
                game_data: GameData {
                    game_id: 0,
                    queue: Queue {
                        id: 0,
                        is_ranked: false,
                        name: "".into(),
                    },
                    game_mode: None,
                },
            }),
            false,
        )
        .await;
    }

    async fn run_info_poller(
        live_events: Arc<Mutex<Vec<LiveGameEvent>>>,
        player_map: Arc<Mutex<HashMap<String, i32>>>,
        last_game_data: Arc<Mutex<Option<shaco::model::ingame::AllGameData>>>,
        terminal_live_event: Arc<Mutex<Option<String>>>,
        app_handle: AppHandle,
    ) -> Vec<LiveGameEvent> {
        let client = shaco::ingame::IngameClient::new();
        let mut last_event_id = 0;
        // Cache: Stable per-player key -> List of Items.
        // Do not use participantId alone here: unstable/ambiguous runtime mapping can cause cross-player contamination.
        let mut previous_inventory: HashMap<String, Vec<shaco::model::ingame::PlayerItem>> = HashMap::new();
        // Flag: fire GameStarted only once (on first successful in-game API response)
        let mut game_started_fired = false;

        loop {
            // Poll every 1 second
            tokio::time::sleep(Duration::from_secs(1)).await;

            match client.all_game_data(Some(last_event_id as u32)).await {
                Ok(data) => {
                    // First successful response from in-game API means loading is done and game has begun.
                    // This is more reliable than LCU GamePhase::InProgress which can fire too early.
                    if !game_started_fired {
                        game_started_fired = true;
                        log::info!("In-game API first success. Emitting GameStarted for Auto Stop.");
                        if let Err(e) = app_handle.send_event(AppEvent::GameStarted) {
                            log::error!("Failed to emit GameStarted: {}", e);
                        }
                    }

                    // Update player map (PID-first; do not use all_players index)
                    if let Ok(mut map) = player_map.lock() {
                        for p in &data.all_players {
                            let team_intro = team_id_str(&p.team);
                            let summoner_key = normalize_identity_key(&p.summoner_name);
                            let scoped_summoner = format!("team:{}|summoner:{}", team_intro, summoner_key);
                            let riot_key = p.riot_id.riot_id.as_deref().map(normalize_identity_key);
                            let mut resolved_pid = map
                                .get(&scoped_summoner)
                                .copied()
                                .or_else(|| map.get(&format!("summoner:{}", summoner_key)).copied());
                            if resolved_pid.is_none() {
                                if let Some(rkey) = &riot_key {
                                    resolved_pid = map
                                        .get(&format!("team:{}|riot:{}", team_intro, rkey))
                                        .copied()
                                        .or_else(|| map.get(&format!("riot:{}", rkey)).copied());
                                }
                            }
                            if let Some(pid) = resolved_pid {
                                map.insert(p.summoner_name.clone(), pid);
                                map.insert(format!("summoner:{}", summoner_key), pid);
                                map.insert(scoped_summoner, pid);
                                if let Some(rkey) = riot_key {
                                    map.insert(format!("riot:{}", rkey), pid);
                                    map.insert(format!("team:{}|riot:{}", team_intro, rkey), pid);
                                }
                            }
                        }
                    }

                    // Update last known game data
                    if let Ok(mut last_data) = last_game_data.lock() {
                        *last_data = Some(data.clone());
                    }

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
                    for (player_idx, player) in data.all_players.iter().enumerate() {
                        let name = player.summoner_name.clone();
                        let current_items = player.items.clone();

                        let inventory_key = format!("idx:{player_idx}|{}", build_live_player_fallback_key(player));
                        let old_items = previous_inventory.entry(inventory_key).or_default();

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
                                        // Use Name + Team identifier.
                                        // Team is required to disambiguate bots with same name on different teams.
                                        let team_intro = team_id_str(&player.team);
                                        // SkinID logic: ChampionID * 1000 + SkinIndex
                                        let unique_name =
                                            format!("{}#TEAM:{}#CNAME:{}", name, team_intro, player.champion_name);

                                        // println!("DEBUG: Generated Event ItemSold for {}", unique_name);

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
                                        // Use Name + Team identifier.
                                        let team_intro = team_id_str(&player.team);
                                        let unique_name =
                                            format!("{}#TEAM:{}#CNAME:{}", name, team_intro, player.champion_name);

                                        // println!("DEBUG: Generated Event ItemPurchased for {}", unique_name);

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

                    for event in &new_events {
                        if let Some(reason) = terminal_live_event_reason(event) {
                            log::info!("Terminal live event detected: {reason}");
                            if let Ok(mut terminal) = terminal_live_event.lock() {
                                if terminal.is_none() {
                                    *terminal = Some(reason);
                                }
                            }
                        }
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
                if init_event_data.game_data.game_id > 0 {
                    self.latest_session_game_id = Some(init_event_data.game_data.game_id);
                }
                self.state_transition(SubscriptionResponse::Session(init_event_data), false)
                    .await;
                self.maybe_trigger_end_of_game_finalize().await;
            }
            Err(e) => log::info!("no initial event-data: {e}"),
        }

        // Prime manual recorder once at startup so first manual hotkey press can start faster.
        let prewarm_ctx = self.ctx.game_ctx(
            self.latest_session_game_id
                .unwrap_or_else(|| Utc::now().timestamp_millis()),
        );
        async_runtime::spawn(async move {
            if let Err(e) = RecordingTask::prewarm(prewarm_ctx).await {
                log::warn!("startup manual prewarm failed: {e}");
            }
        });

        let mut health_tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                maybe_event = lcu_ws_client.next() => {
                    let Some(event) = maybe_event else { break };
                    if event.payload.event_type != EventType::Update {
                        continue;
                    }

                    match serde_json::from_value::<SubscriptionResponse>(event.payload.data) {
                        Ok(event_data) => {
                            if let SubscriptionResponse::Session(session) = &event_data {
                                if session.game_data.game_id > 0 {
                                    self.latest_session_game_id = Some(session.game_data.game_id);
                                }
                            }
                            let transition_event =
                                if matches!(event_data, SubscriptionResponse::EogStatsBlock {})
                                    && matches!(self.state, State::Recording(..))
                                {
                                    log::info!("LCU EOG stats block detected while recording. Stopping recording...");
                                    SubscriptionResponse::Session(SessionEventData {
                                        phase: GamePhase::EndOfGame,
                                        game_data: GameData {
                                            game_id: self.latest_session_game_id.unwrap_or(0),
                                            queue: Queue { id: 0, is_ranked: false, name: "".into() },
                                            game_mode: None,
                                        },
                                    })
                                } else {
                                    event_data
                                };
                            self.state_transition(transition_event, false).await;
                            self.maybe_trigger_end_of_game_finalize().await;
                        }
                        Err(e) => {
                            log::error!("failed to deserialize event: {e}");
                            continue;
                        }
                    }
                }
                Ok(_) = self.manual_stop_rx.recv() => {
                    log::info!("Manual stop triggered via hotkey");
                    if let State::Recording(..) = self.state {
                        if let Err(e) = self.ctx.app_handle.send_event(AppEvent::ManualRecordingStopped) {
                            log::error!("failed to emit ManualRecordingStopped event: {e}");
                        }
                    }
                    self.state_transition(SubscriptionResponse::Session(SessionEventData {
                        phase: GamePhase::PreEndOfGame,
                        game_data: GameData {
                            game_id: 0,
                            queue: Queue { id: 0, is_ranked: false, name: "".into() },
                            game_mode: None,
                        },
                    }), true).await;
                    self.maybe_trigger_end_of_game_finalize().await;
                }
                Ok(_) = self.manual_start_rx.recv() => {
                    log::info!("Manual start triggered via hotkey");
                    // Manual mode must be immediate: do not block on LCU requests here.
                    let should_start = match self.state {
                        State::Idle | State::EndOfGame(..) => true,
                        State::Recording(..) => false,
                    };

                    if should_start {
                        let game_id = self.latest_session_game_id.unwrap_or_else(|| Utc::now().timestamp_millis());
                        if let Err(ev_err) = self.ctx.app_handle.send_event(AppEvent::ManualRecordingStarted) {
                            log::error!("failed to emit ManualRecordingStarted event: {ev_err}");
                        }
                        // Manual start should feel instant in tray UI.
                        // Show recording icon immediately instead of a long preparing state.
                        self.ctx.app_handle.set_tray_menu_recording(true);
                        let live_events = Arc::new(Mutex::new(Vec::new()));
                        let player_map = Arc::new(Mutex::new(HashMap::new()));
                        let live_events_clone = live_events.clone();
                        let player_map_clone = player_map.clone();
                        let last_game_data = Arc::new(Mutex::new(None));
                        if let Ok(mut terminal) = self.terminal_live_event.lock() {
                            *terminal = None;
                        }
                        let live_task = async_runtime::spawn(Self::run_info_poller(
                            live_events_clone,
                            player_map_clone,
                            last_game_data.clone(),
                            self.terminal_live_event.clone(),
                            self.ctx.app_handle.clone(),
                        ));

                        self.state = State::Recording(
                            RecordingTask::new_manual(self.ctx.game_ctx(game_id)),
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
                    if let State::Recording(..) = self.state {
                        let terminal_reason = self.terminal_live_event.lock().ok().and_then(|mut terminal| terminal.take());
                        if let Some(reason) = terminal_reason {
                            log::info!("Stopping recording due to terminal live event: {reason}");
                            self.state_transition(SubscriptionResponse::Session(SessionEventData {
                                phase: GamePhase::PreEndOfGame,
                                game_data: GameData {
                                    game_id: 0,
                                    queue: Queue { id: 0, is_ranked: false, name: "".into() },
                                    game_mode: None,
                                },
                            }), false).await;
                            self.maybe_trigger_end_of_game_finalize().await;
                            continue;
                        }

                        // Missing LoL window can happen when the game client drops mid-match.
                        // Keep recording until LCU or Live Client reports the actual game end.
                        let is_actually_recording = self.ctx.app_handle.state::<CurrentlyRecording>().get().is_some();
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

                    // EndOfGame fallback:
                    // If expected LCU/EOG trigger is missed, force metadata processing after timeout.
                    if let State::EndOfGame(..) = self.state {
                        if let Some(since) = self.end_of_game_since {
                            if since.elapsed() >= Duration::from_secs(5) {
                                log::warn!("EndOfGame metadata trigger timed out. Forcing fallback processing.");
                                self.end_of_game_since = None;
                                self.state_transition(SubscriptionResponse::Session(SessionEventData {
                                    phase: GamePhase::GameStart,
                                    game_data: GameData {
                                        game_id: 0,
                                        queue: Queue { id: 0, is_ranked: false, name: "".into() },
                                        game_mode: None,
                                    },
                                }), false).await;
                                self.maybe_trigger_end_of_game_finalize().await;
                            }
                        }
                    }
                }
                _ = self.ctx.cancel_token.cancelled() => break,
            }
        }

        if let State::Recording(recording_task, highlight_task, live_task, _, _, _, _, _) =
            std::mem::take(&mut self.state)
        {
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
                        match lcu_rest_client.get::<serde_json::Value>(Self::GAMEFLOW_SESSION).await {
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

                        let live_task = async_runtime::spawn(Self::run_info_poller(
                            live_events_clone,
                            player_map_clone,
                            last_game_data.clone(),
                            self.terminal_live_event.clone(),
                            self.ctx.app_handle.clone(),
                        ));

                        // Try to fetch LP
                        let start_lp = fetch_current_lp(&self.ctx.credentials).await;
                        if let Some(lp) = start_lp {
                            log::info!("Fetched initial LP: {}", lp);
                        }

                        State::Recording(
                            RecordingTask::new(self.ctx.game_ctx(game_id)),
                            HighlightTask::new(self.ctx.app_handle.clone()),
                            live_task,
                            live_events,
                            player_map,
                            start_lp,
                            last_game_data,
                            pid_to_cid,
                        )
                    } else {
                        // Manual-start optimization:
                        // If we are not auto-recording this game, prewarm recorder setup now so
                        // manual hotkey start doesn't pay the full initialization cost later.
                        if Some(game_id) != self.last_manual_prewarm_game_id {
                            self.last_manual_prewarm_game_id = Some(game_id);
                            let prewarm_ctx = self.ctx.game_ctx(game_id);
                            let app_handle_clone = self.ctx.app_handle.clone();
                            async_runtime::spawn(async move {
                                app_handle_clone.set_tray_menu_preparing(true);
                                if let Err(e) = RecordingTask::prewarm(prewarm_ctx).await {
                                    log::warn!("manual prewarm failed: {e}");
                                }

                                // Do not override active recording UI if recording already started.
                                let recording_state = app_handle_clone.state::<CurrentlyRecording>();
                                if recording_state.get().is_none() {
                                    app_handle_clone.set_tray_menu_preparing(false);
                                }
                            });
                        }

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

            // wait for game to end => stop recording
            State::Recording(
                recording_task,
                highlight_task,
                live_task,
                live_events_arc,
                player_map,
                start_lp,
                last_game_data_arc,
                pid_to_cid,
            ) => {
                match sub_resp {
                    SubscriptionResponse::Session(SessionEventData {
                        phase:
                            phase @ (GamePhase::FailedToLaunch
                            | GamePhase::WaitingForStats
                            | GamePhase::PreEndOfGame
                            | GamePhase::EndOfGame
                            | GamePhase::TerminatedInError),
                        ..
                    }) => {
                        log::debug!("Game listener detected phase: {phase:?}. Stopping recording...");
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
                                    // Convert collected LiveGameEvents to data::GameEvent
                                    let mut converted_events = Vec::new();
                                    let name_to_id: HashMap<String, i32> = if let Ok(map) = player_map.lock() {
                                        map.clone()
                                    } else {
                                        HashMap::new()
                                    };

                                    // 1. Convert Events (existing logic)
                                    for event in &collected_events {
                                        // Helper to match name to ID
                                        let resolve_id = |name: &str| -> Option<i32> {
                                            if let Some(id) = name_to_id.get(name) {
                                                return Some(*id);
                                            }

                                            // Synthetic shopper_name format:
                                            // "<summoner>#TEAM:<team>#CNAME:<champion>"
                                            if let Some(team_sep) = name.find("#TEAM:") {
                                                let real_name = &name[..team_sep];
                                                let team_and_rest = &name[team_sep + "#TEAM:".len()..];
                                                let team_id = team_and_rest.split('#').next().unwrap_or_default();
                                                let summoner_key = normalize_identity_key(real_name);
                                                if !summoner_key.is_empty() {
                                                    if let Some(id) = name_to_id
                                                        .get(&format!("team:{team_id}|summoner:{summoner_key}"))
                                                    {
                                                        return Some(*id);
                                                    }
                                                    if let Some(id) =
                                                        name_to_id.get(&format!("summoner:{summoner_key}"))
                                                    {
                                                        return Some(*id);
                                                    }
                                                    if let Some(id) = name_to_id.get(real_name) {
                                                        return Some(*id);
                                                    }
                                                }
                                            }

                                            if let Some(real_name) = name.split('#').next() {
                                                if !real_name.is_empty() {
                                                    let summoner_key = normalize_identity_key(real_name);
                                                    if let Some(id) =
                                                        name_to_id.get(&format!("summoner:{summoner_key}"))
                                                    {
                                                        return Some(*id);
                                                    }
                                                    if let Some(id) = name_to_id.get(real_name) {
                                                        return Some(*id);
                                                    }
                                                }
                                            }
                                            None
                                        };

                                        match event {
                                            LiveGameEvent::ItemPurchased(e) => {
                                                if let Some(pid) = resolve_id(&e.shopper_name) {
                                                    converted_events.push(crate::recorder::data::GameEvent {
                                                        timestamp: (e.event_time * 1000.0) as i64,
                                                        event: crate::recorder::data::Event::ItemPurchased {
                                                            participant_id: pid as i64,
                                                            item_id: e.item.item_id as i64,
                                                            slot: None,
                                                        },
                                                    });
                                                }
                                            }
                                            LiveGameEvent::ItemSold(e) => {
                                                if let Some(pid) = resolve_id(&e.shopper_name) {
                                                    converted_events.push(crate::recorder::data::GameEvent {
                                                        timestamp: (e.event_time * 1000.0) as i64,
                                                        event: crate::recorder::data::Event::ItemSold {
                                                            participant_id: pid as i64,
                                                            item_id: e.item.item_id as i64,
                                                            slot: None,
                                                        },
                                                    });
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                    deferred.events = converted_events;

                                    // 2. Synthesize Participants from Last Game Data
                                    if let Ok(Some(game_data)) = last_game_data_arc.lock().as_deref() {
                                        let mut participants = Vec::new();

                                        for player in &game_data.all_players {
                                            // Resolve ID
                                            let pid = name_to_id.get(&player.summoner_name).copied().unwrap_or(0);
                                            // Resolve Team
                                            let team_id = match player.team {
                                                shaco::model::ingame::TeamId::Order => 100,
                                                shaco::model::ingame::TeamId::Chaos => 200,
                                                _ => 100,
                                            };
                                            // Resolve Champion ID
                                            let champion_id = pid_to_cid.get(&(pid as i64)).copied().unwrap_or(0);

                                            // Map Items
                                            // shaco items -> lcu items?
                                            // We just need item IDs for item0..item6
                                            let mut item_ids = [0; 7];
                                            for (i, item) in player.items.iter().enumerate().take(7) {
                                                item_ids[i] = item.item_id as i64;
                                            }

                                            // Construct dummy Stats
                                            let stats = riot_datatypes::lcu::Stats {
                                                kills: player.scores.kills as i64,
                                                deaths: player.scores.deaths as i64,
                                                assists: player.scores.assists as i64,
                                                total_minions_killed: player.scores.creep_score as i64,
                                                neutral_minions_killed: 0, // Not available directly?
                                                gold_earned: 0,            // Not available directly
                                                item5: item_ids[5],
                                                item6: item_ids[6],
                                                win: false, // Don't know yet
                                                ..Default::default()
                                            };

                                            participants.push(crate::recorder::data::Participant {
                                                participant_id: pid as i64,
                                                team_id,
                                                champion_id: champion_id as i64,
                                                spell1_id: 0, // Not available easily
                                                spell2_id: 0,
                                                stats,
                                                lane: "NONE".into(),
                                                role: "NONE".into(),
                                                summoner_name: player.summoner_name.clone(),
                                                lane_score: 0.0,
                                                champ_level: Some(player.level),
                                                summoner_level: None,
                                                rank: None,
                                                placement: None,
                                                players_eliminated: None,
                                                level: None,
                                                r#traits: None,
                                                units: None,
                                                companion: None,
                                            });
                                        }
                                        log::info!(
                                            "Synthesized {} participants from Live Client Data.",
                                            participants.len()
                                        );
                                        deferred.participants = participants;
                                    } else {
                                        log::warn!("No Live Client Data available to synthesize participants.");
                                    }

                                    deferred.highlights = highlight_data;
                                    if let Err(e) = action::save_recording_metadata(
                                        &metadata_filepath,
                                        &MetadataFile::Deferred(deferred),
                                    ) {
                                        log::warn!("failed to write highlight data to deferred metadata file: {e}");
                                    }
                                }

                                // EMIT RECORDING FINISHED
                                if let Some(video_name) = metadata.output_filepath.file_name().and_then(|n| n.to_str())
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

                                State::EndOfGame(metadata, collected_events, start_lp)
                            }
                            Err(e) => {
                                log::debug!("Recording task stop failed: {e}");
                                log::error!("stopped recording task: {e}");
                                State::Idle
                            }
                        }
                    }
                    // GameStarted is now fired from run_info_poller on first successful in-game API response.
                    _ => State::Recording(
                        recording_task,
                        highlight_task,
                        live_task,
                        live_events_arc,
                        player_map,
                        start_lp,
                        last_game_data_arc,
                        pid_to_cid,
                    ),
                }
            }

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

        let entered_end_of_game_now = matches!(self.state, State::EndOfGame(..)) && self.end_of_game_since.is_none();
        if entered_end_of_game_now {
            self.end_of_game_since = Some(Instant::now());
            // Root-path fix: request immediate finalization without depending on extra LCU events.
            // This is consumed in run() right after the current transition returns.
            self.end_of_game_finalize_requested = true;
        }

        if !matches!(self.state, State::EndOfGame(..)) {
            self.end_of_game_since = None;
        }

        log::info!("recorder state: {}", self.state);
    }
}
