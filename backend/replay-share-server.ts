import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import {
    MAX_REPLAY_SHARE_PAYLOAD_BYTES,
    validateReplayShareMetadata,
    type PreparedReplayShare,
} from "../src/ts/replay_share";
import {
    DEFAULT_COMMUNITY_COMMENT_SETTINGS,
    validateCommunityCommentInput,
    validateCommunitySettings,
} from "../src/ts/community_comments";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "leaguerecord";
const HOST = process.env.REPLAY_BACKEND_HOST || "127.0.0.1";
const PORT = Number(process.env.REPLAY_BACKEND_PORT || 8787);
const MAX_REQUEST_BYTES = 256 * 1024;
const WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const WRITE_COOLDOWN_MS = 10_000;
const MAX_CREATES_PER_WINDOW = 20;
const MAX_WRITES_PER_WINDOW = 50;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CHECK_REVOKED_TOKENS = process.env.REPLAY_BACKEND_CHECK_REVOKED === "true";
const COMMENT_WRITE_COOLDOWN_MS = 2_000;
const MAX_COMMENTS_PER_DAY = 200;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_ORIGINS = new Set([
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    ...(process.env.REPLAY_BACKEND_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
]);

class HttpError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validateBackendReplayShare(value: unknown): PreparedReplayShare {
    if (!isObject(value) || !exactKeys(value, ["youtubeVideoId", "payloadJson", "payloadBytes", "payloadSha256"])) {
        throw new HttpError(400, "共有データの項目が不正です。");
    }
    const { youtubeVideoId, payloadJson, payloadBytes, payloadSha256 } = value;
    if (typeof youtubeVideoId !== "string" || !VIDEO_ID.test(youtubeVideoId)) {
        throw new HttpError(400, "YouTube動画IDが不正です。");
    }
    if (typeof payloadJson !== "string" || typeof payloadBytes !== "number" || !Number.isInteger(payloadBytes)) {
        throw new HttpError(400, "共有JSONの形式が不正です。");
    }
    const actualBytes = Buffer.byteLength(payloadJson, "utf8");
    if (actualBytes < 1 || actualBytes > MAX_REPLAY_SHARE_PAYLOAD_BYTES || actualBytes !== payloadBytes) {
        throw new HttpError(400, "共有JSONのサイズ検証に失敗しました。");
    }
    if (typeof payloadSha256 !== "string" || !SHA256.test(payloadSha256) || sha256(payloadJson) !== payloadSha256) {
        throw new HttpError(400, "共有JSONの整合性検証に失敗しました。");
    }

    let payload: unknown;
    try {
        payload = JSON.parse(payloadJson);
    } catch {
        throw new HttpError(400, "共有JSONを解析できません。");
    }
    if (
        !isObject(payload)
        || !exactKeys(payload, ["format", "schemaVersion", "provider", "youtubeVideoId", "metadata"])
        || payload.format !== "league-record-share"
        || payload.schemaVersion !== 1
        || payload.provider !== "youtube"
        || payload.youtubeVideoId !== youtubeVideoId
    ) {
        throw new HttpError(400, "共有JSONのパッケージが不正です。");
    }
    try {
        validateReplayShareMetadata(payload.metadata);
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "試合データが不正です。");
    }
    return { youtubeVideoId, payloadJson, payloadBytes, payloadSha256 };
}

function isGoogleToken(token: DecodedIdToken): boolean {
    return token.firebase?.sign_in_provider === "google.com";
}

async function readJson(request: Request): Promise<unknown> {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BYTES) throw new HttpError(413, "リクエストが大きすぎます。");
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "リクエスト本文がありません。");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REQUEST_BYTES) {
            await reader.cancel();
            throw new HttpError(413, "リクエストが大きすぎます。");
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
        throw new HttpError(400, "JSONリクエストを解析できません。");
    }
}

function corsHeaders(origin: string | null): HeadersInit {
    return origin && ALLOWED_ORIGINS.has(origin)
        ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
        : {};
}

