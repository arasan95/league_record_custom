import { describe, expect, test } from "bun:test";
import {
    COMMUNITY_PUBLIC_ID_LENGTH,
    communityDisplayName,
    createCommunityPublicId,
    isCommunityPublicId,
    normalizeCommunityAccountName,
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
