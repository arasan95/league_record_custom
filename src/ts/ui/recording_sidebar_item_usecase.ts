import { commands, type Participant, type Recording } from "../bindings";
import { startDrag } from "../platform/drag";
import { writeText } from "../platform/clipboard";
import { open } from "../platform/shell";
import {
    cancelYouTubeUpload,
    chooseYouTubeThumbnail,
    getYouTubeAuthStatus,
    getYouTubeChannelCapabilities,
    getYouTubeFirebaseIdToken,
    getYouTubeUploadJob,
    previewYouTubeThumbnail,
    reopenYouTubeSignIn,
    setYouTubeThumbnail,
    signInToYouTube,
    signOutFromYouTube,
    startYouTubeUpload,
    YOUTUBE_AUTH_CHANGED_EVENT,
    YOUTUBE_AUTH_CONNECTED_EVENT,
    type YouTubeUploadJob,
} from "../platform/youtube";
import {
    connectReplayShareGoogle,
    getReplayShareAuthStatus,
    publishReplayShare,
    signOutReplayShareAuth,
} from "../platform/firebase";
import { parseYouTubeVideoId, prepareReplayShare } from "../replay_share";
import { buildYouTubeUploadDefaults } from "../youtube_upload_defaults";
import { UI_LANGUAGE_CHANGED_EVENT, isJapaneseUi } from "../ui_locale";
import {
    findYouTubeUploadForSource,
    rememberYouTubeUpload,
    YOUTUBE_UPLOAD_HISTORY_CHANGED_EVENT,
} from "../youtube_upload_history";
import xLogoIcon from "../../assets/share-icons/x-logo.svg";
import discordSymbolIcon from "../../assets/share-icons/discord-symbol.svg";
import youtubeIcon from "../../assets/share-icons/youtube-icon.svg";
import {
    getChampionIconUrl,
    getChampionIconUrlById,
    getChampionNameById,
    getTftItemIconUrl,
    getTftTraitIconUrl,
    getTftTraitStyleClass,
    getTftUnitIconUrl,
} from "../datadragon";
import { getText } from "../i18n";
import { isFavorite, toVideoName } from "../util";
import { getShortQueueLabel } from "./queue_helpers";
import { requestOwnedYouTubeReplay } from "./youtube_replay_sidebar_usecase";
import {
    calcCsPerMin,
    createClipIconElement,
    formatDurationMmSs,
    formatSidebarDate,
    getMatchResultMeta,
    isRedSideMeta,
    resolveDurationSeconds,
    resolveTftTraitStyleClass,
    resolveTftUnitCost,
} from "./recording_item_usecase";
const PERF_LOG_ENABLED = false;
const X_COMPOSE_URL = "https://x.com/compose/post";
const SHARE_MODAL_ID = "recording-share-modal";
const DRAG_PREVIEW_ICON_DATA_URI =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQfYf2sAAAAASUVORK5CYII=";
let shareModalCleanup: (() => void) | null = null;

function hasReplayGameId(recording: Recording): boolean {
    const metadata = recording.metadata;
    if (!metadata) return false;
    if ("Metadata" in metadata) return metadata.Metadata.matchId.gameId > 0;
    if ("Deferred" in metadata) return metadata.Deferred.matchId.gameId > 0;
    return false;
}

function createReplayActionButton(videoId: string, titleText: string): HTMLSpanElement {
    const button = document.createElement("span");
    button.className = "replay-action replay-play";
    button.title = titleText;
    button.textContent = "\u25B6";
    button.addEventListener("click", async (e: MouseEvent) => {
        e.stopPropagation();
        button.classList.add("is-loading");
        try {
            const result = await commands.playRecordingReplay(videoId);
            if (result.status === "error") {
                alert(result.error || (isJapaneseUi() ? "リプレイ再生に失敗しました。" : "Could not play the replay."));
            }
        } finally {
            button.classList.remove("is-loading");
        }
    });
    return button;
}

function createShareIcon(kind: "x" | "discord" | "youtube"): HTMLImageElement {
    const img = document.createElement("img");
    img.className = "recording-share-option-icon";
    img.alt = "";
    img.draggable = false;
    img.src = kind === "x" ? xLogoIcon : kind === "discord" ? discordSymbolIcon : youtubeIcon;
    return img;
}

function createYouTubeUploadBadge(): SVGSVGElement {
    const badge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    badge.setAttribute("class", "sidebar-youtube-badge");
    badge.setAttribute("viewBox", "0 0 20 14");
    badge.setAttribute("aria-label", (isJapaneseUi() ? "YouTubeへアップロード済み" : "Uploaded to YouTube"));
    badge.setAttribute("role", "img");
    badge.title = (isJapaneseUi() ? "YouTubeへアップロード済み" : "Uploaded to YouTube");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // evenodd makes the play triangle a real hole, exposing the sidebar
    // background rather than painting it white.
    shape.setAttribute("fill-rule", "evenodd");
    shape.setAttribute("d", "M3.1 0h13.8C18.6 0 20 1.4 20 3.1v7.8c0 1.7-1.4 3.1-3.1 3.1H3.1C1.4 14 0 12.6 0 10.9V3.1C0 1.4 1.4 0 3.1 0Zm4.8 3.2v7.6L14.1 7 7.9 3.2Z");
    badge.append(shape);
    return badge;
}

function createOwnedYouTubeReplayButton(youtubeVideoId: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "youtube-owned-play";
    button.dataset.youtubeVideoId = youtubeVideoId;
    const title = (isJapaneseUi() ? "共有プレイヤーの「自分の投稿」で再生" : 'Play from "My Uploads" in the shared player');
    button.title = title;
    button.setAttribute("aria-label", title);
    button.textContent = "YT";
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        requestOwnedYouTubeReplay(youtubeVideoId);
    });
    return button;
}

function syncYouTubeUploadControls(item: HTMLElement): void {
    const sourceVideoId = item.dataset.videoId || "";
    const uploaded = sourceVideoId ? findYouTubeUploadForSource(sourceVideoId) : null;
    let container = item.querySelector<HTMLElement>(".sidebar-badges");
    const badge = item.querySelector<HTMLElement>(".sidebar-youtube-badge");
    const playButton = item.querySelector<HTMLButtonElement>(".youtube-owned-play");
    if (!uploaded) {
        badge?.remove();
        playButton?.remove();
        return;
    }
    if (!container) {
        container = document.createElement("div");
        container.className = "sidebar-badges sidebar-upload-badges";
        item.querySelector(".sidebar-actions")?.before(container);
    }
    if (!badge) {
        container.append(createYouTubeUploadBadge());
    } else {
        const title = (isJapaneseUi() ? "YouTubeへアップロード済み" : "Uploaded to YouTube");
        badge.setAttribute("aria-label", title);
        badge.title = title;
    }
    if (!playButton || playButton.dataset.youtubeVideoId !== uploaded.youtubeVideoId) {
        playButton?.remove();
        item.querySelector(".sidebar-actions")?.prepend(createOwnedYouTubeReplayButton(uploaded.youtubeVideoId));
    } else {
        const title = (isJapaneseUi() ? "共有プレイヤーの「自分の投稿」で再生" : 'Play from "My Uploads" in the shared player');
        playButton.title = title;
        playButton.setAttribute("aria-label", title);
    }
}

function refreshYouTubeUploadBadges(): void {
    document.querySelectorAll<HTMLElement>("li[data-video-id]").forEach((item) => {
        syncYouTubeUploadControls(item);
    });
}

window.addEventListener(YOUTUBE_UPLOAD_HISTORY_CHANGED_EVENT, refreshYouTubeUploadBadges);
window.addEventListener(UI_LANGUAGE_CHANGED_EVENT, refreshYouTubeUploadBadges);

function formatUploadProgress(job: YouTubeUploadJob): string {
    if (job.state === "thumbnail_preparing") return (isJapaneseUi() ? "サムネイルを作成・検証しています…" : "Generating and validating the thumbnail…");
    if (job.state === "preparing") return (isJapaneseUi() ? "アップロードを準備しています…" : "Preparing upload…");
    if (job.state === "uploading") {
        const sent = job.sentBytes || 0;
        const total = job.totalBytes || 0;
        const percent = total > 0 ? Math.min(100, Math.floor(sent / total * 100)) : 0;
        const sentMiB = (sent / 1024 / 1024).toFixed(1);
        const totalMiB = (total / 1024 / 1024).toFixed(1);
        return (isJapaneseUi() ? `アップロード中: ${percent}%（${sentMiB} / ${totalMiB} MiB）` : `Uploading: ${percent}% (${sentMiB} / ${totalMiB} MiB)`);
    }
    if (job.state === "thumbnail_uploading") return (isJapaneseUi() ? "動画の送信が完了しました。サムネイルをYouTubeへ設定しています…" : "Video upload completed. Applying the YouTube thumbnail…");
    if (job.state === "processing") {
        const percent = typeof job.processingPercent === "number" ? ` ${job.processingPercent}%` : "";
        return (isJapaneseUi() ? `YouTubeで動画を処理しています${percent}（${job.processingStatus || "保留中"}）…` : `YouTube is processing the video${percent} (${job.processingStatus || "pending"})…`);
    }
    if (job.state === "completed") return (isJapaneseUi() ? "YouTubeへのアップロードが完了しました。" : "YouTube upload completed.");
    if (job.state === "cancelled") return (isJapaneseUi() ? "アップロードをキャンセルしました。" : "Upload cancelled.");
    if (job.state === "failed") return job.error || (isJapaneseUi() ? "アップロードに失敗しました。" : "Upload failed.");
    return "";
}

type SidebarImagePerfStats = {
    resolveMs: number;
    domLoadMs: number;
    resolveCount: number;
    loadCount: number;
    errorCount: number;
};

type SidebarImageRunSummary = {
    runId: number;
    totalItems: number;
    completedItems: number;
    pendingItems: number;
    totalItemMs: number;
    resolveMs: number;
    domLoadMs: number;
    resolveCount: number;
    loadCount: number;
    errorCount: number;
};

type SidebarImageRunState = SidebarImageRunSummary & {
    done: boolean;
    resolveDone: ((summary: SidebarImageRunSummary) => void) | null;
    donePromise: Promise<SidebarImageRunSummary>;
};

let activeSidebarImageRunId = 0;
const sidebarImageRuns = new Map<number, SidebarImageRunState>();
const SIDEBAR_IMAGE_TASK_CONCURRENCY = 16;
let sidebarImageTasksRunning = 0;
const sidebarImageTaskQueue: Array<() => void> = [];
let sidebarImageObserver: IntersectionObserver | null = null;
const sidebarImageLoaders = new WeakMap<HTMLElement, () => void>();
const sidebarImageLoadedItems = new WeakSet<HTMLElement>();

