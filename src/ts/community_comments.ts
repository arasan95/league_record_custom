export type CommunityAccess = "public" | "invite_only";
export type CommunityCommentVisibility = "public" | "private";
export type CommunityRating = "good" | "bad" | "question" | null;

export interface CommunityCommentSettings {
    writeAccess: CommunityAccess;
    readAccess: CommunityAccess;
}

export interface CommunityCommentInput {
    text: string;
    videoTimeMs: number;
    rating: CommunityRating;
    color: string;
    size: "small" | "medium" | "large";
    durationMs: number;
    mode: "scroll" | "fixed";
    x: number | null;
    y: number | null;
    visibility: CommunityCommentVisibility;
    clientRequestId: string;
}

export interface CommunityCommentRecord extends CommunityCommentInput {
    id: string;
    /** Present only on legacy comments while their ownership record is migrated. */
    authorUid?: string;
    authorName: string;
    authorPublicId: string | null;
    authorGroupIds: string[];
    createdAtMs: number;
    updatedAtMs: number;
}

export interface CommunityCommentContext {
    videoId: string;
    ownerUid: string;
    currentUid: string | null;
    currentPublicId: string | null;
    currentUserName: string | null;
    isOwner: boolean;
    isMember: boolean;
    memberGroupIds: string[];
    settings: CommunityCommentSettings;
    canRead: boolean;
    canWrite: boolean;
}

export const DEFAULT_COMMUNITY_COMMENT_SETTINGS: CommunityCommentSettings = {
    writeAccess: "invite_only",
    readAccess: "public",
};

const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/u;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
    const actual = Object.keys(value).toSorted();
    const wanted = expected.toSorted();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function hasUnsafeCommentText(text: string): boolean {
    if (BIDI_CONTROL.test(text)) return true;
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) return true;
    }
    return false;
}

export function validateCommunitySettings(value: unknown): CommunityCommentSettings {
    if (!isObject(value) || !exactKeys(value, ["writeAccess", "readAccess"])) {
        throw new Error("コメント公開設定の項目が不正です。");
    }
    if ((value.writeAccess !== "public" && value.writeAccess !== "invite_only")
        || (value.readAccess !== "public" && value.readAccess !== "invite_only")) {
        throw new Error("コメント公開設定が不正です。");
    }
    return { writeAccess: value.writeAccess, readAccess: value.readAccess };
}

export function validateCommunityCommentInput(value: unknown): CommunityCommentInput {
    const keys = ["text", "videoTimeMs", "rating", "color", "size", "durationMs", "mode", "x", "y", "visibility", "clientRequestId"];
    if (!isObject(value) || !exactKeys(value, keys)) throw new Error("コメントの項目が不正です。");
    const text = typeof value.text === "string" ? value.text.trim() : "";
    if (!text || text.length > 280 || hasUnsafeCommentText(text)) throw new Error("コメント本文が不正です。");
    if (!Number.isInteger(value.videoTimeMs) || Number(value.videoTimeMs) < 0 || Number(value.videoTimeMs) > 86_400_000) {
        throw new Error("コメント時刻が不正です。");
    }
    if (![null, "good", "bad", "question"].includes(value.rating as CommunityRating)) throw new Error("コメント評価が不正です。");
    if (typeof value.color !== "string" || !/^#[0-9a-f]{6}$/iu.test(value.color)) throw new Error("コメント色が不正です。");
    if (value.size !== "small" && value.size !== "medium" && value.size !== "large") throw new Error("コメントサイズが不正です。");
    if (!Number.isInteger(value.durationMs) || Number(value.durationMs) < 1_000 || Number(value.durationMs) > 30_000) {
        throw new Error("コメント表示時間が不正です。");
    }
    if (value.mode !== "scroll" && value.mode !== "fixed") throw new Error("コメント表示方式が不正です。");
    for (const coordinate of [value.x, value.y]) {
        if (coordinate !== null && (!Number.isInteger(coordinate) || Number(coordinate) < 0 || Number(coordinate) > 10_000)) {
            throw new Error("コメント位置が不正です。");
        }
    }
    if (value.mode === "fixed" && (value.x === null || value.y === null)) throw new Error("固定コメントの位置がありません。");
    if (value.visibility !== "public" && value.visibility !== "private") throw new Error("コメント公開範囲が不正です。");
    if (typeof value.clientRequestId !== "string" || !REQUEST_ID.test(value.clientRequestId)) throw new Error("コメントリクエストIDが不正です。");
    return {
        text,
        videoTimeMs: Number(value.videoTimeMs),
        rating: value.rating as CommunityRating,
        color: value.color,
        size: value.size,
        durationMs: Number(value.durationMs),
        mode: value.mode,
        x: value.x === null ? null : Number(value.x),
        y: value.y === null ? null : Number(value.y),
        visibility: value.visibility,
        clientRequestId: value.clientRequestId,
    };
}
