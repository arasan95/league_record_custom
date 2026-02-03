use std::time::Duration;

use std::fs::{self, OpenOptions};
use std::io::Write;

use anyhow::{bail, Context, Result};
use riot_datatypes::lcu::{Game, Player};
use riot_datatypes::{Champion, MatchId, Queue, Timeline};
use riot_local_auth::Credentials;
use shaco::model::ingame::GameEvent as LiveGameEvent;
use shaco::rest::LcuRestClient;
use tokio::{time::sleep, try_join};
use tokio_util::sync::CancellationToken;

use super::{GameEvent, GameMetadata, GoldFrame, Participant, ParticipantGold};
use crate::cancellable;

pub async fn process_data(
    ingame_time_rec_start_offset: f64,
    match_id: MatchId,
    live_events: Vec<LiveGameEvent>,
) -> Result<GameMetadata> {
    let lcu_rest_client = LcuRestClient::new()?;

    let (player, game) = try_join!(
        lcu_rest_client.get::<Player>("/lol-summoner/v1/current-summoner"),
        lcu_rest_client.get::<Game>(format!("/lol-match-history/v1/games/{}", match_id.game_id)),
    )?;
    let timeline = lcu_rest_client
        .get::<Timeline>(format!("/lol-match-history/v1/game-timelines/{}", match_id.game_id))
        .await
        .unwrap_or_default();

    let queue = match game.queue_id {
        -1 => Queue {
            id: -1,
            name: "Practicetool".into(),
            is_ranked: false,
        },
        0 => Queue {
            id: 0,
            name: "Custom Game".into(),
            is_ranked: false,
        },
        id => Queue {
            id,
            name: "Unknown".into(),
            is_ranked: false,
        },
    };

    let participant_id = game
        .participant_identities
        .iter()
        .find(|pi| pi.player == player)
        .map(|pi| pi.participant_id)
        .context("player not found in game info")?;

    let participant = game
        .participants
        .iter()
        .find(|p| p.participant_id == participant_id)
        .context("player participant_id not found in game info")?;

    // manually fill data for swarm champions because the client somehow doesn't have info on them
    // https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json
    let champion_name = match participant.champion_id {
        3147 => "Riven".into(),
        3151 => "Jinx".into(),
        3152 => "Leona".into(),
        3153 => "Seraphine".into(),
        3156 => "Briar".into(),
        3157 => "Yasuo".into(),
        3159 => "Aurora".into(),
        3678 => "Illaoi".into(),
        3947 => "Xayah".into(),
        _ => "Unknown Champion".into(),
    };

    // Create .error directory if it doesn't exist (relative to sandbox root, goes to project root)
    let _ = fs::create_dir_all("../../.error");

    // Open log file (append mode)
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open("../../.error/events_debug.log");

    let events: Vec<GameEvent> = timeline
        .frames
        .iter()
        .flat_map(|frame| {
            frame.events.iter().filter_map(|event| {
                // Debug: Check for item events
                if let Ok(mut file) = log_file.as_ref() {
                    let _ = writeln!(file, "Processing Event: {:?}", event);
                }

                match TryInto::<GameEvent>::try_into(event.clone()) {
                    Ok(e) => {
                        if let Ok(mut file) = log_file.as_ref() {
                            let _ = writeln!(file, " -> Converted: {:?}", e);
                        }
                        Some(e)
                    }
                    Err(err) => {
                        if let Ok(mut file) = log_file.as_ref() {
                            let _ = writeln!(file, " -> Error converting entry: {}", err);
                        }
                        None
                    }
                }
            })
        })
        .collect();

    let merged_events = merge_live_events(events, live_events, &game.participant_identities);

    let participants = game
        .participants
        .iter()
        .map(|p| {
            let name = game
                .participant_identities
                .iter()
                .find(|pi| pi.participant_id == p.participant_id)
                .map(|pi| format!("{}#{}", pi.player.game_name, pi.player.tag_line))
                .unwrap_or_else(|| "Unknown".to_string());

            Participant {
                participant_id: p.participant_id,
                team_id: p.team_id,
                champion_id: p.champion_id,
                spell1_id: p.spell1_id,
                spell2_id: p.spell2_id,
                stats: p.stats.clone(),
                lane: p
                    .timeline
                    .as_ref()
                    .map(|t| t.lane.clone())
                    .unwrap_or_else(|| "NONE".to_string()),
                role: p
                    .timeline
                    .as_ref()
                    .map(|t| t.role.clone())
                    .unwrap_or_else(|| "NONE".to_string()),
                summoner_name: name,
            }
        })
        .collect();

    let gold_timeline: Vec<GoldFrame> = timeline
        .frames
        .iter()
        .map(|frame| {
            let participants = frame
                .participant_frames
                .iter()
                .map(|(pid, pf)| ParticipantGold {
                    participant_id: *pid,
                    total_gold: pf.total_gold,
                    minions: (pf.minions_killed + pf.jungle_minions_killed) as i64,
                })
                .collect();

            GoldFrame {
                timestamp: frame.timestamp,
                participants,
            }
        })
        .collect();

    Ok(GameMetadata {
        favorite: false,
        match_id,
        ingame_time_rec_start_offset,
        highlights: vec![],
        queue,
        player,
        champion_name,
        stats: participant.stats.clone(),
        participant_id,
        participants,
        teams: game.teams,
        events: merged_events,
        gold_timeline,
        game_version: game.game_version,
        lp_diff: None,
    })
}

