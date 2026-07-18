import { afterAll, beforeAll, beforeEach, describe, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    Timestamp,
    writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-leaguerecord";
const VIDEO_ID = "AAAAAAAAAAA";
let testEnvironment: RulesTestEnvironment;

function validReplay(ownerUid: string): Record<string, unknown> {
    return {
        format: "league-record-share",
        schemaVersion: 1,
        status: "published",
        provider: "youtube",
        youtubeVideoId: VIDEO_ID,
        ownerUid,
        payloadJson: "{}",
        payloadBytes: 2,
        payloadSha256: "0".repeat(64),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
}

function validQuota(ownerUid: string, createCount = 1): Record<string, unknown> {
    return {
        ownerUid,
        lastReplayId: VIDEO_ID,
        windowStartedAt: serverTimestamp(),
        lastWriteAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        writeCount: 1,
        createCount,
    };
}

function createReplayWithQuota(
    db: ReturnType<typeof aliceDb>,
    ownerUid: string,
    replay: Record<string, unknown> = validReplay(ownerUid),
    quota: Record<string, unknown> = validQuota(ownerUid),
) {
    const batch = writeBatch(db);
    batch.set(doc(db, "writeQuotas", ownerUid), quota);
    batch.set(doc(db, "replays", VIDEO_ID), replay);
    return batch.commit();
}

async function seedReplayForUpdate(ownerUid: string, writeCount = 1, createCount = 1): Promise<void> {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const earlier = Timestamp.fromMillis(Date.now() - 20_000);
        await setDoc(doc(db, "writeQuotas", ownerUid), {
            ownerUid,
            lastReplayId: VIDEO_ID,
            windowStartedAt: earlier,
            lastWriteAt: earlier,
            updatedAt: earlier,
            writeCount,
            createCount,
        });
        await setDoc(doc(db, "replays", VIDEO_ID), validReplay(ownerUid));
    });
}

function updateReplayWithQuota(
    db: ReturnType<typeof aliceDb>,
    ownerUid: string,
    replayChanges: Record<string, unknown>,
    writeCount = 2,
    createCount = 1,
) {
    const batch = writeBatch(db);
    batch.update(doc(db, "writeQuotas", ownerUid), {
        lastWriteAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        writeCount,
        createCount,
    });
    batch.update(doc(db, "replays", VIDEO_ID), replayChanges);
    return batch.commit();
}

function aliceDb() {
    return testEnvironment.authenticatedContext("alice", {
        firebase: { sign_in_provider: "google.com" },
    }).firestore();
}

function anonymousAliceDb() {
    return testEnvironment.authenticatedContext("alice", {
        firebase: { sign_in_provider: "anonymous" },
    }).firestore();
}

beforeAll(async () => {
    testEnvironment = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: readFileSync("firestore.rules", "utf8"),
        },
    });
});

beforeEach(async () => {
    await testEnvironment.clearFirestore();
});

afterAll(async () => {
    await testEnvironment.cleanup();
});

