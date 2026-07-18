import { commands, type Participant, type Recording } from "../bindings";
import { startDrag } from "../platform/drag";
import { writeText } from "../platform/clipboard";
import { open } from "../platform/shell";
import {
    cancelYouTubeUpload,
    getYouTubeAuthStatus,
    getYouTubeFirebaseIdToken,
    getYouTubeUploadJob,
    signInToYouTube,
    signOutFromYouTube,
    startYouTubeUpload,
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
import {
    findYouTubeUploadForSource,
    rememberYouTubeUpload,
    YOUTUBE_UPLOAD_HISTORY_CHANGED_EVENT,
} from "../youtube_upload_history";
import xLogoIcon from "../../assets/share-icons/x-logo.svg";
import discordSymbolIcon from "../../assets/share-icons/discord-symbol.svg";
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
                alert(result.error || "リプレイ再生に失敗しました。");
            }
        } finally {
            button.classList.remove("is-loading");
        }
    });
    return button;
}

function createShareIcon(kind: "x" | "discord"): HTMLImageElement {
    const img = document.createElement("img");
    img.className = "recording-share-option-icon";
    img.alt = "";
    img.draggable = false;
    img.src = kind === "x" ? xLogoIcon : discordSymbolIcon;
    return img;
}

function createYouTubeUploadBadge(): SVGSVGElement {
    const badge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    badge.setAttribute("class", "sidebar-youtube-badge");
    badge.setAttribute("viewBox", "0 0 20 14");
    badge.setAttribute("aria-label", "YouTubeへアップロード済み");
    badge.setAttribute("role", "img");
    badge.title = "YouTubeへアップロード済み";
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // evenodd makes the play triangle a real hole, exposing the sidebar
    // background rather than painting it white.
    shape.setAttribute("fill-rule", "evenodd");
    shape.setAttribute("d", "M3.1 0h13.8C18.6 0 20 1.4 20 3.1v7.8c0 1.7-1.4 3.1-3.1 3.1H3.1C1.4 14 0 12.6 0 10.9V3.1C0 1.4 1.4 0 3.1 0Zm4.8 3.2v7.6L14.1 7 7.9 3.2Z");
    badge.append(shape);
    return badge;
}

function refreshYouTubeUploadBadges(): void {
    document.querySelectorAll<HTMLElement>("li[data-video-id]").forEach((item) => {
        const sourceVideoId = item.dataset.videoId || "";
        const uploaded = Boolean(sourceVideoId && findYouTubeUploadForSource(sourceVideoId));
        let container = item.querySelector<HTMLElement>(".sidebar-badges");
        const badge = item.querySelector<HTMLElement>(".sidebar-youtube-badge");
        if (!uploaded) {
            badge?.remove();
            return;
        }
        if (!container) {
            container = document.createElement("div");
            container.className = "sidebar-badges sidebar-upload-badges";
            item.querySelector(".sidebar-actions")?.before(container);
        }
        if (!badge) container.append(createYouTubeUploadBadge());
    });
}

window.addEventListener(YOUTUBE_UPLOAD_HISTORY_CHANGED_EVENT, refreshYouTubeUploadBadges);

