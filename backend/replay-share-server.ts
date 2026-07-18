import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
    MAX_REPLAY_SHARE_PAYLOAD_BYTES,
    validateReplayShareMetadata,
    type PreparedReplayShare,
} from "../src/ts/replay_share";

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
    });
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
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Max-Age": "600",
                },
            });
        }
        if (request.method !== "POST" || url.pathname !== "/v1/replay-shares") {
            throw new HttpError(404, "エンドポイントが見つかりません。");
        }
        const token = await authenticate(request);
        const share = validateBackendReplayShare(await readJson(request));
        await storeReplay(token.uid, share);
        return jsonResponse(200, { ok: true, youtubeVideoId: share.youtubeVideoId }, origin);
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
