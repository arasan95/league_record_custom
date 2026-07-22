import type { PreparedReplayShare } from "../replay_share";
import { findMissingYouTubeVideos, getYouTubeAuthStatus } from "./youtube";
import { readYouTubeUploadHistory, rememberYouTubeUpload } from "../youtube_upload_history";
import {
    DEFAULT_COMMUNITY_COMMENT_SETTINGS,
    validateCommunityCommentInput,
    validateCommunitySettings,
    type CommunityCommentContext,
    type CommunityCommentInput,
    type CommunityCommentRecord,
    type CommunityCommentSettings,
} from "../community_comments";
import {
    communityDisplayName,
    createCommunityPublicId,
    isCommunityPublicId,
    normalizeCommunityAccountName,
    type CommunityAccountProfile,
} from "../community_identity";

// Firebase Web configuration identifies this app/project; it is not a service
// account credential. Firestore Rules below are the access-control boundary.
const firebaseConfig = {
    apiKey: "AIzaSyC1auk9E1xGt9vXiOCMRP3Ioskari6fWQo",
    authDomain: "leaguerecord.firebaseapp.com",
    projectId: "leaguerecord",
    storageBucket: "leaguerecord.firebasestorage.app",
    messagingSenderId: "441188314625",
    appId: "1:441188314625:web:d5e4f4224f48df61d29a00",
};

type FirebaseServices = {
    auth: import("firebase/auth").Auth;
    firestore: import("firebase/firestore").Firestore;
    authSdk: typeof import("firebase/auth");
    firestoreSdk: typeof import("firebase/firestore");
};

