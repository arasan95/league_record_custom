import type { PreparedReplayShare } from "../replay_share";
import { findMissingYouTubeVideos } from "./youtube";
import { readYouTubeUploadHistory, rememberYouTubeUpload } from "../youtube_upload_history";

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

export async function getReplayShareAuthStatus(): Promise<{ authenticated: boolean; google: boolean; anonymous: boolean }> {
    const { auth } = await getFirebaseServices();
    await waitForAuthInitialization(auth);
    return {
        authenticated: Boolean(auth.currentUser),
        google: hasGoogleProvider(auth.currentUser),
        anonymous: auth.currentUser?.isAnonymous === true,
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
        } else if (!hasGoogleProvider(auth.currentUser)) {
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
