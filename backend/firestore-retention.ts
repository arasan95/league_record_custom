import {
    FieldPath,
    Timestamp,
    type DocumentReference,
    type Firestore,
    type Query,
} from "firebase-admin/firestore";

const MIB = 1024 * 1024;
const DEFAULT_MAX_REPLAY_COUNT = 2_000;
const DEFAULT_MAX_REPLAY_PAYLOAD_BYTES = 300 * MIB;
const DEFAULT_MAX_COMMENT_COUNT = 50_000;
const DEFAULT_MAX_REPLAY_DELETES_PER_RUN = 250;
const DEFAULT_MAX_COMMENT_DELETES_PER_RUN = 5_000;
const DELETE_BATCH_SIZE = 400;

export interface FirestoreRetentionOptions {
    maxReplayCount?: number;
    maxReplayPayloadBytes?: number;
    maxCommentCount?: number;
    maxReplayDeletesPerRun?: number;
    maxCommentDeletesPerRun?: number;
    dryRun?: boolean;
    logger?: Pick<Console, "warn">;
}

export interface FirestoreRetentionResult {
    replayCountBefore: number;
    replayPayloadBytesBefore: number;
    replaysDeleted: number;
    commentCountBefore: number;
    commentsDeleted: number;
    dryRun: boolean;
    limits: {
        maxReplayCount: number;
        maxReplayPayloadBytes: number;
        maxCommentCount: number;
    };
}

interface ReplayCandidate {
    ref: DocumentReference;
    createdAtMs: number;
    payloadBytes: number;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
    return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function timestampMillis(value: unknown): number {
    return value instanceof Timestamp ? value.toMillis() : 0;
}

export function selectOldestReplaysForDeletion(
    candidates: ReplayCandidate[],
    maxCount: number,
    maxPayloadBytes: number,
    maxDeletes: number,
): ReplayCandidate[] {
    let remainingCount = candidates.length;
    let remainingBytes = candidates.reduce((total, item) => total + item.payloadBytes, 0);
    const ordered = [...candidates].sort((a, b) =>
        a.createdAtMs - b.createdAtMs || a.ref.path.localeCompare(b.ref.path));
    const selected: ReplayCandidate[] = [];
    for (const candidate of ordered) {
        if (remainingCount <= maxCount && remainingBytes <= maxPayloadBytes) break;
        if (selected.length >= maxDeletes) break;
        selected.push(candidate);
        remainingCount -= 1;
        remainingBytes -= candidate.payloadBytes;
    }
    return selected;
}

async function deleteQueryDocuments(query: Query, dryRun: boolean): Promise<number> {
    let deleted = 0;
    while (true) {
        const snapshot = await query.limit(DELETE_BATCH_SIZE).get();
        if (snapshot.empty) return deleted;
        if (dryRun) return deleted + snapshot.size;
        const batch = snapshot.docs[0].ref.firestore.batch();
        snapshot.docs.forEach((document) => batch.delete(document.ref));
        await batch.commit();
        deleted += snapshot.size;
        if (snapshot.size < DELETE_BATCH_SIZE) return deleted;
    }
}

async function deleteComment(
    db: Firestore,
    commentRef: DocumentReference,
    dryRun: boolean,
): Promise<void> {
    const replayRef = commentRef.parent.parent;
    if (!replayRef) return;
    const commentId = commentRef.id;
    if (dryRun) return;

    await deleteQueryDocuments(
        db.collection("commentReports")
            .where("videoId", "==", replayRef.id)
            .where("commentId", "==", commentId),
        false,
    );
    const batch = db.batch();
    batch.delete(commentRef);
    batch.delete(replayRef.collection("commentAuthors").doc(commentId));
    await batch.commit();
}

async function deleteReplay(db: Firestore, replay: ReplayCandidate, dryRun: boolean): Promise<void> {
    if (dryRun) return;
    const videoId = replay.ref.id;
    await db.recursiveDelete(replay.ref);
    await Promise.all([
        deleteQueryDocuments(db.collection("commentReports").where("videoId", "==", videoId), false),
        deleteQueryDocuments(db.collection("commentWriteQuotas").where("videoId", "==", videoId), false),
    ]);
}

export async function pruneFirestoreRetention(
    db: Firestore,
    options: FirestoreRetentionOptions = {},
): Promise<FirestoreRetentionResult> {
    const logger = options.logger ?? console;
    const maxReplayCount = nonNegativeInteger(options.maxReplayCount, DEFAULT_MAX_REPLAY_COUNT);
    const maxReplayPayloadBytes = nonNegativeInteger(
        options.maxReplayPayloadBytes,
        DEFAULT_MAX_REPLAY_PAYLOAD_BYTES,
    );
    const maxCommentCount = nonNegativeInteger(options.maxCommentCount, DEFAULT_MAX_COMMENT_COUNT);
    const maxReplayDeletes = nonNegativeInteger(
        options.maxReplayDeletesPerRun,
        DEFAULT_MAX_REPLAY_DELETES_PER_RUN,
    );
    const maxCommentDeletes = nonNegativeInteger(
        options.maxCommentDeletesPerRun,
        DEFAULT_MAX_COMMENT_DELETES_PER_RUN,
    );
    const dryRun = options.dryRun === true;

    const replaySnapshot = await db.collection("replays")
        .select("createdAt", "updatedAt", "payloadBytes")
        .get();
    const replayCandidates: ReplayCandidate[] = replaySnapshot.docs.map((document) => {
        const data = document.data();
        return {
            ref: document.ref,
            createdAtMs: timestampMillis(data.createdAt) || timestampMillis(data.updatedAt),
            payloadBytes: Number.isSafeInteger(data.payloadBytes) && data.payloadBytes > 0
                ? data.payloadBytes
                : 0,
        };
    });
    const replayPayloadBytesBefore = replayCandidates.reduce((total, item) => total + item.payloadBytes, 0);
    const replaysToDelete = selectOldestReplaysForDeletion(
        replayCandidates,
        maxReplayCount,
        maxReplayPayloadBytes,
        maxReplayDeletes,
    );
    for (const replay of replaysToDelete) {
        await deleteReplay(db, replay, dryRun);
    }

    const commentCollection = db.collectionGroup("comments");
    const commentCountSnapshot = await commentCollection.count().get();
    const commentCountBefore = commentCountSnapshot.data().count;
    const commentsToDelete = Math.min(
        Math.max(0, commentCountBefore - maxCommentCount),
        maxCommentDeletes,
    );
    let commentsDeleted = 0;
    if (commentsToDelete > 0) {
        const oldestComments = await commentCollection
            .orderBy("createdAt", "asc")
            .orderBy(FieldPath.documentId(), "asc")
            .limit(commentsToDelete)
            .get();
        for (const comment of oldestComments.docs) {
            await deleteComment(db, comment.ref, dryRun);
            commentsDeleted += 1;
        }
        if (oldestComments.size < commentsToDelete) {
            logger.warn("[retention] Some legacy comments have no createdAt field and could not be ordered.");
        }
    }

    return {
        replayCountBefore: replayCandidates.length,
        replayPayloadBytesBefore,
        replaysDeleted: replaysToDelete.length,
        commentCountBefore,
        commentsDeleted,
        dryRun,
        limits: { maxReplayCount, maxReplayPayloadBytes, maxCommentCount },
    };
}
