use riot_local_auth::Credentials;
use serde_json::Value;
use shaco::rest::LcuRestClient;

#[derive(Debug, Clone)]
pub struct RankedLpSnapshot {
    pub queue_type: String,
    pub tier: String,
    pub division: String,
    pub league_points: i32,
}

impl RankedLpSnapshot {
    pub fn lp_diff_from(&self, start: &RankedLpSnapshot) -> Option<i32> {
        if self.queue_type != start.queue_type {
            log::warn!(
                "LP queue changed while calculating diff: start={}, end={}",
                start.queue_type,
                self.queue_type
            );
            return None;
        }

        match (rank_score(start), rank_score(self)) {
            (Some(start_score), Some(end_score)) => Some(end_score - start_score),
            _ if self.tier == start.tier && self.division == start.division => {
                Some(self.league_points - start.league_points)
            }
            _ => {
                log::warn!(
                    "Could not calculate LP diff across rank change: start={:?}, end={:?}",
                    start,
                    self
                );
                None
            }
        }
    }
}

pub fn ranked_queue_type_for_queue_id(queue_id: i64) -> Option<&'static str> {
    match queue_id {
        420 => Some("RANKED_SOLO_5x5"),
        440 => Some("RANKED_FLEX_SR"),
        _ => None,
    }
}

pub async fn fetch_current_lp(credentials: &Credentials, queue_id: i64) -> Option<RankedLpSnapshot> {
    let queue_type = ranked_queue_type_for_queue_id(queue_id)?;
    let client = LcuRestClient::from(credentials);
    // Endpoint: /lol-ranked/v1/current-ranked-stats
    match client.get::<Value>("/lol-ranked/v1/current-ranked-stats").await {
        Ok(data) => {
            let queues = data.get("queues")?.as_array()?;
            for q in queues {
                if q.get("queueType").and_then(|qt| qt.as_str()) == Some(queue_type) {
                    let lp = q.get("leaguePoints").and_then(|lp| lp.as_i64())? as i32;
                    let tier = q.get("tier").and_then(|tier| tier.as_str()).unwrap_or("").to_string();
                    let division = q
                        .get("division")
                        .and_then(|division| division.as_str())
                        .unwrap_or("")
                        .to_string();

                    return Some(RankedLpSnapshot {
                        queue_type: queue_type.to_string(),
                        tier,
                        division,
                        league_points: lp,
                    });
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

fn rank_score(snapshot: &RankedLpSnapshot) -> Option<i32> {
    let tier_index = match snapshot.tier.as_str() {
        "IRON" => 0,
        "BRONZE" => 1,
        "SILVER" => 2,
        "GOLD" => 3,
        "PLATINUM" => 4,
        "EMERALD" => 5,
        "DIAMOND" => 6,
        "MASTER" | "GRANDMASTER" | "CHALLENGER" => 7,
        _ => return None,
    };

    let division_index = match snapshot.tier.as_str() {
        "MASTER" | "GRANDMASTER" | "CHALLENGER" => 0,
        _ => match snapshot.division.as_str() {
            "IV" => 0,
            "III" => 1,
            "II" => 2,
            "I" => 3,
            _ => return None,
        },
    };

    Some(tier_index * 400 + division_index * 100 + snapshot.league_points)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(tier: &str, division: &str, league_points: i32) -> RankedLpSnapshot {
        RankedLpSnapshot {
            queue_type: "RANKED_SOLO_5x5".to_string(),
            tier: tier.to_string(),
            division: division.to_string(),
            league_points,
        }
    }

    #[test]
    fn lp_diff_handles_promotion_lp_reset() {
        let start = snapshot("GOLD", "IV", 70);
        let end = snapshot("GOLD", "III", 0);

        assert_eq!(end.lp_diff_from(&start), Some(30));
    }

    #[test]
    fn lp_diff_handles_demotion_lp_reset() {
        let start = snapshot("GOLD", "III", 0);
        let end = snapshot("GOLD", "IV", 75);

        assert_eq!(end.lp_diff_from(&start), Some(-25));
    }

    #[test]
    fn ranked_queue_type_matches_solo_and_flex_ids() {
        assert_eq!(ranked_queue_type_for_queue_id(420), Some("RANKED_SOLO_5x5"));
        assert_eq!(ranked_queue_type_for_queue_id(440), Some("RANKED_FLEX_SR"));
        assert_eq!(ranked_queue_type_for_queue_id(400), None);
    }

    #[test]
    fn lp_diff_keeps_apex_lp_continuous() {
        let start = snapshot("MASTER", "", 250);
        let end = snapshot("GRANDMASTER", "", 255);

        assert_eq!(end.lp_diff_from(&start), Some(5));
    }
}