function formatUploadProgress(job: YouTubeUploadJob): string {
    if (job.state === "preparing") return "アップロードを準備しています…";
    if (job.state === "uploading") {
        const sent = job.sentBytes || 0;
        const total = job.totalBytes || 0;
        const percent = total > 0 ? Math.min(100, Math.floor(sent / total * 100)) : 0;
        const sentMiB = (sent / 1024 / 1024).toFixed(1);
        const totalMiB = (total / 1024 / 1024).toFixed(1);
        return `アップロード中: ${percent}%（${sentMiB} / ${totalMiB} MiB）`;
    }
    if (job.state === "completed") return "YouTubeへのアップロードが完了しました。";
    if (job.state === "cancelled") return "アップロードをキャンセルしました。";
    if (job.state === "failed") return job.error || "アップロードに失敗しました。";
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
    const settings = await commands.getSettings().catch(() => null);
    const currentLanguage = (settings?.language || "en") as string;

    const overlay = document.createElement("div");
    overlay.id = SHARE_MODAL_ID;
    overlay.className = "recording-share-modal-overlay";

    const panel = document.createElement("div");
    panel.className = "recording-share-modal";
    panel.addEventListener("click", (e) => e.stopPropagation());

    const content = document.createElement("div");
    content.className = "recording-share-modal-content";

    const renderSelectView = () => {
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
        youtubeButton.className = "recording-share-option recording-share-option-youtube";
        youtubeButton.type = "button";
        youtubeButton.title = "YouTube";
        youtubeButton.setAttribute("aria-label", "YouTubeへアップロード");
        youtubeButton.textContent = "▶ YouTube";
        youtubeButton.onclick = () => void renderYouTubeView();

        const uploaded = findYouTubeUploadForSource(videoId);
        const uploadedLink = uploaded
            ? `https://www.youtube.com/watch?v=${uploaded.youtubeVideoId}`
            : null;
        const uploadedLinkRow = document.createElement("div");
        uploadedLinkRow.className = "recording-share-uploaded-id";
        if (uploadedLink) {
            const uploadedLinkLabel = document.createElement("span");
            uploadedLinkLabel.textContent = "YouTubeリンク";
            const uploadedLinkValue = document.createElement("code");
            uploadedLinkValue.textContent = uploadedLink;
            uploadedLinkValue.title = uploadedLink;
            const copyUploadedLink = document.createElement("button");
            copyUploadedLink.type = "button";
            copyUploadedLink.className = "recording-share-copy-id";
            copyUploadedLink.textContent = "リンクをコピー";
            copyUploadedLink.addEventListener("click", async () => {
                try {
                    await writeText(uploadedLink);
                    copyUploadedLink.textContent = "コピーしました";
                    window.setTimeout(() => { copyUploadedLink.textContent = "リンクをコピー"; }, 1500);
                } catch {
                    copyUploadedLink.textContent = "コピーできませんでした";
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
        content.replaceChildren();
        const videoPath = getRecordingMp4Path(videoId);
        const defaultTitle = basename(videoPath).replace(/\.(mp4|webm)$/i, "");

        const title = document.createElement("div");
        title.className = "recording-share-modal-title";
        title.textContent = "YouTubeへアップロード";

        const status = document.createElement("div");
        status.className = "recording-share-modal-subtitle";
        status.textContent = "接続状態を確認しています…";

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
            status.textContent = "YouTubeの開発用Client IDが設定されていません。";
            return;
        }
        if (!auth.connected) {
            status.textContent = "Googleアカウントを接続すると、自分のYouTubeチャンネルへのアップロードと試合データの登録ができます。";
            const connect = document.createElement("button");
            connect.className = "recording-share-option";
            connect.type = "button";
            connect.textContent = "Googleアカウントを接続";
            connect.onclick = async () => {
                connect.disabled = true;
                status.textContent = "ブラウザでGoogleアカウントにログインしてください…";
                try {
                    const signedIn = await signInToYouTube();
                    if (!signedIn.firebaseIdToken) throw new Error("Google本人確認情報を取得できませんでした。");
                    await connectReplayShareGoogle(signedIn.firebaseIdToken);
                    window.dispatchEvent(new Event(YOUTUBE_AUTH_CONNECTED_EVENT));
                    await renderYouTubeView();
                } catch (error) {
                    status.textContent = error instanceof Error ? error.message : String(error);
                    connect.disabled = false;
                }
            };
            actions.prepend(connect);
            return;
        }

        let replayAuth: Awaited<ReturnType<typeof getReplayShareAuthStatus>> = {
            authenticated: false,
            google: false,
            anonymous: false,
        };

        const titleInput = document.createElement("input");
        titleInput.className = "recording-share-input";
        let generatedDefaults = { title: defaultTitle.slice(0, 100), description: "" };
        if (recording.metadata && "Metadata" in recording.metadata) {
            generatedDefaults = await buildYouTubeUploadDefaults(recording.metadata.Metadata, getChampionNameById);
        }
        titleInput.value = generatedDefaults.title;
        titleInput.maxLength = 100;
        titleInput.placeholder = "タイトル（1〜100文字）";
        const description = document.createElement("textarea");
        description.className = "recording-share-input recording-share-textarea";
        description.maxLength = 5000;
        description.placeholder = "説明（任意、5,000文字まで）";
        description.value = generatedDefaults.description;
        const privacyStatus = document.createElement("select");
        privacyStatus.className = "recording-share-input";
        privacyStatus.innerHTML = "<option value='private'>非公開</option><option value='unlisted'>限定公開</option><option value='public'>公開</option>";
        privacyStatus.value = "public";
        const registerReplayShareLabel = document.createElement("label");
        registerReplayShareLabel.className = "recording-share-guidelines";
        const registerReplayShare = document.createElement("input");
        registerReplayShare.type = "checkbox";
        registerReplayShare.checked = true;
        registerReplayShare.className = "recording-share-guidelines-check";
        const registerReplayShareText = document.createElement("span");
        registerReplayShareText.textContent = "試合データをDBへ登録して、YouTube URLから再生できるようにする";
        registerReplayShareLabel.append(registerReplayShare, registerReplayShareText);
        const anonymousShareLabel = document.createElement("label");
        anonymousShareLabel.className = "recording-share-guidelines";
        const anonymousShare = document.createElement("input");
        anonymousShare.type = "checkbox";
        anonymousShare.className = "recording-share-guidelines-check";
        const anonymousShareText = document.createElement("span");
        anonymousShareText.textContent = "試合データを匿名化して共有する（名前・Riotタグ・ランク・サモナーレベル・内部IDを除外）";
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
        privacyPolicyButton.textContent = "プライバシーポリシー";
        privacyPolicyButton.onclick = () => void open("https://arasan95.github.io/league_record_custom/privacy.html");
        const termsButton = document.createElement("button");
        termsButton.type = "button";
        termsButton.className = "recording-share-link";
        termsButton.textContent = "利用規約";
        termsButton.onclick = () => void open("https://arasan95.github.io/league_record_custom/terms.html");
        const policyText = document.createElement("span");
        policyText.append("YouTubeアップロードに関する ", privacyPolicyButton, " と ", termsButton, " に同意します。");
        policyLabel.append(policyAccepted, policyText);
        const guidelinesLabel = document.createElement("label");
        guidelinesLabel.className = "recording-share-guidelines";
        const guidelinesConfirmed = document.createElement("input");
        guidelinesConfirmed.type = "checkbox";
        guidelinesConfirmed.className = "recording-share-guidelines-check";
        const guidelinesText = document.createElement("span");
        guidelinesText.textContent = "投稿する動画がYouTubeコミュニティガイドラインに準拠していることを確認しました。";
        guidelinesLabel.append(guidelinesConfirmed, guidelinesText);
        const note = document.createElement("div");
        note.className = "recording-share-modal-subtitle";
        note.textContent = "元の録画またはクリップを再エンコードせず、その解像度のままYouTubeへ送信します。試合データのDB登録は任意です。YouTube側のHD処理には時間がかかる場合があります。";
        const existingVideoUrl = document.createElement("input");
        existingVideoUrl.className = "recording-share-input";
        existingVideoUrl.placeholder = "登録済みYouTube動画のURL（試合データのみ更新）";
        const republishMetadata = document.createElement("button");
        republishMetadata.className = "recording-share-option";
        republishMetadata.type = "button";
        republishMetadata.textContent = "既存動画へ試合データを登録";
        republishMetadata.onclick = async () => {
            let youtubeVideoId: string;
            try {
                youtubeVideoId = parseYouTubeVideoId(existingVideoUrl.value);
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
                return;
            }
            if (!await ensureReplayShareAuth()) return;
            if (!window.confirm("YouTube動画は変更せず、この録画の試合データだけをFirestoreへ登録・更新します。続行しますか？")) return;
            republishMetadata.disabled = true;
            status.textContent = "試合データを登録しています…";
            try {
                const share = await prepareReplayShare(recording.metadata, youtubeVideoId, {
                    anonymizePlayers: anonymousShare.checked,
                });
                await publishReplayShare(share);
                rememberYouTubeUpload(videoId, youtubeVideoId);
                status.textContent = "既存YouTube動画の試合データを更新しました。";
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                status.textContent = message.includes("Firestoreへの登録が拒否")
                    ? "この共有データは別のFirebase認証で登録されています。Firebase Consoleで該当する replays 文書を削除してから、もう一度登録してください。"
                    : message;
            } finally {
                republishMetadata.disabled = false;
            }
        };
        const upload = document.createElement("button");
        upload.className = "recording-share-option recording-share-upload";
        upload.type = "button";
        upload.textContent = "アップロードを開始";
        const cancel = document.createElement("button");
        cancel.className = "recording-share-cancel";
        cancel.type = "button";
        cancel.textContent = "キャンセル";
        cancel.style.display = "none";
        const openVideo = document.createElement("button");
        openVideo.className = "recording-share-option";
        openVideo.type = "button";
        openVideo.textContent = "YouTubeで開く";
        openVideo.style.display = "none";
        const uploadedVideoId = document.createElement("div");
        uploadedVideoId.className = "recording-share-uploaded-id";
        uploadedVideoId.hidden = true;
        const uploadedVideoIdLabel = document.createElement("span");
        uploadedVideoIdLabel.textContent = "YouTube動画ID";
        const uploadedVideoIdValue = document.createElement("code");
        const copyVideoId = document.createElement("button");
        copyVideoId.type = "button";
        copyVideoId.className = "recording-share-copy-id";
        copyVideoId.textContent = "IDをコピー";
        copyVideoId.addEventListener("click", async () => {
            const id = uploadedVideoIdValue.textContent || "";
            if (!id) return;
            try {
                await writeText(id);
                copyVideoId.textContent = "コピーしました";
                window.setTimeout(() => { copyVideoId.textContent = "IDをコピー"; }, 1500);
            } catch {
                status.textContent = "動画IDをコピーできませんでした。";
            }
        });
        uploadedVideoId.append(uploadedVideoIdLabel, uploadedVideoIdValue, copyVideoId);
        const disconnect = document.createElement("button");
        disconnect.className = "recording-share-option";
        disconnect.type = "button";
        disconnect.textContent = "Google接続を解除";
        disconnect.onclick = async () => {
            disconnect.disabled = true;
            status.textContent = "Google接続を解除しています…";
            try {
                await signOutReplayShareAuth();
                await signOutFromYouTube();
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
        let completedJob: YouTubeUploadJob | null = null;
        const normalizedSourceName = (value: string) => value.replace(/\\/g, "/").split("/").pop()?.replace(/\.(mp4|webm)$/i, "") ?? "";
        const jobBelongsToRecording = (job: YouTubeUploadJob) => (
            job.sourceVideoId === videoId
            || (Boolean(job.fileName) && normalizedSourceName(job.fileName!) === normalizedSourceName(videoId))
        );
        const stopPolling = () => { if (poller) clearInterval(poller); poller = null; };
        const ensureReplayShareAuth = async (): Promise<boolean> => {
            if (replayAuth.google) return true;
            status.textContent = "試合データを登録するため、FirebaseへGoogleアカウントを接続しています…";
            try {
                replayAuth = await getReplayShareAuthStatus();
                if (replayAuth.google) return true;
                await connectReplayShareGoogle(await getYouTubeFirebaseIdToken());
                replayAuth = await getReplayShareAuthStatus();
                if (!replayAuth.google) throw new Error("FirebaseのGoogle認証を確認できませんでした。");
                return true;
            } catch (error) {
                status.textContent = `試合データを登録できません。${error instanceof Error ? error.message : String(error)}`;
                return false;
            }
        };
        const publishMetadata = async (job: YouTubeUploadJob) => {
            if (replayShareState === "publishing" || replayShareState === "published") return;
            completedJob = job;
            replayShareState = "publishing";
            status.textContent = "YouTubeへのアップロードが完了しました。試合データを登録しています…";
            try {
                const share = await prepareReplayShare(recording.metadata, job.youtubeVideoId, {
                    anonymizePlayers: anonymousShare.checked,
                });
                await publishReplayShare(share);
                replayShareState = "published";
                status.textContent = "YouTubeへのアップロードと試合データの登録が完了しました。";
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("共有できる試合データがありません")) {
                    replayShareState = "unavailable";
                    status.textContent = "YouTubeへのアップロードは完了しました。この動画には共有できる試合データがありません。";
                    return;
                }
                replayShareState = "failed";
                status.textContent = `YouTubeへのアップロードは完了しましたが、試合データを登録できませんでした。${message}`;
                upload.textContent = "試合データの登録を再試行";
                upload.disabled = false;
            }
        };
        const showJob = (job: YouTubeUploadJob) => {
            // The first status poll can race the IPC command and still be
            // idle. Keep the optimistic "preparing" state in that case.
            if (job.state === "idle" && uploadHasStarted) return;
            if (job.state !== "completed" || replayShareState === "idle") {
                status.textContent = formatUploadProgress(job);
            }
            const inFlight = job.state === "preparing" || job.state === "uploading";
            if (inFlight) uploadHasStarted = true;
            upload.disabled = inFlight;
            cancel.style.display = inFlight ? "" : "none";
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
                if (shouldPublishMetadata && replayShareState === "idle") {
                    void publishMetadata(job);
                } else if (!shouldPublishMetadata && replayShareState === "idle") {
                    replayShareState = "not_requested";
                    status.textContent = "YouTubeへのアップロードが完了しました。試合データは登録していません。HD画質はYouTubeの処理完了後に利用できます。";
                } else if (replayShareState === "idle" && job.youtubeVideoId && jobBelongsToRecording(job)) {
                    completedJob = job;
                    replayShareState = "failed";
                    status.textContent = "YouTubeへのアップロードは完了しています。試合データの登録を再試行できます。";
                    upload.textContent = "試合データの登録を再試行";
                    upload.disabled = false;
                }
            }
            if (uploadHasStarted && !inFlight) stopPolling();
        };
        upload.onclick = async () => {
            if (replayShareState === "failed" && completedJob) {
                upload.disabled = true;
                upload.textContent = "試合データを登録しています…";
                await publishMetadata(completedJob);
                if (replayShareState !== "failed") upload.style.display = "none";
                return;
            }
            if (!(["private", "unlisted", "public"] as const).includes(privacyStatus.value as "private" | "unlisted" | "public")) {
                status.textContent = "公開設定を選択してください。";
                return;
            }
            if (!policyAccepted.checked) {
                status.textContent = "プライバシーポリシーと利用規約への同意を確認してください。";
                return;
            }
            if (!guidelinesConfirmed.checked) {
                status.textContent = "YouTubeコミュニティガイドライン遵守を確認してください。";
                return;
            }
            if (registerReplayShare.checked && !await ensureReplayShareAuth()) return;
            const privacyLabel = privacyStatus.selectedOptions[0]?.textContent || privacyStatus.value;
            if (!window.confirm(`接続中のYouTubeアカウントへアップロードします。\n\nタイトル: ${titleInput.value || defaultTitle}\n公開設定: ${privacyLabel}\n\n「OK」を選ぶとアップロードを開始します。`)) return;
            upload.disabled = true;
            uploadHasStarted = true;
            shouldPublishMetadata = registerReplayShare.checked;
            showJob({ state: "preparing" });
            try {
                void startYouTubeUpload(videoId, {
                    title: titleInput.value,
                    description: description.value,
                    madeForKids: false,
                    privacyStatus: privacyStatus.value as "private" | "unlisted" | "public",
                    policyAccepted: policyAccepted.checked,
                    communityGuidelinesConfirmed: guidelinesConfirmed.checked,
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
        actions.prepend(upload, cancel, openVideo, disconnect);
        content.append(title, status, titleInput, description, privacyStatus, registerReplayShareLabel, anonymousShareLabel, policyLabel, guidelinesLabel, note, existingVideoUrl, republishMetadata, uploadedVideoId, actions);
        const existing = await getYouTubeUploadJob();
        showJob(existing);
    };

    const renderXView = () => {
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
    if (findYouTubeUploadForSource(recording.videoId)) {
        let badgeContainer = li.querySelector<HTMLElement>(".sidebar-badges");
        if (!badgeContainer) {
            badgeContainer = createEl("div", {}, { class: "sidebar-badges sidebar-upload-badges" });
            actionsDiv.before(badgeContainer);
        }
        if (!badgeContainer.querySelector(".sidebar-youtube-badge")) badgeContainer.append(createYouTubeUploadBadge());
    }
    scheduleImageLoadForItem?.(li);
    return li;
}