function jsonResponse(status: number, body: Record<string, unknown>, origin: string | null): Response {
    return Response.json(body, {
        status,
        headers: { ...corsHeaders(origin), "Cache-Control": "no-store" },
    });
}

async function authenticate(request: Request): Promise<DecodedIdToken> {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Google認証が必要です。");
    try {
        // Local verification only needs Google's public signing keys. A deployed
        // backend can set REPLAY_BACKEND_CHECK_REVOKED=true because its service
        // account can also perform the additional revocation lookup.
        const token = await getAuth().verifyIdToken(authorization.slice(7), CHECK_REVOKED_TOKENS);
        if (!isGoogleToken(token)) throw new HttpError(403, "Googleアカウントでの認証が必要です。");
        return token;
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(401, "認証情報を確認できませんでした。");
    }
}

async function storeReplay(ownerUid: string, share: PreparedReplayShare): Promise<void> {
    const db = getFirestore();
    const replayRef = db.doc(`replays/${share.youtubeVideoId}`);
    const quotaRef = db.doc(`writeQuotas/${ownerUid}`);
    const commentSettingsRef = db.doc(`replays/${share.youtubeVideoId}/commentSettings/access`);
    await db.runTransaction(async (transaction) => {
        const [existing, quotaSnapshot] = await Promise.all([
            transaction.get(replayRef),
            transaction.get(quotaRef),
        ]);
        if (existing.exists && existing.get("ownerUid") !== ownerUid) {
            throw new HttpError(409, "この動画IDには別の所有者の共有データがあります。");
        }
        const now = Timestamp.now();
        const isCreate = !existing.exists;
        const quota = quotaSnapshot.data();
        const windowStartedAt = quota?.windowStartedAt instanceof Timestamp ? quota.windowStartedAt : null;
        const lastWriteAt = quota?.lastWriteAt instanceof Timestamp ? quota.lastWriteAt : null;
        const resetWindow = !windowStartedAt || now.toMillis() >= windowStartedAt.toMillis() + WRITE_WINDOW_MS;
        if (!resetWindow && lastWriteAt && now.toMillis() < lastWriteAt.toMillis() + WRITE_COOLDOWN_MS) {
            throw new HttpError(429, "短時間に連続して登録できません。少し待ってから再試行してください。");
        }
        const writeCount = resetWindow ? 1 : Number(quota?.writeCount || 0) + 1;
        const createCount = resetWindow ? (isCreate ? 1 : 0) : Number(quota?.createCount || 0) + (isCreate ? 1 : 0);
        if (writeCount > MAX_WRITES_PER_WINDOW || createCount > MAX_CREATES_PER_WINDOW) {
            throw new HttpError(429, "共有回数の上限に達しました。時間をおいて再試行してください。");
        }
        transaction.set(quotaRef, {
            ownerUid,
            lastReplayId: share.youtubeVideoId,
            windowStartedAt: resetWindow ? now : windowStartedAt,
            lastWriteAt: now,
            updatedAt: now,
            writeCount,
            createCount,
        });
        const replay = {
            format: "league-record-share",
            schemaVersion: 1,
            status: "published",
            provider: "youtube",
            youtubeVideoId: share.youtubeVideoId,
            ownerUid,
            payloadJson: share.payloadJson,
            payloadBytes: share.payloadBytes,
            payloadSha256: share.payloadSha256,
            updatedAt: now,
            ...(isCreate ? { createdAt: now } : { createdAt: existing.get("createdAt") }),
        };
        transaction.set(replayRef, replay);
        if (isCreate) {
            transaction.set(commentSettingsRef, {
                ...DEFAULT_COMMUNITY_COMMENT_SETTINGS,
                ownerUid,
                createdAt: now,
                updatedAt: now,
            });
        }
    });
}