pub async fn process_data_with_retry(
    ingame_time_rec_start_offset: f64,
    match_id: MatchId,
    credentials: &Credentials,
    cancel_token: &CancellationToken,
    live_events: Vec<LiveGameEvent>,
) -> Result<GameMetadata> {
    let lcu_rest_client = LcuRestClient::from(credentials);

    let mut player_info = None;
    let mut timeline_data = None;
    for _ in 0..60 {
        player_info = try_join!(
            lcu_rest_client.get::<Player>("/lol-summoner/v1/current-summoner"),
            lcu_rest_client.get::<Game>(format!("/lol-match-history/v1/games/{}", match_id.game_id)),
        )
        .ok();

        timeline_data = lcu_rest_client
            .get::<Timeline>(format!("/lol-match-history/v1/game-timelines/{}", match_id.game_id))
            .await
            .ok();

        if player_info.is_some() && timeline_data.is_some() {
            break;
        }

        let cancelled = cancellable!(sleep(Duration::from_secs(1)), cancel_token, ());
        if cancelled {
            bail!("task cancelled (process_data)");
        }
    }

    let Some((player, game)) = player_info else { bail!("unable to collect game data") };
    let timeline = timeline_data.unwrap_or_default();

    let queue = match game.queue_id {
        -1 => Queue {
            id: -1,
            name: "Practicetool".into(),
            is_ranked: false,
        },
        0 => Queue {
            id: 0,
            name: "Custom Game".into(),
            is_ranked: false,
        },
        id => {
            lcu_rest_client
                .get::<Queue>(format!("/lol-game-queues/v1/queues/{id}"))
                .await?
        }
    };

    let participant_id = game
        .participant_identities
        .iter()
        .find(|pi| pi.player == player)
        .map(|pi| pi.participant_id)
        .context("player not found in game info")?;

    let participant = game
        .participants
        .iter()
        .find(|p| p.participant_id == participant_id)
        .context("player participant_id not found in game info")?;

    // manually fill data for swarm champions because the client somehow doesn't have info on them
    // https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json
    let champion_name = match participant.champion_id {
        3147 => "Riven".into(),
        3151 => "Jinx".into(),
        3152 => "Leona".into(),
        3153 => "Seraphine".into(),
        3156 => "Briar".into(),
        3157 => "Yasuo".into(),
        3159 => "Aurora".into(),
        3678 => "Illaoi".into(),
        3947 => "Xayah".into(),
        _ => {
            lcu_rest_client
                .get::<Champion>(format!(
                    "/lol-champions/v1/inventories/{}/champions/{}",
                    player.summoner_id.unwrap(),
                    participant.champion_id
                ))
                .await?
                .name
        }
    };

    // Create .log directory if it doesn't exist
    let _ = fs::create_dir_all(".log");

    // Open log file (append mode)
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(".log/events_debug.log");

    let events: Vec<GameEvent> = timeline
        .frames
        .iter()
        .flat_map(|frame| {
            frame.events.iter().filter_map(|event| {
                // Debug: Check for item events
                if let Ok(mut file) = log_file.as_ref() {
                    let _ = writeln!(file, "Processing Event: {:?}", event);
                }

                match TryInto::<GameEvent>::try_into(event.clone()) {
                    Ok(e) => {
                        if let Ok(mut file) = log_file.as_ref() {
                            let _ = writeln!(file, " -> Converted: {:?}", e);
                        }
                        Some(e)
                    }
                    Err(err) => {
                        if let Ok(mut file) = log_file.as_ref() {
                            let _ = writeln!(file, " -> Error converting entry: {}", err);
                        }
                        None
                    }
                }
            })
        })
        .collect();

    let merged_events = merge_live_events(events, live_events, &game.participant_identities);

    let participants = game
        .participants
        .iter()
        .map(|p| {
            let name = game
                .participant_identities
                .iter()
                .find(|pi| pi.participant_id == p.participant_id)
                .map(|pi| format!("{}#{}", pi.player.game_name, pi.player.tag_line))
                .unwrap_or_else(|| "Unknown".to_string());

            Participant {
                participant_id: p.participant_id,
                team_id: p.team_id,
                champion_id: p.champion_id,
                spell1_id: p.spell1_id,
                spell2_id: p.spell2_id,
                stats: p.stats.clone(),
                lane: p
                    .timeline
                    .as_ref()
                    .map(|t| t.lane.clone())
                    .unwrap_or_else(|| "NONE".to_string()),
                role: p
                    .timeline
                    .as_ref()
                    .map(|t| t.role.clone())
                    .unwrap_or_else(|| "NONE".to_string()),
                summoner_name: name,
            }
        })
        .collect();

    let gold_timeline: Vec<GoldFrame> = timeline
        .frames
        .iter()
        .map(|frame| {
            let participants = frame
                .participant_frames
                .iter()
                .map(|(pid, pf)| ParticipantGold {
                    participant_id: *pid,
                    total_gold: pf.total_gold,
                    minions: (pf.minions_killed + pf.jungle_minions_killed) as i64,
                })
                .collect();

            GoldFrame {
                timestamp: frame.timestamp,
                participants,
            }
        })
        .collect();

    Ok(GameMetadata {
        favorite: false,
        match_id,
        ingame_time_rec_start_offset,
        highlights: vec![],
        queue,
        player,
        champion_name,
        stats: participant.stats.clone(),
        participant_id,
        participants,
        teams: game.teams,
        events: merged_events,
        gold_timeline,
        game_version: game.game_version,
        lp_diff: None,
    })
}

