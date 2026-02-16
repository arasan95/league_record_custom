use riot_datatypes::{lcu, ParticipantId};
use serde_json::Value;
use shaco::rest::LcuRestClient;
use std::collections::HashMap;

/// Helper to fetch Sumonner Level and Rank for participants
pub async fn fetch_participant_metadata(
    lcu_rest_client: &LcuRestClient,
    identities: &[lcu::ParticipantIdentity],
) -> HashMap<ParticipantId, (String, i32)> {
    let mut pid_to_meta: HashMap<ParticipantId, (String, i32)> = HashMap::new();

    for identity in identities {
        let mut rank_str = "Unranked".to_string();
        let mut summoner_level = 0;
        let mut puuid = String::new();

        // 1. Get Summoner Level & PUUID
        // identity.player.summoner_id is Option<u64>
        if let Some(sum_id) = identity.player.summoner_id {
            // Fetch Summoner Info
            let summoner_info: Option<Value> = lcu_rest_client
                .get(format!("/lol-summoner/v1/summoners/{}", sum_id))
                .await
                .ok();

            if let Some(info) = summoner_info {
                if let Some(sl) = info.get("summonerLevel").and_then(|v| v.as_i64()) {
                    summoner_level = sl as i32;
                }
                if let Some(p) = info.get("puuid").and_then(|v| v.as_str()) {
                    puuid = p.to_string();
                }
            }
        }

        // 2. Get Rank if PUUID available
        if !puuid.is_empty() {
            // /lol-ranked/v1/ranked-stats/{puuid}
            let ranked_stats: Option<Value> = lcu_rest_client
                .get(format!("/lol-ranked/v1/ranked-stats/{}", puuid))
                .await
                .ok();

            if let Some(stats) = ranked_stats {
                if let Some(queues) = stats.get("queues").and_then(|v| v.as_array()) {
                    // Find RANKED_SOLO_5x5
                    if let Some(solo_q) = queues
                        .iter()
                        .find(|q| q.get("queueType").and_then(|t| t.as_str()).unwrap_or("") == "RANKED_SOLO_5x5")
                    {
                        let tier = solo_q.get("tier").and_then(|t| t.as_str()).unwrap_or("");
                        let division = solo_q.get("division").and_then(|d| d.as_str()).unwrap_or("");

                        if !tier.is_empty() {
                            // Format: "GOLD IV"
                            rank_str = if division.is_empty() {
                                tier.to_string()
                            } else {
                                format!("{} {}", tier, division)
                            };
                        }
                    }
                }
            }
        }

        pid_to_meta.insert(identity.participant_id, (rank_str, summoner_level));
    }

    pid_to_meta
}