async function requireReplayOwner(videoId: string, uid: string): Promise<DocumentSnapshot> {
    const replay = await getFirestore().doc(`replays/${videoId}`).get();
    if (!replay.exists) throw new HttpError(404, "共有リプレイが見つかりません。");
    if (replay.get("ownerUid") !== uid) throw new HttpError(403, "リプレイ所有者だけが変更できます。");
    return replay;
}

async function updateCommentSettings(videoId: string, token: DecodedIdToken, value: unknown): Promise<void> {
    await requireReplayOwner(videoId, token.uid);
    let settings;
    try {
        settings = validateCommunitySettings(value);
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "コメント公開設定が不正です。");
    }
    const ref = getFirestore().doc(`replays/${videoId}/commentSettings/access`);
    const existing = await ref.get();
    const now = Timestamp.now();
    await ref.set({
        ...settings,
        ownerUid: token.uid,
        createdAt: existing.exists ? existing.get("createdAt") : now,
        updatedAt: now,
    });
}

async function createCommentInvite(videoId: string, token: DecodedIdToken): Promise<string> {
    await requireReplayOwner(videoId, token.uid);
    const inviteId = randomBytes(9).toString("base64url");
    const secret = randomBytes(24).toString("base64url");
    const now = Timestamp.now();
    await getFirestore().doc(`replays/${videoId}/commentInvites/${inviteId}`).set({
        tokenHash: sha256(secret),
        status: "active",
        role: "commenter",
        createdByUid: token.uid,
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS),
        maxUses: 1,
        usedCount: 0,
    });
    return `${inviteId}.${secret}`;
}