function enqueueSidebarImageTask(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
        const run = () => {
            sidebarImageTasksRunning += 1;
            task()
                .catch(() => {})
                .finally(() => {
                    sidebarImageTasksRunning = Math.max(0, sidebarImageTasksRunning - 1);
                    const next = sidebarImageTaskQueue.shift();
                    if (next) next();
                    resolve();
                });
        };
        if (sidebarImageTasksRunning < SIDEBAR_IMAGE_TASK_CONCURRENCY) run();
        else sidebarImageTaskQueue.push(run);
    });
}

function ensureSidebarImageObserver(): IntersectionObserver | null {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
        return null;
    }
    if (sidebarImageObserver) return sidebarImageObserver;
    sidebarImageObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target as HTMLElement;
            const loader = sidebarImageLoaders.get(el);
            if (!loader) continue;
            sidebarImageObserver?.unobserve(el);
            sidebarImageLoaders.delete(el);
            if (sidebarImageLoadedItems.has(el)) continue;
            sidebarImageLoadedItems.add(el);
            loader();
        }
    }, {
        root: null,
        rootMargin: "500px 0px",
        threshold: 0.01,
    });
    return sidebarImageObserver;
}

function scheduleSidebarItemImageLoad(el: HTMLElement, loader: () => void): void {
    if (sidebarImageLoadedItems.has(el)) return;
    const observer = ensureSidebarImageObserver();
    if (!observer) {
        sidebarImageLoadedItems.add(el);
        setTimeout(loader, 0);
        return;
    }
    sidebarImageLoaders.set(el, loader);
    observer.observe(el);
}

function createSidebarImageRunState(runId: number): SidebarImageRunState {
    let resolveDone: ((summary: SidebarImageRunSummary) => void) | null = null;
    const donePromise = new Promise<SidebarImageRunSummary>((resolve) => {
        resolveDone = resolve;
    });
    return {
        runId,
        totalItems: 0,
        completedItems: 0,
        pendingItems: 0,
        totalItemMs: 0,
        resolveMs: 0,
        domLoadMs: 0,
        resolveCount: 0,
        loadCount: 0,
        errorCount: 0,
        done: false,
        resolveDone,
        donePromise,
    };
}

function getSidebarImageRun(runId: number): SidebarImageRunState | null {
    return sidebarImageRuns.get(runId) || null;
}

function maybeFinishSidebarImageRun(run: SidebarImageRunState): void {
    if (run.done || run.pendingItems !== 0) return;
    run.done = true;
    const summary: SidebarImageRunSummary = {
        runId: run.runId,
        totalItems: run.totalItems,
        completedItems: run.completedItems,
        pendingItems: run.pendingItems,
        totalItemMs: run.totalItemMs,
        resolveMs: run.resolveMs,
        domLoadMs: run.domLoadMs,
        resolveCount: run.resolveCount,
        loadCount: run.loadCount,
        errorCount: run.errorCount,
    };
    run.resolveDone?.(summary);
}

export function beginSidebarImageRun(): number {
    activeSidebarImageRunId += 1;
    sidebarImageRuns.set(activeSidebarImageRunId, createSidebarImageRunState(activeSidebarImageRunId));
    return activeSidebarImageRunId;
}

export function waitForSidebarImageRun(runId: number, timeoutMs?: number): Promise<SidebarImageRunSummary> {
    const run = getSidebarImageRun(runId);
    if (!run) {
        return Promise.resolve({
            runId,
            totalItems: 0,
            completedItems: 0,
            pendingItems: 0,
            totalItemMs: 0,
            resolveMs: 0,
            domLoadMs: 0,
            resolveCount: 0,
            loadCount: 0,
            errorCount: 0,
        });
    }

    if (run.pendingItems === 0 && !run.done) {
        maybeFinishSidebarImageRun(run);
    }

    const settlePromise = timeoutMs && timeoutMs > 0
        ? Promise.race([
            run.donePromise,
            new Promise<SidebarImageRunSummary>((resolve) => {
                setTimeout(() => {
                    resolve({
                        runId: run.runId,
                        totalItems: run.totalItems,
                        completedItems: run.completedItems,
                        pendingItems: run.pendingItems,
                        totalItemMs: run.totalItemMs,
                        resolveMs: run.resolveMs,
                        domLoadMs: run.domLoadMs,
                        resolveCount: run.resolveCount,
                        loadCount: run.loadCount,
                        errorCount: run.errorCount,
                    });
                }, timeoutMs);
            }),
        ])
        : run.donePromise;

    return settlePromise.finally(() => {
        if (run.pendingItems === 0 || run.done) {
            sidebarImageRuns.delete(runId);
        }
    });
}

function getActiveSidebarImageRunId(): number {
    return activeSidebarImageRunId;
}

type SidebarImageBatchStats = SidebarImagePerfStats & {
    itemCount: number;
    totalMs: number;
};

let sidebarImageBatchTimer: ReturnType<typeof setTimeout> | null = null;
const sidebarImageBatchStats: SidebarImageBatchStats = {
    resolveMs: 0,
    domLoadMs: 0,
    resolveCount: 0,
    loadCount: 0,
    errorCount: 0,
    itemCount: 0,
    totalMs: 0,
};

function recordSidebarImageBatch(stats: SidebarImagePerfStats, totalMs: number): void {
    sidebarImageBatchStats.itemCount += 1;
    sidebarImageBatchStats.totalMs += totalMs;
    sidebarImageBatchStats.resolveMs += stats.resolveMs;
    sidebarImageBatchStats.domLoadMs += stats.domLoadMs;
    sidebarImageBatchStats.resolveCount += stats.resolveCount;
    sidebarImageBatchStats.loadCount += stats.loadCount;
    sidebarImageBatchStats.errorCount += stats.errorCount;

    if (sidebarImageBatchTimer) return;
    sidebarImageBatchTimer = setTimeout(() => {
        if (PERF_LOG_ENABLED) {
            console.log(
                `[perf] sidebar_images_batch items=${sidebarImageBatchStats.itemCount} total=${sidebarImageBatchStats.totalMs.toFixed(1)}ms resolve=${sidebarImageBatchStats.resolveMs.toFixed(1)}ms resolve_count=${sidebarImageBatchStats.resolveCount} dom_load=${sidebarImageBatchStats.domLoadMs.toFixed(1)}ms load_count=${sidebarImageBatchStats.loadCount} error_count=${sidebarImageBatchStats.errorCount}`,
            );
        }
        sidebarImageBatchStats.itemCount = 0;
        sidebarImageBatchStats.totalMs = 0;
        sidebarImageBatchStats.resolveMs = 0;
        sidebarImageBatchStats.domLoadMs = 0;
        sidebarImageBatchStats.resolveCount = 0;
        sidebarImageBatchStats.loadCount = 0;
        sidebarImageBatchStats.errorCount = 0;
        sidebarImageBatchTimer = null;
    }, 1200);
}

function perfNowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function getRecordingMp4Path(videoId: string): string {
    return videoId.toLowerCase().endsWith(".mp4") ? videoId : `${videoId}.mp4`;
}

function basename(path: string): string {
    return path.split(/[\\/]/).pop() || "recording.mp4";
}

async function openXComposer(): Promise<void> {
    await open(X_COMPOSE_URL);
}

function closeShareModal(): void {
    shareModalCleanup?.();
    shareModalCleanup = null;
    document.getElementById(SHARE_MODAL_ID)?.remove();
}

