import type { GameMetadata, MetadataFile } from "./bindings";
import { fetchReplayShareDocument } from "./platform/firebase";
import { isPublicYouTubeVideoAvailable } from "./platform/youtube";

export const MAX_REPLAY_SHARE_PAYLOAD_BYTES = 192 * 1024;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALWAYS_EXCLUDED_METADATA_FIELDS = new Set([
    // Local-only state and post-match LP change are not needed to replay a
    // match through the shared player. Honor recipients are also outside the
    // replay and scoreboard use cases.
    "favorite",
    "lpDiff",
    "honorReceived",
]);
const ANONYMOUS_METADATA_FIELDS = new Set([
    "summonerId",
    "summonerName",
    "gameName",
    "tagLine",
    "rank",
    "summonerLevel",
]);

export type ReplaySharePrivacyOptions = {
    anonymizePlayers?: boolean;
};

export type ReplaySharePackageV1 = {
    format: "league-record-share";
    schemaVersion: 1;
    provider: "youtube";
    youtubeVideoId: string;
    metadata: Record<string, unknown>;
};

export type PreparedReplayShare = {
    youtubeVideoId: string;
    payloadJson: string;
    payloadBytes: number;
    payloadSha256: string;
};

export type LoadedReplayShare = {
    youtubeVideoId: string;
    youtubeUrl: string;
    metadataFile: { Metadata: GameMetadata };
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_SHARED_JSON_DEPTH = 10;
const MAX_SHARED_JSON_NODES = 30_000;
const MAX_SHARED_ARRAY_ITEMS = 2_000;
const MAX_SHARED_OBJECT_KEYS = 256;
const MAX_SHARED_STRING_LENGTH = 512;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const UNSAFE_SHARED_TEXT = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/u;
const UNSAFE_URI_SCHEME = /(?:javascript|vbscript|data|file):/iu;
const METADATA_KEYS = new Set([
    "matchId", "ingameTimeRecStartOffset", "highlights", "tftRoundMarkers", "queue", "player",
    "championName", "stats", "participantId", "participants", "teams", "events", "goldTimeline",
    "gameVersion", "gameDuration",
]);
const PARTICIPANT_KEYS = new Set([
    "participantId", "teamId", "championId", "spell1Id", "spell2Id", "stats", "lane", "role",
    "summonerName", "summonerId", "laneScore", "champLevel", "summonerLevel", "rank", "placement",
    "playersEliminated", "level", "traits", "units", "companion",
]);
const STATS_KEYS = new Set([
    "kills", "deaths", "assists", "largestMultiKill", "neutralMinionsKilled",
    "neutralMinionsKilledEnemyJungle", "neutralMinionsKilledTeamJungle", "totalMinionsKilled",
    "visionScore", "visionWardsBoughtInGame", "wardsPlaced", "wardsKilled", "gameEndedInEarlySurrender",
    "gameEndedInSurrender", "win", "item0", "item1", "item2", "item3", "item4", "item5", "item6",
    "perk0", "perk1", "perk2", "perk3", "perk4", "perk5", "perkPrimaryStyle", "perkSubStyle",
    "goldEarned",
]);
const TEAM_KEYS = new Set([
    "teamId", "win", "towerKills", "inhibitorKills", "baronKills", "dragonKills", "vilemawKills",
    "riftHeraldKills", "dominionVictoryScore", "bans",
]);
const EVENT_TYPES = new Set(["ChampionKill", "BuildingKill", "EliteMonsterKill", "ItemPurchased", "ItemSold", "ItemUndo"]);

function invalidMetadata(detail: string): never {
    throw new Error(`共有された試合データが安全な形式ではありません（${detail}）。`);
}

function validateBoundedJson(value: unknown): void {
    let nodes = 0;
    const visit = (current: unknown, depth: number, path: string): void => {
        nodes++;
        if (nodes > MAX_SHARED_JSON_NODES) invalidMetadata("データ要素が多すぎます");
        if (depth > MAX_SHARED_JSON_DEPTH) invalidMetadata("入れ子が深すぎます");
        if (current === null || typeof current === "boolean") return;
        if (typeof current === "number") {
            if (!Number.isFinite(current)) invalidMetadata(`${path}の数値が不正です`);
            if (Math.abs(current) > Number.MAX_SAFE_INTEGER) invalidMetadata(`${path}の数値が大きすぎます`);
            return;
        }
        if (typeof current === "string") {
            if (current.length > MAX_SHARED_STRING_LENGTH) invalidMetadata(`${path}の文字列が長すぎます`);
            if (UNSAFE_SHARED_TEXT.test(current) || UNSAFE_URI_SCHEME.test(current)) {
                invalidMetadata(`${path}に安全でない文字列があります`);
            }
            return;
        }
        if (Array.isArray(current)) {
            if (current.length > MAX_SHARED_ARRAY_ITEMS) invalidMetadata(`${path}の配列が大きすぎます`);
            current.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`));
            return;
        }
        if (!isObject(current)) invalidMetadata(`${path}に使用できない値があります`);
        const keys = Object.keys(current);
        if (keys.length > MAX_SHARED_OBJECT_KEYS) invalidMetadata(`${path}の項目が多すぎます`);
        for (const key of keys) {
            if (key.length > 128 || FORBIDDEN_OBJECT_KEYS.has(key)) invalidMetadata(`${path}に不正な項目名があります`);
            visit(current[key], depth + 1, `${path}.${key}`);
        }
    };
    visit(value, 0, "metadata");
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
    if (!isObject(value)) invalidMetadata(`${path}がオブジェクトではありません`);
    return value;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) invalidMetadata(`${path}.${key}は許可されていない項目です`);
    }
}

function validateOptionalNumber(value: unknown, path: string, minimum: number, maximum: number, integer = false): void {
    if (value !== undefined && value !== null) requireFiniteNumber(value, path, minimum, maximum, integer);
}

function validateStats(value: unknown, path: string): void {
    const stats = requireObject(value, path);
    assertAllowedKeys(stats, STATS_KEYS, path);
    for (const [key, field] of Object.entries(stats)) {
        if (["gameEndedInEarlySurrender", "gameEndedInSurrender", "win"].includes(key)) {
            if (typeof field !== "boolean") invalidMetadata(`${path}.${key}が不正です`);
        } else {
            requireFiniteNumber(field, `${path}.${key}`, 0, 10_000_000, true);
        }
    }
}

function validateParticipantIds(value: unknown, path: string): void {
    if (!Array.isArray(value) || value.length > 10) invalidMetadata(`${path}が不正です`);
    value.forEach((id, index) => requireFiniteNumber(id, `${path}[${index}]`, 0, 20, true));
}

function validateEvent(value: unknown, index: number): void {
    const path = `events[${index}]`;
    const event = requireObject(value, path);
    const eventTypes = Object.keys(event).filter((key) => key !== "timestamp");
    if (eventTypes.length !== 1 || !EVENT_TYPES.has(eventTypes[0])) invalidMetadata(`${path}のイベント種別が不正です`);
    assertAllowedKeys(event, new Set(["timestamp", eventTypes[0]]), path);
    requireFiniteNumber(event.timestamp, `${path}.timestamp`, -60_000, 86_400_000);
    const type = eventTypes[0];
    const detail = requireObject(event[type], `${path}.${type}`);
    if (type === "ChampionKill") {
        assertAllowedKeys(detail, new Set(["victim_id", "killer_id", "assisting_participant_ids", "position"]), `${path}.${type}`);
        requireFiniteNumber(detail.victim_id, `${path}.${type}.victim_id`, 0, 20, true);
        requireFiniteNumber(detail.killer_id, `${path}.${type}.killer_id`, 0, 20, true);
        validateParticipantIds(detail.assisting_participant_ids, `${path}.${type}.assisting_participant_ids`);
        const position = requireObject(detail.position, `${path}.${type}.position`);
        assertAllowedKeys(position, new Set(["x", "y"]), `${path}.${type}.position`);
        requireFiniteNumber(position.x, `${path}.${type}.position.x`, -100_000, 100_000);
        requireFiniteNumber(position.y, `${path}.${type}.position.y`, -100_000, 100_000);
    } else if (type === "BuildingKill") {
        assertAllowedKeys(detail, new Set(["team_id", "killer_id", "building_type", "assisting_participant_ids"]), `${path}.${type}`);
        requireFiniteNumber(detail.team_id, `${path}.${type}.team_id`, 0, 1_000, true);
        requireFiniteNumber(detail.killer_id, `${path}.${type}.killer_id`, 0, 20, true);
        validateParticipantIds(detail.assisting_participant_ids, `${path}.${type}.assisting_participant_ids`);
        const building = requireObject(detail.building_type, `${path}.${type}.building_type`);
        assertAllowedKeys(building, new Set(["buildingType", "laneType", "towerType"]), `${path}.${type}.building_type`);
        requireShortString(building.buildingType, `${path}.${type}.buildingType`, 32);
        requireShortString(building.laneType, `${path}.${type}.laneType`, 32);
        if (building.towerType !== undefined) requireShortString(building.towerType, `${path}.${type}.towerType`, 32);
    } else if (type === "EliteMonsterKill") {
        assertAllowedKeys(detail, new Set(["killer_id", "monster_type", "assisting_participant_ids"]), `${path}.${type}`);
        requireFiniteNumber(detail.killer_id, `${path}.${type}.killer_id`, 0, 20, true);
        validateParticipantIds(detail.assisting_participant_ids, `${path}.${type}.assisting_participant_ids`);
        const monster = requireObject(detail.monster_type, `${path}.${type}.monster_type`);
        assertAllowedKeys(monster, new Set(["monsterType", "monsterSubType"]), `${path}.${type}.monster_type`);
        requireShortString(monster.monsterType, `${path}.${type}.monsterType`, 32);
        if (monster.monsterSubType !== undefined) requireShortString(monster.monsterSubType, `${path}.${type}.monsterSubType`, 32);
    } else if (type === "ItemPurchased" || type === "ItemSold") {
        assertAllowedKeys(detail, new Set(["participant_id", "item_id", "slot"]), `${path}.${type}`);
        requireFiniteNumber(detail.participant_id, `${path}.${type}.participant_id`, 0, 20, true);
        requireFiniteNumber(detail.item_id, `${path}.${type}.item_id`, 0, 1_000_000, true);
        validateOptionalNumber(detail.slot, `${path}.${type}.slot`, 0, 20, true);
    } else {
        assertAllowedKeys(detail, new Set(["participant_id", "before_id", "after_id", "gold_gain"]), `${path}.${type}`);
        requireFiniteNumber(detail.participant_id, `${path}.${type}.participant_id`, 0, 20, true);
        requireFiniteNumber(detail.before_id, `${path}.${type}.before_id`, 0, 1_000_000, true);
        requireFiniteNumber(detail.after_id, `${path}.${type}.after_id`, 0, 1_000_000, true);
        requireFiniteNumber(detail.gold_gain, `${path}.${type}.gold_gain`, -1_000_000, 1_000_000, true);
    }
}

function requireFiniteNumber(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
    integer = false,
): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        invalidMetadata(`${path}の範囲が不正です`);
    }
    if (integer && !Number.isInteger(value)) invalidMetadata(`${path}は整数ではありません`);
    return value;
}

function requireShortString(value: unknown, path: string, maximum = 128): string {
    if (typeof value !== "string" || value.length > maximum) invalidMetadata(`${path}が不正です`);
    return value;
}

export function validateReplayShareMetadata(value: unknown): asserts value is GameMetadata {
    validateBoundedJson(value);
    if (!isObject(value)) invalidMetadata("ルートがオブジェクトではありません");
    assertAllowedKeys(value, METADATA_KEYS, "metadata");
    if (!isObject(value.queue) || !Array.isArray(value.participants) || !Array.isArray(value.teams) || !Array.isArray(value.events)) {
        invalidMetadata("必須項目がありません");
    }
    if (!isObject(value.stats) || !isObject(value.matchId) || !isObject(value.player)) {
        invalidMetadata("試合情報がありません");
    }
    if (value.participants.length < 1 || value.participants.length > 10) invalidMetadata("参加者数が不正です");
    if (value.teams.length > 2) invalidMetadata("チーム数が不正です");
    if (value.events.length > 2_000) invalidMetadata("イベント数が多すぎます");

    requireFiniteNumber(value.ingameTimeRecStartOffset, "録画開始時刻", -7_200, 7_200);
    requireFiniteNumber(value.participantId, "participantId", 0, 20, true);
    const matchId = requireObject(value.matchId, "matchId");
    assertAllowedKeys(matchId, new Set(["gameId", "platformId"]), "matchId");
    requireFiniteNumber(matchId.gameId, "matchId.gameId", 0, Number.MAX_SAFE_INTEGER, true);
    requireShortString(matchId.platformId, "matchId.platformId", 16);
    assertAllowedKeys(value.queue, new Set(["id", "name", "isRanked"]), "queue");
    requireFiniteNumber(value.queue.id, "queue.id", 0, 100_000, true);
    requireShortString(value.queue.name, "queue.name");
    if (typeof value.queue.isRanked !== "boolean") invalidMetadata("queue.isRankedが不正です");
    assertAllowedKeys(value.player, new Set(["gameName", "tagLine", "summonerId"]), "player");
    if (value.player.gameName !== undefined) requireShortString(value.player.gameName, "player.gameName");
    if (value.player.tagLine !== undefined) requireShortString(value.player.tagLine, "player.tagLine", 32);
    validateOptionalNumber(value.player.summonerId, "player.summonerId", 0, Number.MAX_SAFE_INTEGER, true);
    requireShortString(value.championName, "championName");
    validateStats(value.stats, "stats");

    const participantIds = new Set<number>();
    value.participants.forEach((participant, index) => {
        if (!isObject(participant) || !isObject(participant.stats)) invalidMetadata(`participants[${index}]が不正です`);
        assertAllowedKeys(participant, PARTICIPANT_KEYS, `participants[${index}]`);
        const participantId = requireFiniteNumber(participant.participantId, `participants[${index}].participantId`, 0, 20, true);
        if (participantIds.has(participantId)) invalidMetadata("participantIdが重複しています");
        participantIds.add(participantId);
        requireFiniteNumber(participant.teamId, `participants[${index}].teamId`, 0, 1_000, true);
        requireFiniteNumber(participant.championId, `participants[${index}].championId`, 0, 100_000, true);
        requireFiniteNumber(participant.spell1Id, `participants[${index}].spell1Id`, 0, 1_000_000, true);
        requireFiniteNumber(participant.spell2Id, `participants[${index}].spell2Id`, 0, 1_000_000, true);
        validateStats(participant.stats, `participants[${index}].stats`);
        if (participant.summonerName !== undefined) requireShortString(participant.summonerName, `participants[${index}].summonerName`);
        validateOptionalNumber(participant.summonerId, `participants[${index}].summonerId`, 0, Number.MAX_SAFE_INTEGER, true);
    });

    value.teams.forEach((team, index) => {
        if (!isObject(team)) invalidMetadata(`teams[${index}]が不正です`);
        assertAllowedKeys(team, TEAM_KEYS, `teams[${index}]`);
        requireFiniteNumber(team.teamId, `teams[${index}].teamId`, 0, 1_000, true);
        if (team.bans !== undefined) {
            if (!Array.isArray(team.bans) || team.bans.length > 20) invalidMetadata(`teams[${index}].bansが不正です`);
            team.bans.forEach((ban, banIndex) => {
                const item = requireObject(ban, `teams[${index}].bans[${banIndex}]`);
                assertAllowedKeys(item, new Set(["championId", "pickTurn"]), `teams[${index}].bans[${banIndex}]`);
                requireFiniteNumber(item.championId, `teams[${index}].bans[${banIndex}].championId`, -1, 100_000, true);
                requireFiniteNumber(item.pickTurn, `teams[${index}].bans[${banIndex}].pickTurn`, 0, 100, true);
            });
        }
    });
    value.events.forEach(validateEvent);
}

export function parseYouTubeVideoId(input: string): string {
    const value = input.trim();
    if (YOUTUBE_VIDEO_ID.test(value)) return value;

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("有効なYouTube URLを入力してください。");
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") {
        videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
        if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? "";
        else {
            const parts = url.pathname.split("/").filter(Boolean);
            if (["embed", "shorts", "live"].includes(parts[0] ?? "")) videoId = parts[1] ?? "";
        }
    }
    if (!YOUTUBE_VIDEO_ID.test(videoId)) {
        throw new Error("URLからYouTube動画IDを取得できませんでした。");
    }
    return videoId;
}

function shareableMetadata(
    metadata: GameMetadata,
    options: ReplaySharePrivacyOptions,
): Record<string, unknown> {
    // Metadata is produced locally. Serialize it once so only JSON-compatible
    // data is shared. The normal share preserves the player-facing details
    // shown in the game; anonymous sharing removes them explicitly.
    const excludedFields = options.anonymizePlayers
        ? new Set([...ALWAYS_EXCLUDED_METADATA_FIELDS, ...ANONYMOUS_METADATA_FIELDS])
        : ALWAYS_EXCLUDED_METADATA_FIELDS;
    return JSON.parse(JSON.stringify(metadata, (key, value) => (
        excludedFields.has(key) ? undefined : value
    ))) as Record<string, unknown>;
}

function bytesToHex(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
    return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function normalizeSharedMetadata(value: unknown): GameMetadata {
    validateReplayShareMetadata(value);
    const player = isObject(value.player) ? value.player : {};
    return {
        ...(value as unknown as GameMetadata),
        favorite: false,
        player: {
            gameName: typeof player.gameName === "string" ? player.gameName : "Shared player",
            tagLine: typeof player.tagLine === "string" ? player.tagLine : "",
        },
    };
}

export async function loadReplayShare(input: string): Promise<LoadedReplayShare> {
    const youtubeVideoId = parseYouTubeVideoId(input);
    if (!await isPublicYouTubeVideoAvailable(youtubeVideoId)) {
        throw new Error("YouTube動画が見つからない、非公開、または埋め込み再生を許可していません。試合データは表示しません。");
    }
    const document = await fetchReplayShareDocument(youtubeVideoId);
    if (
        document.format !== "league-record-share"
        || document.schemaVersion !== 1
        || document.status !== "published"
        || document.provider !== "youtube"
        || document.youtubeVideoId !== youtubeVideoId
        || typeof document.payloadJson !== "string"
        || typeof document.payloadBytes !== "number"
        || typeof document.payloadSha256 !== "string"
    ) {
        throw new Error("Firestoreの共有データ形式が不正です。");
    }

    const actualBytes = new TextEncoder().encode(document.payloadJson).byteLength;
    if (actualBytes > MAX_REPLAY_SHARE_PAYLOAD_BYTES || actualBytes !== document.payloadBytes) {
        throw new Error("共有データのサイズ検証に失敗しました。");
    }
    if (await sha256(document.payloadJson) !== document.payloadSha256.toLowerCase()) {
        throw new Error("共有データの整合性検証に失敗しました。");
    }

    let payload: unknown;
    try {
        payload = JSON.parse(document.payloadJson);
    } catch {
        throw new Error("共有された試合JSONを読み取れませんでした。");
    }
    if (
        !isObject(payload)
        || payload.format !== "league-record-share"
        || payload.schemaVersion !== 1
        || payload.provider !== "youtube"
        || payload.youtubeVideoId !== youtubeVideoId
    ) {
        throw new Error("共有された試合JSONの形式が不正です。");
    }
    assertAllowedKeys(payload, new Set(["format", "schemaVersion", "provider", "youtubeVideoId", "metadata"]), "payload");

    return {
        youtubeVideoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
        metadataFile: { Metadata: normalizeSharedMetadata(payload.metadata) },
    };
}

export async function prepareReplayShare(
    metadataFile: MetadataFile | null,
    youtubeVideoId: string | null | undefined,
    options: ReplaySharePrivacyOptions = {},
): Promise<PreparedReplayShare> {
    if (!youtubeVideoId || !YOUTUBE_VIDEO_ID.test(youtubeVideoId)) {
        throw new Error("YouTube動画IDを確認できませんでした。");
    }
    if (!metadataFile || !("Metadata" in metadataFile)) {
        throw new Error("この動画には共有できる試合データがありません。");
    }

    const payload: ReplaySharePackageV1 = {
        format: "league-record-share",
        schemaVersion: 1,
        provider: "youtube",
        youtubeVideoId,
        metadata: shareableMetadata(metadataFile.Metadata, options),
    };
    validateReplayShareMetadata(payload.metadata);
    const payloadJson = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadJson).byteLength;
    if (payloadBytes > MAX_REPLAY_SHARE_PAYLOAD_BYTES) {
        throw new Error("試合データが大きすぎるため共有できません（上限 192 KiB）。");
    }
    const payloadSha256 = await sha256(payloadJson);

    return { youtubeVideoId, payloadJson, payloadBytes, payloadSha256 };
}