async function redeemCommentInvite(videoId: string, token: DecodedIdToken, value: unknown): Promise<void> {
    if (!isObject(value) || !exactKeys(value, ["code"]) || typeof value.code !== "string") {
        throw new HttpError(400, "招待コードが不正です。");
    }
    const [inviteId, secret, ...rest] = value.code.trim().split(".");
    if (rest.length > 0 || !/^[A-Za-z0-9_-]{12}$/u.test(inviteId) || !/^[A-Za-z0-9_-]{32}$/u.test(secret)) {
        throw new HttpError(400, "招待コードが不正です。");
    }
    const db = getFirestore();
    const inviteRef = db.doc(`replays/${videoId}/commentInvites/${inviteId}`);
    const memberRef = db.doc(`replays/${videoId}/commentMembers/${token.uid}`);
    await db.runTransaction(async (transaction) => {
        const [invite, replay] = await Promise.all([
            transaction.get(inviteRef),
            transaction.get(db.doc(`replays/${videoId}`)),
        ]);
        if (!replay.exists || !invite.exists) throw new HttpError(404, "招待コードが見つかりません。");
        const expiresAt = invite.get("expiresAt");
        const usedCount = Number(invite.get("usedCount") || 0);
        const maxUses = Number(invite.get("maxUses") || 0);
        if (invite.get("status") !== "active" || !(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= Date.now()
            || usedCount >= maxUses || invite.get("tokenHash") !== sha256(secret)) {
            throw new HttpError(410, "招待コードは無効または使用済みです。");
        }
        const now = Timestamp.now();
        transaction.set(memberRef, {
            uid: token.uid,
            role: "commenter",
            status: "active",
            displayName: String(token.name || "Google user").slice(0, 64),
            groupIds: FieldValue.arrayUnion(inviteId),
            invitedByUid: invite.get("createdByUid"),
            grantedAt: now,
            updatedAt: now,
        }, { merge: true });
        transaction.update(inviteRef, { usedCount: usedCount + 1, status: usedCount + 1 >= maxUses ? "used" : "active", usedAt: now });
    });
}

async function createCommunityComment(videoId: string, token: DecodedIdToken, value: unknown): Promise<string> {
    let input;
    try {
        input = validateCommunityCommentInput(value);
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "コメントが不正です。");
    }
    const db = getFirestore();
    const replayRef = db.doc(`replays/${videoId}`);
    const settingsRef = db.doc(`replays/${videoId}/commentSettings/access`);
    const memberRef = db.doc(`replays/${videoId}/commentMembers/${token.uid}`);
    const commentRef = db.doc(`replays/${videoId}/comments/${input.clientRequestId}`);
    const quotaRef = db.doc(`commentWriteQuotas/${token.uid}_${videoId}`);
    await db.runTransaction(async (transaction) => {
        const [replay, settingsSnapshot, member, existing, quota] = await Promise.all([
            transaction.get(replayRef), transaction.get(settingsRef), transaction.get(memberRef),
            transaction.get(commentRef), transaction.get(quotaRef),
        ]);
        if (!replay.exists) throw new HttpError(404, "共有リプレイが見つかりません。");
        if (existing.exists) return;
        const isOwner = replay.get("ownerUid") === token.uid;
        const isMember = member.exists && member.get("status") === "active";
        const settings = settingsSnapshot.exists ? settingsSnapshot.data()! : DEFAULT_COMMUNITY_COMMENT_SETTINGS;
        if (settings.readAccess === "invite_only" && !isOwner && !isMember) throw new HttpError(403, "コメントの閲覧許可がありません。");
        if (settings.writeAccess === "invite_only" && !isOwner && !isMember) throw new HttpError(403, "コメントの投稿許可がありません。");
        const now = Timestamp.now();
        const quotaData = quota.data();
        const windowStart = quotaData?.windowStartedAt instanceof Timestamp ? quotaData.windowStartedAt : null;
        const lastWrite = quotaData?.lastWriteAt instanceof Timestamp ? quotaData.lastWriteAt : null;
        const reset = !windowStart || now.toMillis() >= windowStart.toMillis() + WRITE_WINDOW_MS;
        const count = reset ? 1 : Number(quotaData?.writeCount || 0) + 1;
        if (!reset && lastWrite && now.toMillis() < lastWrite.toMillis() + COMMENT_WRITE_COOLDOWN_MS) {
            throw new HttpError(429, "コメントの連続投稿はできません。少し待ってください。");
        }
        if (count > MAX_COMMENTS_PER_DAY) throw new HttpError(429, "1日のコメント投稿上限に達しました。");
        const groupIds = isMember && Array.isArray(member.get("groupIds")) ? member.get("groupIds").slice(0, 20) : [];
        transaction.set(commentRef, {
            schemaVersion: 1,
            ...input,
            authorUid: token.uid,
            authorName: String(token.name || member.get("displayName") || "Google user").slice(0, 64),
            authorGroupIds: groupIds,
            status: "published",
            createdAt: now,
            updatedAt: now,
        });
        transaction.set(quotaRef, {
            uid: token.uid,
            videoId,
            windowStartedAt: reset ? now : windowStart,
            lastWriteAt: now,
            writeCount: count,
        });
    });
    return input.clientRequestId;
}