async function showShareModal(recording: Recording): Promise<void> {
    closeShareModal();
    const videoId = recording.videoId;
    const isClipUpload = videoId.includes("_clip");
    const settings = await commands.getSettings().catch(() => null);
    const currentLanguage = (settings?.language || "en") as string;
    const tr = (japanese: string, english: string): string => currentLanguage === "ja" ? japanese : english;

    const overlay = document.createElement("div");
    overlay.id = SHARE_MODAL_ID;
    overlay.className = "recording-share-modal-overlay";

    const panel = document.createElement("div");
    panel.className = "recording-share-modal";
    panel.addEventListener("click", (e) => e.stopPropagation());

    const content = document.createElement("div");
    content.className = "recording-share-modal-content";

    const renderSelectView = () => {
        panel.classList.add("recording-share-modal-compact");
        content.replaceChildren();

        const title = document.createElement("div");
        title.className = "recording-share-modal-title";
        title.textContent = getText(currentLanguage as any, "shareChooseDestination" as any) || "Choose Destination";

        const options = document.createElement("div");
        options.className = "recording-share-modal-options";

        const xButton = document.createElement("button");
        xButton.className = "recording-share-option recording-share-option-icon-only";
        xButton.type = "button";
        xButton.title = "X";
        xButton.setAttribute("aria-label", getText(currentLanguage as any, "shareToXAria" as any) || "Share to X");
        xButton.append(createShareIcon("x"));
        xButton.onclick = () => renderXView();

        const discordButton = document.createElement("button");
        discordButton.className = "recording-share-option recording-share-option-icon-only";
        discordButton.type = "button";
        discordButton.title = "Discord";
        discordButton.setAttribute("aria-label", getText(currentLanguage as any, "shareToDiscordAria" as any) || "Share to Discord");
        discordButton.append(createShareIcon("discord"));
        discordButton.onclick = () => renderDiscordView();

        const youtubeButton = document.createElement("button");
        youtubeButton.className = "recording-share-option recording-share-option-icon-only";
        youtubeButton.type = "button";
        youtubeButton.title = "YouTube";
        youtubeButton.setAttribute("aria-label", tr("YouTubeへアップロード", "Upload to YouTube"));
        youtubeButton.append(createShareIcon("youtube"));
        youtubeButton.onclick = () => void renderYouTubeView();

        const uploaded = findYouTubeUploadForSource(videoId);
        const uploadedLink = uploaded
            ? `https://www.youtube.com/watch?v=${uploaded.youtubeVideoId}`
            : null;
        const uploadedLinkRow = document.createElement("div");
        uploadedLinkRow.className = "recording-share-uploaded-id";
        if (uploadedLink) {
            const uploadedLinkLabel = document.createElement("span");
            uploadedLinkLabel.textContent = tr("YouTubeリンク", "YouTube Link");
            const uploadedLinkValue = document.createElement("code");
            uploadedLinkValue.textContent = uploadedLink;
            uploadedLinkValue.title = uploadedLink;
            const copyUploadedLink = document.createElement("button");
            copyUploadedLink.type = "button";
            copyUploadedLink.className = "recording-share-copy-id";
            copyUploadedLink.textContent = tr("リンクをコピー", "Copy Link");
            copyUploadedLink.addEventListener("click", async () => {
                try {
                    await writeText(uploadedLink);
                    copyUploadedLink.textContent = tr("コピーしました", "Copied");
                    window.setTimeout(() => { copyUploadedLink.textContent = tr("リンクをコピー", "Copy Link"); }, 1500);
                } catch {
                    copyUploadedLink.textContent = tr("コピーできませんでした", "Could not copy");
                }
            });
            uploadedLinkRow.append(uploadedLinkLabel, uploadedLinkValue, copyUploadedLink);
        }

        const cancelButton = document.createElement("button");
        cancelButton.className = "recording-share-cancel";
        cancelButton.type = "button";
        cancelButton.textContent = getText(currentLanguage as any, "close" as any) || "Close";
        cancelButton.onclick = () => closeShareModal();

        options.append(xButton, discordButton, youtubeButton);
        content.append(title, options);
        if (uploadedLink) content.append(uploadedLinkRow);
        content.append(cancelButton);
    };

    const renderYouTubeView = async () => {
        panel.classList.remove("recording-share-modal-compact");
        content.replaceChildren();
        const videoPath = getRecordingMp4Path(videoId);
        const defaultTitle = basename(videoPath).replace(/\.(mp4|webm)$/i, "");

        const title = document.createElement("div");
        title.className = "recording-share-modal-title";
        title.textContent = tr("YouTubeへアップロード", "Upload to YouTube");

        const status = document.createElement("div");
        status.className = "recording-share-modal-subtitle";
        status.textContent = tr("接続状態を確認しています…", "Checking connection…");

        const backButton = document.createElement("button");
        backButton.className = "recording-share-option";
        backButton.type = "button";
        backButton.textContent = getText(currentLanguage as any, "back" as any) || "Back";
        backButton.onclick = () => renderSelectView();

        const actions = document.createElement("div");
        actions.className = "recording-share-modal-actions";
        actions.append(backButton);
        content.append(title, status, actions);

        let auth;
        try {
            auth = await getYouTubeAuthStatus();
        } catch (error) {
            status.textContent = String(error);
            return;
        }
        if (!auth.configured) {
            status.textContent = tr("YouTubeの開発用Client IDが設定されていません。", "The YouTube OAuth Client ID is not configured.");
            return;
        }
        if (!auth.connected) {
            status.textContent = tr(
                "Googleアカウントを接続すると、自分のYouTubeチャンネルへのアップロードと試合データの登録ができます。",
                "Connect a Google account to upload to your YouTube channel and publish match data.",
            );
            const connect = document.createElement("button");
            connect.className = "recording-share-option";
            connect.type = "button";
            connect.textContent = tr("Googleアカウントを接続", "Connect Google Account");
            let googleAuthorizationPending = false;
            connect.onclick = async () => {
                if (googleAuthorizationPending) {
                    status.textContent = tr("Google認証画面をもう一度開いています…", "Opening Google authorization again…");
                    try {
                        await reopenYouTubeSignIn();
                        status.textContent = tr(
                            "ブラウザでGoogleアカウントにログインしてください…",
                            "Sign in to your Google account in the browser…",
                        );
                    } catch (error) {
                        status.textContent = error instanceof Error ? error.message : String(error);
                    }
                    return;
                }
                googleAuthorizationPending = true;
                connect.textContent = tr("Google認証画面をもう一度開く", "Open Google Authorization Again");
                status.textContent = tr("ブラウザでGoogleアカウントにログインしてください…", "Sign in to your Google account in the browser…");
                try {
                    const signedIn = await signInToYouTube();
                    if (!signedIn.firebaseIdToken) {
                        throw new Error(tr(
                            "Google本人確認情報を取得できませんでした。",
                            "Could not obtain Google identity information.",
                        ));
                    }
                    await connectReplayShareGoogle(signedIn.firebaseIdToken);
                    window.dispatchEvent(new Event(YOUTUBE_AUTH_CHANGED_EVENT));
                    window.dispatchEvent(new Event(YOUTUBE_AUTH_CONNECTED_EVENT));
                    await renderYouTubeView();
                } catch (error) {
                    status.textContent = error instanceof Error ? error.message : String(error);
                    googleAuthorizationPending = false;
                    connect.textContent = tr("Googleアカウントを接続", "Connect Google Account");
                }
            };
            actions.prepend(connect);
            return;
        }

        let connectedChannelTitle: string | null = null;
        let connectedChannelId: string | null = null;
        try {
            const channel = await getYouTubeChannelCapabilities();
            connectedChannelTitle = channel.channelTitle;
            connectedChannelId = channel.channelId;
        } catch (error) {
            console.warn("Could not identify the connected YouTube channel:", error);
        }
        const connectedChannel = document.createElement("div");
        connectedChannel.className = "recording-share-modal-subtitle";
        connectedChannel.style.padding = "10px 12px";
        connectedChannel.style.border = "1px solid #4b5563";
        connectedChannel.style.borderRadius = "8px";
        if (connectedChannelId) {
            const channelUrl = `https://www.youtube.com/channel/${encodeURIComponent(connectedChannelId)}`;
            const channelLabel = document.createElement("span");
            channelLabel.textContent = tr(
                `アップロード先: ${connectedChannelTitle || connectedChannelId}（チャンネルID: ${connectedChannelId}）`,
                `Upload destination: ${connectedChannelTitle || connectedChannelId} (Channel ID: ${connectedChannelId})`,
            );
            const openChannel = document.createElement("button");
            openChannel.type = "button";
            openChannel.className = "recording-share-link";
            openChannel.style.marginLeft = "8px";
            openChannel.textContent = tr("チャンネルを確認", "View Channel");
            openChannel.onclick = () => void open(channelUrl);
            connectedChannel.append(channelLabel, openChannel);
            status.textContent = tr("接続先チャンネルを確認しました。", "Connected channel confirmed.");
        } else {
            connectedChannel.textContent = tr(
                "接続中のYouTubeチャンネルを確認できませんでした。再接続するか、YouTubeチャンネルが作成済みか確認してください。",
                "The connected YouTube channel could not be identified. Reconnect Google or confirm that the account has a YouTube channel.",
            );
            status.textContent = connectedChannel.textContent;
        }

        let replayAuth: Awaited<ReturnType<typeof getReplayShareAuthStatus>> = {
            authenticated: false,
            google: false,
            anonymous: false,
            uid: null,
            displayName: null,
            email: null,
            photoURL: null,
        };

        const titleInput = document.createElement("input");
        titleInput.className = "recording-share-input";
        let generatedDefaults = { title: defaultTitle.slice(0, 100), description: "" };
        if (recording.metadata && "Metadata" in recording.metadata) {
            generatedDefaults = await buildYouTubeUploadDefaults(recording.metadata.Metadata, getChampionNameById, { isClip: isClipUpload });
        }
        titleInput.value = generatedDefaults.title;
        titleInput.maxLength = 100;
        titleInput.placeholder = tr("タイトル（1〜100文字）", "Title (1–100 characters)");
        const description = document.createElement("textarea");
        description.className = "recording-share-input recording-share-textarea";
        description.maxLength = 5000;
        description.placeholder = tr("説明（任意、5,000文字まで）", "Description (optional, up to 5,000 characters)");
        description.value = generatedDefaults.description;
        const privacyStatus = document.createElement("select");
        privacyStatus.className = "recording-share-input";
        privacyStatus.innerHTML = currentLanguage === "ja"
            ? "<option value='private'>非公開</option><option value='unlisted'>限定公開</option><option value='public'>公開</option>"
            : "<option value='private'>Private</option><option value='unlisted'>Unlisted</option><option value='public'>Public</option>";
        privacyStatus.value = "public";
        const registerReplayShareLabel = document.createElement("label");
        registerReplayShareLabel.className = "recording-share-guidelines";
        const registerReplayShare = document.createElement("input");
        registerReplayShare.type = "checkbox";
        registerReplayShare.checked = true;
        registerReplayShare.className = "recording-share-guidelines-check";
        const registerReplayShareText = document.createElement("span");
        registerReplayShareText.textContent = tr(
            "試合データをDBへ登録して、YouTube URLから再生できるようにする",
            "Publish match data so the replay can be opened from its YouTube URL",
        );
        registerReplayShareLabel.append(registerReplayShare, registerReplayShareText);
        const anonymousShareLabel = document.createElement("label");
        anonymousShareLabel.className = "recording-share-guidelines";
        const anonymousShare = document.createElement("input");
        anonymousShare.type = "checkbox";
        anonymousShare.className = "recording-share-guidelines-check";
        const anonymousShareText = document.createElement("span");
        anonymousShareText.textContent = tr(
            "試合データを匿名化して共有する（名前・Riotタグ・ランク・サモナーレベル・内部IDを除外）",
            "Anonymize shared match data (remove names, Riot tags, ranks, summoner levels, and internal IDs)",
        );
        anonymousShareLabel.append(anonymousShare, anonymousShareText);
        const updateReplayShareOptions = () => {
            const enabled = registerReplayShare.checked;
            anonymousShare.disabled = !enabled;
            anonymousShareLabel.style.opacity = enabled ? "" : "0.55";
        };
        registerReplayShare.addEventListener("change", updateReplayShareOptions);
        updateReplayShareOptions();
        const policyLabel = document.createElement("label");
        policyLabel.className = "recording-share-guidelines";
        const policyAccepted = document.createElement("input");
        policyAccepted.type = "checkbox";
        policyAccepted.className = "recording-share-guidelines-check";
        const privacyPolicyButton = document.createElement("button");
        privacyPolicyButton.type = "button";
        privacyPolicyButton.className = "recording-share-link";
        privacyPolicyButton.textContent = tr("プライバシーポリシー", "Privacy Policy");
        privacyPolicyButton.onclick = () => void open(currentLanguage === "ja"
            ? "https://leaguerecord.web.app/ja/privacy.html"
            : "https://leaguerecord.web.app/privacy.html");
        const termsButton = document.createElement("button");
        termsButton.type = "button";
        termsButton.className = "recording-share-link";
        termsButton.textContent = tr("利用規約", "Terms of Service");
        termsButton.onclick = () => void open(currentLanguage === "ja"
            ? "https://leaguerecord.web.app/ja/terms.html"
            : "https://leaguerecord.web.app/terms.html");
        const policyText = document.createElement("span");
        if (currentLanguage === "ja") {
            policyText.append("YouTubeアップロードに関する ", privacyPolicyButton, " と ", termsButton, " に同意します。");
        } else {
            policyText.append("I agree to the ", privacyPolicyButton, " and ", termsButton, " for YouTube uploads.");
        }
        policyLabel.append(policyAccepted, policyText);
        const guidelinesLabel = document.createElement("label");
        guidelinesLabel.className = "recording-share-guidelines";
        const guidelinesConfirmed = document.createElement("input");
        guidelinesConfirmed.type = "checkbox";
        guidelinesConfirmed.className = "recording-share-guidelines-check";
        const guidelinesText = document.createElement("span");
        guidelinesText.textContent = tr(
            "投稿する動画がYouTubeコミュニティガイドラインに準拠していることを確認しました。",
            "I confirm that this video complies with the YouTube Community Guidelines.",
        );
        guidelinesLabel.append(guidelinesConfirmed, guidelinesText);
        const note = document.createElement("div");
        note.className = "recording-share-modal-subtitle";
        note.textContent = tr(
            "元の録画またはクリップを再エンコードせず、その解像度のままYouTubeへ送信します。試合データのDB登録は任意です。YouTube側のHD処理には時間がかかる場合があります。",
            "The original recording or clip is uploaded at its current resolution without re-encoding. Publishing match data is optional. YouTube HD processing may take some time.",
        );
        const thumbnailEligibilityHelp = document.createElement("div");
        thumbnailEligibilityHelp.className = "recording-youtube-requirements";
        thumbnailEligibilityHelp.hidden = true;
        const thumbnailEligibilityText = document.createElement("span");
        thumbnailEligibilityText.textContent = tr(
            "YouTube Studio → 設定 → チャンネル → 機能の利用資格で、カスタムサムネイルの要件を満たしてください。",
            "In YouTube Studio, open Settings → Channel → Feature eligibility and complete the requirements for custom thumbnails.",
        );
        const openYouTubeStudio = document.createElement("button");
        openYouTubeStudio.type = "button";
        openYouTubeStudio.className = "recording-share-link recording-youtube-studio-link";
        openYouTubeStudio.textContent = tr("YouTube Studioを開く", "Open YouTube Studio");
        openYouTubeStudio.onclick = () => void open("https://studio.youtube.com/");
        thumbnailEligibilityHelp.append(thumbnailEligibilityText, openYouTubeStudio);
        const updateThumbnailEligibilityHelp = (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error ?? "");
            thumbnailEligibilityHelp.hidden = !(
                /カスタムサムネイル/u.test(message)
                || /custom\s+thumbnail/iu.test(message)
                || /thumbnail[^.]*enabled/iu.test(message)
            );
        };
        const existingVideoUrl = document.createElement("input");
        existingVideoUrl.className = "recording-share-input";
        existingVideoUrl.placeholder = tr("登録済みYouTube動画のURL（試合データのみ更新）", "Existing YouTube video URL (update match data only)");
        const republishMetadata = document.createElement("button");
        republishMetadata.className = "recording-share-option";
        republishMetadata.type = "button";
        republishMetadata.textContent = tr("既存動画へ試合データを登録", "Publish Match Data for Existing Video");
        republishMetadata.onclick = async () => {
            let youtubeVideoId: string;
            try {
                youtubeVideoId = parseYouTubeVideoId(existingVideoUrl.value);
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
                return;
            }
            if (!await ensureReplayShareAuth()) return;
            if (!window.confirm(tr(
                "YouTube動画は変更せず、この録画の試合データだけをFirestoreへ登録・更新します。続行しますか？",
                "This will publish or update only this recording's match data in Firestore without changing the YouTube video. Continue?",
            ))) return;
            republishMetadata.disabled = true;
            status.textContent = tr("試合データを登録しています…", "Publishing match data…");
            try {
                const share = await prepareReplayShare(recording.metadata, youtubeVideoId, {
                    anonymizePlayers: anonymousShare.checked,
                });
                await publishReplayShare(share);
                rememberYouTubeUpload(videoId, youtubeVideoId);
                status.textContent = tr("既存YouTube動画の試合データを更新しました。", "Updated match data for the existing YouTube video.");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                status.textContent = message.includes("Firestoreへの登録が拒否")
                    ? tr(
                        "この共有データは別のFirebase認証で登録されています。Firebase Consoleで該当する replays 文書を削除してから、もう一度登録してください。",
                        "This shared replay belongs to another Firebase identity. Delete the corresponding replays document in Firebase Console, then try again.",
                    )
                    : message;
            } finally {
                republishMetadata.disabled = false;
            }
        };
        const upload = document.createElement("button");
        upload.className = "recording-share-option recording-share-upload";
        upload.type = "button";
        upload.textContent = tr("アップロードを開始", "Start Upload");
        const cancel = document.createElement("button");
        cancel.className = "recording-share-cancel";
        cancel.type = "button";
        cancel.textContent = tr("キャンセル", "Cancel");
        cancel.style.display = "none";
        const openVideo = document.createElement("button");
        openVideo.className = "recording-share-option";
        openVideo.type = "button";
        openVideo.textContent = tr("YouTubeで開く", "Open in YouTube");
        openVideo.style.display = "none";
        const retryThumbnail = document.createElement("button");
        retryThumbnail.className = "recording-share-option";
        retryThumbnail.type = "button";
        retryThumbnail.textContent = tr("サムネイル設定を再試行", "Retry Thumbnail");
        retryThumbnail.style.display = "none";
        const previewThumbnail = document.createElement("button");
        previewThumbnail.className = "recording-share-option";
        previewThumbnail.type = "button";
        previewThumbnail.textContent = tr("サムネイルをプレビュー", "Preview Thumbnail");
        let customThumbnailPath: string | null = null;
        let skipThumbnail = false;
        const thumbnailPicker = document.createElement("div");
        thumbnailPicker.style.display = "flex";
        thumbnailPicker.style.gap = "8px";
        thumbnailPicker.style.alignItems = "center";
        thumbnailPicker.style.flexWrap = "wrap";
        const thumbnailPathDisplay = document.createElement("input");
        thumbnailPathDisplay.className = "recording-thumbnail-path";
        thumbnailPathDisplay.readOnly = true;
        thumbnailPathDisplay.placeholder = tr("自動生成サムネイルを使用", "Use automatically generated thumbnail");
        thumbnailPathDisplay.style.flex = "1";
        thumbnailPathDisplay.style.background = "#4b5563";
        thumbnailPathDisplay.style.color = "#ffffff";
        thumbnailPathDisplay.style.border = "1px solid #6b7280";
        const browseThumbnail = document.createElement("button");
        browseThumbnail.type = "button";
        browseThumbnail.className = "recording-share-option";
        browseThumbnail.textContent = tr("参照…", "Browse…");
        browseThumbnail.onclick = async () => {
            const selected = await chooseYouTubeThumbnail();
            if (!selected) return;
            skipThumbnail = false;
            customThumbnailPath = selected;
            thumbnailPathDisplay.value = selected;
            previewThumbnail.disabled = false;
            thumbnailPreviewImage.hidden = true;
            previewThumbnail.textContent = tr("サムネイルをプレビュー", "Preview Thumbnail");
        };
        const clearThumbnail = document.createElement("button");
        clearThumbnail.type = "button";
        clearThumbnail.className = "recording-share-option";
        clearThumbnail.textContent = tr("自動生成に戻す", "Use Automatic Thumbnail");
        clearThumbnail.onclick = () => {
            skipThumbnail = false;
            customThumbnailPath = null;
            thumbnailPathDisplay.value = "";
            thumbnailPathDisplay.placeholder = tr("自動生成サムネイルを使用", "Use automatically generated thumbnail");
            previewThumbnail.disabled = false;
            thumbnailPreviewImage.hidden = true;
            previewThumbnail.textContent = tr("サムネイルをプレビュー", "Preview Thumbnail");
        };
        const noThumbnail = document.createElement("button");
        noThumbnail.type = "button";
        noThumbnail.className = "recording-share-option recording-thumbnail-none";
        noThumbnail.textContent = tr("サムネイルなし", "No Thumbnail");
        noThumbnail.onclick = () => {
            skipThumbnail = true;
            customThumbnailPath = null;
            thumbnailPathDisplay.value = tr("サムネイルを設定しません", "No thumbnail will be applied");
            previewThumbnail.disabled = true;
            thumbnailPreviewImage.hidden = true;
            status.textContent = tr(
                "サムネイルなしでYouTubeへアップロードします。",
                "The video will be uploaded without applying a thumbnail.",
            );
        };
        thumbnailPicker.append(thumbnailPathDisplay, browseThumbnail, clearThumbnail, noThumbnail);
        const thumbnailPreviewImage = document.createElement("img");
        thumbnailPreviewImage.alt = tr("YouTubeサムネイルのプレビュー", "YouTube thumbnail preview");
        thumbnailPreviewImage.hidden = true;
        thumbnailPreviewImage.style.width = "100%";
        thumbnailPreviewImage.style.aspectRatio = "16 / 9";
        thumbnailPreviewImage.style.objectFit = "contain";
        thumbnailPreviewImage.style.borderRadius = "10px";
        thumbnailPreviewImage.style.background = "#0b0e14";
        previewThumbnail.onclick = async () => {
            previewThumbnail.disabled = true;
            status.textContent = tr("サムネイルのプレビューを作成しています…", "Generating thumbnail preview…");
            try {
                const preview = await previewYouTubeThumbnail(recording.metadata, {
                    isClip: isClipUpload,
                    customThumbnailPath,
                });
                thumbnailPreviewImage.src = preview.dataUrl;
                thumbnailPreviewImage.hidden = false;
                status.textContent = tr(
                    `サムネイルのプレビューを作成しました（${Math.ceil(preview.bytes / 1024)}KB）。`,
                    `Thumbnail preview generated (${Math.ceil(preview.bytes / 1024)} KB).`,
                );
                previewThumbnail.textContent = tr("プレビューを更新", "Refresh Preview");
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
            } finally {
                previewThumbnail.disabled = false;
            }
        };
        const uploadedVideoId = document.createElement("div");
        uploadedVideoId.className = "recording-share-uploaded-id";
        uploadedVideoId.hidden = true;
        const uploadedVideoIdLabel = document.createElement("span");
        uploadedVideoIdLabel.textContent = tr("YouTube動画ID", "YouTube Video ID");
        const uploadedVideoIdValue = document.createElement("code");
        const copyVideoId = document.createElement("button");
        copyVideoId.type = "button";
        copyVideoId.className = "recording-share-copy-id";
        copyVideoId.textContent = tr("IDをコピー", "Copy ID");
        copyVideoId.addEventListener("click", async () => {
            const id = uploadedVideoIdValue.textContent || "";
            if (!id) return;
            try {
                await writeText(id);
                copyVideoId.textContent = tr("コピーしました", "Copied");
                window.setTimeout(() => { copyVideoId.textContent = tr("IDをコピー", "Copy ID"); }, 1500);
            } catch {
                status.textContent = tr("動画IDをコピーできませんでした。", "Could not copy the video ID.");
            }
        });
        uploadedVideoId.append(uploadedVideoIdLabel, uploadedVideoIdValue, copyVideoId);
        const disconnect = document.createElement("button");
        disconnect.className = "recording-share-option";
        disconnect.type = "button";
        disconnect.textContent = tr("Google接続を解除", "Disconnect Google");
        disconnect.onclick = async () => {
            disconnect.disabled = true;
            status.textContent = tr("Google接続を解除しています…", "Disconnecting Google…");
            try {
                await signOutReplayShareAuth();
                await signOutFromYouTube();
                window.dispatchEvent(new Event(YOUTUBE_AUTH_CHANGED_EVENT));
                await renderYouTubeView();
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
                disconnect.disabled = false;
            }
        };
        let poller: ReturnType<typeof setInterval> | null = null;
        let uploadHasStarted = false;
        let shouldPublishMetadata = false;
        let replayShareState: "idle" | "publishing" | "published" | "not_requested" | "unavailable" | "failed" = "idle";
        let thumbnailState: "idle" | "setting" | "set" | "failed" = "idle";
        let completedJob: YouTubeUploadJob | null = null;
        const normalizedSourceName = (value: string) => value.replace(/\\/g, "/").split("/").pop()?.replace(/\.(mp4|webm)$/i, "") ?? "";
        const jobBelongsToRecording = (job: YouTubeUploadJob) => (
            job.sourceVideoId === videoId
            || (Boolean(job.fileName) && normalizedSourceName(job.fileName!) === normalizedSourceName(videoId))
        );
        const stopPolling = () => { if (poller) clearInterval(poller); poller = null; };
        const ensureReplayShareAuth = async (): Promise<boolean> => {
            status.textContent = tr(
                "試合データを登録するため、FirebaseへGoogleアカウントを接続しています…",
                "Connecting your Google account to Firebase to publish match data…",
            );
            try {
                // Firebase can retain a different Google account after the
                // desktop YouTube session changes. Always synchronize with
                // the current YouTube credential before storing ownerUid.
                await connectReplayShareGoogle(await getYouTubeFirebaseIdToken());
                replayAuth = await getReplayShareAuthStatus();
                if (!replayAuth.google) {
                    throw new Error(tr(
                        "FirebaseのGoogle認証を確認できませんでした。",
                        "Could not verify Google authentication in Firebase.",
                    ));
                }
                return true;
            } catch (error) {
                status.textContent = tr("試合データを登録できません。", "Could not publish match data. ")
                    + (error instanceof Error ? error.message : String(error));
                return false;
            }
        };
        const setThumbnailForJob = async (job: YouTubeUploadJob): Promise<boolean> => {
            if (!job.youtubeVideoId || thumbnailState === "setting") return false;
            thumbnailState = "setting";
            retryThumbnail.style.display = "none";
            updateThumbnailEligibilityHelp(null);
            try {
                status.textContent = tr("サムネイルを生成して設定しています…", "Generating and applying the thumbnail…");
                await setYouTubeThumbnail(job.youtubeVideoId, recording.metadata, { isClip: isClipUpload, customThumbnailPath });
                thumbnailState = "set";
                return true;
            } catch (error) {
                thumbnailState = "failed";
                retryThumbnail.style.display = "";
                console.warn("Failed to set YouTube thumbnail:", error);
                updateThumbnailEligibilityHelp(error);
                status.textContent = tr(
                    "動画のアップロードは完了しましたが、サムネイルを設定できませんでした。",
                    "The video was uploaded, but the thumbnail could not be applied. ",
                ) + (error instanceof Error ? error.message : String(error));
                return false;
            }
        };
        const publishMetadata = async (job: YouTubeUploadJob) => {
            if (replayShareState === "publishing" || replayShareState === "published") return;
            completedJob = job;
            replayShareState = "publishing";
            status.textContent = tr(
                "YouTubeへのアップロードが完了しました。試合データを登録しています…",
                "YouTube upload completed. Publishing match data…",
            );
            try {
                const share = await prepareReplayShare(recording.metadata, job.youtubeVideoId, {
                    anonymizePlayers: anonymousShare.checked,
                });
                await publishReplayShare(share);
                replayShareState = "published";
                status.textContent = tr(
                    "YouTubeへのアップロードと試合データの登録が完了しました。",
                    "YouTube upload and match-data publishing completed.",
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("共有できる試合データがありません")) {
                    replayShareState = "unavailable";
                    status.textContent = tr(
                        "YouTubeへのアップロードは完了しました。この動画には共有できる試合データがありません。",
                        "YouTube upload completed, but this video has no match data that can be shared.",
                    );
                    return;
                }
                replayShareState = "failed";
                status.textContent = tr(
                    "YouTubeへのアップロードは完了しましたが、試合データを登録できませんでした。",
                    "YouTube upload completed, but match data could not be published. ",
                ) + message;
                upload.textContent = tr("試合データの登録を再試行", "Retry Match Data");
                upload.disabled = false;
            }
        };
        const finishCompletedUpload = async (job: YouTubeUploadJob) => {
            completedJob = job;
            const thumbnailFailed = job.thumbnailStatus === "failed";
            const thumbnailSkipped = job.thumbnailStatus === "skipped";
            if (thumbnailFailed) {
                thumbnailState = "failed";
                retryThumbnail.style.display = "";
                updateThumbnailEligibilityHelp(job.thumbnailError);
            }
            if (shouldPublishMetadata) {
                await publishMetadata(job);
                if (replayShareState === "published") {
                    status.textContent = thumbnailFailed
                        ? tr(
                            "動画のアップロードと試合データ登録は完了しました。サムネイルは設定できませんでした。",
                            "The video upload and match-data publishing completed, but the thumbnail could not be applied.",
                        )
                        : thumbnailSkipped
                        ? tr(
                            "YouTubeへのアップロードと試合データ登録が完了しました。サムネイルは設定していません。",
                            "YouTube upload and match-data publishing completed without a thumbnail.",
                        )
                        : tr(
                            "YouTubeへのアップロード、サムネイル設定、試合データ登録が完了しました。",
                            "YouTube upload, thumbnail setup, and match-data publishing completed.",
                        );
                }
                return;
            }
            replayShareState = "not_requested";
            status.textContent = thumbnailFailed
                ? tr(
                    "動画のアップロードは完了しましたが、サムネイルは設定できませんでした。試合データは登録していません。",
                    "The video upload completed, but the thumbnail could not be applied. Match data was not published.",
                )
                : thumbnailSkipped && job.processingStatus === "pending"
                ? tr(
                    "サムネイルなしで動画をアップロードしました。YouTube側では動画処理が引き続き保留中です。",
                    "The video was uploaded without a thumbnail. YouTube is still processing the video.",
                )
                : thumbnailSkipped
                ? tr(
                    "サムネイルなしでYouTubeへのアップロードが完了しました。試合データは登録していません。",
                    "YouTube upload completed without a thumbnail. Match data was not published.",
                )
                : job.processingStatus === "pending"
                ? tr(
                    "動画とサムネイルのアップロードが完了しました。YouTube側では動画処理が引き続き保留中です。",
                    "Video and thumbnail upload completed. YouTube is still processing the video.",
                )
                : tr(
                    "YouTubeへのアップロードとサムネイル設定が完了しました。試合データは登録していません。",
                    "YouTube upload and thumbnail setup completed. Match data was not published.",
                );
        };
        retryThumbnail.onclick = async () => {
            if (!completedJob) return;
            retryThumbnail.disabled = true;
            thumbnailState = "idle";
            const succeeded = await setThumbnailForJob(completedJob);
            retryThumbnail.disabled = false;
            if (succeeded) {
                retryThumbnail.style.display = "none";
                status.textContent = tr("サムネイルを設定しました。", "Thumbnail applied.");
            }
        };
        const showJob = (job: YouTubeUploadJob) => {
            // The first status poll can race the IPC command and still be
            // idle. Keep the optimistic "preparing" state in that case.
            if (job.state === "idle" && uploadHasStarted) return;
            if (job.state !== "completed" || replayShareState === "idle") {
                status.textContent = formatUploadProgress(job);
            }
            updateThumbnailEligibilityHelp(job.thumbnailError || (job.state === "failed" ? job.error : null));
            const inFlight = ["thumbnail_preparing", "preparing", "uploading", "thumbnail_uploading", "processing"].includes(job.state);
            if (inFlight) uploadHasStarted = true;
            upload.disabled = inFlight;
            cancel.style.display = inFlight ? "" : "none";
            if (job.youtubeVideoId && job.youtubeUrl && jobBelongsToRecording(job)) {
                openVideo.style.display = "";
                openVideo.onclick = () => void open(job.youtubeUrl!);
                uploadedVideoIdValue.textContent = job.youtubeVideoId;
                uploadedVideoId.hidden = false;
                rememberYouTubeUpload(videoId, job.youtubeVideoId);
                completedJob = job;
                if (job.thumbnailStatus === "failed" || (job.state === "failed" && job.thumbnailStatus !== "skipped")) {
                    retryThumbnail.style.display = "";
                }
            }
            if (job.state === "completed" && job.youtubeUrl) {
                openVideo.style.display = "";
                openVideo.onclick = () => void open(job.youtubeUrl!);
                if (job.youtubeVideoId) {
                    uploadedVideoIdValue.textContent = job.youtubeVideoId;
                    uploadedVideoId.hidden = false;
                }
                if (job.youtubeVideoId && jobBelongsToRecording(job)) {
                    rememberYouTubeUpload(videoId, job.youtubeVideoId);
                }
                if (uploadHasStarted && job.youtubeVideoId && jobBelongsToRecording(job) && replayShareState === "idle") {
                    void finishCompletedUpload(job);
                } else if (!uploadHasStarted && replayShareState === "idle" && job.youtubeVideoId && jobBelongsToRecording(job)) {
                    completedJob = job;
                    replayShareState = "failed";
                    status.textContent = tr(
                        "YouTubeへのアップロードは完了しています。試合データの登録を再試行できます。",
                        "The YouTube upload is complete. You can retry publishing match data.",
                    );
                    upload.textContent = tr("試合データの登録を再試行", "Retry Match Data");
                    upload.disabled = false;
                }
            }
            if (uploadHasStarted && !inFlight) stopPolling();
        };
        upload.onclick = async () => {
            if (replayShareState === "failed" && completedJob) {
                upload.disabled = true;
                upload.textContent = tr("試合データを登録しています…", "Publishing Match Data…");
                await publishMetadata(completedJob);
                if (replayShareState !== "failed") upload.style.display = "none";
                return;
            }
            if (!(["private", "unlisted", "public"] as const).includes(privacyStatus.value as "private" | "unlisted" | "public")) {
                status.textContent = tr("公開設定を選択してください。", "Select a visibility setting.");
                return;
            }
            if (!policyAccepted.checked) {
                status.textContent = tr(
                    "プライバシーポリシーと利用規約への同意を確認してください。",
                    "Confirm your agreement to the Privacy Policy and Terms of Service.",
                );
                return;
            }
            if (!guidelinesConfirmed.checked) {
                status.textContent = tr(
                    "YouTubeコミュニティガイドライン遵守を確認してください。",
                    "Confirm compliance with the YouTube Community Guidelines.",
                );
                return;
            }
            if (registerReplayShare.checked && !await ensureReplayShareAuth()) return;
            const privacyLabel = privacyStatus.selectedOptions[0]?.textContent || privacyStatus.value;
            const channelLabel = connectedChannelTitle || connectedChannelId || tr("接続中のYouTubeチャンネル", "the connected YouTube channel");
            if (!window.confirm(tr(
                `${channelLabel} へアップロードします。\n\nタイトル: ${titleInput.value || defaultTitle}\n公開設定: ${privacyLabel}\n\n「OK」を選ぶとアップロードを開始します。`,
                `Upload to ${channelLabel}.\n\nTitle: ${titleInput.value || defaultTitle}\nVisibility: ${privacyLabel}\n\nSelect OK to start uploading.`,
            ))) return;
            upload.disabled = true;
            uploadHasStarted = true;
            shouldPublishMetadata = registerReplayShare.checked;
            showJob({ state: "thumbnail_preparing" });
            try {
                void startYouTubeUpload(videoId, {
                    title: titleInput.value,
                    description: description.value,
                    madeForKids: false,
                    privacyStatus: privacyStatus.value as "private" | "unlisted" | "public",
                    policyAccepted: policyAccepted.checked,
                    communityGuidelinesConfirmed: guidelinesConfirmed.checked,
                }, {
                    metadata: recording.metadata,
                    isClip: isClipUpload,
                    customThumbnailPath,
                    skip: skipThumbnail,
                })
                    .then(showJob)
                    .catch((error) => {
                        showJob({ state: "failed", error: error instanceof Error ? error.message : String(error) });
                        upload.disabled = false;
                    });
                poller = setInterval(() => { void getYouTubeUploadJob().then(showJob).catch(() => {}); }, 400);
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
                upload.disabled = false;
            }
        };
        cancel.onclick = () => { void cancelYouTubeUpload().then(showJob); };
        actions.prepend(upload, cancel, previewThumbnail, retryThumbnail, openVideo, disconnect);
        content.append(title, status, connectedChannel, thumbnailEligibilityHelp, thumbnailPicker, thumbnailPreviewImage, titleInput, description, privacyStatus, registerReplayShareLabel, anonymousShareLabel, policyLabel, guidelinesLabel, note, existingVideoUrl, republishMetadata, uploadedVideoId, actions);
        const existing = await getYouTubeUploadJob();
        showJob(existing);
    };

    const renderXView = () => {
        panel.classList.add("recording-share-modal-compact");
        content.replaceChildren();
        const videoPath = getRecordingMp4Path(videoId);
        const fileName = basename(videoPath);

        const title = document.createElement("div");
        title.className = "recording-share-modal-title";
        title.textContent = getText(currentLanguage as any, "shareToXTitle" as any) || "Share to X";

        const subtitle = document.createElement("div");
        subtitle.className = "recording-share-modal-subtitle";
        subtitle.textContent = getText(currentLanguage as any, "shareToXSubtitle" as any) || "Drag the file below into X";

        const chip = document.createElement("div");
        chip.className = "discord-share-drag-chip recording-share-modal-drag-chip";
        chip.title = videoPath;
        chip.textContent = fileName;
        chip.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void startDrag({
                item: [videoPath],
                icon: DRAG_PREVIEW_ICON_DATA_URI,
                mode: "copy",
            }).catch((err) => {
                console.error("Failed to start native drag for X share:", err);
            });
        });

        const actions = document.createElement("div");
        actions.className = "recording-share-modal-actions recording-share-modal-actions-3";

        const openButton = document.createElement("button");
        openButton.className = "recording-share-option";
        openButton.type = "button";
        openButton.textContent = getText(currentLanguage as any, "shareOpenX" as any) || "Open X";
        openButton.onclick = () => {
            void openXComposer().catch((err) => {
                console.error("Failed to open X composer:", err);
            });
        };

        const backButton = document.createElement("button");
        backButton.className = "recording-share-option";
        backButton.type = "button";
        backButton.textContent = getText(currentLanguage as any, "back" as any) || "Back";
        backButton.onclick = () => renderSelectView();

        const closeButton = document.createElement("button");
        closeButton.className = "recording-share-cancel";
        closeButton.type = "button";
        closeButton.textContent = getText(currentLanguage as any, "close" as any) || "Close";
        closeButton.onclick = () => closeShareModal();

        actions.append(openButton, backButton, closeButton);
        content.append(title, subtitle, chip, actions);
    };

    const renderDiscordView = () => {
        panel.classList.add("recording-share-modal-compact");
        content.replaceChildren();
        const videoPath = getRecordingMp4Path(videoId);
        const fileName = basename(videoPath);

        const title = document.createElement("div");
        title.className = "recording-share-modal-title";
        title.textContent = getText(currentLanguage as any, "shareToDiscordTitle" as any) || "Share to Discord";

        const subtitle = document.createElement("div");
        subtitle.className = "recording-share-modal-subtitle";
        subtitle.textContent = getText(currentLanguage as any, "shareToDiscordSubtitle" as any) || "Drag the file below into Discord";

        const chip = document.createElement("div");
        chip.className = "discord-share-drag-chip recording-share-modal-drag-chip";
        chip.title = videoPath;
        chip.textContent = fileName;
        chip.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void startDrag({
                item: [videoPath],
                icon: DRAG_PREVIEW_ICON_DATA_URI,
                mode: "copy",
            }).catch((err) => {
                console.error("Failed to start native drag for Discord share:", err);
            });
        });

        const actions = document.createElement("div");
        actions.className = "recording-share-modal-actions";

        const backButton = document.createElement("button");
        backButton.className = "recording-share-option";
        backButton.type = "button";
        backButton.textContent = getText(currentLanguage as any, "back" as any) || "Back";
        backButton.onclick = () => renderSelectView();

        const closeButton = document.createElement("button");
        closeButton.className = "recording-share-cancel";
        closeButton.type = "button";
        closeButton.textContent = getText(currentLanguage as any, "close" as any) || "Close";
        closeButton.onclick = () => closeShareModal();

        actions.append(backButton, closeButton);
        content.append(title, subtitle, chip, actions);
    };

    renderSelectView();
    panel.append(content);
    overlay.append(panel);
    overlay.addEventListener("click", () => closeShareModal());

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeShareModal();
    };
    document.addEventListener("keydown", onKeyDown, true);
    shareModalCleanup = () => document.removeEventListener("keydown", onKeyDown, true);

    document.body.append(overlay);
}

