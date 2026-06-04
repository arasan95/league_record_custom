use riot_datatypes::*;
use serde::{Deserialize, Serialize};

fn is_false(value: &bool) -> bool {
    !*value
}

// allow large difference in enum Variant size because the big variant is the more common one
#[allow(clippy::large_enum_variant)]
#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MetadataFile {
    Metadata(GameMetadata),
    Deferred(Deferred),
    NoData(NoData),
}

impl MetadataFile {
    pub fn is_favorite(&self) -> bool {
        match self {
            MetadataFile::Metadata(metadata) => metadata.favorite,
            MetadataFile::Deferred(deferred) => deferred.favorite,
            MetadataFile::NoData(no_data) => no_data.favorite,
        }
    }

    pub fn set_favorite(&mut self, favorite: bool) {
        match self {
            MetadataFile::Metadata(metadata) => metadata.favorite = favorite,
            MetadataFile::Deferred(deferred) => deferred.favorite = favorite,
            MetadataFile::NoData(no_data) => no_data.favorite = favorite,
        };
    }
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub participant_id: ParticipantId,
    pub team_id: i64,
    pub champion_id: ChampionId,
    pub spell1_id: SpellId,
    pub spell2_id: SpellId,
    pub stats: lcu::Stats,
    #[serde(default)]
    pub lane: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub summoner_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summoner_id: Option<SummonerId>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub honor_received: bool,
    #[serde(default)]
    pub lane_score: f64,
    #[serde(default)]
    pub champ_level: Option<i32>,
    #[serde(default)]
    pub summoner_level: Option<i32>,
    #[serde(default)]
    pub rank: Option<String>,

    // ======== TFT Specific Fields ======== //
    #[serde(default, alias = "placement")]
    pub placement: Option<i64>,
    #[serde(default, alias = "players_eliminated")]
    pub players_eliminated: Option<i64>,
    #[serde(default, alias = "level")]
    pub level: Option<i64>,
    #[serde(default, alias = "traits")]
    pub r#traits: Option<Vec<TftTrait>>,
    #[serde(default, alias = "units")]
    pub units: Option<Vec<TftUnit>>,
    #[serde(default, alias = "companion")]
    pub companion: Option<TftCompanion>,
}

#[cfg_attr(test, derive(specta::Type))]
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

#[cfg_attr(test, derive(specta::Type))]
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

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftCompanion {
    #[serde(rename = "contentID", alias = "content_ID")]
    pub content_i_d: String,
    #[serde(rename = "skinID", alias = "skin_ID")]
    pub skin_i_d: i64,
    pub species: String,
}

impl From<riot_datatypes::lcu::TftUnit> for TftUnit {
    fn from(u: riot_datatypes::lcu::TftUnit) -> Self {
        Self {
            character_id: u.character_id,
            name: u.name,
            rarity: u.rarity,
            tier: u.tier,
            item_names: u.item_names,
        }
    }
}

impl From<riot_datatypes::lcu::TftTrait> for TftTrait {
    fn from(t: riot_datatypes::lcu::TftTrait) -> Self {
        Self {
            name: t.name,
            num_units: t.num_units,
            style: t.style,
            tier_current: t.tier_current,
            tier_total: t.tier_total,
        }
    }
}

