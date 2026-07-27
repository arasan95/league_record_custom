import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dir, "..");
const { generateThumbnailHtml } = require(join(root, "electron", "youtube", "thumbnail-generator.cjs"));

function thumbnailMetadata(rank: string) {
    return {
        participantId: 1,
        championName: "Caitlyn",
        gameDuration: 1200,
        participants: [
            {
                participantId: 1,
                teamId: 100,
                championId: 51,
                rank,
                stats: { kills: 1, deaths: 2, assists: 3, win: true },
            },
            {
                participantId: 6,
                teamId: 200,
                championId: 238,
                rank: "UNRANKED",
                stats: {},
            },
        ],
        teams: [{ teamId: 100, win: "Win" }, { teamId: 200, win: "Fail" }],
    };
}

describe("YouTube thumbnail packaged assets", () => {
    for (const rank of [
        "IRON IV",
        "BRONZE IV",
        "SILVER IV",
        "GOLD IV",
        "PLATINUM IV",
        "EMERALD IV",
        "DIAMOND IV",
        "MASTER",
        "GRANDMASTER",
        "CHALLENGER",
    ]) {
        test(`embeds the ${rank} emblem`, () => {
            const html = generateThumbnailHtml(thumbnailMetadata(rank), root, []);
            expect(html).toContain("data:image/png;base64,");
            expect(html).toMatch(
                /<img class="ranked-emblem" src="data:image\/png;base64,/,
            );
        });
    }
});
