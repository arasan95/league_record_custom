import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { validateBackendReplayShare } from "../backend/replay-share-server";
import {
    MAX_REPLAY_SHARE_PAYLOAD_BYTES,
    validateReplayShareMetadata,
} from "../src/ts/replay_share";

function validMetadata(): Record<string, unknown> {
    return {
        queue: { id: 420, name: "Ranked Solo", isRanked: true },
        participants: [
            { participantId: 1, teamId: 100, championId: 51, spell1Id: 4, spell2Id: 7, summonerName: "Player", stats: {} },
        ],
        teams: [
            { teamId: 100 },
            { teamId: 200 },
        ],
        events: [{ timestamp: 12_000, ItemPurchased: { participant_id: 1, item_id: 1001 } }],
        stats: {},
        matchId: { gameId: 123, platformId: "JP1" },
        player: { gameName: "Player", tagLine: "JP1" },
        ingameTimeRecStartOffset: -15,
        participantId: 1,
        championName: "Caitlyn",
    };
}

function cloneMetadata(): Record<string, any> {
    return structuredClone(validMetadata()) as Record<string, any>;
}

function validBackendShare(): Record<string, unknown> {
    const youtubeVideoId = "9amkzpyouoI";
    const payloadJson = JSON.stringify({
        format: "league-record-share",
        schemaVersion: 1,
        provider: "youtube",
        youtubeVideoId,
        metadata: validMetadata(),
    });
    return {
        youtubeVideoId,
        payloadJson,
        payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
        payloadSha256: createHash("sha256").update(payloadJson, "utf8").digest("hex"),
    };
}