fn merge_live_events(
    mut current_events: Vec<GameEvent>,
    live_events: Vec<LiveGameEvent>,
    participant_identities: &[riot_datatypes::lcu::ParticipantIdentity],
) -> Vec<GameEvent> {
    // Open log file for debugging
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("../../.error/events_debug.log");

    if let Ok(mut file) = log_file.as_ref() {
        let _ = writeln!(file, "--- Merge Live Events Start ---");
        let _ = writeln!(file, "Live Events Count: {}", live_events.len());
        let _ = writeln!(file, "Participant Identities Count: {}", participant_identities.len());
        for pi in participant_identities {
            let _ = writeln!(
                file,
                "Identity: ID={}, Name='{}', Tag='{}'",
                pi.participant_id, pi.player.game_name, pi.player.tag_line
            );
        }
    }

    for live_event in live_events {
        let (event_time, shopper_name, item, is_undo, is_sell, undo_gold_gain, undo_item_before) = match &live_event {
            LiveGameEvent::ItemPurchased(e) => (e.event_time, &e.shopper_name, Some(&e.item), false, false, 0, None),
            LiveGameEvent::ItemSold(e) => (e.event_time, &e.shopper_name, Some(&e.item), false, true, 0, None),
            LiveGameEvent::ItemUndo(e) => (
                e.event_time,
                &e.shopper_name,
                Some(&e.item_after),
                true,
                false,
                e.gold_gain as i64,
                Some(&e.item_before),
            ),
            _ => continue,
        };

        // Parse optional index suffix: "Name#IDX:<Number>"
        let (actual_name, target_idx) = if let Some(idx_start) = shopper_name.rfind("#IDX:") {
            let (name_part, idx_part) = shopper_name.split_at(idx_start);
            if let Some(idx_str) = idx_part.strip_prefix("#IDX:") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    (name_part, Some(idx))
                } else {
                    (shopper_name.as_str(), None)
                }
            } else {
                (shopper_name.as_str(), None)
            }
        } else {
            (shopper_name.as_str(), None)
        };

        // Try to match by summoner name (game_name) OR index if provided
        let identity = participant_identities.iter().find(|pi| {
            // 1. Match by Index if available (Strongest Match)
            // Live Client Data list order (0-9) corresponds to participantId (1-10)
            if let Some(t_idx) = target_idx {
                // participant_id is 1-based, index is 0-based
                if (pi.participant_id as usize) == (t_idx + 1) {
                    return true;
                }
                // If index is provided, we STRICTLY match by index.
                // But just in case logic differs, we could check name, but for bots index is safer.
                return false;
            }

            // 2. Normal Name Matching (fallback for non-synthetic events)
            let full_riot_id = format!("{}#{}", pi.player.game_name, pi.player.tag_line);
            if pi.player.game_name == actual_name || full_riot_id == actual_name {
                return true;
            }

            // Heuristic for bots (Partial Match) - Only if no index was provided
            if actual_name.contains(&pi.player.game_name) || pi.player.game_name.contains(actual_name) {
                return true;
            }

            false
        });

        if let Ok(mut file) = log_file.as_ref() {
            let status = if identity.is_some() { "MATCHED" } else { "NO MATCH" };
            let _ = writeln!(
                file,
                "Event: {:?}, Shopper: '{}' -> {}",
                live_event, shopper_name, status
            );
        }

        if let Some(identity) = identity {
            let timestamp = (event_time * 1000.0) as i64;

            let event_enum = if is_undo {
                let item_after = item.unwrap();
                let item_before = undo_item_before.unwrap();
                riot_datatypes::Event::ItemUndo {
                    participant_id: identity.participant_id,
                    before_id: item_before.item_id as i64,
                    after_id: item_after.item_id as i64,
                    gold_gain: undo_gold_gain,
                }
            } else if is_sell {
                let item = item.unwrap();
                riot_datatypes::Event::ItemSold {
                    participant_id: identity.participant_id,
                    item_id: item.item_id as i64,
                    slot: Some(item.slot as i64),
                }
            } else {
                let item = item.unwrap();
                riot_datatypes::Event::ItemPurchased {
                    participant_id: identity.participant_id,
                    item_id: item.item_id as i64,
                    slot: Some(item.slot as i64),
                }
            };

            if let Ok(local_event) = TryInto::<super::Event>::try_into(event_enum) {
                current_events.push(super::GameEvent { event: local_event, timestamp });
            }
        }
    }

    current_events.sort_by_key(|e| e.timestamp);
    current_events
}