let firebaseServicesPromise: Promise<FirebaseServices> | null = null;
const FIREBASE_OPERATION_TIMEOUT_MS = 20_000;
const REPLAY_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPLAY_WRITE_COOLDOWN_MS = 10_000;
const MAX_REPLAY_CREATES_PER_WINDOW = 20;
const MAX_REPLAY_WRITES_PER_WINDOW = 50;
const COMMENT_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const COMMENT_WRITE_COOLDOWN_MS = 2_000;
const MAX_COMMENTS_PER_WINDOW = 200;
const COMMENT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const electronDevConfig = typeof window !== "undefined" ? window.leagueRecord?.devConfig : undefined;
const REPLAY_SHARE_BACKEND_URL = electronDevConfig?.replayShareBackendUrl.trim().replace(/\/$/, "") || "";
const FIRESTORE_EMULATOR_ADDRESS = electronDevConfig?.firestoreEmulatorHost.trim() || "";

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label}がタイムアウトしました。インターネット接続とFirestoreルールを確認してください。`));
        }, FIREBASE_OPERATION_TIMEOUT_MS);
    });
    return Promise.race([operation, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

function firebaseErrorCode(error: unknown): string {
    return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

function replayWriteError(error: unknown): Error {
    const code = firebaseErrorCode(error);
    if (code.includes("permission-denied")) {
        return new Error("Firestoreへの登録が拒否されました。Google認証とFirestoreルールを確認してください。");
    }
    if (code.includes("unauthenticated")) {
        return new Error("FirebaseのGoogle認証に失敗しました。Googleアカウントをもう一度接続してください。");
    }
    if (code.includes("unavailable")) {
        return new Error("Firestoreに接続できません。インターネット接続を確認してください。");
    }
    return error instanceof Error ? error : new Error(String(error));
}

async function getFirebaseServices(): Promise<FirebaseServices> {
    firebaseServicesPromise ??= Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
    ]).then(([appSdk, authSdk, firestoreSdk]) => {
        const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
        let firestore: import("firebase/firestore").Firestore;
        try {
            firestore = firestoreSdk.initializeFirestore(app, {
                experimentalForceLongPolling: true,
                experimentalLongPollingOptions: { timeoutSeconds: 15 },
            });
        } catch (error) {
            // During development HMR can retain an already initialized Firebase
            // app. Reuse it; a normal application restart gets the settings above.
            if (!firebaseErrorCode(error).includes("failed-precondition")) throw error;
            firestore = firestoreSdk.getFirestore(app);
        }
        if (FIRESTORE_EMULATOR_ADDRESS) {
            const [host, portText] = FIRESTORE_EMULATOR_ADDRESS.split(":");
            const port = Number(portText);
            if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
                throw new Error("VITE_FIRESTORE_EMULATOR_HOSTは host:port 形式で指定してください。");
            }
            try {
                firestoreSdk.connectFirestoreEmulator(firestore, host, port);
            } catch (error) {
                if (!firebaseErrorCode(error).includes("failed-precondition")) throw error;
            }
        }
        return {
            auth: authSdk.getAuth(app),
            // Electron/antivirus/proxy combinations can buffer Firestore's
            // WebChannel stream indefinitely. Long polling avoids that hang.
            firestore,
            authSdk,
            firestoreSdk,
        };
    });
    return firebaseServicesPromise;
}

async function waitForAuthInitialization(auth: import("firebase/auth").Auth): Promise<void> {
    await withTimeout(auth.authStateReady(), "Firebase認証状態の確認");
}

function hasGoogleProvider(user: import("firebase/auth").User | null): boolean {
    return Boolean(user?.providerData.some((provider) => provider.providerId === "google.com"));
}

export async function getReplayShareAuthStatus(): Promise<{
    authenticated: boolean;
    google: boolean;
    anonymous: boolean;
    uid: string | null;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
}> {
    const { auth } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    return {
        authenticated: Boolean(auth.currentUser),
        google: hasGoogleProvider(auth.currentUser),
        anonymous: auth.currentUser?.isAnonymous === true,
        uid: auth.currentUser?.uid ?? null,
        displayName: auth.currentUser?.displayName ?? null,
        email: auth.currentUser?.email ?? null,
        photoURL: auth.currentUser?.photoURL ?? null,
    };
}

export async function connectReplayShareGoogle(firebaseIdToken: string): Promise<void> {
    if (!firebaseIdToken) throw new Error("Google本人確認情報がありません。もう一度接続してください。");
    const { auth, authSdk } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    const credential = authSdk.GoogleAuthProvider.credential(firebaseIdToken);
    try {
        if (auth.currentUser?.isAnonymous) {
            await withTimeout(authSdk.linkWithCredential(auth.currentUser, credential), "Firebaseアカウントの移行");
        } else {
            // The YouTube desktop session can be switched to another Google
            // account while Firebase still retains the previous one. Always
            // apply the freshly issued credential so ownership checks use the
            // account that is currently connected to YouTube.
            await withTimeout(authSdk.signInWithCredential(auth, credential), "Firebase Google認証");
        }
    } catch (error) {
        const code = firebaseErrorCode(error);
        if (code.includes("credential-already-in-use") || code.includes("account-exists-with-different-credential")) {
            // This Google account was linked on an earlier installation or
            // device. Sign back into that existing Firebase account.
            await withTimeout(authSdk.signInWithCredential(auth, credential), "既存Firebaseアカウントへのログイン");
        } else {
            throw error;
        }
    }
    if (!hasGoogleProvider(auth.currentUser)) {
        throw new Error("FirebaseのGoogle認証を確認できませんでした。");
    }
    await ensureCommunityAccountProfile();
}

export async function listOwnedReplayShareIds(): Promise<string[]> {
    const { auth, firestore, firestoreSdk } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    if (!auth.currentUser || !hasGoogleProvider(auth.currentUser)) {
        throw new Error("自分の投稿を表示するにはGoogleアカウントを接続してください。");
    }
    try {
        const ownedQuery = firestoreSdk.query(
            firestoreSdk.collection(firestore, "replays"),
            firestoreSdk.where("ownerUid", "==", auth.currentUser.uid),
            firestoreSdk.limit(100),
        );
        const snapshot = await withTimeout(firestoreSdk.getDocs(ownedQuery), "自分の共有リプレイの取得");
        return snapshot.docs
            .map((item) => item.id)
            .filter((videoId) => /^[A-Za-z0-9_-]{11}$/u.test(videoId));
    } catch (error) {
        throw replayWriteError(error);
    }
}

export async function signOutReplayShareAuth(): Promise<void> {
    const { auth, authSdk } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    await withTimeout(authSdk.signOut(auth), "Firebaseからのログアウト");
}

async function currentGoogleUid(): Promise<string> {
    const { auth } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    if (!auth.currentUser || !hasGoogleProvider(auth.currentUser)) {
        throw new Error("試合データを登録するにはGoogleアカウントを接続してください。");
    }
    return auth.currentUser.uid;
}

async function currentCommunityUser(): Promise<import("firebase/auth").User> {
    const { auth } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    if (!auth.currentUser || !hasGoogleProvider(auth.currentUser)) throw new Error("Googleアカウントを接続してください。");
    return auth.currentUser;
}

function communityProfileFromData(uid: string, data: Record<string, any>): CommunityAccountProfile {
    if (data.uid !== uid || !isCommunityPublicId(data.publicId)) throw new Error("コミュニティIDの保存データが不正です。");
    return {
        uid,
        publicId: data.publicId,
        accountName: normalizeCommunityAccountName(data.accountName),
        createdAtMs: data.createdAt?.toMillis?.() ?? 0,
        updatedAtMs: data.updatedAt?.toMillis?.() ?? 0,
    };
}

export async function ensureCommunityAccountProfile(): Promise<CommunityAccountProfile> {
    const user = await currentCommunityUser();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    const profileRef = firestoreSdk.doc(firestore, "communityProfiles", user.uid);
    const existing = await withTimeout(firestoreSdk.getDoc(profileRef), "コミュニティIDの確認");
    if (existing.exists()) return communityProfileFromData(user.uid, existing.data());

    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const publicId = createCommunityPublicId();
        const reservationRef = firestoreSdk.doc(firestore, "communityPublicIds", publicId);
        const batch = firestoreSdk.writeBatch(firestore);
        batch.set(reservationRef, {
                uid: user.uid,
                createdAt: firestoreSdk.serverTimestamp(),
        });
        batch.set(profileRef, {
                uid: user.uid,
                publicId,
                accountName: null,
                createdAt: firestoreSdk.serverTimestamp(),
                updatedAt: firestoreSdk.serverTimestamp(),
        });
        try {
            // No reservation read is needed. An existing ID turns this set into
            // an update, which security rules reject, so a collision is retried.
            await withTimeout(batch.commit(), "コミュニティIDの作成");
            return { uid: user.uid, publicId, accountName: null, createdAtMs: Date.now(), updatedAtMs: Date.now() };
        } catch (error) {
            lastError = error;
            const concurrentlyCreated = await withTimeout(firestoreSdk.getDoc(profileRef), "コミュニティIDの再確認");
            if (concurrentlyCreated.exists()) return communityProfileFromData(user.uid, concurrentlyCreated.data());
        }
    }
    throw communityWriteError(lastError);
}

export async function getCommunityAccountProfile(): Promise<CommunityAccountProfile | null> {
    const { auth, firestore, firestoreSdk } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    if (!auth.currentUser || !hasGoogleProvider(auth.currentUser)) return null;
    const snapshot = await withTimeout(
        firestoreSdk.getDoc(firestoreSdk.doc(firestore, "communityProfiles", auth.currentUser.uid)),
        "コミュニティIDの取得",
    );
    return snapshot.exists() ? communityProfileFromData(auth.currentUser.uid, snapshot.data()) : null;
}

export async function saveCommunityAccountName(value: string | null): Promise<CommunityAccountProfile> {
    const accountName = normalizeCommunityAccountName(value);
    const profile = await ensureCommunityAccountProfile();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    try {
        await withTimeout(firestoreSdk.updateDoc(
            firestoreSdk.doc(firestore, "communityProfiles", profile.uid),
            { accountName, updatedAt: firestoreSdk.serverTimestamp() },
        ), "アカウント名の保存");
        return { ...profile, accountName, updatedAtMs: Date.now() };
    } catch (error) {
        throw communityWriteError(error);
    }
}

function communityWriteError(error: unknown): Error {
    const code = firebaseErrorCode(error);
    if (code.includes("permission-denied")) {
        return new Error("この操作を行う権限がありません。Googleアカウントと共有設定を確認してください。");
    }
    if (code.includes("already-exists")) return new Error("同じデータがすでに登録されています。");
    return replayWriteError(error);
}

function createInviteCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getCommunityCommentContext(videoId: string): Promise<CommunityCommentContext> {
    const { auth, firestore, firestoreSdk } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    const user = hasGoogleProvider(auth.currentUser) ? auth.currentUser : null;
    const replayRef = firestoreSdk.doc(firestore, "replays", videoId);
    const settingsRef = firestoreSdk.doc(firestore, "replays", videoId, "commentSettings", "access");
    const [replaySnapshot, settingsSnapshot] = await Promise.all([
        withTimeout(firestoreSdk.getDoc(replayRef), "共有リプレイ情報の取得"),
        withTimeout(firestoreSdk.getDoc(settingsRef), "コメント公開設定の取得"),
    ]);
    if (!replaySnapshot.exists()) throw new Error("共有リプレイが見つかりません。");
    const settingsData = settingsSnapshot.data();
    const settings: CommunityCommentSettings = settingsData
        && (settingsData.writeAccess === "public" || settingsData.writeAccess === "invite_only")
        && (settingsData.readAccess === "public" || settingsData.readAccess === "invite_only")
        ? { writeAccess: settingsData.writeAccess, readAccess: settingsData.readAccess }
        : DEFAULT_COMMUNITY_COMMENT_SETTINGS;
    let isMember = false;
    let memberGroupIds: string[] = [];
    let currentPublicId: string | null = null;
    if (user) {
        const [member, profile] = await Promise.all([
            withTimeout(
                firestoreSdk.getDoc(firestoreSdk.doc(firestore, "replays", videoId, "commentMembers", user.uid)),
                "コメント権限の確認",
            ),
            withTimeout(
                firestoreSdk.getDoc(firestoreSdk.doc(firestore, "communityProfiles", user.uid)),
                "コミュニティIDの確認",
            ),
        ]);
        const memberData = member.data();
        isMember = member.exists() && memberData?.status === "active";
        memberGroupIds = isMember && Array.isArray(memberData?.groupIds)
            ? memberData.groupIds.filter((value: unknown): value is string => typeof value === "string")
            : [];
        currentPublicId = profile.exists() && isCommunityPublicId(profile.data().publicId) ? profile.data().publicId : null;
    }
    const ownerUid = String(replaySnapshot.data().ownerUid || "");
    const isOwner = user?.uid === ownerUid;
    const canRead = settings.readAccess === "public" || isOwner || isMember;
    const canWrite = Boolean(user) && canRead && (settings.writeAccess === "public" || isOwner || isMember);
    return {
        videoId,
        ownerUid,
        currentUid: user?.uid ?? null,
        currentPublicId,
        currentUserName: user?.displayName ?? null,
        isOwner,
        isMember,
        memberGroupIds,
        settings,
        canRead,
        canWrite,
    };
}

function communityRecord(id: string, data: Record<string, any>): CommunityCommentRecord | null {
    if (typeof data.text !== "string" || typeof data.authorName !== "string") return null;
    return {
        id,
        text: data.text,
        videoTimeMs: Number(data.videoTimeMs || 0),
        rating: data.rating === "good" || data.rating === "bad" || data.rating === "question" ? data.rating : null,
        color: typeof data.color === "string" ? data.color : "#ffffff",
        size: data.size === "small" || data.size === "large" ? data.size : "medium",
        durationMs: Number(data.durationMs || 5_000),
        mode: data.mode === "fixed" ? "fixed" : "scroll",
        x: typeof data.x === "number" ? data.x : null,
        y: typeof data.y === "number" ? data.y : null,
        visibility: data.visibility === "private" ? "private" : "public",
        clientRequestId: typeof data.clientRequestId === "string" ? data.clientRequestId : id,
        authorUid: typeof data.authorUid === "string" ? data.authorUid : undefined,
        authorName: data.authorName,
        authorPublicId: isCommunityPublicId(data.authorPublicId) ? data.authorPublicId : null,
        authorGroupIds: Array.isArray(data.authorGroupIds) ? data.authorGroupIds.filter((value: unknown) => typeof value === "string") : [],
        createdAtMs: data.createdAt?.toMillis?.() ?? 0,
        updatedAtMs: data.updatedAt?.toMillis?.() ?? 0,
    };
}

export async function subscribeCommunityComments(
    context: CommunityCommentContext,
    onComments: (comments: CommunityCommentRecord[]) => void,
    onError: (error: Error) => void,
): Promise<() => void> {
    if (!context.canRead) {
        onComments([]);
        return () => {};
    }
    const { firestore, firestoreSdk } = await getFirebaseServices();
    const collectionRef = firestoreSdk.collection(firestore, "replays", context.videoId, "comments");
    const snapshots = new Map<string, CommunityCommentRecord>();
    const publicIds = new Set<string>();
    const privateIds = new Set<string>();
    const legacyPrivateIds = new Set<string>();
    const migratingLegacyIds = new Set<string>();
    const emit = () => onComments([...snapshots.values()].toSorted((a, b) => a.videoTimeMs - b.videoTimeMs || a.createdAtMs - b.createdAtMs));
    const consume = (bucket: Set<string>, snapshot: import("firebase/firestore").QuerySnapshot) => {
        for (const id of bucket) snapshots.delete(id);
        bucket.clear();
        snapshot.docs.forEach((item) => {
            const data = item.data();
            const record = communityRecord(item.id, data);
            if (!record) return;
            bucket.add(item.id);
            snapshots.set(item.id, record);
            if (record.authorUid && record.authorPublicId && data.createdAt
                && (context.isOwner || record.authorUid === context.currentUid)
                && !migratingLegacyIds.has(item.id)) {
                migratingLegacyIds.add(item.id);
                const migration = firestoreSdk.writeBatch(firestore);
                migration.set(firestoreSdk.doc(firestore, "replays", context.videoId, "commentAuthors", item.id), {
                    uid: record.authorUid,
                    publicId: record.authorPublicId,
                    createdAt: data.createdAt,
                });
                migration.update(item.ref, { authorUid: firestoreSdk.deleteField() });
                void migration.commit().catch(() => migratingLegacyIds.delete(item.id));
            }
        });
        emit();
    };
    const unsubs: Array<() => void> = [];
    const publicQuery = firestoreSdk.query(collectionRef,
        firestoreSdk.where("status", "==", "published"),
        firestoreSdk.where("visibility", "==", "public"),
        firestoreSdk.limit(500));
    unsubs.push(firestoreSdk.onSnapshot(publicQuery, (snapshot) => consume(publicIds, snapshot), (error) => onError(replayWriteError(error))));
    if (context.currentPublicId) {
        const privateQuery = firestoreSdk.query(collectionRef,
            firestoreSdk.where("status", "==", "published"),
            firestoreSdk.where("visibility", "==", "private"),
            firestoreSdk.where("authorPublicId", "==", context.currentPublicId),
            firestoreSdk.limit(500));
        unsubs.push(firestoreSdk.onSnapshot(privateQuery, (snapshot) => consume(privateIds, snapshot), (error) => onError(replayWriteError(error))));
    }
    if (!context.currentPublicId && context.currentUid) {
        const legacyPrivateQuery = firestoreSdk.query(collectionRef,
            firestoreSdk.where("status", "==", "published"),
            firestoreSdk.where("visibility", "==", "private"),
            firestoreSdk.where("authorUid", "==", context.currentUid),
            firestoreSdk.limit(500));
        unsubs.push(firestoreSdk.onSnapshot(legacyPrivateQuery, (snapshot) => consume(legacyPrivateIds, snapshot), (error) => onError(replayWriteError(error))));
    }
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
}

export async function postCommunityComment(videoId: string, input: CommunityCommentInput): Promise<string> {
    const validated = validateCommunityCommentInput(input);
    const user = await currentCommunityUser();
    const profile = await ensureCommunityAccountProfile();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    const replayRef = firestoreSdk.doc(firestore, "replays", videoId);
    const settingsRef = firestoreSdk.doc(firestore, "replays", videoId, "commentSettings", "access");
    const memberRef = firestoreSdk.doc(firestore, "replays", videoId, "commentMembers", user.uid);
    const commentRef = firestoreSdk.doc(firestore, "replays", videoId, "comments", validated.clientRequestId);
    const authorRef = firestoreSdk.doc(firestore, "replays", videoId, "commentAuthors", validated.clientRequestId);
    const quotaRef = firestoreSdk.doc(firestore, "commentWriteQuotas", `${user.uid}_${videoId}`);
    try {
        await withTimeout(firestoreSdk.runTransaction(firestore, async (transaction) => {
            const [replay, settingsSnapshot, member, existing, quotaSnapshot] = await Promise.all([
                transaction.get(replayRef), transaction.get(settingsRef), transaction.get(memberRef),
                transaction.get(commentRef), transaction.get(quotaRef),
            ]);
            if (!replay.exists()) throw new Error("共有リプレイが見つかりません。");
            if (existing.exists()) return;
            const isOwner = replay.data().ownerUid === user.uid;
            const isMember = member.exists() && member.data().status === "active";
            const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : DEFAULT_COMMUNITY_COMMENT_SETTINGS;
            if (settings.readAccess === "invite_only" && !isOwner && !isMember) throw new Error("コメントの閲覧許可がありません。");
            if (settings.writeAccess === "invite_only" && !isOwner && !isMember) throw new Error("コメントの投稿許可がありません。");
            const quota = quotaSnapshot.data();
            const nowMillis = Date.now();
            const windowStartedAt = quota?.windowStartedAt?.toMillis?.() ?? 0;
            const lastWriteAt = quota?.lastWriteAt?.toMillis?.() ?? 0;
            const reset = !quotaSnapshot.exists() || nowMillis >= windowStartedAt + COMMENT_WRITE_WINDOW_MS;
            const writeCount = reset ? 1 : Number(quota?.writeCount || 0) + 1;
            if (!reset && nowMillis < lastWriteAt + COMMENT_WRITE_COOLDOWN_MS) {
                throw new Error("コメントの連続投稿はできません。少し待ってください。");
            }
            if (writeCount > MAX_COMMENTS_PER_WINDOW) throw new Error("1日のコメント投稿上限に達しました。");
            const authorGroupIds = isMember && Array.isArray(member.data()?.groupIds)
                ? member.data().groupIds.filter((value: unknown): value is string => typeof value === "string").slice(0, 20)
                : [];
            transaction.set(commentRef, {
                schemaVersion: 1,
                ...validated,
                authorName: communityDisplayName(profile),
                authorPublicId: profile.publicId,
                authorGroupIds,
                status: "published",
                createdAt: firestoreSdk.serverTimestamp(),
                updatedAt: firestoreSdk.serverTimestamp(),
            });
            transaction.set(authorRef, {
                uid: user.uid,
                publicId: profile.publicId,
                createdAt: firestoreSdk.serverTimestamp(),
            });
            transaction.set(quotaRef, {
                uid: user.uid,
                videoId,
                lastCommentId: validated.clientRequestId,
                windowStartedAt: reset ? firestoreSdk.serverTimestamp() : quota!.windowStartedAt,
                lastWriteAt: firestoreSdk.serverTimestamp(),
                writeCount,
            });
        }), "コメントの投稿");
        return validated.clientRequestId;
    } catch (error) {
        throw communityWriteError(error);
    }
}

export async function updateCommunityComment(videoId: string, commentId: string, input: CommunityCommentInput): Promise<void> {
    const validated = validateCommunityCommentInput(input);
    if (validated.clientRequestId !== commentId) throw new Error("コメントIDが一致しません。");
    await currentCommunityUser();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    try {
        await withTimeout(firestoreSdk.updateDoc(
            firestoreSdk.doc(firestore, "replays", videoId, "comments", commentId),
            { ...validated, updatedAt: firestoreSdk.serverTimestamp() },
        ), "コメントの更新");
    } catch (error) {
        throw communityWriteError(error);
    }
}

export async function deleteCommunityComment(videoId: string, commentId: string): Promise<void> {
    await currentCommunityUser();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    try {
        await withTimeout(firestoreSdk.updateDoc(
            firestoreSdk.doc(firestore, "replays", videoId, "comments", commentId),
            { status: "deleted", updatedAt: firestoreSdk.serverTimestamp() },
        ), "コメントの削除");
    } catch (error) {
        throw communityWriteError(error);
    }
}

export async function saveCommunityCommentSettings(videoId: string, settings: CommunityCommentSettings): Promise<void> {
    const validated = validateCommunitySettings(settings);
    const user = await currentCommunityUser();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    const replayRef = firestoreSdk.doc(firestore, "replays", videoId);
    const settingsRef = firestoreSdk.doc(firestore, "replays", videoId, "commentSettings", "access");
    try {
        await withTimeout(firestoreSdk.runTransaction(firestore, async (transaction) => {
            const [replay, existing] = await Promise.all([transaction.get(replayRef), transaction.get(settingsRef)]);
            if (!replay.exists() || replay.data().ownerUid !== user.uid) throw new Error("リプレイ所有者だけが変更できます。");
            transaction.set(settingsRef, {
                ...validated,
                ownerUid: user.uid,
                createdAt: existing.exists() ? existing.data().createdAt : firestoreSdk.serverTimestamp(),
                updatedAt: firestoreSdk.serverTimestamp(),
            });
        }), "コメント設定の保存");
    } catch (error) {
        throw communityWriteError(error);
    }
}

export async function createCommunityCommentInvite(videoId: string): Promise<string> {
    const user = await currentCommunityUser();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    const code = createInviteCode();
    try {
        await withTimeout(firestoreSdk.setDoc(
            firestoreSdk.doc(firestore, "replays", videoId, "commentInvites", code),
            {
                status: "active",
                role: "commenter",
                createdByUid: user.uid,
                createdAt: firestoreSdk.serverTimestamp(),
                expiresAt: firestoreSdk.Timestamp.fromMillis(Date.now() + COMMENT_INVITE_TTL_MS),
                maxUses: 1,
                usedCount: 0,
            },
        ), "招待コードの発行");
        return code;
    } catch (error) {
        throw communityWriteError(error);
    }
}

export async function redeemCommunityCommentInvite(videoId: string, code: string): Promise<void> {
    const normalizedCode = code.trim().toLowerCase();
    if (!/^[0-9a-f]{48}$/u.test(normalizedCode)) throw new Error("招待コードが不正です。");
    const user = await currentCommunityUser();
    const { firestore, firestoreSdk } = await getFirebaseServices();
    const inviteRef = firestoreSdk.doc(firestore, "replays", videoId, "commentInvites", normalizedCode);
    const memberRef = firestoreSdk.doc(firestore, "replays", videoId, "commentMembers", user.uid);
    try {
        await withTimeout(firestoreSdk.runTransaction(firestore, async (transaction) => {
            const [invite, member] = await Promise.all([transaction.get(inviteRef), transaction.get(memberRef)]);
            if (!invite.exists()) throw new Error("招待コードが見つかりません。");
            if (member.exists() && member.data().status === "active") throw new Error("すでに招待メンバーです。");
            const data = invite.data();
            const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
            if (data.status !== "active" || Date.now() >= expiresAt || Number(data.usedCount) >= Number(data.maxUses)) {
                throw new Error("招待コードは無効または使用済みです。");
            }
            transaction.update(inviteRef, {
                usedCount: Number(data.usedCount) + 1,
                status: "used",
                usedAt: firestoreSdk.serverTimestamp(),
            });
            transaction.set(memberRef, {
                uid: user.uid,
                role: "commenter",
                status: "active",
                displayName: (user.displayName || "Google user").slice(0, 64),
                groupIds: [normalizedCode],
                invitedByUid: data.createdByUid,
                grantedAt: firestoreSdk.serverTimestamp(),
                updatedAt: firestoreSdk.serverTimestamp(),
            });
        }), "招待コードへの参加");
    } catch (error) {
        throw communityWriteError(error);
    }
}

export async function publishReplayShare(share: PreparedReplayShare): Promise<void> {
    try {
        const { firestore, firestoreSdk } = await getFirebaseServices();
        const ownerUid = await currentGoogleUid();
        if (REPLAY_SHARE_BACKEND_URL) {
            const { auth } = await getFirebaseServices();
            const idToken = await auth.currentUser!.getIdToken();
            const response = await withTimeout(fetch(`${REPLAY_SHARE_BACKEND_URL}/v1/replay-shares`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(share),
            }), "検証バックエンドへの試合データ登録");
            const result = await response.json().catch(() => null) as { error?: string } | null;
            if (!response.ok) {
                throw new Error(result?.error || `検証バックエンドが登録を拒否しました（HTTP ${response.status}）。`);
            }
            return;
        }
        const replayRef = firestoreSdk.doc(firestore, "replays", share.youtubeVideoId);
        const quotaRef = firestoreSdk.doc(firestore, "writeQuotas", ownerUid);
        await withTimeout(firestoreSdk.runTransaction(firestore, async (transaction) => {
            const existing = await transaction.get(replayRef);
            const quotaSnapshot = await transaction.get(quotaRef);
            const isCreate = !existing.exists();
            const nowMillis = Date.now();
            const quota = quotaSnapshot.data() as {
                windowStartedAt?: { toMillis?: () => number };
                lastWriteAt?: { toMillis?: () => number };
                writeCount?: number;
                createCount?: number;
            } | undefined;
            const windowStartedAt = quota?.windowStartedAt?.toMillis?.() ?? 0;
            const lastWriteAt = quota?.lastWriteAt?.toMillis?.() ?? 0;
            const resetWindow = !quotaSnapshot.exists() || nowMillis >= windowStartedAt + REPLAY_WRITE_WINDOW_MS;
            const writeCount = resetWindow ? 1 : Number(quota?.writeCount || 0) + 1;
            const createCount = resetWindow ? (isCreate ? 1 : 0) : Number(quota?.createCount || 0) + (isCreate ? 1 : 0);
            if (!resetWindow && nowMillis < lastWriteAt + REPLAY_WRITE_COOLDOWN_MS) {
                const waitSeconds = Math.max(1, Math.ceil((lastWriteAt + REPLAY_WRITE_COOLDOWN_MS - nowMillis) / 1000));
                throw new Error(`連続した試合データ登録はできません。${waitSeconds}秒後にもう一度お試しください。`);
            }
            if (writeCount > MAX_REPLAY_WRITES_PER_WINDOW) {
                throw new Error("24時間の試合データ登録・更新上限（50回）に達しました。時間をおいてお試しください。");
            }
            if (createCount > MAX_REPLAY_CREATES_PER_WINDOW) {
                throw new Error("24時間の新規共有上限（20件）に達しました。時間をおいてお試しください。");
            }
            transaction.set(quotaRef, {
                ownerUid,
                lastReplayId: share.youtubeVideoId,
                windowStartedAt: resetWindow ? firestoreSdk.serverTimestamp() : quota!.windowStartedAt,
                lastWriteAt: firestoreSdk.serverTimestamp(),
                updatedAt: firestoreSdk.serverTimestamp(),
                writeCount,
                createCount,
            });
            const sharedFields = {
                format: "league-record-share",
                schemaVersion: 1,
                status: "published",
                provider: "youtube",
                youtubeVideoId: share.youtubeVideoId,
                ownerUid,
                payloadJson: share.payloadJson,
                payloadBytes: share.payloadBytes,
                payloadSha256: share.payloadSha256,
                updatedAt: firestoreSdk.serverTimestamp(),
            } as const;
            if (!isCreate) {
                transaction.update(replayRef, sharedFields);
            } else {
                transaction.set(replayRef, {
                    ...sharedFields,
                    createdAt: firestoreSdk.serverTimestamp(),
                });
            }
        }), "Firestoreへの試合データ登録");
    } catch (error) {
        throw replayWriteError(error);
    }
}

export async function cleanupDeletedReplayShares(): Promise<string[]> {
    const videoIds = [...new Set(readYouTubeUploadHistory().map((item) => item.youtubeVideoId))];
    if (!videoIds.length) return [];
    try {
        // Startup cleanup must remain silent until OAuth is connected. Calling
        // videos.list before that only produces a misleading not_connected
        // error in the Electron IPC handler.
        const auth = await getYouTubeAuthStatus();
        if (!auth.connected || auth.cleanupEnabled !== true) return [];
        const deletedVideoIds: string[] = [];
        // videos.list accepts at most 50 IDs per request. Only IDs recorded by
        // this installation are checked; ordinary users perform no API calls.
        for (let offset = 0; offset < videoIds.length; offset += 50) {
            const missing = await findMissingYouTubeVideos(videoIds.slice(offset, offset + 50));
            deletedVideoIds.push(...missing);
        }
        if (!deletedVideoIds.length) return [];
        // The local badge is removed by the caller even if Firebase is signed
        // out. A badge means the video exists, not that its metadata exists.
        // Firestore deletion remains owner-only under the security rules.
        try {
            const { firestore, firestoreSdk } = await getFirebaseServices();
            await currentGoogleUid();
            for (const videoId of deletedVideoIds) {
                try {
                    await withTimeout(
                        firestoreSdk.deleteDoc(firestoreSdk.doc(firestore, "replays", videoId)),
                        "削除済み動画の試合データ整理",
                    );
                } catch (error) {
                    if (!firebaseErrorCode(error).includes("permission-denied")) throw error;
                }
            }
        } catch (error) {
            console.info("[youtube-replay] Firestore cleanup skipped after video removal", error);
        }
        return deletedVideoIds;
    } catch (error) {
        throw replayWriteError(error);
    }
}

export async function fetchReplayShareDocument(youtubeVideoId: string): Promise<Record<string, unknown>> {
    const { auth, firestore, firestoreSdk } = await getFirebaseServices();
    let snapshot;
    try {
        snapshot = await withTimeout(
            firestoreSdk.getDocFromServer(firestoreSdk.doc(firestore, "replays", youtubeVideoId)),
            "Firestoreからの試合データ取得",
        );
    } catch (error) {
        const code = firebaseErrorCode(error);
        if (code.includes("permission-denied")) {
            throw new Error("試合データを読み取れません。Firestoreルールが公開されているか確認してください。");
        }
        if (code.includes("unavailable")) {
            throw new Error("Firestoreに接続できません。インターネット接続を確認してください。");
        }
        throw error;
    }
    if (!snapshot.exists()) {
        throw new Error("このYouTube動画に対応する試合データが見つかりません。");
    }
    const data = snapshot.data() as Record<string, unknown>;
    // Backfill local upload history for shares created before it was introduced.
    // Ownership is verified before the ID becomes eligible for cleanup.
    if (hasGoogleProvider(auth.currentUser) && data.ownerUid === auth.currentUser?.uid) {
        rememberYouTubeUpload(null, youtubeVideoId);
    }
    return data;
}
