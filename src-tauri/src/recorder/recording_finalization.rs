use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use riot_datatypes::GameId;
use serde::Deserialize;
use shaco::model::ingame::GameEvent as LiveGameEvent;
use shaco::rest::LcuRestClient;
use tauri::async_runtime;

use crate::app::{action, AppEvent, EventManager};
use crate::recorder::MetadataFile;

use super::lp_helper::{fetch_current_lp, RankedLpSnapshot};
use super::metadata;
use super::live_game::is_tft_queue_id;
use super::recording_session::ApiCtx;
use super::recording_task::Metadata;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HonorRecognition {
    sender_puuid: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HonorRecognitionHistoryEntry {
    game_id: GameId,
    puuid: String,
    summoner_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HonorBallotPlayer {
    puuid: String,
    summoner_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HonorBallot {
    eligible_allies: Vec<HonorBallotPlayer>,
}

async fn fetch_honor_sender_summoner_ids(lcu_rest_client: &LcuRestClient, game_id: GameId) -> Result<HashSet<i64>> {
    let recognitions = lcu_rest_client
        .get::<Vec<HonorRecognition>>("/lol-honor-v2/v1/recognition")
        .await?;
    let sender_puuids: HashSet<String> = recognitions
        .into_iter()
        .filter_map(|recognition| {
            let puuid = recognition.sender_puuid.trim();
            (!puuid.is_empty()).then(|| puuid.to_string())
        })
        .collect();

    if sender_puuids.is_empty() {
        return Ok(HashSet::new());
    }

    let mut sender_summoner_ids = HashSet::new();

    if let Ok(history) = lcu_rest_client
        .get::<Vec<HonorRecognitionHistoryEntry>>("/lol-honor-v2/v1/recognition-history")
        .await
    {
        for entry in history {
            if entry.game_id == game_id && sender_puuids.contains(&entry.puuid) {
                sender_summoner_ids.insert(entry.summoner_id);
            }
        }
    }

    if let Ok(ballot) = lcu_rest_client.get::<HonorBallot>("/lol-honor-v2/v1/ballot").await {
        for ally in ballot.eligible_allies {
            if sender_puuids.contains(&ally.puuid) {
                sender_summoner_ids.insert(ally.summoner_id);
            }
        }
    }

    Ok(sender_summoner_ids)
}

fn mark_honor_received(metadata_file: &mut MetadataFile, sender_summoner_ids: &HashSet<i64>) -> bool {
    let participants = match metadata_file {
        MetadataFile::Metadata(metadata) => &mut metadata.participants,
        MetadataFile::Deferred(deferred) => &mut deferred.participants,
        MetadataFile::NoData(_) => return false,
    };

    let mut changed = false;
    for participant in participants {
        let received = participant
            .summoner_id
            .is_some_and(|summoner_id| sender_summoner_ids.contains(&summoner_id));
        if received && !participant.honor_received {
            participant.honor_received = true;
            changed = true;
        }
    }
    changed
}

async fn append_honor_received_metadata(ctx: ApiCtx, metadata_filepath: PathBuf, video_id: String, game_id: GameId) {
    let lcu_rest_client = LcuRestClient::from(&ctx.credentials);

    for attempt in 1..=10 {
        if ctx.cancel_token.is_cancelled() {
            return;
        }

        match fetch_honor_sender_summoner_ids(&lcu_rest_client, game_id).await {
            Ok(sender_summoner_ids) if !sender_summoner_ids.is_empty() => {
                match action::update_recording_metadata(&metadata_filepath, |current| {
                    mark_honor_received(current, &sender_summoner_ids)
                }) {
                    Ok(true) => {
                        let _ = ctx.app_handle.send_event(AppEvent::MetadataChanged { payload: vec![video_id] });
                    }
                    Ok(false) => {}
                    Err(error) => log::warn!("failed to append honor metadata: {error}"),
                }
                return;
            }
            Ok(_) => {
                log::debug!("Honor recognition not ready yet (attempt {attempt}/10)");
            }
            Err(e) => {
                log::debug!("Honor recognition fetch failed (attempt {attempt}/10): {e}");
            }
        }

        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    log::info!("Honor recognition was not available for game_id={game_id}");
}

pub(super) fn finalize_metadata(
    ctx: ApiCtx,
    metadata: Metadata,
    live_events: Vec<LiveGameEvent>,
    start_lp: Option<RankedLpSnapshot>,
) {
    async_runtime::spawn(async move {
        let Metadata {
            match_id,
            output_filepath,
            ingame_time_rec_start_offset,
        } = metadata;
        let honor_game_id = match_id.game_id;

        let mut metadata_filepath = output_filepath;
        let video_id = metadata_filepath.to_str().map(str::to_owned);
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
                let is_tft_metadata = is_tft_queue_id(game_metadata.queue.id);
                if !is_tft_metadata {
                    game_metadata.tft_round_markers.clear();
                }

                // Calculate LP Diff
                if !is_tft_metadata {
                    if let Some(s_lp) = &start_lp {
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

                        if let Some(end_lp) = fetch_current_lp(&ctx.credentials, game_metadata.queue.id).await {
                            if let Some(diff) = end_lp.lp_diff_from(s_lp) {
                                log::info!("LP Update: Start={:?}, End={:?}, Diff={}", s_lp, end_lp, diff);
                                game_metadata.lp_diff = Some(diff);
                            }
                        } else {
                            log::warn!("Could not fetch End LP");
                        }
                    }
                }

                let tft_round_markers_empty = game_metadata.tft_round_markers.is_empty();
                let result = action::update_recording_metadata(&metadata_filepath, |current| {
                    game_metadata.favorite = current.is_favorite();
                    if let MetadataFile::Deferred(deferred) = current {
                        game_metadata.highlights = std::mem::take(&mut deferred.highlights);
                        if is_tft_metadata {
                            game_metadata.tft_round_markers = std::mem::take(&mut deferred.tft_round_markers);
                        }
                    }
                    *current = MetadataFile::Metadata(game_metadata);
                });
                if let Err(error) = &result {
                    log::error!("Could not persist recording metadata: {error}");
                    let _ = ctx.app_handle.send_event(AppEvent::RecordingMetadataSaveFailed { payload: error.to_string() });
                }
                let should_backfill_tft_rounds = false && result.is_ok() && is_tft_metadata && tft_round_markers_empty;
                if should_backfill_tft_rounds {
                    let video_path = metadata_filepath.with_extension("mp4");
                    let backfill_metadata_path = metadata_filepath.clone();
                    let backfill_app_handle = ctx.app_handle.clone();
                    let backfill_video_id = video_id.clone();
                    async_runtime::spawn(async move {
                        match super::tft_round_ocr::backfill_from_recording(
                            backfill_app_handle.clone(),
                            video_path,
                            backfill_metadata_path,
                        )
                        .await
                        {
                            Ok(count) if count > 0 => {
                                log::info!("backfilled {count} TFT round markers");
                                if let Some(video_id) = backfill_video_id {
                                    let _ = backfill_app_handle
                                        .send_event(AppEvent::MetadataChanged { payload: vec![video_id] });
                                }
                            }
                            Ok(_) => {}
                            Err(e) => log::warn!("failed to backfill TFT round markers: {e}"),
                        }
                    });
                }
            }
            Err(e) => log::error!("unable to process data: {e}"),
        }

        if let Some(video_id) = video_id {
            if let Err(e) = ctx.app_handle.send_event(AppEvent::MetadataChanged {
                payload: vec![video_id.clone()],
            }) {
                log::error!("Recording finalization failed to send event: {e}");
            }

            let honor_ctx = ctx.clone();
            let honor_metadata_filepath = metadata_filepath.clone();
            let honor_video_id = video_id.clone();
            async_runtime::spawn(async move {
                append_honor_received_metadata(honor_ctx, honor_metadata_filepath, honor_video_id, honor_game_id).await;
            });
        }
    });
}