describe("shared replay metadata validation", () => {
    test("accepts a bounded normal replay", () => {
        expect(() => validateReplayShareMetadata(validMetadata())).not.toThrow();
    });

    test("accepts anonymized player fields", () => {
        const metadata = cloneMetadata();
        metadata.player = {};
        delete metadata.participants[0].summonerName;
        expect(() => validateReplayShareMetadata(metadata)).not.toThrow();
    });

    test("uses the reduced 192 KiB payload limit", () => {
        expect(MAX_REPLAY_SHARE_PAYLOAD_BYTES).toBe(192 * 1024);
    });

    test("rejects too many participants", () => {
        const metadata = cloneMetadata();
        metadata.participants = Array.from({ length: 11 }, (_, index) => ({
            participantId: index + 1,
            teamId: index < 5 ? 100 : 200,
            championId: index + 1,
            stats: {},
        }));
        expect(() => validateReplayShareMetadata(metadata)).toThrow("参加者数");
    });

    test("rejects duplicate participant IDs", () => {
        const metadata = cloneMetadata();
        metadata.participants.push({ ...metadata.participants[0] });
        expect(() => validateReplayShareMetadata(metadata)).toThrow("重複");
    });

    test("rejects excessive events", () => {
        const metadata = cloneMetadata();
        metadata.events = Array.from({ length: 2_001 }, () => ({ timestamp: 1 }));
        expect(() => validateReplayShareMetadata(metadata)).toThrow("配列が大きすぎます");
    });

    test("rejects excessive nesting", () => {
        const metadata = cloneMetadata();
        let cursor: Record<string, unknown> = metadata;
        for (let index = 0; index < 12; index++) {
            cursor.nested = {};
            cursor = cursor.nested as Record<string, unknown>;
        }
        expect(() => validateReplayShareMetadata(metadata)).toThrow("入れ子");
    });

    test("rejects oversized strings", () => {
        const metadata = cloneMetadata();
        metadata.player.gameName = "x".repeat(513);
        expect(() => validateReplayShareMetadata(metadata)).toThrow("文字列が長すぎます");
    });

    test("rejects prototype-related property names", () => {
        const metadata = cloneMetadata();
        metadata.untrusted = JSON.parse('{"__proto__":{"polluted":true}}');
        expect(() => validateReplayShareMetadata(metadata)).toThrow("不正な項目名");
    });

    test("rejects non-finite numbers", () => {
        const metadata = cloneMetadata();
        metadata.events[0].timestamp = Number.POSITIVE_INFINITY;
        expect(() => validateReplayShareMetadata(metadata)).toThrow("数値が不正");
    });

    test("rejects executable-looking HTML in player-controlled text", () => {
        const metadata = cloneMetadata();
        metadata.participants[0].summonerName = '<img src=x onerror="alert(1)">';
        expect(() => validateReplayShareMetadata(metadata)).toThrow("安全でない文字列");
    });

    test("rejects dangerous URI schemes in shared strings", () => {
        const metadata = cloneMetadata();
        metadata.player.gameName = "javascript:alert(1)";
        expect(() => validateReplayShareMetadata(metadata)).toThrow("安全でない文字列");
    });

    test("rejects bidi control characters used to disguise content", () => {
        const metadata = cloneMetadata();
        metadata.player.gameName = `safe\u202Egn.exe`;
        expect(() => validateReplayShareMetadata(metadata)).toThrow("安全でない文字列");
    });

    test("rejects unknown fields that could smuggle commands or URLs", () => {
        const metadata = cloneMetadata();
        metadata.command = "run";
        expect(() => validateReplayShareMetadata(metadata)).toThrow("許可されていない項目");
    });

    test("rejects malformed event payload fields", () => {
        const metadata = cloneMetadata();
        metadata.events[0].ItemPurchased.execute = "calc.exe";
        expect(() => validateReplayShareMetadata(metadata)).toThrow("許可されていない項目");
    });

    test("accepts the numeric team ID and camelCase building fields produced by real recordings", () => {
        const metadata = cloneMetadata();
        metadata.events = [{
            timestamp: 974_008,
            BuildingKill: {
                team_id: 200,
                killer_id: 3,
                building_type: {
                    buildingType: "TOWER_BUILDING",
                    laneType: "BOT_LANE",
                    towerType: "OUTER_TURRET",
                },
                assisting_participant_ids: [],
            },
        }];
        expect(() => validateReplayShareMetadata(metadata)).not.toThrow();
    });

    test("rejects a string building team ID", () => {
        const metadata = cloneMetadata();
        metadata.events = [{
            timestamp: 974_008,
            BuildingKill: {
                team_id: "200",
                killer_id: 3,
                building_type: { buildingType: "TOWER_BUILDING", laneType: "BOT_LANE" },
                assisting_participant_ids: [],
            },
        }];
        expect(() => validateReplayShareMetadata(metadata)).toThrow("team_id");
    });
});

describe("local replay validation backend", () => {
    test("accepts a valid prepared share", () => {
        expect(() => validateBackendReplayShare(validBackendShare())).not.toThrow();
    });

    test("rejects a payload changed after hashing", () => {
        const share = validBackendShare();
        share.payloadJson = `${share.payloadJson} `;
        share.payloadBytes = Buffer.byteLength(String(share.payloadJson), "utf8");
        expect(() => validateBackendReplayShare(share)).toThrow("整合性");
    });

    test("rejects an unknown transport field", () => {
        const share = validBackendShare();
        share.command = "execute";
        expect(() => validateBackendReplayShare(share)).toThrow("項目");
    });

    test("rejects unsafe metadata on the server too", () => {
        const share = validBackendShare();
        const payload = JSON.parse(String(share.payloadJson));
        payload.metadata.player.gameName = "javascript:alert(1)";
        share.payloadJson = JSON.stringify(payload);
        share.payloadBytes = Buffer.byteLength(String(share.payloadJson), "utf8");
        share.payloadSha256 = createHash("sha256").update(String(share.payloadJson), "utf8").digest("hex");
        expect(() => validateBackendReplayShare(share)).toThrow("安全でない文字列");
    });
});
