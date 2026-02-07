export type AudioSource = 
/**
 * no audio
 */
"NONE" | 
/**
 * only the audio of the window that is being captured
 */
"APPLICATION" | 
/**
 * the default audio output of the pc
 */
"SYSTEM" | 
/**
 * the default audio input and output of the pc
 */
"ALL"
export type Ban = { championId: number; pickTurn: number }
export type BuildingType = { buildingType: "INHIBITOR_BUILDING"; lane_type: LaneType } | { buildingType: "TOWER_BUILDING"; lane_type: LaneType; tower_type: TowerType }
export type Deferred = { favorite: boolean; matchId: MatchId; ingameTimeRecStartOffset: number; highlights?: number[] }
export type DragonType = "FIRE_DRAGON" | "EARTH_DRAGON" | "WATER_DRAGON" | "AIR_DRAGON" | "HEXTECH_DRAGON" | "CHEMTECH_DRAGON" | "ELDER_DRAGON"
export type Framerate = [number, number]
export type GameEvent = ({ ChampionKill: { victim_id: number; killer_id: number; assisting_participant_ids: number[]; position: Position } } | { BuildingKill: { team_id: Team; killer_id: number; building_type: BuildingType; assisting_participant_ids: number[] } } | { EliteMonsterKill: { killer_id: number; monster_type: MonsterType; assisting_participant_ids: number[] } } | { ItemPurchased: { participant_id: number; item_id: number; slot?: number | null } } | { ItemSold: { participant_id: number; item_id: number; slot?: number | null } } | { ItemUndo: { participant_id: number; before_id: number; after_id: number; gold_gain: number } }) & { timestamp: number }
export type GameMetadata = { favorite: boolean; matchId: MatchId; ingameTimeRecStartOffset: number; highlights?: number[]; queue: Queue; player: Player; championName: string; stats: Stats; participantId: number; participants: Participant[]; teams: MatchTeam[]; events: GameEvent[]; goldTimeline?: GoldFrame[]; gameVersion?: string; lpDiff?: number | null }
export type GoldFrame = { timestamp: number; participants: ParticipantGold[] }
export type LaneType = "TOP_LANE" | "MID_LANE" | "BOT_LANE"
export type MarkerFlags = { kill: boolean; death: boolean; assist: boolean; structure: boolean; dragon: boolean; voidgrub: boolean; herald: boolean; baron: boolean }
export type MatchId = { gameId: number; platformId: string }
export type MatchTeam = { teamId: number; win: string | null; towerKills: number; inhibitorKills: number; baronKills: number; dragonKills: number; vilemawKills: number; riftHeraldKills: number; dominionVictoryScore: number; bans: Ban[] }
export type MetadataFile = { Metadata: GameMetadata } | { Deferred: Deferred } | { NoData: NoData }
export type MonsterType = { monsterType: "HORDE" } | { monsterType: "RIFTHERALD" } | { monsterType: "BARON_NASHOR" } | { monsterType: "DRAGON"; monsterSubType: DragonType }
export type NoData = { favorite: boolean }
export type Participant = { participantId: number; teamId: number; championId: number; spell1Id: number; spell2Id: number; stats: Stats; lane?: string; role?: string; summonerName?: string; laneScore?: number }
export type ParticipantGold = { participantId: number; totalGold: number; minions?: number }
export type Player = { gameName: string; tagLine: string; summonerId?: number | null }
export type Position = { x: number; y: number }
export type Queue = { id: number; name: string; isRanked: boolean }
export type Settings = { markerFlags: MarkerFlags; debugLog: boolean; recordingsFolder: string; clipsFolder: string; filenameFormat: string; encodingQuality: number; outputResolution: StdResolution | null; framerate: Framerate; recordAudio: AudioSource; autostart: boolean; maxRecordingAgeDays: number | null; maxRecordingsSizeGb: number | null; confirmDelete: boolean; hightlightHotkey: string | null; startRecordingHotkey: string | null; stopRecordingHotkey: string | null; gameModes: string[] | null; autoplayVideo: boolean; autoStopPlayback: boolean; autoSelectRecording: boolean; autoPopupOnEnd: boolean; ffmpegPath: string | null; developerMode: boolean; matchHistoryBaseUrl: string | null; scrollFrameStepModifier: string | null; scoreboardScale: number | null; playRecordingSounds: boolean; language: string }
export type Stats = { kills: number; deaths: number; assists: number; largestMultiKill: number; neutralMinionsKilled: number; neutralMinionsKilledEnemyJungle: number; neutralMinionsKilledTeamJungle: number; totalMinionsKilled: number; visionScore: number; visionWardsBoughtInGame: number; wardsPlaced: number; wardsKilled: number; 
/**
 * remake
 * if this field is true `win` has to be ignored because the team that had to remake counts as the loser of the game
 * surrenders pre minute 20 count as a normal surrender (field `game_ended_in_surrender`)
 */
gameEndedInEarlySurrender: boolean; gameEndedInSurrender: boolean; win: boolean; item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number; perk0: number; perk1: number; perk2: number; perk3: number; perk4: number; perk5: number; perkPrimaryStyle: number; perkSubStyle: number; goldEarned: number }
/**
 * most common resolutions for the aspect ratios 4:3, 5:4, 16:9, 16:10, 21:9, 43:18, 24:10, 32:9, 32:10
 */
export type StdResolution = 
/**
 * 4:3 1024x768p
 */
"1024x768p" | 
/**
 * 4:3 1600x1200p
 */
"1600x1200p" | 
/**
 * 5:4 1280x1024p
 */
"1280x1024p" | 
/**
 * 16:9 1280x720p
 */
"1280x720p" | 
/**
 * 16:9 1366x768p
 */
"1366x768p" | 
/**
 * 16:9 1600x900p
 */
"1600x900p" | 
/**
 * 16:9 1920x1080p
 */
"1920x1080p" | 
/**
 * 16:9 2560x1440p
 */
"2560x1440p" | 
/**
 * 16:9 3840x2160p
 */
"3840x2160p" | 
/**
 * 16:9 5120x2880p
 */
"5120x2880p" | 
/**
 * 16:10 1280x800p
 */
"1280x800p" | 
/**
 * 16:10 1440x900p
 */
"1440x900p" | 
/**
 * 16:10 1680x1050p
 */
"1680x1050p" | 
/**
 * 16:10 1920x1200p
 */
"1920x1200p" | 
/**
 * 16:10 2240x1400p
 */
"2240x1400p" | 
/**
 * 16:10 2560x1600p
 */
"2560x1600p" | 
/**
 * 21:9 2560x1080p
 */
"2560x1080p" | 
/**
 * 21:9 5120x2160p
 */
"5120x2160p" | 
/**
 * 43:18 2580x1080p
 */
"2580x1080p" | 
/**
 * 43:18 3440x1440p
 */
"3440x1440p" | 
/**
 * 24:10 3840x1600p
 */
"3840x1600p" | 
/**
 * 32:9 3840x1080p
 */
"3840x1080p" | 
/**
 * 32:9 5120x1440p
 */
"5120x1440p" | 
/**
 * 32:10 3840x1200p
 */
"3840x1200p"
export type Team = "BLUE" | "RED"
export type TowerType = "OUTER_TURRET" | "INNER_TURRET" | "BASE_TURRET" | "NEXUS_TURRET"