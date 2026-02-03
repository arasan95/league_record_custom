use riot_local_auth::Credentials;
use serde_json::Value;
use shaco::rest::LcuRestClient;

pub async fn fetch_current_lp(credentials: &Credentials) -> Option<i32> {
    let client = LcuRestClient::from(credentials);
    // Endpoint: /lol-ranked/v1/current-ranked-stats
    match client.get::<Value>("/lol-ranked/v1/current-ranked-stats").await {
        Ok(data) => {
            // Find RANKED_SOLO_5x5
            let queues = data.get("queues")?.as_array()?;
            for q in queues {
                if q.get("queueType").and_then(|qt| qt.as_str()) == Some("RANKED_SOLO_5x5") {
                    let lp = q.get("leaguePoints").and_then(|lp| lp.as_i64())? as i32;
                    return Some(lp);
                }
            }
            None
        }
        Err(e) => {
            log::warn!("Failed to fetch LP: {}", e);
            None
        }
    }
}
