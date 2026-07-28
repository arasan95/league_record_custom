import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pruneFirestoreRetention } from "../backend/firestore-retention";

function environmentInteger(name: string): number | undefined {
    const raw = process.env[name]?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer.`);
    }
    return value;
}

function initializeAdmin() {
    if (getApps().length > 0) return getApps()[0]!;
    const projectId = process.env.FIREBASE_PROJECT_ID || "leaguerecord";
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson);
        return initializeApp({ credential: cert(serviceAccount), projectId });
    }
    if (process.env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId });
    return initializeApp({ credential: applicationDefault(), projectId });
}

const dryRun = process.argv.includes("--dry-run");
const quiet = process.argv.includes("--quiet");
const app = initializeAdmin();
const result = await pruneFirestoreRetention(getFirestore(app), {
    maxReplayCount: environmentInteger("RETENTION_MAX_REPLAY_COUNT"),
    maxReplayPayloadBytes: environmentInteger("RETENTION_MAX_REPLAY_PAYLOAD_BYTES"),
    maxCommentCount: environmentInteger("RETENTION_MAX_COMMENT_COUNT"),
    maxReplayDeletesPerRun: environmentInteger("RETENTION_MAX_REPLAY_DELETES_PER_RUN"),
    maxCommentDeletesPerRun: environmentInteger("RETENTION_MAX_COMMENT_DELETES_PER_RUN"),
    dryRun,
});

if (!quiet) console.log(JSON.stringify(result, null, 2));