function createSidebarImagePerfStats(): SidebarImagePerfStats {
    return {
        resolveMs: 0,
        domLoadMs: 0,
        resolveCount: 0,
        loadCount: 0,
        errorCount: 0,
    };
}

function waitForImageLoad(img: HTMLImageElement, timeoutMs: number = 4000): Promise<"load" | "error" | "timeout"> {
    if (img.complete) {
        return Promise.resolve(img.naturalWidth > 0 ? "load" : "error");
    }

    return new Promise((resolve) => {
        let done = false;
        const finish = (state: "load" | "error" | "timeout") => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            img.removeEventListener("load", onLoad);
            img.removeEventListener("error", onError);
            resolve(state);
        };
        const onLoad = () => finish("load");
        const onError = () => finish("error");
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
        img.addEventListener("load", onLoad, { once: true });
        img.addEventListener("error", onError, { once: true });
    });
}

async function resolveAndApplyImage(params: {
    stats: SidebarImagePerfStats;
    label: string;
    resolver: () => Promise<string>;
    apply: (url: string) => HTMLImageElement | null;
}): Promise<void> {
    const { stats, label, resolver, apply } = params;
    const resolveStarted = perfNowMs();
    let url = "";

    try {
        url = await resolver();
    } catch (e) {
        stats.errorCount += 1;
        if (PERF_LOG_ENABLED) console.warn(`[perf] sidebar_image_resolve_error label=${label}`, e);
        return;
    } finally {
        stats.resolveMs += perfNowMs() - resolveStarted;
        stats.resolveCount += 1;
    }

    if (!url) {
        stats.errorCount += 1;
        return;
    }

    const img = apply(url);
    if (!img) return;

    const domStarted = perfNowMs();
    const status = await waitForImageLoad(img);
    stats.domLoadMs += perfNowMs() - domStarted;
    if (status === "load") stats.loadCount += 1;
    else stats.errorCount += 1;
}

