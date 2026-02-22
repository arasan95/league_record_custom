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
    #[serde(default)]
    pub team_id: i64,
    #[serde(default)]
    pub champion_id: ChampionId,
    #[serde(default)]
    pub spell1_id: SpellId,
    #[serde(default)]
    pub spell2_id: SpellId,
    #[serde(default)]
    pub stats: Stats,
    #[serde(default)]
    pub timeline: Option<ParticipantTimeline>,

    // ======== TFT Specific Fields ======== //
    #[serde(default)]
    pub placement: Option<i64>,
    #[serde(default)]
    pub players_eliminated: Option<i64>,
    #[serde(default)]
    pub level: Option<i64>,
    #[serde(default)]
    pub r#traits: Option<Vec<TftTrait>>,
    #[serde(default)]
    pub units: Option<Vec<TftUnit>>,
    #[serde(default)]
    pub companion: Option<TftCompanion>,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftUnit {
    #[serde(alias = "character_id")]
    pub character_id: String,
    pub name: String,
    pub rarity: i64,
    pub tier: i64,
    #[serde(default, alias = "item_names")]
    pub item_names: Vec<String>,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftTrait {
    pub name: String,
    #[serde(alias = "num_units")]
    pub num_units: i64,
    pub style: i64,
    #[serde(alias = "tier_current")]
    pub tier_current: i64,
    #[serde(alias = "tier_total")]
    pub tier_total: i64,
}

#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftCompanion {
    #[serde(rename = "contentID", alias = "content_ID")]
    pub content_i_d: String,
    #[serde(rename = "skinID", alias = "skin_ID")]
    pub skin_i_d: i64,
    pub species: String,
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

impl Default for Stats {
    fn default() -> Self {
        Self {
            kills: 0,
            deaths: 0,
            assists: 0,
            largest_multi_kill: 0,
            neutral_minions_killed: 0,
            neutral_minions_killed_enemy_jungle: 0,
            neutral_minions_killed_team_jungle: 0,
            total_minions_killed: 0,
            vision_score: 0.0,
            vision_wards_bought_in_game: 0,
            wards_placed: 0,
            wards_killed: 0,
            game_ended_in_early_surrender: false,
            game_ended_in_surrender: false,
            win: false,
            item0: 0,
            item1: 0,
            item2: 0,
            item3: 0,
            item4: 0,
            item5: 0,
            item6: 0,
            perk0: 0,
            perk1: 0,
            perk2: 0,
            perk3: 0,
            perk4: 0,
            perk5: 0,
            perk_primary_style: 0,
            perk_sub_style: 0,
            gold_earned: 0,
        }
    }
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

// ======== TFT Match History Data Structures ======== //

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftHistoryResponse {
    pub games: Vec<TftHistoryGame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftHistoryGame {
    pub json: TftGameJson,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftGameJson {
    pub game_id: GameId,
    #[serde(alias = "game_length")]
    pub game_length: f64,
    pub queue_id: QueueId,
    pub participants: Vec<TftHistoryParticipant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftHistoryParticipant {
    pub puuid: String,
    pub placement: i64,
    #[serde(alias = "players_eliminated")]
    pub players_eliminated: i64,
    pub level: i64,
    #[serde(default)]
    pub r#traits: Option<Vec<TftTrait>>,
    #[serde(default)]
    pub units: Option<Vec<TftUnit>>,
    #[serde(default)]
    pub companion: Option<TftCompanion>,
}
