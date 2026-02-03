use serde::{Deserialize, Serialize};

use crate::{ChampionId, GameId, MapId, ParticipantId, QueueId, SpellId, SummonerId, Timestamp};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub game_version: String,
    pub game_id: GameId,
    pub map_id: MapId,
    pub queue_id: QueueId,
    pub game_duration: Timestamp,
    pub participant_identities: Vec<ParticipantIdentity>,
    pub participants: Vec<Participant>,
    pub teams: Vec<MatchTeam>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantIdentity {
    pub participant_id: ParticipantId,
    pub player: Player,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub game_name: String,
    pub tag_line: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summoner_id: Option<SummonerId>,
}

impl PartialEq for Player {
    fn eq(&self, other: &Self) -> bool {
        self.game_name == other.game_name && self.tag_line == other.tag_line
    }
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantTimeline {
    pub lane: String,
    pub role: String,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub participant_id: ParticipantId,
    pub team_id: i64,
    pub champion_id: ChampionId,
    pub spell1_id: SpellId,
    pub spell2_id: SpellId,
    pub stats: Stats,
    #[serde(default)]
    pub timeline: Option<ParticipantTimeline>,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub largest_multi_kill: i64,
    pub neutral_minions_killed: i64,
    pub neutral_minions_killed_enemy_jungle: i64,
    pub neutral_minions_killed_team_jungle: i64,
    pub total_minions_killed: i64,
    pub vision_score: f64,
    pub vision_wards_bought_in_game: i64,
    pub wards_placed: i64,
    pub wards_killed: i64,
    /// remake
    /// if this field is true `win` has to be ignored because the team that had to remake counts as the loser of the game
    /// surrenders pre minute 20 count as a normal surrender (field `game_ended_in_surrender`)
    pub game_ended_in_early_surrender: bool,
    pub game_ended_in_surrender: bool,
    pub win: bool,
    pub item0: i64,
    pub item1: i64,
    pub item2: i64,
    pub item3: i64,
    pub item4: i64,
    pub item5: i64,
    pub item6: i64,
    pub perk0: i64,
    pub perk1: i64,
    pub perk2: i64,
    pub perk3: i64,
    pub perk4: i64,
    pub perk5: i64,
    pub perk_primary_style: i64,
    pub perk_sub_style: i64,
    pub gold_earned: i64,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchTeam {
    pub team_id: i64,
    pub win: Option<String>,
    pub tower_kills: i64,
    pub inhibitor_kills: i64,
    pub baron_kills: i64,
    pub dragon_kills: i64,
    pub vilemaw_kills: i64,
    pub rift_herald_kills: i64,
    pub dominion_victory_score: i64,
    pub bans: Vec<Ban>,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ban {
    pub champion_id: ChampionId,
    pub pick_turn: i64,
}