async function resolveAndApplyMask(params: {
    stats: SidebarImagePerfStats;
    label: string;
    resolver: () => Promise<string>;
    apply: (url: string) => void | Promise<void>;
}): Promise<void> {
    const { stats, label, resolver, apply } = params;
    const resolveStarted = perfNowMs();
    let url = "";
    try {
        url = await resolver();
    } catch (e) {
        stats.errorCount += 1;
        if (PERF_LOG_ENABLED) console.warn(`[perf] sidebar_image_resolve_error label=${label}`, e);
        return;
    } finally {
        stats.resolveMs += perfNowMs() - resolveStarted;
        stats.resolveCount += 1;
    }
    if (!url) {
        stats.errorCount += 1;
    }
    await apply(url);
}

export function createRecordingSidebarItem(input: {
    recording: Recording;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    currentLanguage: string;
    onVideo: (videoId: string) => void;
    onFavorite: (videoId: string) => Promise<boolean | null>;
    onRename: (videoId: string) => void;
    onDelete: (videoId: string, isFavorite: boolean) => void;
    onDeleteVideoOnly?: (videoId: string, isFavorite: boolean) => void;
    filterStar: boolean;
    onRefreshForStarUnfavorite?: () => void;
}): HTMLElement {
    const {
        recording,
        createEl,
        currentLanguage,
        onVideo,
        onFavorite,
        onRename,
        onDelete,
        onDeleteVideoOnly,
        filterStar,
        onRefreshForStarUnfavorite,
    } = input;
    const tooltipLocale = (currentLanguage || "en") === "ja" ? "ja" : "en";
    const tooltipText = (ja: string, en: string): string => (tooltipLocale === "ja" ? ja : en);

    const videoName = toVideoName(recording.videoId);
    const isClipRecording = recording.videoId.includes("_clip");
    const favorite = isFavorite(recording.metadata);
    let displayContent: HTMLElement[] = [createEl("span", {}, { class: "video-name" }, videoName) as HTMLElement];
    let liClass = "recording-item";
    if (isClipRecording) liClass += " recording-clip";
    if (!recording.videoExists) liClass += " video-deleted";

    const mainContent = document.createElement("div");
    mainContent.className = "recording-content";
    let scheduleImageLoadForItem: ((el: HTMLElement) => void) | null = null;
    let hasSidebarMetadata = false;

    if (recording.metadata && "Metadata" in recording.metadata) {
        hasSidebarMetadata = true;
        liClass += " has-metadata";
        const meta = recording.metadata.Metadata;
        const dateStr = formatSidebarDate(videoName);
        const champion = meta.championName;
        const kda = `${meta.stats.kills}/${meta.stats.deaths}/${meta.stats.assists}`;
        const { result, resultClass } = getMatchResultMeta(meta);
        const queueName = getShortQueueLabel(meta.queue?.id, meta.queue?.name ?? "Custom");
        const isRedSide = isRedSideMeta(meta);
        const selfPart = meta.participants.find((p) => p.participantId === meta.participantId);
        liClass += isRedSide ? " side-red" : " side-blue";

        const mainCol = createEl("div", {}, { class: "sidebar-main" });
        const rightCol = createEl("div", {}, { class: "sidebar-right" });
        const headerRow = createEl("div", {}, { class: "sidebar-header-row" });
        const durationSec = resolveDurationSeconds(meta);
        const timeStr = formatDurationMmSs(durationSec);
        const timeSpan = createEl("span", {}, { class: "sidebar-time" }, timeStr);
        const modeSpan = createEl("span", {}, { class: "sidebar-mode" }, queueName);
        const dateSpan = createEl("div", {}, { class: "sidebar-date" }, dateStr);
        headerRow.append(timeSpan, modeSpan);

        const bodyRow = createEl("div", {}, { class: "sidebar-body-row" });
        const mainIconImg = createEl("img", {}, { class: "main-champ-img" }) as HTMLImageElement;
        const participantsContainer = createEl("div", {}, { class: "sidebar-participants" });
        const team1Row = createEl("div", {}, { class: "participant-row" }) as HTMLElement;
        const team2Row = createEl("div", {}, { class: "participant-row" }) as HTMLElement;
        participantsContainer.append(team1Row, team2Row);

        if (queueName === "TFT") {
            liClass += " tft-match";
            const statsCol = createEl("div", {}, { class: "sidebar-stats tft-stats" });
            const placementClass = selfPart?.placement === 1 ? "tft-1st" : selfPart?.placement && selfPart.placement <= 4 ? "tft-top4" : "tft-bot4";
            const placementStr = selfPart?.placement ? `#${selfPart.placement}` : "-";
            const placementSpan = createEl("span", {}, { class: `sidebar-placement ${placementClass}` }, placementStr);
            headerRow.append(placementSpan, dateSpan);

            const tftTraits = createEl("div", {}, { class: "sidebar-tft-traits" });
            if (selfPart?.traits) {
                const activeTraits = [...selfPart.traits]
                    .filter((t) => t.tierCurrent > 0)
                    .sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits)
                    .slice(0, 7);
                for (const trait of activeTraits) {
                    const styleClass = resolveTftTraitStyleClass(trait.tierCurrent, trait.tierTotal);
                    const trWrapper = createEl("div", { title: trait.name.replace(/^TFT\d+_/, "") }, { class: `tft-trait-wrapper ${styleClass}` });
                    const trImg = createEl("div", {}, { class: "tft-trait" }) as HTMLElement;
                    const trNum = createEl("span", {}, { class: "tft-trait-num" }, `${trait.numUnits}`);
                    trWrapper.append(trImg, trNum);
                    tftTraits.append(trWrapper);
                }
            }

            const tftUnits = createEl("div", {}, { class: "sidebar-tft-units" });
            if (selfPart?.units) {
                const activeUnits = [...selfPart.units].slice(0, 10);
                for (const unit of activeUnits) {
                    const costClass = `tft-cost-${resolveTftUnitCost(unit.rarity)}`;
                    const unitContainer = createEl("div", {}, { class: `tft-unit-wrapper ${costClass}` });
                    const unitImg = createEl("img", { title: unit.characterId.replace(/^TFT\d+_/, "") }, { class: "tft-unit-img" }) as HTMLImageElement;
                    unitContainer.append(unitImg);
                    if (unit.tier > 1) {
                        const starClass = unit.tier === 3 ? "star-gold" : "star-silver";
                        unitContainer.append(createEl("span", {}, { class: `tft-unit-stars ${starClass}` }, "\u2605".repeat(unit.tier)));
                    }
                    const itemsContainer = createEl("div", {}, { class: "tft-unit-items" });
                    if (unit.itemNames && unit.itemNames.length > 0) {
                        for (const itemName of unit.itemNames) {
                            itemsContainer.append(createEl("img", { title: itemName.replace(/^TFT\d+_Item_/, "") }, { class: "tft-unit-item-img" }) as HTMLImageElement);
                        }
                    }
                    unitContainer.append(itemsContainer);
                    tftUnits.append(unitContainer);
                }
            }

            statsCol.append(tftTraits, tftUnits);
            bodyRow.append(statsCol);
        } else {
            const totalCS = meta.stats.totalMinionsKilled + meta.stats.neutralMinionsKilled;
            const csPerMin = calcCsPerMin(totalCS, durationSec);
            const statsCol = createEl("div", {}, { class: "sidebar-stats" });
            const csSpan = createEl("span", {}, { class: "sidebar-cs" });
            csSpan.append(
                createEl("span", {}, { class: "sidebar-cs-total" }, `${totalCS} CS`),
                createEl("span", {}, { class: "sidebar-cs-per-minute" }, `(${csPerMin}/m)`),
            );
            statsCol.append(
                createEl("span", {}, { class: "sidebar-kda" }, kda),
                csSpan,
                createEl("span", {}, { class: `sidebar-result ${resultClass}` }, result),
            );
            if (meta.lpDiff !== undefined && meta.lpDiff !== null && meta.queue?.isRanked) {
                const diffStr = meta.lpDiff >= 0 ? `+${meta.lpDiff} LP` : `${meta.lpDiff} LP`;
                statsCol.append(createEl("span", {}, { class: `sidebar-lp ${resultClass}` }, diffStr));
            }
            bodyRow.append(mainIconImg, statsCol);
        }

        mainCol.append(headerRow, bodyRow);
        const sidebarBadges = createEl("div", {}, { class: "sidebar-badges" });
        if (isClipRecording) {
            const clipBadge = createEl("span", {}, { class: "sidebar-clip-badge", title: "Clip" });
            clipBadge.append(createClipIconElement());
            sidebarBadges.append(clipBadge);
        }
        if (favorite) {
            sidebarBadges.append(
                createEl(
                    "span",
                    {},
                    { class: "sidebar-favorite-badge", title: tooltipText("お気に入り", "Favorite") },
                    "\u2605",
                ),
            );
        }

        if (queueName === "TFT") {
            mainCol.append(sidebarBadges);
            mainContent.append(mainCol);
        } else {
            participantsContainer.append(team1Row, team2Row);
            rightCol.append(dateSpan, participantsContainer, sidebarBadges);
            mainContent.append(mainCol, rightCol);
        }

        const sidebarImageRunId = getActiveSidebarImageRunId();
        const runItemImageLoading = async () => {
            const perfStartedAt = perfNowMs();
            const perfStats = createSidebarImagePerfStats();
            const tasks: Promise<void>[] = [];
            const runState = getSidebarImageRun(sidebarImageRunId);
            if (runState) {
                runState.totalItems += 1;
                runState.pendingItems += 1;
            }
            try {
                const selfParticipant = meta.participants.find((p) => p.participantId === meta.participantId);
                if (queueName === "TFT" && selfParticipant) {
                    if (selfParticipant.companion) {
                        tasks.push(
                            enqueueSidebarImageTask(() => resolveAndApplyImage({
                                stats: perfStats,
                                label: "tft_main_companion",
                                resolver: async () => getTftUnitIconUrl(selfParticipant.units?.[0]?.characterId || ""),
                                apply: (url) => {
                                    mainIconImg.src = url;
                                    return mainIconImg;
                                },
                            })),
                        );
                    }
                    const tftStatsCol = bodyRow.querySelector(".sidebar-stats.tft-stats");
                    const unitWrappers = tftStatsCol?.querySelectorAll(".tft-unit-wrapper");
                    const traitImgs = tftStatsCol?.querySelectorAll(".tft-trait");
                    if (unitWrappers && selfParticipant.units) {
                        const maxLen = Math.min(unitWrappers.length, selfParticipant.units.length);
                        for (let i = 0; i < maxLen; i++) {
                            const unit = selfParticipant.units[i];
                            const wrapper = unitWrappers[i];
                            const img = wrapper.querySelector(".tft-unit-img") as HTMLImageElement;
                            if (img) {
                                tasks.push(
                                    enqueueSidebarImageTask(() => resolveAndApplyImage({
                                        stats: perfStats,
                                        label: "tft_unit_icon",
                                        resolver: async () => getTftUnitIconUrl(unit.characterId),
                                        apply: (url) => {
                                            img.src = url;
                                            img.onerror = () => { img.style.opacity = "0"; };
                                            return img;
                                        },
                                    })),
                                );
                            }
                            const itemImgs = wrapper.querySelectorAll(".tft-unit-item-img");
                            const itemNames = unit.itemNames;
                            if (itemImgs && itemNames) {
                                for (let j = 0; j < Math.min(itemImgs.length, itemNames.length); j++) {
                                    const itemImg = itemImgs[j] as HTMLImageElement;
                                    tasks.push(
                                        enqueueSidebarImageTask(() => resolveAndApplyImage({
                                            stats: perfStats,
                                            label: "tft_item_icon",
                                            resolver: async () => getTftItemIconUrl(itemNames[j]),
                                            apply: (url) => {
                                                itemImg.src = url;
                                                itemImg.onerror = () => { itemImg.style.display = "none"; };
                                                return itemImg;
                                            },
                                        })),
                                    );
                                }
                            }
                        }
                    }
                    if (traitImgs && selfParticipant.traits) {
                        const activeTraits = [...selfParticipant.traits]
                            .filter((t) => t.tierCurrent > 0)
                            .sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits)
                            .slice(0, 7);
                        for (let i = 0; i < Math.min(traitImgs.length, activeTraits.length); i++) {
                            const el = traitImgs[i] as HTMLElement;
                            const trait = activeTraits[i];
                            tasks.push(
                                enqueueSidebarImageTask(() => resolveAndApplyMask({
                                    stats: perfStats,
                                    label: "tft_trait_icon",
                                    resolver: async () => getTftTraitIconUrl(trait.name),
                                    apply: async (url) => {
                                        if (url) {
                                            el.style.webkitMaskImage = `url("${url}")`;
                                            el.style.webkitMaskSize = "contain";
                                            el.style.webkitMaskRepeat = "no-repeat";
                                            el.style.webkitMaskPosition = "center";
                                            el.style.backgroundColor = "currentColor";
                                        }
                                        const correctedClass = await getTftTraitStyleClass(trait.name, trait.numUnits);
                                        const wrapper = el.closest(".tft-trait-wrapper");
                                        if (wrapper && correctedClass) {
                                            wrapper.classList.remove(
                                                "tft-prismatic",
                                                "tft-gold",
                                                "tft-silver",
                                                "tft-bronze",
                                                "tft-inactive",
                                                "tft-unique",
                                            );
                                            wrapper.classList.add(correctedClass);
                                        }
                                    },
                                })),
                            );
                        }
                    }
                } else {
                    if (selfParticipant) {
                        tasks.push(
                            enqueueSidebarImageTask(() => resolveAndApplyImage({
                                stats: perfStats,
                                label: "main_champion_icon_by_id",
                                resolver: async () => getChampionIconUrlById(selfParticipant.championId),
                                apply: (url) => {
                                    mainIconImg.src = url;
                                    mainIconImg.onerror = () => { console.error("Failed to load main icon:", url); };
                                    return mainIconImg;
                                },
                            })),
                        );
                    } else {
                        tasks.push(
                            enqueueSidebarImageTask(() => resolveAndApplyImage({
                                stats: perfStats,
                                label: "main_champion_icon_by_name",
                                resolver: async () => getChampionIconUrl(champion),
                                apply: (url) => {
                                    mainIconImg.src = url;
                                    return mainIconImg;
                                },
                            })),
                        );
                    }
                }

                const p100 = meta.participants.filter((p) => {
                    if ("teamId" in p && p.teamId === 200) return false;
                    if ("teamId" in p && p.teamId === 100) return true;
                    return p.participantId <= 5;
                });
                const p200 = meta.participants.filter((p) => {
                    if ("teamId" in p && p.teamId === 200) return true;
                    if ("teamId" in p && p.teamId === 100) return false;
                    return p.participantId > 5;
                });

                const appendIcon = async (p: Participant, row: HTMLElement) => {
                    const img = createEl("img", { src: "" }, { class: "sub-champ-icon" }) as HTMLImageElement;
                    row.append(img);
                    await enqueueSidebarImageTask(() => resolveAndApplyImage({
                        stats: perfStats,
                        label: "sub_champion_icon",
                        resolver: async () => getChampionIconUrlById(p.championId),
                        apply: (url) => {
                            img.src = url;
                            img.onerror = () => { img.style.display = "none"; };
                            return img;
                        },
                    })).catch(() => {
                        img.style.display = "none";
                    });
                };
                for (const p of p100) tasks.push(appendIcon(p, team1Row));
                for (const p of p200) tasks.push(appendIcon(p, team2Row));

                await Promise.allSettled(tasks);
                const elapsedMs = perfNowMs() - perfStartedAt;
                const shortVideoId = recording.videoId.split("\\").pop()?.split("/").pop() || recording.videoId;
                if (PERF_LOG_ENABLED && (elapsedMs >= 300 || perfStats.errorCount > 0)) {
                    console.log(
                        `[perf] sidebar_images video=${shortVideoId} queue=${queueName} total=${elapsedMs.toFixed(1)}ms resolve=${perfStats.resolveMs.toFixed(1)}ms resolve_count=${perfStats.resolveCount} dom_load=${perfStats.domLoadMs.toFixed(1)}ms load_count=${perfStats.loadCount} error_count=${perfStats.errorCount}`,
                    );
                }
                recordSidebarImageBatch(perfStats, elapsedMs);
                if (runState) {
                    runState.completedItems += 1;
                    runState.pendingItems = Math.max(0, runState.pendingItems - 1);
                    runState.totalItemMs += elapsedMs;
                    runState.resolveMs += perfStats.resolveMs;
                    runState.domLoadMs += perfStats.domLoadMs;
                    runState.resolveCount += perfStats.resolveCount;
                    runState.loadCount += perfStats.loadCount;
                    runState.errorCount += perfStats.errorCount;
                    maybeFinishSidebarImageRun(runState);
                }
            } catch (e) {
                console.error("Error loading icons in sidebar:", e);
                if (runState) {
                    runState.completedItems += 1;
                    runState.pendingItems = Math.max(0, runState.pendingItems - 1);
                    runState.errorCount += 1;
                    maybeFinishSidebarImageRun(runState);
                }
            }
        };
        scheduleImageLoadForItem = (el: HTMLElement) => {
            scheduleSidebarItemImageLoad(el, () => {
                void runItemImageLoading();
            });
        };

        displayContent = [mainContent];
    } else if (recording.metadata && "Deferred" in recording.metadata && (recording.metadata.Deferred.tftRoundMarkers?.length ?? 0) > 0) {
        hasSidebarMetadata = true;
        liClass += " has-metadata tft-match";
        const deferred = recording.metadata.Deferred;
        const markers = deferred.tftRoundMarkers ?? [];
        const dateStr = formatSidebarDate(videoName);
        const durationSec = Math.max(0, Math.floor(((markers.at(-1)?.timestamp ?? 0) / 1000) - deferred.ingameTimeRecStartOffset));
        const timeStr = formatDurationMmSs(durationSec);
        const lastRound = markers.at(-1)?.round ?? "-";

        const mainCol = createEl("div", {}, { class: "sidebar-main" });
        const headerRow = createEl("div", {}, { class: "sidebar-header-row" });
        headerRow.append(
            createEl("span", {}, { class: "sidebar-time" }, timeStr),
            createEl("span", {}, { class: "sidebar-mode" }, "TFT"),
            createEl("span", {}, { class: "sidebar-placement tft-top4" }, lastRound),
            createEl("div", {}, { class: "sidebar-date" }, dateStr),
        );

        const bodyRow = createEl("div", {}, { class: "sidebar-body-row" });
        const statsCol = createEl("div", {}, { class: "sidebar-stats tft-stats" });
        statsCol.append(
            createEl("span", {}, { class: "sidebar-kda" }, `${markers.length} rounds`),
            createEl("span", {}, { class: "sidebar-cs" }, `Game ${deferred.matchId.platformId}-${deferred.matchId.gameId}`),
        );
        bodyRow.append(statsCol);

        const sidebarBadges = createEl("div", {}, { class: "sidebar-badges" });
        if (favorite) {
            sidebarBadges.append(
                createEl(
                    "span",
                    {},
                    { class: "sidebar-favorite-badge", title: tooltipText("お気に入り", "Favorite") },
                    "\u2605",
                ),
            );
        }

        mainCol.append(headerRow, bodyRow, sidebarBadges);
        mainContent.append(mainCol);
        displayContent = [mainContent];
    } else if (isClipRecording) {
        const clipName = createEl("span", {}, { class: "video-name" }) as HTMLSpanElement;
        clipName.append(createClipIconElement(), document.createTextNode(` ${videoName}`));
        displayContent = [clipName];
    }

    const li = createEl("li", {
        onclick: () => {
            if (recording.videoExists) onVideo(recording.videoId);
            else console.log("Video file no longer exists for this recording.");
        },
    }, { id: recording.videoId, class: liClass }) as HTMLElement;
    li.dataset.videoId = recording.videoId;

    const favoriteBtn = createEl("span", {
        onclick: (e: MouseEvent) => {
            e.stopPropagation();
            onFavorite(recording.videoId).then((fav) => {
                if (fav === null) return;
                favoriteBtn.innerHTML = fav ? "\u2605" : "\u2606";
                favoriteBtn.style.color = fav ? "gold" : "";
                if (recording.metadata) {
                    if ("Metadata" in recording.metadata) recording.metadata.Metadata.favorite = fav;
                    else if ("Deferred" in recording.metadata) recording.metadata.Deferred.favorite = fav;
                    else if ("NoData" in recording.metadata) recording.metadata.NoData.favorite = fav;
                }
                const badgeContainer = li.querySelector(".sidebar-badges");
                if (!fav) {
                    // A recording may have multiple badge containers while its
                    // metadata is loading. Remove every favorite marker so a
                    // stale one cannot survive an unfavorite action.
                    li.querySelectorAll(".sidebar-favorite-badge").forEach((badge) => badge.remove());
                } else if (badgeContainer) {
                    const existingFavoriteBadge = badgeContainer.querySelector(".sidebar-favorite-badge");
                    if (!existingFavoriteBadge) {
                        badgeContainer.append(
                            createEl(
                                "span",
                                {},
                                { class: "sidebar-favorite-badge", title: tooltipText("お気に入り", "Favorite") },
                                "\u2605",
                            ),
                        );
                    }
                }
                if (filterStar && !fav && onRefreshForStarUnfavorite) onRefreshForStarUnfavorite();
            });
        },
    }, {
        class: "favorite",
        title: tooltipText("お気に入り", "Favorite"),
        ...(favorite ? { style: "color: gold" } : {}),
    }, favorite ? "\u2605" : "\u2606") as HTMLSpanElement;

    const shareBtn = createEl("span", {
        onclick: (e: MouseEvent) => {
            e.stopPropagation();
            void showShareModal(recording);
        },
    }, { class: "share", title: tooltipText("共有", "Share") }, "\u21AA");
    const replayButtons = hasReplayGameId(recording)
        ? [createReplayActionButton(recording.videoId, tooltipText("ROFLを準備してクライアントで再生", "Prepare ROFL and play in client"))]
        : [];
    const renameBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); onRename(recording.videoId); } }, { class: "rename", title: tooltipText("名前変更", "Rename") }, "\u270E");
    const deleteBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); onDelete(recording.videoId, isFavorite(recording.metadata)); } }, { class: "delete", title: tooltipText("削除", "Delete") }, "\u2716");
    const deleteVideoOnlyBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); if (onDeleteVideoOnly) onDeleteVideoOnly(recording.videoId, isFavorite(recording.metadata)); } }, { class: "delete-video-only", title: tooltipText("動画のみ削除", "Delete Video Only") }, "\uD83D\uDDD1");
    const actionsDiv = createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, shareBtn, ...replayButtons, renameBtn, deleteVideoOnlyBtn, deleteBtn]);

    if (recording.metadata && "Metadata" in recording.metadata) {
        li.dataset.hasMetadata = recording.metadata.Metadata.queue.name !== "Unknown Queue" ? "true" : "false";
        li.append(mainContent);
    } else {
        li.dataset.hasMetadata = hasSidebarMetadata ? "true" : "false";
        li.append(...displayContent);
    }
    li.append(actionsDiv);
    syncYouTubeUploadControls(li);
    scheduleImageLoadForItem?.(li);
    return li;
}
