import { describe, expect, test } from "bun:test";
import {
    COMMUNITY_PUBLIC_ID_LENGTH,
    communityDisplayName,
    createCommunityPublicId,
    isCommunityPublicId,
    normalizeCommunityAccountName,
    normalizeCommunityRiotAccount,
} from "../src/ts/community_identity";

describe("community account identity", () => {
    test("creates fixed-length alphanumeric public IDs", () => {
        const ids = Array.from({ length: 100 }, () => createCommunityPublicId());
        expect(ids.every((id) => id.length === COMMUNITY_PUBLIC_ID_LENGTH && isCommunityPublicId(id))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("uses the immutable public ID until an account name is configured", () => {
        expect(communityDisplayName({ publicId: "AbCd234567", accountName: null })).toBe("AbCd234567");
        expect(communityDisplayName({ publicId: "AbCd234567", accountName: "Review Coach" })).toBe("Review Coach");
    });

    test("normalizes blank names and rejects unsafe names", () => {
        expect(normalizeCommunityAccountName("   ")).toBeNull();
        expect(normalizeCommunityAccountName("  Coach  ")).toBe("Coach");
        expect(() => normalizeCommunityAccountName("hidden\u202ename")).toThrow();
    });
});

describe("community Riot account validation", () => {
    test("accepts a bounded linked account and normalized ranks", () => {
        const account = normalizeCommunityRiotAccount({
            puuid: "verified-puuid-value-0000000001",
            gameName: "Player",
            tagLine: "JP1",
            platformId: "jp1",
            soloRank: "gold iv",
            flexRank: "unranked",
            primaryRank: "gold iv",
            verifiedAtMs: 123456,
        });
        expect(account?.platformId).toBe("JP1");
        expect(account?.primaryRank).toBe("GOLD IV");
    });

    test("rejects malformed identity and rank values", () => {
        expect(() => normalizeCommunityRiotAccount({
            puuid: "short",
            gameName: "Player",
            tagLine: "JP1",
            platformId: "JP1",
            soloRank: "GOLD IV",
            flexRank: "UNRANKED",
            primaryRank: "ADMIN",
            verifiedAtMs: 123456,
        })).toThrow("不正");
    });
});
