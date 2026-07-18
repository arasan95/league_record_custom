import { describe, expect, test } from "bun:test";
import type { GameMetadata } from "../src/ts/bindings";
import { buildYouTubeUploadDefaults } from "../src/ts/youtube_upload_defaults";

function metadata(): GameMetadata {
    return {
        favorite: false,
        matchId: { gameId: 1, platformId: "JP1" },
        ingameTimeRecStartOffset: 5,
        queue: { id: 420, name: "Ranked Solo", isRanked: true },
        player: { gameName: "Player", tagLine: "JP1" },
        championName: "Caitlyn",
        stats: {} as any,
        participantId: 1,
        gameVersion: "16.13.791.5903",
        teams: [] as any,
        participants: [
            { participantId: 1, teamId: 100, championId: 51, lane: "BOTTOM", role: "CARRY", rank: "SILVER I", stats: {} as any } as any,
            { participantId: 2, teamId: 100, championId: 26, lane: "BOTTOM", role: "SUPPORT", stats: {} as any } as any,
            { participantId: 6, teamId: 200, championId: 18, lane: "BOTTOM", role: "CARRY", stats: {} as any } as any,
            { participantId: 7, teamId: 200, championId: 63, lane: "BOTTOM", role: "SUPPORT", stats: {} as any } as any,
        ],
        events: [
            { timestamp: 230_000, ChampionKill: { killer_id: 1, victim_id: 6, assisting_participant_ids: [], position: { x: 1, y: 1 } } },
            { timestamp: 235_000, ChampionKill: { killer_id: 2, victim_id: 7, assisting_participant_ids: [1], position: { x: 1, y: 1 } } },
            { timestamp: 260_000, ChampionKill: { killer_id: 6, victim_id: 1, assisting_participant_ids: [], position: { x: 1, y: 1 } } },
        ],
    };
}

describe("YouTube upload defaults", () => {
    test("builds title, teams, hashtags and self-event chapters without links", async () => {
        const names: Record<number, string> = { 51: "Caitlyn", 26: "Zilean", 18: "Tristana", 63: "Brand" };
        const result = await buildYouTubeUploadDefaults(metadata(), async (id) => names[id] ?? null);
        expect(result.title).toBe("Caitlyn ADC vs Tristana | SILVER I | Patch 16.13");
        expect(result.description).toContain("Side: Blue Side");
        expect(result.description).toContain("Blue Team: Caitlyn / Zilean");
        expect(result.description).toContain("Red Team: Tristana / Brand");
        expect(result.description).not.toMatch(/https?:\/\//);
        expect(result.description).toContain("#LeagueOfLegends #LoL #LeagueRecord");
        expect(result.description).toContain("0:00 Start");
        expect(result.description).toContain("3:45 Kill");
        expect(result.description).not.toContain("3:50 Assist");
        expect(result.description).toContain("4:15 Death");
    });

    test("falls back to team order when old metadata marks every lane NONE/SUPPORT", async () => {
        const replay = metadata();
        replay.participantId = 4;
        replay.participants = [
            ...[1, 2, 3, 4, 5].map((participantId) => ({ participantId, teamId: 100, championId: participantId, lane: "NONE", role: "SUPPORT", rank: participantId === 4 ? "GOLD IV" : undefined, stats: {} } as any)),
            ...[6, 7, 8, 9, 10].map((participantId) => ({ participantId, teamId: 200, championId: participantId, lane: "NONE", role: "SUPPORT", stats: {} } as any)),
        ];
        const result = await buildYouTubeUploadDefaults(replay, async (id) => `Champion${id}`);
        expect(result.title).toBe("Champion4 ADC vs Champion9 | GOLD IV | Patch 16.13");
    });
});
