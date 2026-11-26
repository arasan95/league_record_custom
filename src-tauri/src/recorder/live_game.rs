use shaco::model::ingame::GameEvent as LiveGameEvent;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::AppHandle;

use super::Deferred;
use crate::app::{AppEvent, EventManager};

pub(super) fn normalize_identity_key(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn team_id_str(team: &shaco::model::ingame::TeamId) -> &'static str {
    match team {
        shaco::model::ingame::TeamId::Chaos => "200",
        shaco::model::ingame::TeamId::Order => "100",
        _ => "100",
    }
}

pub(super) fn is_tft_queue_id(queue_id: i64) -> bool {
    matches!(queue_id, 1090 | 1100 | 1110 | 1130 | 1160 | 1220)
}

fn build_live_player_fallback_key(player: &shaco::model::ingame::Player) -> String {
    let riot_key = player
        .riot_id
        .riot_id
        .as_deref()
        .map(normalize_identity_key)
        .unwrap_or_default();
    format!(
        "fallback:{}|{}|{}",
        team_id_str(&player.team),
        normalize_identity_key(&player.summoner_name),
        riot_key
    )
}

fn parse_pid_tag(raw: &str) -> Option<i32> {
    let (_, rest) = raw.rsplit_once("#PID:")?;
    let pid_str = rest.split('#').next().unwrap_or_default();
    pid_str.parse::<i32>().ok().filter(|pid| (1..=10).contains(pid))
}

fn build_synthetic_shopper_name(player: &shaco::model::ingame::Player, player_map: &HashMap<String, i32>) -> String {
    let team_intro = team_id_str(&player.team);
    let summoner_key = normalize_identity_key(&player.summoner_name);
    let riot_key = player.riot_id.riot_id.as_deref().map(normalize_identity_key);

    let resolved_pid = player_map
        .get(&format!("team:{}|summoner:{}", team_intro, summoner_key))
        .copied()
        .or_else(|| player_map.get(&format!("summoner:{}", summoner_key)).copied())
        .or_else(|| {
            riot_key.as_ref().and_then(|key| {
                player_map
                    .get(&format!("team:{}|riot:{}", team_intro, key))
                    .copied()
                    .or_else(|| player_map.get(&format!("riot:{}", key)).copied())
            })
        });

    match resolved_pid {
        Some(pid) => format!(
            "{}#PID:{}#TEAM:{}#CNAME:{}",
            player.summoner_name, pid, team_intro, player.champion_name
        ),
        None => format!(
            "{}#TEAM:{}#CNAME:{}",
            player.summoner_name, team_intro, player.champion_name
        ),
    }
}

fn terminal_live_event_reason(event: &LiveGameEvent) -> Option<String> {
    match event {
        LiveGameEvent::GameEnd(e) => Some(format!("Live Client GameEnd ({:?})", e.result)),
        _ => None,
    }
}

pub(super) async fn run_info_poller(
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
                    let synthetic_shopper_name = player_map
                        .lock()
                        .ok()
                        .map(|map| build_synthetic_shopper_name(player, &map))
                        .unwrap_or_else(|| {
                            format!(
                                "{}#TEAM:{}#CNAME:{}",
                                name,
                                team_id_str(&player.team),
                                player.champion_name
                            )
                        });

                    let inventory_key = if let Some(pid) = parse_pid_tag(&synthetic_shopper_name) {
                        format!("pid:{pid}")
                    } else {
                        format!("idx:{player_idx}|{}", build_live_player_fallback_key(player))
                    };
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
                                    new_events.push(LiveGameEvent::ItemSold(shaco::model::ingame::ItemSold {
                                        event_id: 0, // Synthetic Only
                                        event_time: game_time,
                                        item: item_struct.clone(),
                                        shopper_name: synthetic_shopper_name.clone(),
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
                                    new_events.push(LiveGameEvent::ItemPurchased(
                                        shaco::model::ingame::ItemPurchased {
                                            event_id: 0, // Synthetic Only
                                            event_time: game_time,
                                            item: item_struct.clone(),
                                            shopper_name: synthetic_shopper_name.clone(),
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

pub(super) fn apply_live_data(
    deferred: &mut Deferred,
    collected_events: &[LiveGameEvent],
    player_map: &Mutex<HashMap<String, i32>>,
    last_game_data_arc: &Mutex<Option<shaco::model::ingame::AllGameData>>,
    pid_to_cid: &HashMap<i64, i32>,
) {
    // Convert collected LiveGameEvents to data::GameEvent
    let mut converted_events = Vec::new();
    let name_to_id: HashMap<String, i32> = if let Ok(map) = player_map.lock() {
        map.clone()
    } else {
        HashMap::new()
    };

    // 1. Convert Events (existing logic)
    for event in collected_events {
        // Helper to match name to ID
        let resolve_id = |name: &str| -> Option<i32> {
            if let Some(pid) = parse_pid_tag(name) {
                return Some(pid);
            }

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
                    if let Some(id) = name_to_id.get(&format!("team:{team_id}|summoner:{summoner_key}")) {
                        return Some(*id);
                    }
                    if let Some(id) = name_to_id.get(&format!("summoner:{summoner_key}")) {
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
                    if let Some(id) = name_to_id.get(&format!("summoner:{summoner_key}")) {
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
                            slot: Some(e.item.slot as i64),
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
                            slot: Some(e.item.slot as i64),
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
                summoner_id: None,
                honor_received: false,
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
        log::info!("Synthesized {} participants from Live Client Data.", participants.len());
        deferred.participants = participants;
    } else {
        log::warn!("No Live Client Data available to synthesize participants.");
    }
}