describe("Firestore replay security rules", () => {
    test("allows an authenticated owner to create a valid replay", async () => {
        await assertSucceeds(createReplayWithQuota(aliceDb(), "alice"));
    });

    test("denies unauthenticated creation", async () => {
        const db = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(createReplayWithQuota(db as ReturnType<typeof aliceDb>, "anonymous"));
    });

    test("denies anonymous Firebase users", async () => {
        await assertFails(createReplayWithQuota(anonymousAliceDb(), "alice"));
    });

    test("denies replay creation without an atomic quota write", async () => {
        await assertFails(setDoc(doc(aliceDb(), "replays", VIDEO_ID), validReplay("alice")));
    });

    test("denies additional unapproved fields", async () => {
        await assertFails(createReplayWithQuota(aliceDb(), "alice", {
            ...validReplay("alice"),
            attackerControlled: "not allowed",
        }));
    });

    test("denies payloads over 192 KiB", async () => {
        await assertFails(createReplayWithQuota(aliceDb(), "alice", {
            ...validReplay("alice"),
            payloadJson: "x".repeat(196_609),
            payloadBytes: 196_609,
        }));
    });

    test("denies malformed hashes", async () => {
        await assertFails(createReplayWithQuota(aliceDb(), "alice", {
            ...validReplay("alice"),
            payloadSha256: "Z".repeat(64),
        }));
    });

    test("requires server timestamps on creation", async () => {
        await assertFails(createReplayWithQuota(aliceDb(), "alice", {
            ...validReplay("alice"),
            createdAt: Timestamp.fromMillis(0),
            updatedAt: Timestamp.fromMillis(0),
        }));
    });

    test("allows public get of a known valid replay and a missing valid ID", async () => {
        await createReplayWithQuota(aliceDb(), "alice");
        const publicDb = testEnvironment.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(publicDb, "replays", VIDEO_ID)));
        await assertSucceeds(getDoc(doc(publicDb, "replays", "BBBBBBBBBBB")));
    });

    test("denies collection listing", async () => {
        await createReplayWithQuota(aliceDb(), "alice");
        const publicDb = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(publicDb, "replays")));
    });

    test("allows the owner to update only payload fields", async () => {
        await seedReplayForUpdate("alice");
        await assertSucceeds(updateReplayWithQuota(aliceDb(), "alice", {
            payloadJson: '{"updated":true}',
            payloadBytes: 16,
            payloadSha256: "1".repeat(64),
            updatedAt: serverTimestamp(),
        }));
    });

    test("denies updates and deletes by another user", async () => {
        await seedReplayForUpdate("alice");
        const bobRef = doc(testEnvironment.authenticatedContext("bob", {
            firebase: { sign_in_provider: "google.com" },
        }).firestore(), "replays", VIDEO_ID);
        const bobBatch = writeBatch(bobRef.firestore);
        bobBatch.set(doc(bobRef.firestore, "writeQuotas", "bob"), validQuota("bob", 0));
        bobBatch.update(bobRef, {
            payloadJson: "{}",
            payloadBytes: 2,
            payloadSha256: "2".repeat(64),
            updatedAt: serverTimestamp(),
        });
        await assertFails(bobBatch.commit());
        await assertFails(deleteDoc(bobRef));
    });

    test("denies changing owner or creation time", async () => {
        await seedReplayForUpdate("alice");
        await assertFails(updateReplayWithQuota(aliceDb(), "alice", { ownerUid: "bob", updatedAt: serverTimestamp() }));
        await assertFails(updateReplayWithQuota(aliceDb(), "alice", {
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }));
    });

    test("allows the owner to delete", async () => {
        const replayRef = doc(aliceDb(), "replays", VIDEO_ID);
        await createReplayWithQuota(aliceDb(), "alice");
        await assertSucceeds(deleteDoc(replayRef));
    });

    test("denies a second write inside the 10 second cooldown", async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            const recent = Timestamp.fromMillis(Date.now());
            await setDoc(doc(db, "writeQuotas", "alice"), {
                ownerUid: "alice",
                windowStartedAt: recent,
                lastWriteAt: recent,
                updatedAt: recent,
                writeCount: 1,
                createCount: 1,
            });
            await setDoc(doc(db, "replays", VIDEO_ID), validReplay("alice"));
        });
        await assertFails(updateReplayWithQuota(aliceDb(), "alice", {
            payloadJson: "{}",
            payloadBytes: 2,
            payloadSha256: "3".repeat(64),
            updatedAt: serverTimestamp(),
        }));
    });

    test("denies writes beyond the 50 write rolling limit", async () => {
        await seedReplayForUpdate("alice", 50, 1);
        await assertFails(updateReplayWithQuota(aliceDb(), "alice", {
            payloadJson: "{}",
            payloadBytes: 2,
            payloadSha256: "4".repeat(64),
            updatedAt: serverTimestamp(),
        }, 51, 1));
    });

    test("denies using one quota increment for multiple replay documents", async () => {
        const db = aliceDb();
        const secondVideoId = "BBBBBBBBBBB";
        const batch = writeBatch(db);
        batch.set(doc(db, "writeQuotas", "alice"), validQuota("alice"));
        batch.set(doc(db, "replays", VIDEO_ID), validReplay("alice"));
        batch.set(doc(db, "replays", secondVideoId), {
            ...validReplay("alice"),
            youtubeVideoId: secondVideoId,
        });
        await assertFails(batch.commit());
    });

    test("denies new shares beyond the 20 create rolling limit", async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            const earlier = Timestamp.fromMillis(Date.now() - 20_000);
            await setDoc(doc(db, "writeQuotas", "alice"), {
                ownerUid: "alice",
                lastReplayId: "BBBBBBBBBBB",
                windowStartedAt: earlier,
                lastWriteAt: earlier,
                updatedAt: earlier,
                writeCount: 20,
                createCount: 20,
            });
        });
        const db = aliceDb();
        const batch = writeBatch(db);
        batch.update(doc(db, "writeQuotas", "alice"), {
            lastReplayId: VIDEO_ID,
            lastWriteAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            writeCount: 21,
            createCount: 21,
        });
        batch.set(doc(db, "replays", VIDEO_ID), validReplay("alice"));
        await assertFails(batch.commit());
    });

    test("allows counters to reset after 24 hours", async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            const expired = Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000);
            await setDoc(doc(db, "writeQuotas", "alice"), {
                ownerUid: "alice",
                lastReplayId: "BBBBBBBBBBB",
                windowStartedAt: expired,
                lastWriteAt: expired,
                updatedAt: expired,
                writeCount: 50,
                createCount: 20,
            });
        });
        const db = aliceDb();
        const batch = writeBatch(db);
        batch.update(doc(db, "writeQuotas", "alice"), {
            lastReplayId: VIDEO_ID,
            windowStartedAt: serverTimestamp(),
            lastWriteAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            writeCount: 1,
            createCount: 1,
        });
        batch.set(doc(db, "replays", VIDEO_ID), validReplay("alice"));
        await assertSucceeds(batch.commit());
    });
});