async function updateCommunityComment(videoId: string, commentId: string, token: DecodedIdToken, value: unknown): Promise<void> {
    let input;
    try {
        input = validateCommunityCommentInput(value);
    } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "コメントが不正です。");
    }
    if (input.clientRequestId !== commentId) throw new HttpError(400, "コメントIDが一致しません。");
    const ref = getFirestore().doc(`replays/${videoId}/comments/${commentId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpError(404, "コメントが見つかりません。");
    if (snapshot.get("authorUid") !== token.uid) throw new HttpError(403, "自分のコメントだけ変更できます。");
    await ref.update({ ...input, updatedAt: Timestamp.now() });
}

async function deleteCommunityComment(videoId: string, commentId: string, token: DecodedIdToken): Promise<void> {
    const db = getFirestore();
    const [comment, replay] = await Promise.all([
        db.doc(`replays/${videoId}/comments/${commentId}`).get(),
        db.doc(`replays/${videoId}`).get(),
    ]);
    if (!comment.exists) throw new HttpError(404, "コメントが見つかりません。");
    if (comment.get("authorUid") !== token.uid && replay.get("ownerUid") !== token.uid) {
        throw new HttpError(403, "コメントを削除する権限がありません。");
    }
    await comment.ref.update({ status: "deleted", updatedAt: Timestamp.now(), deletedByUid: token.uid });
}

export async function handleReplayBackendRequest(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    try {
        if (origin && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, "許可されていない送信元です。");
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/health") {
            return jsonResponse(200, { ok: true, mode: "local-emulator" }, origin);
        }
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    ...corsHeaders(origin),
                    "Access-Control-Allow-Headers": "Authorization, Content-Type",
                    "Access-Control-Allow-Methods": "POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Max-Age": "600",
                },
            });
        }
        if (request.method === "POST" && url.pathname === "/v1/replay-shares") {
            const token = await authenticate(request);
            const share = validateBackendReplayShare(await readJson(request));
            await storeReplay(token.uid, share);
            return jsonResponse(200, { ok: true, youtubeVideoId: share.youtubeVideoId }, origin);
        }
        const settingsMatch = url.pathname.match(/^\/v1\/replays\/([A-Za-z0-9_-]{11})\/comment-settings$/u);
        if (request.method === "PUT" && settingsMatch) {
            const token = await authenticate(request);
            await updateCommentSettings(settingsMatch[1], token, await readJson(request));
            return jsonResponse(200, { ok: true }, origin);
        }
        const inviteMatch = url.pathname.match(/^\/v1\/replays\/([A-Za-z0-9_-]{11})\/comment-invites$/u);
        if (request.method === "POST" && inviteMatch) {
            const token = await authenticate(request);
            const code = await createCommentInvite(inviteMatch[1], token);
            return jsonResponse(201, { ok: true, code, expiresInSeconds: INVITE_TTL_MS / 1000 }, origin);
        }
        const redeemMatch = url.pathname.match(/^\/v1\/replays\/([A-Za-z0-9_-]{11})\/comment-invites\/redeem$/u);
        if (request.method === "POST" && redeemMatch) {
            const token = await authenticate(request);
            await redeemCommentInvite(redeemMatch[1], token, await readJson(request));
            return jsonResponse(200, { ok: true }, origin);
        }
        const commentMatch = url.pathname.match(/^\/v1\/replays\/([A-Za-z0-9_-]{11})\/comments$/u);
        if (request.method === "POST" && commentMatch) {
            const token = await authenticate(request);
            const commentId = await createCommunityComment(commentMatch[1], token, await readJson(request));
            return jsonResponse(201, { ok: true, commentId }, origin);
        }
        const commentItemMatch = url.pathname.match(/^\/v1\/replays\/([A-Za-z0-9_-]{11})\/comments\/([A-Za-z0-9_-]{8,80})$/u);
        if (request.method === "PUT" && commentItemMatch) {
            const token = await authenticate(request);
            await updateCommunityComment(commentItemMatch[1], commentItemMatch[2], token, await readJson(request));
            return jsonResponse(200, { ok: true }, origin);
        }
        if (request.method === "DELETE" && commentItemMatch) {
            const token = await authenticate(request);
            await deleteCommunityComment(commentItemMatch[1], commentItemMatch[2], token);
            return jsonResponse(200, { ok: true }, origin);
        }
        throw new HttpError(404, "エンドポイントが見つかりません。");
    } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof HttpError ? error.message : "バックエンド処理に失敗しました。";
        if (!(error instanceof HttpError)) console.error(error);
        return jsonResponse(status, { ok: false, error: message }, origin);
    }
}

if (import.meta.main) {
    process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
    initializeApp({ projectId: PROJECT_ID });
    Bun.serve({ hostname: HOST, port: PORT, fetch: handleReplayBackendRequest });
    console.log(`Replay validation backend: http://${HOST}:${PORT}`);
    console.log(`Firestore emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
}
