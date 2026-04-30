use std::time::Duration;

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

    let player_info = try_join!(
        lcu_rest_client.get::<Player>("/lol-summoner/v1/current-summoner"),
        lcu_rest_client.get::<Game>(format!("/lol-match-history/v1/games/{}", match_id.game_id)),
    )
    .ok();

    let (player, game) = match player_info {
        Some((p, g)) => (p, g),
        None => {
            // ==== TFT Fallback ====
            if let Some(dummy_game) = fetch_tft_fallback_if_exists(&lcu_rest_client, &match_id).await {
                let p = lcu_rest_client
                    .get::<Player>("/lol-summoner/v1/current-summoner")
                    .await?;
                return process_tft_fallback(ingame_time_rec_start_offset, match_id, p, dummy_game).await;
            }
            bail!("unable to collect game data (TFT fallback also failed)");
        }
    };
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

    let events: Vec<GameEvent> = timeline
        .frames
        .iter()
        .flat_map(|frame| {
            frame
                .events
                .iter()
                .filter_map(|event| match TryInto::<GameEvent>::try_into(event.clone()) {
                    Ok(e) => Some(e),
                    Err(_) => None,
                })
        })
        .collect();

    // Create PID -> Champion Map
    let mut pid_to_champ = std::collections::HashMap::new();
    if let Some(sum_id) = player.summoner_id {
        for p in &game.participants {
            // We need to fetch champion info for each participant to get Name/Alias
            // Note: This is 10 async calls. Should be fast enough.
            let result = lcu_rest_client
                .get::<Champion>(format!(
                    "/lol-champions/v1/inventories/{}/champions/{}",
                    sum_id, p.champion_id
                ))
                .await;

            if let Ok(champ) = result {
                pid_to_champ.insert(p.participant_id, champ);
            }
        }
    }

    let merged_events = merge_live_events(
        events,
        live_events,
        &game.participant_identities,
        &game.participants,
        &pid_to_champ,
    );

    // Fetch Rank and Summoner Level
    let pid_to_meta =
        super::lp_helper_meta::fetch_participant_metadata(&lcu_rest_client, &game.participant_identities).await;

    let lane_scores = calculate_lane_scores(&merged_events);

    let participants = game
        .participants
        .iter()
        .map(|p| {
            let identity = game
                .participant_identities
                .iter()
                .find(|pi| pi.participant_id == p.participant_id);
            let name = identity
                .map(|pi| format!("{}#{}", pi.player.game_name, pi.player.tag_line))
                .unwrap_or_else(|| "Unknown".to_string());
            let summoner_id = identity.and_then(|pi| pi.player.summoner_id);

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
                summoner_id,
                honor_received: false,
                lane_score: *lane_scores.get(&p.participant_id).unwrap_or(&0.0),
                champ_level: Some(0),
                summoner_level: pid_to_meta.get(&p.participant_id).map(|m| m.1),
                rank: pid_to_meta
                    .get(&p.participant_id)
                    .map(|m| m.0.clone())
                    .or(Some("Unranked".to_string())),
                // ======== TFT Data Mapping ========
                placement: p.placement,
                players_eliminated: p.players_eliminated,
                level: p.level,
                r#traits: p
                    .r#traits
                    .clone()
                    .map(|traits| traits.into_iter().map(|t| t.into()).collect()),
                units: p
                    .units
                    .clone()
                    .map(|units| units.into_iter().map(|u| u.into()).collect()),
                companion: p.companion.clone().map(|c| c.into()),
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
                    level: Some(pf.level),
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
        game_duration: game.game_duration,
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
    const MAX_ATTEMPTS: usize = 8;
    const MAX_RETRY_DELAY: Duration = Duration::from_secs(3);

    let mut player_info = None;
    let mut timeline_data = None;
    let mut retry_delay = Duration::from_millis(500);
    for attempt in 0..MAX_ATTEMPTS {
        player_info = try_join!(
            lcu_rest_client.get::<Player>("/lol-summoner/v1/current-summoner"),
            lcu_rest_client.get::<Game>(format!("/lol-match-history/v1/games/{}", match_id.game_id)),
        )
        .ok();

        timeline_data = lcu_rest_client
            .get::<Timeline>(format!("/lol-match-history/v1/game-timelines/{}", match_id.game_id))
            .await
            .ok();

        if player_info.is_some() {
            // If it's a TFT game (or game without timeline), we don't necessarily need timeline_data to be Some
            if let Some((_, ref game)) = player_info {
                let qid = game.queue_id;
                let is_tft = qid == 1090 || qid == 1100 || qid == 1110 || qid == 1130 || qid == 1160;

                if timeline_data.is_some() || is_tft {
                    break;
                }
            } else if timeline_data.is_some() {
                break;
            }
        }

        if attempt + 1 < MAX_ATTEMPTS {
            let cancelled = cancellable!(sleep(retry_delay), cancel_token, ());
            if cancelled {
                bail!("task cancelled (process_data)");
            }
            retry_delay = std::cmp::min(retry_delay.saturating_mul(2), MAX_RETRY_DELAY);
        }
    }

    let (player, game) = match player_info {
        Some((p, g)) => (p, g),
        None => {
            // ==== TFT Fallback ====
            let p_res = lcu_rest_client.get::<Player>("/lol-summoner/v1/current-summoner").await;
            if let Ok(p) = p_res {
                if let Some(dummy_game) = fetch_tft_fallback_if_exists(&lcu_rest_client, &match_id).await {
                    return process_tft_fallback(ingame_time_rec_start_offset, match_id, p, dummy_game).await;
                }
            }
            bail!("unable to collect game data (TFT fallback also failed)");
        }
    };
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

    let events: Vec<GameEvent> = timeline
        .frames
        .iter()
        .flat_map(|frame| {
            frame
                .events
                .iter()
                .filter_map(|event| match TryInto::<GameEvent>::try_into(event.clone()) {
                    Ok(e) => Some(e),
                    Err(_) => None,
                })
        })
        .collect();

    // Create PID -> Champion Map for retry logic
    let mut pid_to_champ = std::collections::HashMap::new();
    if let Some(sum_id) = player.summoner_id {
        for p in &game.participants {
            // Fetch Alias/Name
            let result = lcu_rest_client
                .get::<Champion>(format!(
                    "/lol-champions/v1/inventories/{}/champions/{}",
                    sum_id, p.champion_id
                ))
                .await;

            if let Ok(champ) = result {
                pid_to_champ.insert(p.participant_id, champ);
            }
        }
    }

    let merged_events = merge_live_events(
        events,
        live_events,
        &game.participant_identities,
        &game.participants,
        &pid_to_champ,
    );

    // Fetch Rank and Summoner Level
    let pid_to_meta =
        super::lp_helper_meta::fetch_participant_metadata(&lcu_rest_client, &game.participant_identities).await;

    let lane_scores = calculate_lane_scores(&merged_events);

    let participants = game
        .participants
        .iter()
        .map(|p| {
            let identity = game
                .participant_identities
                .iter()
                .find(|pi| pi.participant_id == p.participant_id);
            let name = identity
                .map(|pi| format!("{}#{}", pi.player.game_name, pi.player.tag_line))
                .unwrap_or_else(|| "Unknown".to_string());
            let summoner_id = identity.and_then(|pi| pi.player.summoner_id);

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
                summoner_id,
                honor_received: false,
                lane_score: *lane_scores.get(&p.participant_id).unwrap_or(&0.0),
                champ_level: Some(0),
                summoner_level: pid_to_meta.get(&p.participant_id).map(|m| m.1),
                rank: pid_to_meta
                    .get(&p.participant_id)
                    .map(|m| m.0.clone())
                    .or(Some("Unranked".to_string())),
                // ======== TFT Data Mapping ========
                placement: p.placement,
                players_eliminated: p.players_eliminated,
                level: p.level,
                r#traits: p
                    .r#traits
                    .clone()
                    .map(|traits| traits.into_iter().map(|t| t.into()).collect()),
                units: p
                    .units
                    .clone()
                    .map(|units| units.into_iter().map(|u| u.into()).collect()),
                companion: p.companion.clone().map(|c| c.into()),
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
                    level: Some(pf.level),
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
        game_duration: game.game_duration,
        lp_diff: None,
    })
}

async fn process_tft_fallback(
    ingame_time_rec_start_offset: f64,
    match_id: MatchId,
    player: Player,
    game: Game,
) -> Result<GameMetadata> {
    let queue = Queue {
        id: game.queue_id,
        name: "Teamfight Tactics".into(),
        is_ranked: game.queue_id == 1100,
    };

    let participant_id = game
        .participant_identities
        .iter()
        .find(|pi| pi.player == player)
        .map(|pi| pi.participant_id)
        .context("player not found in TFT fallback game info")?;

    let participants = game
        .participants
        .iter()
        .map(|p| Participant {
            participant_id: p.participant_id,
            team_id: p.team_id,
            champion_id: p.champion_id,
            spell1_id: 0,
            spell2_id: 0,
            stats: p.stats.clone(),
            lane: "NONE".to_string(),
            role: "NONE".to_string(),
            summoner_name: if p.participant_id == participant_id {
                format!("{}#{}", player.game_name, player.tag_line)
            } else {
                "Unknown".to_string()
            },
            summoner_id: if p.participant_id == participant_id {
                player.summoner_id
            } else {
                None
            },
            honor_received: false,
            lane_score: 0.0,
            champ_level: None,
            summoner_level: None,
            rank: None,
            placement: p.placement,
            players_eliminated: p.players_eliminated,
            level: p.level,
            r#traits: p
                .r#traits
                .clone()
                .map(|traits| traits.into_iter().map(|t| t.into()).collect()),
            units: p
                .units
                .clone()
                .map(|units| units.into_iter().map(|u| u.into()).collect()),
            companion: p.companion.clone().map(|c| c.into()),
        })
        .collect();

    Ok(GameMetadata {
        favorite: false,
        match_id,
        ingame_time_rec_start_offset,
        highlights: vec![],
        queue,
        player,
        champion_name: "TFT Champion".into(),
        stats: Default::default(),
        participant_id,
        participants,
        teams: vec![],
        events: vec![],
        gold_timeline: vec![],
        game_version: game.game_version,
        game_duration: game.game_duration,
        lp_diff: None,
    })
}

async fn fetch_tft_fallback_if_exists(lcu_rest_client: &LcuRestClient, match_id: &MatchId) -> Option<Game> {
    if let Some(puuid) = lcu_rest_client
        .get::<serde_json::Value>("/lol-summoner/v1/current-summoner")
        .await
        .ok()
        .and_then(|v| v["puuid"].as_str().map(String::from))
    {
        let endpoint = format!("/lol-match-history/v1/products/tft/{puuid}/matches");
        let tft_history_res = lcu_rest_client
            .get::<riot_datatypes::lcu::TftHistoryResponse>(&endpoint)
            .await;
        if let Ok(history) = tft_history_res {
            // 目的の試合IDが含まれているか探す
            if let Some(tft_game) = history.games.into_iter().find(|g| g.json.game_id == match_id.game_id) {
                // TFT用の情報を使ってダミーの Game 構造体を生成する
                log::info!(
                    "TFT Match {} found in products/tft endpoint. Emulating standard Match Data.",
                    match_id.game_id
                );

                let mut participants = Vec::new();
                for (i, tft_p) in tft_game.json.participants.into_iter().enumerate() {
                    participants.push(riot_datatypes::lcu::Participant {
                        participant_id: (i + 1) as i64,
                        team_id: if tft_p.puuid == puuid { 100 } else { 200 }, // self is 100
                        champion_id: 0,
                        spell1_id: 0,
                        spell2_id: 0,
                        stats: Default::default(),
                        timeline: None,
                        placement: Some(tft_p.placement),
                        players_eliminated: Some(tft_p.players_eliminated),
                        level: Some(tft_p.level),
                        r#traits: tft_p.r#traits,
                        units: tft_p.units,
                        companion: tft_p.companion,
                    });
                }

                let p = lcu_rest_client
                    .get::<Player>("/lol-summoner/v1/current-summoner")
                    .await
                    .unwrap_or_else(|_| Player {
                        summoner_id: None,
                        game_name: "Unknown".into(),
                        tag_line: "TFT".into(),
                    });

                let dummy_game = Game {
                    game_version: "TFT_Fallback".into(),
                    game_id: tft_game.json.game_id,
                    map_id: 22,
                    queue_id: tft_game.json.queue_id,
                    game_duration: (tft_game.json.game_length * 1000.0) as i64,
                    participant_identities: vec![riot_datatypes::lcu::ParticipantIdentity {
                        participant_id: participants
                            .iter()
                            .find(|p| p.team_id == 100)
                            .map(|p| p.participant_id)
                            .unwrap_or(1),
                        player: p,
                    }],
                    participants,
                    teams: vec![],
                };
                return Some(dummy_game);
            }
        }
    }
    None
}

fn merge_live_events(
    mut current_events: Vec<GameEvent>,
    live_events: Vec<LiveGameEvent>,
    participant_identities: &[riot_datatypes::lcu::ParticipantIdentity],
    participants_info: &[riot_datatypes::lcu::Participant],
    pid_to_champ: &std::collections::HashMap<riot_datatypes::ParticipantId, riot_datatypes::Champion>,
) -> Vec<GameEvent> {
    // Create PID -> TeamID Map for fast lookup
    let mut pid_to_team = std::collections::HashMap::new();
    for p in participants_info {
        pid_to_team.insert(p.participant_id, p.team_id);
    }

    for live_event in live_events {
        let (event_time, shopper_name, item, is_undo, is_sell, undo_gold_gain, undo_item_before) = match &live_event {
            LiveGameEvent::ItemPurchased(e) => (e.event_time, &e.shopper_name, &e.item, false, false, None, None),
            LiveGameEvent::ItemSold(e) => (e.event_time, &e.shopper_name, &e.item, false, true, None, None),
            LiveGameEvent::ItemUndo(e) => (
                e.event_time,
                &e.shopper_name,
                &e.item_after,
                true,
                false,
                Some(e.gold_gain as i64),
                Some(&e.item_before),
            ),
            _ => continue,
        };

        // Parse optional tags: "Name#TEAM:<Side>#CNAME:<Name>"
        // CNAME Check
        let (intermediate_name, target_cname) = if let Some(idx_start) = shopper_name.rfind("#CNAME:") {
            let (name_part, cname_part) = shopper_name.split_at(idx_start);
            if let Some(cname_str) = cname_part.strip_prefix("#CNAME:") {
                (name_part, Some(cname_str))
            } else {
                (name_part, None)
            }
        } else {
            (shopper_name.as_str(), None)
        };

        // Team Check
        let (actual_name, target_team_side) = if let Some(idx_start) = intermediate_name.rfind("#TEAM:") {
            let (name_part, team_part) = intermediate_name.split_at(idx_start);
            if let Some(team_str) = team_part.strip_prefix("#TEAM:") {
                let team_id = match team_str {
                    "100" | "ORDER" | "Order" => Some(100i64),
                    "200" | "CHAOS" | "Chaos" => Some(200i64),
                    _ => None,
                };
                (name_part, team_id)
            } else {
                (intermediate_name, None)
            }
        } else {
            (intermediate_name, None)
        };

        // Match Logic
        let identity = participant_identities.iter().find(|pi| {
            let pid = pi.participant_id;

            // 1. CNAME Check (Primary Identity)
            if let Some(req_cname) = target_cname {
                if let Some(champ) = pid_to_champ.get(&pid) {
                    // Check if requested CNAME matches Alias (Key) or Name (Localized)
                    let cname_match = champ.alias == req_cname || champ.name == req_cname;

                    if cname_match {
                        // Check Team as well for sanity
                        if let Some(req_team) = target_team_side {
                            if let Some(&real_team) = pid_to_team.get(&pid) {
                                if real_team == req_team {
                                    return true;
                                }
                            }
                        } else {
                            // If exact CNAME match, we trust it.
                            return true;
                        }
                    }
                }
                // If CNAME is present, we strict match on it.
                return false;
            }

            // 2. Fallback: Name + Team Check
            let full_riot_id = format!("{}#{}", pi.player.game_name, pi.player.tag_line);
            let name_matches = pi.player.game_name == actual_name || full_riot_id == actual_name;
            let partial_match = !actual_name.is_empty()
                && (actual_name.contains(&pi.player.game_name) || pi.player.game_name.contains(actual_name));

            if !name_matches && !partial_match {
                return false;
            }

            if let Some(req_team) = target_team_side {
                if let Some(&real_team) = pid_to_team.get(&pid) {
                    if real_team == req_team {
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    let inferred_team = if pid <= 5 { 100 } else { 200 };
                    return inferred_team == req_team;
                }
            }

            // Legacy
            true
        });

        if identity.is_none() {
            log::warn!("   -> NO MATCH FOUND for '{}'", shopper_name);
        }

        if let Some(identity) = identity {
            let timestamp = (event_time * 1000.0) as i64;

            let event_enum = if is_undo {
                let item_after = item;
                let item_before = undo_item_before.unwrap();
                riot_datatypes::Event::ItemUndo {
                    participant_id: identity.participant_id,
                    before_id: item_before.item_id as i64,
                    after_id: item_after.item_id as i64,
                    gold_gain: undo_gold_gain.unwrap_or(0),
                }
            } else if is_sell {
                let item = item;
                riot_datatypes::Event::ItemSold {
                    participant_id: identity.participant_id,
                    item_id: item.item_id as i64,
                    slot: Some(item.slot as i64),
                }
            } else {
                let item = item;
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

fn calculate_lane_scores(events: &[GameEvent]) -> std::collections::HashMap<i64, f64> {
    let mut scores = std::collections::HashMap::new();
    let mut pos_sums = std::collections::HashMap::new(); // PID -> (x, y, count)

    // 14 minutes in milliseconds
    let time_limit = 14 * 60 * 1000;

    for event in events {
        if event.timestamp > time_limit {
            break; // Events are presumably sorted by timestamp
        }

        if let super::Event::ChampionKill {
            victim_id,
            killer_id,
            assisting_participant_ids,
            position,
        } = &event.event
        {
            // Update logic
            let update = |pid: i64, sums: &mut std::collections::HashMap<i64, (f64, f64, i32)>| {
                let entry = sums.entry(pid).or_insert((0.0, 0.0, 0));
                entry.0 += position.x as f64;
                entry.1 += position.y as f64;
                entry.2 += 1;
            };

            update(*victim_id, &mut pos_sums);
            update(*killer_id, &mut pos_sums);
            for assist_id in assisting_participant_ids {
                update(*assist_id, &mut pos_sums);
            }
        }
    }

    for (pid, (sum_x, sum_y, count)) in pos_sums {
        if count > 0 {
            let avg_x = sum_x / count as f64;
            let avg_y = sum_y / count as f64;
            scores.insert(pid, avg_y - avg_x);
        }
    }

    scores
}
