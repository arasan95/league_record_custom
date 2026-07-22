import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
    collection,
    deleteField,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where,
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
    return googleDb("alice");
}

function googleDb(uid: string) {
    return testEnvironment.authenticatedContext(uid, {
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

    test("allows a Google user to query only their own replays", async () => {
        await createReplayWithQuota(aliceDb(), "alice");
        await assertSucceeds(getDocs(query(collection(aliceDb(), "replays"), where("ownerUid", "==", "alice"), limit(100))));
        await assertFails(getDocs(query(collection(aliceDb(), "replays"), where("ownerUid", "==", "bob"), limit(100))));
        await assertFails(getDocs(query(collection(aliceDb(), "replays"), where("ownerUid", "==", "alice"))));
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

async function seedCommunityComments(
    readAccess: "public" | "invite_only" = "public",
    writeAccess: "public" | "invite_only" = "invite_only",
): Promise<void> {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const now = Timestamp.now();
        await setDoc(doc(db, "replays", VIDEO_ID), validReplay("alice"));
        await setDoc(doc(db, "replays", VIDEO_ID, "commentSettings", "access"), {
            ownerUid: "alice", writeAccess, readAccess, createdAt: now, updatedAt: now,
        });
        for (const uid of ["alice", "bob"]) {
            const publicId = testPublicId(uid);
            await setDoc(doc(db, "communityProfiles", uid), {
                uid, publicId, accountName: null, createdAt: now, updatedAt: now,
            });
        }
        await setDoc(doc(db, "replays", VIDEO_ID, "comments", "public-comment"), {
            status: "published", visibility: "public", authorName: testPublicId("alice"),
            authorPublicId: testPublicId("alice"), text: "public",
        });
        await setDoc(doc(db, "replays", VIDEO_ID, "commentAuthors", "public-comment"), {
            uid: "alice", publicId: testPublicId("alice"), createdAt: now,
        });
        await setDoc(doc(db, "replays", VIDEO_ID, "comments", "private-comment"), {
            status: "published", visibility: "private", authorName: testPublicId("bob"),
            authorPublicId: testPublicId("bob"), text: "private",
        });
        await setDoc(doc(db, "replays", VIDEO_ID, "commentAuthors", "private-comment"), {
            uid: "bob", publicId: testPublicId("bob"), createdAt: now,
        });
    });
}

function validCommunityComment(
    authorUid: string,
    commentId: string,
    groupIds: string[] = [],
    authorName = testPublicId(authorUid),
): Record<string, unknown> {
    const authorPublicId = testPublicId(authorUid);
    return {
        schemaVersion: 1,
        text: "review comment",
        videoTimeMs: 12_000,
        rating: "good",
        color: "#ffffff",
        size: "medium",
        durationMs: 5_000,
        mode: "scroll",
        x: null,
        y: null,
        visibility: "public",
        clientRequestId: commentId,
        authorName,
        authorPublicId,
        authorGroupIds: groupIds,
        status: "published",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
}

function testPublicId(uid: string): string {
    return `${uid}0000000000`.slice(0, 10);
}

async function seedCommunityProfile(uid: string, accountName: string | null = null): Promise<void> {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const now = Timestamp.now();
        const publicId = testPublicId(uid);
        await setDoc(doc(db, "communityPublicIds", publicId), { uid, createdAt: now });
        await setDoc(doc(db, "communityProfiles", uid), { uid, publicId, accountName, createdAt: now, updatedAt: now });
    });
}

function createCommentWithQuota(
    db: ReturnType<typeof aliceDb>,
    uid: string,
    commentId: string,
    groupIds: string[] = [],
    authorName = testPublicId(uid),
) {
    const batch = writeBatch(db);
    batch.set(doc(db, "commentWriteQuotas", `${uid}_${VIDEO_ID}`), {
        uid,
        videoId: VIDEO_ID,
        lastCommentId: commentId,
        windowStartedAt: serverTimestamp(),
        lastWriteAt: serverTimestamp(),
        writeCount: 1,
    });
    batch.set(doc(db, "replays", VIDEO_ID, "comments", commentId), validCommunityComment(uid, commentId, groupIds, authorName));
    batch.set(doc(db, "replays", VIDEO_ID, "commentAuthors", commentId), {
        uid,
        publicId: testPublicId(uid),
        createdAt: serverTimestamp(),
    });
    return batch.commit();
}

describe("Firestore community comment security rules", () => {
    test("allows only the replay owner to change comment access settings", async () => {
        await seedCommunityComments();
        const settingsRef = doc(aliceDb(), "replays", VIDEO_ID, "commentSettings", "access");
        await assertSucceeds(updateDoc(settingsRef, {
            writeAccess: "public",
            readAccess: "invite_only",
            updatedAt: serverTimestamp(),
        }));
        await assertFails(updateDoc(doc(googleDb("bob"), "replays", VIDEO_ID, "commentSettings", "access"), {
            writeAccess: "public",
            updatedAt: serverTimestamp(),
        }));
    });

    test("creates one immutable public ID atomically and allows changing only the account name", async () => {
        const db = googleDb("bob");
        const publicId = testPublicId("bob");
        const create = writeBatch(db);
        create.set(doc(db, "communityPublicIds", publicId), { uid: "bob", createdAt: serverTimestamp() });
        create.set(doc(db, "communityProfiles", "bob"), {
            uid: "bob", publicId, accountName: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        await assertSucceeds(create.commit());
        await assertFails(getDoc(doc(db, "communityPublicIds", publicId)));
        await assertSucceeds(updateDoc(doc(db, "communityProfiles", "bob"), {
            accountName: "Coach Bob", updatedAt: serverTimestamp(),
        }));
        await assertFails(updateDoc(doc(db, "communityProfiles", "bob"), {
            publicId: "Changed123", updatedAt: serverTimestamp(),
        }));

        const charlie = googleDb("charlie");
        const duplicate = writeBatch(charlie);
        duplicate.set(doc(charlie, "communityPublicIds", publicId), { uid: "charlie", createdAt: serverTimestamp() });
        duplicate.set(doc(charlie, "communityProfiles", "charlie"), {
            uid: "charlie", publicId, accountName: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        await assertFails(duplicate.commit());
    });

    test("allows an owner to issue a one-use invite and the code holder to redeem it atomically", async () => {
        await seedCommunityComments();
        const inviteId = "a".repeat(48);
        const owner = aliceDb();
        await assertSucceeds(setDoc(doc(owner, "replays", VIDEO_ID, "commentInvites", inviteId), {
            status: "active",
            role: "commenter",
            createdByUid: "alice",
            createdAt: serverTimestamp(),
            expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
            maxUses: 1,
            usedCount: 0,
        }));

        const bob = googleDb("bob");
        const redeem = writeBatch(bob);
        redeem.update(doc(bob, "replays", VIDEO_ID, "commentInvites", inviteId), {
            status: "used",
            usedCount: 1,
            usedAt: serverTimestamp(),
        });
        redeem.set(doc(bob, "replays", VIDEO_ID, "commentMembers", "bob"), {
            uid: "bob",
            role: "commenter",
            status: "active",
            displayName: "Bob user",
            groupIds: [inviteId],
            invitedByUid: "alice",
            grantedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        await assertSucceeds(redeem.commit());
        await assertSucceeds(getDoc(doc(bob, "replays", VIDEO_ID, "commentMembers", "bob")));

        const charlie = googleDb("charlie");
        const reuse = writeBatch(charlie);
        reuse.update(doc(charlie, "replays", VIDEO_ID, "commentInvites", inviteId), {
            status: "used", usedCount: 2, usedAt: serverTimestamp(),
        });
        reuse.set(doc(charlie, "replays", VIDEO_ID, "commentMembers", "charlie"), {
            uid: "charlie", role: "commenter", status: "active", displayName: "Charlie user",
            groupIds: [inviteId], invitedByUid: "alice", grantedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        await assertFails(reuse.commit());
    });

    test("allows a permitted user to create and edit a validated comment with an atomic quota", async () => {
        await seedCommunityComments("public", "public");
        await seedCommunityProfile("bob");
        const bob = googleDb("bob");
        const commentId = "comment-bob-0001";
        await assertSucceeds(createCommentWithQuota(bob, "bob", commentId));
        const created = await getDoc(doc(bob, "replays", VIDEO_ID, "comments", commentId));
        expect(created.data()).not.toHaveProperty("authorUid");
        await assertFails(getDoc(doc(bob, "replays", VIDEO_ID, "commentAuthors", commentId)));
        await assertFails(getDoc(doc(aliceDb(), "replays", VIDEO_ID, "commentAuthors", commentId)));
        await assertSucceeds(updateDoc(doc(bob, "replays", VIDEO_ID, "comments", commentId), {
            text: "updated review",
            updatedAt: serverTimestamp(),
        }));
        await assertFails(updateDoc(doc(googleDb("charlie"), "replays", VIDEO_ID, "comments", commentId), {
            text: "hijacked",
            updatedAt: serverTimestamp(),
        }));
    });

    test("allows the replay owner to soft-delete another user's comment", async () => {
        await seedCommunityComments("public", "public");
        await seedCommunityProfile("bob");
        const commentId = "comment-bob-0002";
        await assertSucceeds(createCommentWithQuota(googleDb("bob"), "bob", commentId));
        await assertSucceeds(updateDoc(doc(aliceDb(), "replays", VIDEO_ID, "comments", commentId), {
            status: "deleted",
            updatedAt: serverTimestamp(),
        }));
    });

    test("moves a legacy comment UID into a client-unreadable ownership document", async () => {
        await seedCommunityComments("public", "public");
        await seedCommunityProfile("bob");
        const commentId = "legacy-comment-01";
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), "replays", VIDEO_ID, "comments", commentId), {
                ...validCommunityComment("bob", commentId),
                authorUid: "bob",
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
        });
        const bob = googleDb("bob");
        const legacy = await getDoc(doc(bob, "replays", VIDEO_ID, "comments", commentId));
        const migrate = writeBatch(bob);
        migrate.set(doc(bob, "replays", VIDEO_ID, "commentAuthors", commentId), {
            uid: "bob",
            publicId: testPublicId("bob"),
            createdAt: legacy.data()!.createdAt,
        });
        migrate.update(doc(bob, "replays", VIDEO_ID, "comments", commentId), { authorUid: deleteField() });
        await assertSucceeds(migrate.commit());
        const migrated = await getDoc(doc(bob, "replays", VIDEO_ID, "comments", commentId));
        expect(migrated.data()).not.toHaveProperty("authorUid");
        await assertFails(getDoc(doc(bob, "replays", VIDEO_ID, "commentAuthors", commentId)));
    });

    test("requires the configured account name instead of a forged comment author name", async () => {
        await seedCommunityComments("public", "public");
        await seedCommunityProfile("bob", "Coach Bob");
        const bob = googleDb("bob");
        await assertSucceeds(createCommentWithQuota(bob, "bob", "comment-account-name", [], "Coach Bob"));
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            await deleteDoc(doc(context.firestore(), "commentWriteQuotas", `bob_${VIDEO_ID}`));
        });
        await assertFails(createCommentWithQuota(bob, "bob", "comment-forged-name", [], "Someone Else"));
    });

    test("denies a valid-looking comment without its quota write or with spoofed invite groups", async () => {
        await seedCommunityComments("public", "public");
        await seedCommunityProfile("bob");
        const bob = googleDb("bob");
        await assertFails(setDoc(
            doc(bob, "replays", VIDEO_ID, "comments", "comment-no-quota"),
            validCommunityComment("bob", "comment-no-quota"),
        ));
        const missingAuthor = writeBatch(bob);
        missingAuthor.set(doc(bob, "commentWriteQuotas", `bob_${VIDEO_ID}`), {
            uid: "bob", videoId: VIDEO_ID, lastCommentId: "comment-no-author",
            windowStartedAt: serverTimestamp(), lastWriteAt: serverTimestamp(), writeCount: 1,
        });
        missingAuthor.set(
            doc(bob, "replays", VIDEO_ID, "comments", "comment-no-author"),
            validCommunityComment("bob", "comment-no-author"),
        );
        await assertFails(missingAuthor.commit());
        await assertFails(createCommentWithQuota(bob, "bob", "comment-fake-group", ["a".repeat(48)]));
    });

    test("allows everyone to read public comments when configured public", async () => {
        await seedCommunityComments("public");
        const db = testEnvironment.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(db, "replays", VIDEO_ID, "comments", "public-comment")));
        await assertFails(getDoc(doc(db, "replays", VIDEO_ID, "comments", "private-comment")));
    });

    test("allows only the author to read a private comment", async () => {
        await seedCommunityComments("public");
        const bob = testEnvironment.authenticatedContext("bob", { firebase: { sign_in_provider: "google.com" } }).firestore();
        await assertSucceeds(getDoc(doc(bob, "replays", VIDEO_ID, "comments", "private-comment")));
        await assertFails(getDoc(doc(aliceDb(), "replays", VIDEO_ID, "comments", "private-comment")));
    });

    test("requires active membership when reading is invite-only", async () => {
        await seedCommunityComments("invite_only");
        const publicDb = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(publicDb, "replays", VIDEO_ID, "comments", "public-comment")));
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), "replays", VIDEO_ID, "commentMembers", "bob"), {
                uid: "bob", status: "active", role: "commenter", groupIds: ["group-1"],
            });
        });
        const bob = testEnvironment.authenticatedContext("bob", { firebase: { sign_in_provider: "google.com" } }).firestore();
        await assertSucceeds(getDoc(doc(bob, "replays", VIDEO_ID, "comments", "public-comment")));
    });

    test("denies direct client comment and membership writes", async () => {
        await seedCommunityComments("public");
        await assertFails(setDoc(doc(aliceDb(), "replays", VIDEO_ID, "comments", "attacker"), {
            status: "published", visibility: "public", authorUid: "alice", text: "bypass backend",
        }));
        await assertFails(setDoc(doc(aliceDb(), "replays", VIDEO_ID, "commentMembers", "mallory"), {
            uid: "mallory", status: "active", role: "commenter",
        }));
    });
});
