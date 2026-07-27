import { describe, expect, test } from "bun:test";
import { formatReviewTimestamp, getCommunityAuthorFilterKey } from "../src/ts/review_comments";

describe("review comment timestamps", () => {
    test("formats minute timestamps", () => {
        expect(formatReviewTimestamp(0)).toBe("0:00");
        expect(formatReviewTimestamp(65.9)).toBe("1:05");
    });

    test("formats long recordings with hours", () => {
        expect(formatReviewTimestamp(3661)).toBe("1:01:01");
    });

    test("clamps invalid negative positions to the video start", () => {
        expect(formatReviewTimestamp(-10)).toBe("0:00");
    });
});

describe("shared comment author filters", () => {
    test("uses the stable public ID instead of the editable account name", () => {
        expect(getCommunityAuthorFilterKey({
            source: "community",
            authorName: "Player One",
            authorPublicId: "A1B2C3D4",
        })).toBe("id:A1B2C3D4");
    });

    test("does not filter local comments as shared authors", () => {
        expect(getCommunityAuthorFilterKey({
            source: "local",
            authorName: "Player One",
            authorPublicId: "A1B2C3D4",
        })).toBeNull();
    });
});
