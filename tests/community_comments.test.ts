import { describe, expect, test } from "bun:test";
import {
    DEFAULT_COMMUNITY_COMMENT_SETTINGS,
    validateCommunityCommentInput,
    validateCommunitySettings,
} from "../src/ts/community_comments";

function validComment(): Record<string, unknown> {
    return {
        text: "この場面は先に視界を取る",
        videoTimeMs: 123_000,
        rating: "question",
        color: "#ffd75e",
        size: "medium",
        durationMs: 5_000,
        mode: "scroll",
        x: null,
        y: null,
        visibility: "public",
        anonymous: false,
        clientRequestId: "comment-safe-id-1234",
    };
}

describe("community comment validation", () => {
    test("uses safe invite-only write defaults", () => {
        expect(DEFAULT_COMMUNITY_COMMENT_SETTINGS).toEqual({ writeAccess: "invite_only", readAccess: "public" });
    });

    test("accepts all supported access combinations", () => {
        expect(validateCommunitySettings({ writeAccess: "public", readAccess: "invite_only" })).toEqual({
            writeAccess: "public",
            readAccess: "invite_only",
        });
        expect(validateCommunitySettings({ writeAccess: "rank_verified", readAccess: "public" })).toEqual({
            writeAccess: "rank_verified",
            readAccess: "public",
        });
    });

    test("accepts a bounded public comment", () => {
        expect(validateCommunityCommentInput(validComment()).text).toBe("この場面は先に視界を取る");
    });

    test("accepts public anonymous comments and rejects private anonymous comments", () => {
        expect(validateCommunityCommentInput({ ...validComment(), anonymous: true }).anonymous).toBe(true);
        expect(() => validateCommunityCommentInput({
            ...validComment(), anonymous: true, visibility: "private",
        })).toThrow("匿名コメント");
    });

    test("accepts private fixed comments with normalized coordinates", () => {
        const comment = validComment();
        Object.assign(comment, { mode: "fixed", x: 2500, y: 7500, visibility: "private" });
        expect(validateCommunityCommentInput(comment).visibility).toBe("private");
    });

    test("rejects extra fields and disguised control characters", () => {
        expect(() => validateCommunityCommentInput({ ...validComment(), authorUid: "spoofed" })).toThrow("項目");
        expect(() => validateCommunityCommentInput({ ...validComment(), text: "safe\u202Eevil" })).toThrow("本文");
    });

    test("rejects fixed comments without a position", () => {
        expect(() => validateCommunityCommentInput({ ...validComment(), mode: "fixed" })).toThrow("位置");
    });
});