impl From<riot_datatypes::lcu::TftCompanion> for TftCompanion {
    fn from(c: riot_datatypes::lcu::TftCompanion) -> Self {
        Self {
            content_i_d: c.content_i_d,
            skin_i_d: c.skin_i_d,
            species: c.species,
        }
    }
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantGold {
    pub participant_id: ParticipantId,
    pub total_gold: i64,
    #[serde(default)]
    pub minions: i64,
    #[serde(default)]
    pub level: Option<i64>,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldFrame {
    pub timestamp: Timestamp,
    pub participants: Vec<ParticipantGold>,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TftRoundMarker {
    pub round: String,
    pub timestamp: f64,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadata {
    pub favorite: bool,
    pub match_id: MatchId,
    pub ingame_time_rec_start_offset: f64,
    #[serde(default)]
    pub highlights: Vec<f64>,
    #[serde(default)]
    pub tft_round_markers: Vec<TftRoundMarker>,
    pub queue: Queue,
    pub player: lcu::Player,
    pub champion_name: String,
    pub stats: lcu::Stats,
    pub participant_id: ParticipantId,
    pub participants: Vec<Participant>,
    pub teams: Vec<lcu::MatchTeam>,
    pub events: Vec<GameEvent>,
    #[serde(default)]
    pub gold_timeline: Vec<GoldFrame>,
    #[serde(default)]
    pub game_version: String,
    #[serde(default)]
    pub game_duration: i64,
    #[serde(default)]
    pub lp_diff: Option<i32>,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deferred {
    pub favorite: bool,
    pub match_id: MatchId,
    pub ingame_time_rec_start_offset: f64,
    #[serde(default)]
    pub highlights: Vec<f64>,
    #[serde(default)]
    pub tft_round_markers: Vec<TftRoundMarker>,
    #[serde(default)]
    pub events: Vec<GameEvent>,
    #[serde(default)]
    pub participants: Vec<Participant>,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoData {
    pub favorite: bool,
}

// seperate struct for frontend compatability since Specta is a bit limited for now and doesn't support some of the
// tags on the 'deserialization struct'
#[allow(clippy::enum_variant_names)]
#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameEvent {
    #[serde(flatten)]
    pub event: Event,
    pub timestamp: Timestamp,
}

// seperate struct for frontend compatability since Specta is a bit limited for now and doesn't support some of the
// tags on the 'deserialization struct'
#[allow(clippy::enum_variant_names)]
#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Event {
    ChampionKill {
        victim_id: ParticipantId,
        killer_id: ParticipantId,
        assisting_participant_ids: Vec<ParticipantId>,
        position: Position,
    },
    BuildingKill {
        team_id: Team,
        killer_id: ParticipantId,
        building_type: BuildingType,
        assisting_participant_ids: Vec<ParticipantId>,
    },
    EliteMonsterKill {
        killer_id: ParticipantId,
        monster_type: MonsterType,
        assisting_participant_ids: Vec<ParticipantId>,
    },
    ItemPurchased {
        participant_id: ParticipantId,
        item_id: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        slot: Option<i64>,
    },
    ItemSold {
        participant_id: ParticipantId,
        item_id: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        slot: Option<i64>,
    },
    ItemUndo {
        participant_id: ParticipantId,
        before_id: i64,
        after_id: i64,
        gold_gain: i64,
    },
}

#[derive(Debug, Clone)]
pub struct UnknownEvent(riot_datatypes::Event);

impl std::error::Error for UnknownEvent {}

impl std::fmt::Display for UnknownEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_fmt(format_args!("{:#?}", self.0))
    }
}

impl TryFrom<riot_datatypes::Event> for Event {
    type Error = UnknownEvent;

    fn try_from(value: riot_datatypes::Event) -> Result<Self, Self::Error> {
        Ok(match value {
            riot_datatypes::Event::ChampionKill {
                victim_id,
                killer_id,
                assisting_participant_ids,
                position,
            } => Event::ChampionKill {
                victim_id,
                killer_id,
                assisting_participant_ids,
                position,
            },
            riot_datatypes::Event::BuildingKill {
                team_id,
                killer_id,
                building_type,
                assisting_participant_ids,
            } => Event::BuildingKill {
                team_id,
                killer_id,
                building_type,
                assisting_participant_ids,
            },
            riot_datatypes::Event::EliteMonsterKill {
                killer_id,
                monster_type,
                assisting_participant_ids,
            } => Event::EliteMonsterKill {
                killer_id,
                monster_type,
                assisting_participant_ids,
            },
            riot_datatypes::Event::ItemPurchased { participant_id, item_id, slot } => {
                Event::ItemPurchased { participant_id, item_id, slot }
            }
            riot_datatypes::Event::ItemSold { participant_id, item_id, slot } => {
                Event::ItemSold { participant_id, item_id, slot }
            }
            riot_datatypes::Event::ItemUndo {
                participant_id,
                before_id,
                after_id,
                gold_gain,
            } => Event::ItemUndo {
                participant_id,
                before_id,
                after_id,
                gold_gain,
            },
            event => return Err(UnknownEvent(event)),
        })
    }
}

impl TryFrom<riot_datatypes::GameEvent> for GameEvent {
    type Error = UnknownEvent;

    fn try_from(value: riot_datatypes::GameEvent) -> Result<Self, Self::Error> {
        Ok(GameEvent {
            event: value.event.try_into()?,
            timestamp: value.timestamp,
        })
    }
}
