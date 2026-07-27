import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import { MarkersPlugin, type Settings } from "@fffffffxxxxxxx/videojs-markers";
import "@fffffffxxxxxxx/videojs-markers";

import { convertFileSrc } from "./platform/core";
import { join, sep } from "./platform/path";
import { exists } from "./platform/fs";
import { open as openExternalUrl } from "./platform/shell";
import { registerYouTubeTech } from "./platform/videojs_youtube_tech";
import { getYouTubeFirebaseIdToken, getYouTubeVideoPublishedDates, signInToYouTube, YOUTUBE_AUTH_CHANGED_EVENT } from "./platform/youtube";

import { commands, type ClipAudioTrack, type GameEvent, type Recording } from "./bindings";
import ListenerManager from "./listeners";
import UI from "./ui";
import { splitRight, playNotificationSound } from "./util";
import { DEFAULT_KEYBINDS, isAction, loadKeybinds, loadMouseConfig, type KeybindMap, type MouseConfig } from "./keybinds";
import { TitleBar } from "./titlebar";
import { initPatchVersion } from "./version";
import { initTooltipFallback } from "./tooltip";
import { getText } from "./i18n";
import { ensureDataLoaded } from "./datadragon";
import { buildMetadataCandidates, normalizeVideoId, toAssetPath, videoIdsMatch } from "./main_video_id_usecase";
import { getLatestRetryVideoId, getRetryState } from "./main_sidebar_usecase";
import { getMetadataFromRecordingsList, getMetadataWithFallback } from "./main_metadata_usecase";
import { renderMetadataState } from "./main_metadata_render_usecase";
import { buildMarkers, markerEventName, type HighlightEvents, type MarkerDetail, type RecordingEvents, type TftRoundEvents } from "./main_markers_usecase";
import { initializeProgressTooltips } from "./main_progress_tooltip_usecase";
import { initializeMarkerHoverTooltips } from "./main_marker_tooltip_usecase";
import { createKeyboardHandlers } from "./main_keyboard_usecase";
import { refreshSidebar, retrySidebarUpdateLoop } from "./main_recordings_usecase";
import { buildTimelineRows } from "./main_timeline_usecase";
import { loadReplayShare, type LoadedReplayShare } from "./replay_share";
import { cleanupDeletedReplayShares, connectReplayShareGoogle, listOwnedReplayShareIds, redeemCommunityCommentInvite } from "./platform/firebase";
import { hasYouTubeUploadHistory, readYouTubeUploadHistory, removeYouTubeUploadsByVideoIds } from "./youtube_upload_history";
import { bindYouTubeReplaySidebar, updateYouTubeReplayStatus } from "./ui/youtube_replay_sidebar_usecase";
import { ReviewCommentsController } from "./review_comments";
import { uiText } from "./ui_locale";
import { listen } from "./platform/event";
import { getBridge } from "./platform/bridge";
import { parseReplayDeepLink } from "./replay_deep_link";
import {
    deleteVideoFlow,
    deleteVideoOnlyWithConfirm,
    openRenameModal,
    renameVideoFlow,
    showDeleteWithConfirm,
} from "./main_video_management_usecase";

// Explicit registration guards against bundler tree-shaking of the side‑effect import.
if (!videojs.getPlugin("markers")) {
  videojs.registerPlugin("markers", MarkersPlugin);
}

// initDebug();

// sets the time a marker jumps to before the actual event happens
// jumps to (eventTime - EVENT_DELAY) when a marker is clicked
const EVENT_DELAY = 2;

await registerYouTubeTech(videojs);
const ui = new UI(videojs);
new TitleBar();

// Load keybinds & mouse config
export let currentKeybinds: KeybindMap = loadKeybinds();
export let currentMouseConfig: MouseConfig = loadMouseConfig();

export function reloadKeybinds() {
    currentKeybinds = loadKeybinds();
    currentMouseConfig = loadMouseConfig();
}

let currentEvents: RecordingEvents | null = null;
let highlightEvents: HighlightEvents | null = null;
let tftRoundEvents: TftRoundEvents | null = null;
let markerDetails: Array<MarkerDetail | undefined> = [];
let preferredActiveVideoId: string | null = null;
const metadataRetryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const metadataRenderSignatures = new Map<string, string>();
let metadataRenderRequestSerial = 0;
let lastRenderedMetadataVideoKey: string | null = null;
let recordingsChangedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let recordingsChangedRefreshInFlight = false;
let recordingsChangedRefreshQueued = false;
let suppressRecordingsChangedUntil = 0;
let cachedRecordingsSizeGb = 0;
let recordingsSizeCacheUpdatedAt = 0;
let recordingsSizeFetchInFlight: Promise<number> | null = null;
let manualStartPending = false;
let manualStartPendingTimeout: ReturnType<typeof setTimeout> | null = null;
const RECORDINGS_SIZE_CACHE_MS = 5000;
const YOUTUBE_REPLAY_HISTORY_STORAGE_KEY = "league-record.youtube-replay-history.v1";
const YOUTUBE_REPLAY_HISTORY_LIMIT = 100;
let youtubeReplayHistoryRestoreGeneration = 0;
let remotePlaybackActive = false;
let replayDeepLinkTransitionActive = false;
let replayDeepLinkQueue = Promise.resolve();

async function openReplayDeepLink(value: string): Promise<void> {
    const link = parseReplayDeepLink(value);
    replayDeepLinkTransitionActive = true;
    console.info("[replay-deep-link] opening shared replay", { videoId: link.youtubeVideoId });
    player.pause();
    const replayButton = document.querySelector<HTMLButtonElement>("#nav-youtube-replay");
    if (!replayButton) {
        replayDeepLinkTransitionActive = false;
        throw new Error(uiText(
            "共有リプレイ画面を開けませんでした。",
            "Could not open the shared replay screen.",
        ));
    }
    replayButton.click();
    const youtubeUrl = `https://www.youtube.com/watch?v=${link.youtubeVideoId}`;
    const urlInput = document.querySelector<HTMLTextAreaElement>("#youtube-replay-url");
    if (urlInput) urlInput.value = youtubeUrl;
    updateYouTubeReplayStatus(uiText(
        "招待リンクを確認しています…",
        "Checking the invite link…",
    ));

    try {
        let firebaseIdToken: string;
        try {
            firebaseIdToken = await getYouTubeFirebaseIdToken();
        } catch {
            const signedIn = await signInToYouTube();
            firebaseIdToken = signedIn.firebaseIdToken || await getYouTubeFirebaseIdToken();
        }
        await connectReplayShareGoogle(firebaseIdToken);
        await redeemCommunityCommentInvite(link.youtubeVideoId, link.inviteCode);
        updateYouTubeReplayStatus(uiText(
            "招待を適用しました。リプレイを読み込んでいます…",
            "Invite applied. Loading the replay…",
        ));
        const loaded = await loadReplayShare(youtubeUrl);
        replayButton.click();
        await setYouTubeReplay(loaded);
        updateYouTubeReplayStatus(uiText(
            "招待を適用し、共有リプレイを開きました。",
            "Invite applied and shared replay opened.",
        ));
        console.info("[replay-deep-link] shared replay opened", { videoId: link.youtubeVideoId });
    } finally {
        replayDeepLinkTransitionActive = false;
    }
}

function enqueueReplayDeepLink(value: string): void {
    replayDeepLinkQueue = replayDeepLinkQueue
        .catch(() => {})
        .then(() => openReplayDeepLink(value))
        .catch((error) => {
            console.error("[replay-deep-link] failed", error);
            updateYouTubeReplayStatus(error instanceof Error ? error.message : String(error), true);
        });
}

async function bindReplayDeepLinks(): Promise<void> {
    const bridge = getBridge();
    if (!bridge?.deepLink) return;
    await listen<string>("ReplayDeepLinkOpened", ({ payload }) => enqueueReplayDeepLink(payload));
    const pending = await bridge.deepLink.rendererReady();
    for (const value of pending) enqueueReplayDeepLink(value);
}

function readYouTubeReplayHistory(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(YOUTUBE_REPLAY_HISTORY_STORAGE_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return [...new Set(parsed.filter((value): value is string => (
            typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value)
        )))].slice(0, YOUTUBE_REPLAY_HISTORY_LIMIT);
    } catch (error) {
        console.warn("[youtube-replay] could not read replay history", error);
        return [];
    }
}

async function runDeletedYouTubeReplayCleanup(): Promise<void> {
    if (!hasYouTubeUploadHistory()) return;
    try {
        const deletedVideoIds = await cleanupDeletedReplayShares();
        removeYouTubeUploadsByVideoIds(deletedVideoIds);
        for (const videoId of deletedVideoIds) removeYouTubeReplayHistoryItem(videoId);
        if (deletedVideoIds.length > 0) console.info(`[youtube-replay] removed ${deletedVideoIds.length} deleted YouTube share(s)`);
    } catch (error) {
        // Offline, signed-out, missing-scope, and temporarily unavailable API
        // states are expected. Never remove data unless the check succeeds.
        console.info("[youtube-replay] automatic cleanup skipped", error);
    }
}

function writeYouTubeReplayHistory(videoIds: string[]): void {
    try {
        localStorage.setItem(
            YOUTUBE_REPLAY_HISTORY_STORAGE_KEY,
            JSON.stringify(videoIds.slice(0, YOUTUBE_REPLAY_HISTORY_LIMIT)),
        );
    } catch (error) {
        console.warn("[youtube-replay] could not save replay history", error);
    }
}

function rememberYouTubeReplay(videoId: string): void {
    writeYouTubeReplayHistory([videoId, ...readYouTubeReplayHistory().filter((id) => id !== videoId)]);
}

function updateYouTubeReplayHistoryVisibility(): void {
    const history = document.querySelector<HTMLUListElement>("#youtube-replay-history");
    const header = document.querySelector<HTMLElement>("#youtube-replay-history-header");
    if (!history || !header) return;
    const hasItems = history.childElementCount > 0;
    history.hidden = !hasItems;
    header.hidden = !hasItems;
}

function removeYouTubeReplayHistoryItem(videoId: string): void {
    const history = document.querySelector<HTMLUListElement>("#youtube-replay-history");
    const item = Array.from(history?.querySelectorAll<HTMLElement>("[data-shared-replay-id]") ?? [])
        .find((candidate) => candidate.dataset.sharedReplayId === videoId);
    const wasActive = item?.classList.contains("active") ?? false;
    item?.remove();
    writeYouTubeReplayHistory(readYouTubeReplayHistory().filter((id) => id !== videoId));
    if (wasActive) ui.setActiveVideoId(null);
    updateYouTubeReplayHistoryVisibility();
}

function clearYouTubeReplayHistory(): void {
    youtubeReplayHistoryRestoreGeneration++;
    document.querySelector<HTMLUListElement>("#youtube-replay-history")?.replaceChildren();
    writeYouTubeReplayHistory([]);
    ui.setActiveVideoId(null);
    updateYouTubeReplayHistoryVisibility();
}

function initializeYouTubeUiComparison(): void {
    const panel = document.querySelector<HTMLElement>("#youtube-ui-comparison");
    const checkbox = document.querySelector<HTMLInputElement>("#youtube-ui-comparison-enabled");
    if (!panel || !checkbox) return;

    panel.hidden = false;
    checkbox.checked = true;

    const setEnabled = async (enabled: boolean): Promise<void> => {
        player.el().classList.toggle("youtube-ui-comparison", enabled);
        const result = await (window as any).leagueRecord?.youtubeComparison?.setEnabled(enabled);
        console.info("[youtube-replay] YouTube UI hidden", result ?? { enabled });
    };

    checkbox.addEventListener("change", async () => {
        checkbox.blur();
        player.el().focus({ preventScroll: true });
        try {
            await setEnabled(checkbox.checked);
        } catch (error) {
            checkbox.checked = false;
            player.el().classList.remove("youtube-ui-comparison");
            console.error("[youtube-replay] YouTube UI toggle failed", error);
            updateYouTubeReplayStatus(uiText("YouTube UI表示を切り替えられませんでした。", "Could not toggle the YouTube UI."), true);
        }
    });

    void setEnabled(true).catch((error) => {
        console.error("[youtube-replay] initial YouTube UI setup failed", error);
    });
}

function ensureYouTubeTechLoaded(): void {
    if (!videojs.getTech("Youtube")) {
        throw new Error("Video.jsにYouTubeプレイヤーを登録できませんでした。");
    }
    // videojs-youtube calls Object.keys(customVars) whenever this option is
    // present. Video.js may normalize an omitted value to null, so always
    // provide a real object before the YouTube tech is instantiated.
    const youtubeOptions = ((player.options_ as any).youtube ??= {});
    youtubeOptions.ytControls = 0;
    youtubeOptions.disablekb = 1;
    youtubeOptions.fs = 0;
    youtubeOptions.customVars = {
        ...(youtubeOptions.customVars ?? {}),
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
    };

    // video.js constructs the tech options later and can still turn an
    // absent customVars value into null. Guard the library boundary as
    // well, immediately before videojs-youtube calls Object.keys().
    const youtubeTech = videojs.getTech("Youtube") as any;
    if (!youtubeTech) {
        throw new Error("Video.jsにYouTubeプレイヤーを登録できませんでした。");
    }
    if (youtubeTech.prototype?.createEl && !youtubeTech.prototype.__leagueRecordLayoutGuard) {
        const createEl = youtubeTech.prototype.createEl;
        youtubeTech.prototype.createEl = function(this: unknown, ...args: unknown[]) {
            const element = createEl.apply(this, args) as HTMLElement;
            element.classList.add("lr-youtube-tech-wrapper");
            return element;
        };
        youtubeTech.prototype.__leagueRecordLayoutGuard = true;
    }
    if (youtubeTech?.prototype?.initYTPlayer && !youtubeTech.prototype.__leagueRecordCustomVarsGuard) {
        const initYTPlayer = youtubeTech.prototype.initYTPlayer;
        youtubeTech.prototype.initYTPlayer = function(this: { options_?: { customVars?: unknown } }, ...args: unknown[]) {
            if (!this.options_ || typeof this.options_.customVars !== "object" || this.options_.customVars === null) {
                this.options_ = { ...(this.options_ ?? {}), customVars: {} };
            }
            return initYTPlayer.apply(this, args);
        };
        youtubeTech.prototype.__leagueRecordCustomVarsGuard = true;
    }
    if (!player.options_.techOrder.includes("youtube")) {
        player.options_.techOrder.push("youtube");
    }
    console.info("[youtube-replay] YouTube tech ready", { techOrder: player.options_.techOrder });
}

function perfNowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function releasePlayerSourceForDelete() {
    try {
        player.pause();
    } catch {}
    try {
        player.src("");
    } catch {}
    try {
        const techEl = (player as any).tech?.(true)?.el?.() as HTMLVideoElement | undefined;
        if (techEl) {
            techEl.pause();
            techEl.removeAttribute("src");
            techEl.load();
        }
    } catch {}
    try {
        (player as any).load?.();
    } catch {}
}

async function prepareVideoForDelete(videoId: string, forceWait: boolean = false): Promise<void> {
    const activeVideoId = ui.getActiveVideoId();
    if (activeVideoId && videoIdsMatch(activeVideoId, videoId)) {
        preferredActiveVideoId = null;
        ui.setActiveVideoId(null);
        releasePlayerSourceForDelete();
        await delay(350);
        return;
    }
    if (forceWait) {
        await delay(350);
    }
}

function logPerf(label: string, startedAtMs: number): void {
    const PERF_LOG_ENABLED = false;
    if (!PERF_LOG_ENABLED) return;
    const elapsedMs = perfNowMs() - startedAtMs;
    console.log(`[perf] ${label}: ${elapsedMs.toFixed(1)}ms`);
}

function seekDiagnosticsEnabled(): boolean {
    try {
        return window.localStorage.getItem("lr.seekDiagnostics") === "1";
    } catch {
        return false;
    }
}

function installSeekDiagnostics(): void {
    let lastSeekRequest: { at: number; target: number; method: string } | null = null;
    const log = (message: string) => {
        if (seekDiagnosticsEnabled()) {
            console.log(`[seek-diagnostics] ${message}`);
        }
    };

    window.addEventListener("lr:seek-requested", (event) => {
        const detail = (event as CustomEvent<{ target?: number; method?: string }>).detail ?? {};
        lastSeekRequest = {
            at: perfNowMs(),
            target: Number(detail.target ?? NaN),
            method: String(detail.method ?? "unknown"),
        };
        log(`requested method=${lastSeekRequest.method} target=${lastSeekRequest.target.toFixed(3)} current=${(player.currentTime() ?? 0).toFixed(3)}`);
    });

    player.on("seeking", () => {
        if (!lastSeekRequest) {
            log(`seeking current=${(player.currentTime() ?? 0).toFixed(3)}`);
            return;
        }
        log(`seeking +${(perfNowMs() - lastSeekRequest.at).toFixed(1)}ms current=${(player.currentTime() ?? 0).toFixed(3)}`);
    });

    player.on("seeked", () => {
        if (!lastSeekRequest) {
            log(`seeked current=${(player.currentTime() ?? 0).toFixed(3)}`);
            return;
        }
        log(`seeked +${(perfNowMs() - lastSeekRequest.at).toFixed(1)}ms target=${lastSeekRequest.target.toFixed(3)} current=${(player.currentTime() ?? 0).toFixed(3)}`);
    });

    player.on("waiting", () => {
        log(`waiting current=${(player.currentTime() ?? 0).toFixed(3)}`);
    });

    player.on("playing", () => {
        if (!lastSeekRequest) return;
        log(`playing +${(perfNowMs() - lastSeekRequest.at).toFixed(1)}ms current=${(player.currentTime() ?? 0).toFixed(3)}`);
    });

    if (seekDiagnosticsEnabled()) {
        log("enabled");
    }
}

function metadataDataSignature(data: any): string {
    if (!data) return "null";
    if ("NoData" in data) return "NoData";
    if ("Metadata" in data) {
        const m = data.Metadata;
        const eventCount = Array.isArray(m.events) ? m.events.length : 0;
        const lastEventTs = eventCount > 0 ? Number(m.events[eventCount - 1]?.timestamp ?? -1) : -1;
        const participantKey = Array.isArray(m.participants)
            ? m.participants.map((p: any) => `${p.participantId}:${p.championId}:${p.honorReceived ? 1 : 0}`).join("|")
            : "";
        const highlightsCount = Array.isArray(m.highlights) ? m.highlights.length : 0;
        const tftRoundCount = Array.isArray(m.tftRoundMarkers) ? m.tftRoundMarkers.length : 0;
        const lastTftRound = tftRoundCount > 0 ? `${m.tftRoundMarkers[tftRoundCount - 1]?.round}:${m.tftRoundMarkers[tftRoundCount - 1]?.timestamp}` : "";
        return `Metadata|pid=${m.participantId}|pc=${m.participants?.length ?? 0}|p=${participantKey}|ev=${eventCount}|last=${lastEventTs}|hi=${highlightsCount}|tft=${tftRoundCount}:${lastTftRound}|q=${m.queue?.id ?? 0}|gv=${m.gameVersion ?? ""}`;
    }
    if ("Deferred" in data) {
        const d = data.Deferred;
        const eventCount = Array.isArray(d.events) ? d.events.length : 0;
        const lastEventTs = eventCount > 0 ? Number(d.events[eventCount - 1]?.timestamp ?? -1) : -1;
        const participantKey = Array.isArray(d.participants)
            ? d.participants.map((p: any) => `${p.participantId}:${p.championId}:${p.honorReceived ? 1 : 0}`).join("|")
            : "";
        const highlightsCount = Array.isArray(d.highlights) ? d.highlights.length : 0;
        const tftRoundCount = Array.isArray(d.tftRoundMarkers) ? d.tftRoundMarkers.length : 0;
        const lastTftRound = tftRoundCount > 0 ? `${d.tftRoundMarkers[tftRoundCount - 1]?.round}:${d.tftRoundMarkers[tftRoundCount - 1]?.timestamp}` : "";
        return `Deferred|pc=${d.participants?.length ?? 0}|p=${participantKey}|ev=${eventCount}|last=${lastEventTs}|hi=${highlightsCount}|tft=${tftRoundCount}:${lastTftRound}|off=${d.ingameTimeRecStartOffset ?? 0}`;
    }
    return "unknown";
}

function armManualStartPending() {
    manualStartPending = true;
    if (manualStartPendingTimeout) {
        clearTimeout(manualStartPendingTimeout);
    }
    manualStartPendingTimeout = setTimeout(() => {
        manualStartPending = false;
        manualStartPendingTimeout = null;
    }, 15000);
}

function clearManualStartPending() {
    manualStartPending = false;
    if (manualStartPendingTimeout) {
        clearTimeout(manualStartPendingTimeout);
        manualStartPendingTimeout = null;
    }
}

function clearMetadataRetry(videoId: string) {
    const key = normalizeVideoId(videoId);
    const timeout = metadataRetryTimeouts.get(key);
    if (timeout) {
        clearTimeout(timeout);
        metadataRetryTimeouts.delete(key);
    }
}

async function flushRecordingsChangedRefresh() {
    if (recordingsChangedRefreshInFlight) {
        recordingsChangedRefreshQueued = true;
        return;
    }

    recordingsChangedRefreshInFlight = true;
    try {
        do {
            recordingsChangedRefreshQueued = false;
            await updateSidebar();
        } while (recordingsChangedRefreshQueued);
    } finally {
        recordingsChangedRefreshInFlight = false;
    }
}

function scheduleRecordingsChangedRefresh(delayMs: number = 120) {
    if (recordingsChangedRefreshTimer) {
        clearTimeout(recordingsChangedRefreshTimer);
    }
    recordingsChangedRefreshTimer = setTimeout(() => {
        recordingsChangedRefreshTimer = null;
        void flushRecordingsChangedRefresh();
    }, delayMs);
}

function suppressRecordingsChangedEventsFor(ms: number = 3000) {
    suppressRecordingsChangedUntil = Date.now() + ms;
}

async function getRecordingsSizeCached(forceRefresh: boolean = false): Promise<number> {
    const now = Date.now();
    const cacheFresh = now - recordingsSizeCacheUpdatedAt < RECORDINGS_SIZE_CACHE_MS;
    if (!forceRefresh && cacheFresh) {
        return cachedRecordingsSizeGb;
    }

    if (recordingsSizeFetchInFlight) {
        return recordingsSizeFetchInFlight;
    }

    recordingsSizeFetchInFlight = commands
        .getRecordingsSize()
        .then((size) => {
            cachedRecordingsSizeGb = size;
            recordingsSizeCacheUpdatedAt = Date.now();
            return size;
        })
        .catch((error) => {
            console.warn("Failed to refresh recordings size, using cached value:", error);
            return cachedRecordingsSizeGb;
        })
        .finally(() => {
            recordingsSizeFetchInFlight = null;
        });

    return recordingsSizeFetchInFlight;
}

function scheduleMetadataRetry(videoId: string, attemptsLeft: number = 4, delayMs: number = 700) {
    const key = normalizeVideoId(videoId);
    clearMetadataRetry(key);
    if (attemptsLeft <= 0) {
        return;
    }

    const timeout = setTimeout(async () => {
        metadataRetryTimeouts.delete(key);

        // Only retry for the currently selected recording.
        const activeVideoId = preferredActiveVideoId ?? ui.getActiveVideoId();
        if (!activeVideoId || !videoIdsMatch(activeVideoId, key)) {
            return;
        }

        const completed = await setMetadata(activeVideoId);
        if (!completed) {
            scheduleMetadataRetry(activeVideoId, attemptsLeft - 1, delayMs);
        }
    }, delayMs);

    metadataRetryTimeouts.set(key, timeout);
}

const VIDEO_JS_OPTIONS = {
    // fluid: true, // - Removed
    // fill: true, // - Removed
    // aspectRatio: "16:9", // - Removed
    playbackRates: [0.5, 1, 1.5, 2],
    // Register the YouTube tech lazily when a shared URL is actually opened.
    techOrder: ["html5"],
    autoplay: false,
    controls: true,
    preload: "auto",
    enableSourceset: true,
    notSupportedMessage: " ",
    userActions: {
        doubleClick: false,
    },
    bigPlayButton: false,
    youtube: {
        ytControls: false,
        enablePrivacyEnhancedMode: true,
        playsinline: 1,
        customVars: {},
    },
    controlBar: {
        volumePanel: { inline: false }, // Horizontal=inline:true. Vertical=inline:false
        currentTimeDisplay: false, // User requested hide
        timeDivider: false, // User requested hide
        durationDisplay: false, // User requested hide
        remainingTimeDisplay: false, // Hide remaining time
        liveDisplay: false, // Hide Live
        pictureInPictureToggle: false,
        subsCapsButton: false, // Hide CC
        audioTrackButton: false,
        descriptionsButton: false,
        chaptersButton: false, // Hide Chapters
    },
};

const player = videojs("video_player", VIDEO_JS_OPTIONS) as Player & {
    markers: (settings?: Settings) => MarkersPlugin;
};
ui.setPlayer(player); // Pass player instance to UI
const reviewComments = new ReviewCommentsController(player);
installSeekDiagnostics();

// Video.js hides the vertical volume control as soon as the pointer leaves the
// small mute button. Keep it visible for the entire drag, including when the
// pointer is over the popup itself or outside the button bounds.
function installVolumeDragVisibility(): void {
    const playerEl = player.el();
    if ((playerEl as HTMLElement).dataset.lrVolumeDragVisibilityInstalled === "true") return;
    (playerEl as HTMLElement).dataset.lrVolumeDragVisibilityInstalled = "true";

    const finishVolumeDrag = () => {
        const panel = playerEl.querySelector(".vjs-volume-panel") as HTMLElement | null;
        panel?.classList.remove("lr-volume-dragging");
        window.removeEventListener("pointerup", finishVolumeDrag, true);
        window.removeEventListener("pointercancel", finishVolumeDrag, true);
        window.removeEventListener("mouseup", finishVolumeDrag, true);
        window.removeEventListener("blur", finishVolumeDrag);
    };
    const startVolumeDrag = (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest(".vjs-volume-control.vjs-volume-vertical")) return;
        const panel = playerEl.querySelector(".vjs-volume-panel") as HTMLElement | null;
        if (!panel) return;
        panel.classList.add("lr-volume-dragging");
        window.addEventListener("pointerup", finishVolumeDrag, true);
        window.addEventListener("pointercancel", finishVolumeDrag, true);
        window.addEventListener("mouseup", finishVolumeDrag, true);
        window.addEventListener("blur", finishVolumeDrag);
    };

    // Capture phase is deliberate: Video.js consumes the slider's own drag
    // events before they bubble to the panel.
    playerEl.addEventListener("pointerdown", startVolumeDrag, true);
    playerEl.addEventListener("mousedown", startVolumeDrag, true);
}
installVolumeDragVisibility();
player.ready(installVolumeDragVisibility);

// Initialize Video Header
const mainContainer = document.getElementById("main");
const playerElement = document.getElementById("video_player");
if (mainContainer && playerElement) {
    ui.initVideoHeader(mainContainer, playerElement);
}

// --- Loop Controls ---
const loopStartInput = document.getElementById("loop-start") as HTMLInputElement;
const loopEndInput = document.getElementById("loop-end") as HTMLInputElement;
const loopEnabledCheckbox = document.getElementById("loop-enabled") as HTMLInputElement;
const createClipBtn = document.getElementById("create-clip-btn") as HTMLButtonElement;

let loopStart: number | null = null;
let loopEnd: number | null = null;
let isLooping = false;
let isCreatingClip = false;

function setClipButtonProgress(percent: number) {
    if (!createClipBtn) return;
    const normalized = Math.max(0, Math.min(100, Math.floor(percent)));
    createClipBtn.textContent = `[${normalized}%]`;
}

function updateClipBtnState() {
    const canCreateClip = loopStart !== null && loopEnd !== null && loopEnd > loopStart;
    if (createClipBtn) createClipBtn.disabled = remotePlaybackActive || isCreatingClip || !canCreateClip;
}

function setLoopPlaybackEnabled(enabled: boolean) {
    isLooping = enabled;
    if (loopEnabledCheckbox && loopEnabledCheckbox.checked !== enabled) {
        loopEnabledCheckbox.checked = enabled;
        loopEnabledCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

function isOutsideLoopRange(time: number): boolean {
    return (
        isLooping &&
        loopStart !== null &&
        loopEnd !== null &&
        loopEnd > loopStart &&
        (time < loopStart || time > loopEnd)
    );
}

function formatLoopTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseLoopTime(timeStr: string): number | null {
    let normalized = timeStr.replace(/[^0-9:]/g, "");
    // If no colon, try to infer from length (e.g., 2454 or 123)
    if (!normalized.includes(":") && normalized.length >= 3) {
        const minsStr = normalized.slice(0, normalized.length - 2);
        const secsStr = normalized.slice(normalized.length - 2);
        normalized = `${minsStr}:${secsStr}`;
    }

    const parts = normalized.split(":");
    if (parts.length !== 2) return null;
    const mins = parseInt(parts[0], 10);
    const secs = parseInt(parts[1], 10);
    if (isNaN(mins) || isNaN(secs)) return null;
    return mins * 60 + secs;
}

type ClipAudioMode = "game-only" | "vc-in";

function pickClipAudioMode(_tracks: ReadonlyArray<ClipAudioTrack>, lang: string): Promise<ClipAudioMode | null> {
    return new Promise((resolve) => {
        let selectedMode: ClipAudioMode = "vc-in";
        const cleanup = () => {
            document.removeEventListener("keydown", onKeyDown);
        };
        const close = (result: ClipAudioMode | null) => {
            cleanup();
            ui.hideModal();
            resolve(result);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                close(null);
            } else if (event.key === "Enter") {
                event.preventDefault();
                close(selectedMode);
            }
        };

        const title = document.createElement("p");
        title.textContent = getText(lang as any, "clipAudioTitle" as any) || "Clip Audio";

        const buttonRow = document.createElement("p");
        const gameOnlyButton = document.createElement("button");
        gameOnlyButton.className = "btn";
        gameOnlyButton.textContent = getText(lang as any, "clipAudioGameOnly" as any) || "Game Only";
        gameOnlyButton.onclick = () => {
            selectedMode = "game-only";
            close("game-only");
        };
        const vcInButton = document.createElement("button");
        vcInButton.className = "btn";
        vcInButton.textContent = getText(lang as any, "clipAudioWithVc" as any) || "With VC";
        vcInButton.onclick = () => {
            selectedMode = "vc-in";
            close("vc-in");
        };
        const cancelButton = document.createElement("button");
        cancelButton.className = "btn";
        cancelButton.textContent = getText(lang as any, "cancel" as any) || "Cancel";
        cancelButton.onclick = () => close(null);
        buttonRow.append(gameOnlyButton, vcInButton, cancelButton);

        document.addEventListener("keydown", onKeyDown);
        ui.showModal([title, buttonRow]);
    });
}

function handleTimeInput(e: Event) {
    const input = e.target as HTMLInputElement;
    let value = input.value.replace(/[^0-9]/g, "");
    if (value.length > 4) value = value.slice(0, 4);

    if (value.length >= 3) {
        const mins = value.slice(0, value.length - 2);
        const secs = value.slice(value.length - 2);
        input.value = `${mins}:${secs}`;
    } else {
        input.value = value;
    }
}

if (loopStartInput && loopEndInput && loopEnabledCheckbox) {
    loopStartInput.addEventListener("input", handleTimeInput);
    loopEndInput.addEventListener("input", handleTimeInput);

    loopStartInput.addEventListener("change", () => {
        loopStart = parseLoopTime(loopStartInput.value);
        updateClipBtnState();
    });
    loopEndInput.addEventListener("change", () => {
        loopEnd = parseLoopTime(loopEndInput.value);
        updateClipBtnState();
    });
    loopEnabledCheckbox.addEventListener("change", () => {
        isLooping = loopEnabledCheckbox.checked;
    });
}

playerElement?.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    const progressHolder = target?.closest(".vjs-progress-holder") as HTMLElement | null;
    if (!progressHolder) return;

    const duration = player.duration();
    if (typeof duration !== "number" || duration <= 0) return;

    const rect = progressHolder.getBoundingClientRect();
    if (rect.width <= 0) return;

    const seekRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const seekTime = seekRatio * duration;
    if (isOutsideLoopRange(seekTime)) {
        setLoopPlaybackEnabled(false);
    }
});

if (createClipBtn) {
    createClipBtn.onclick = async () => {
        const videoId = ui.getActiveVideoId();
        if (!videoId || loopStart === null || loopEnd === null) return;
        let playClipSound = false;
        
        try {
            isCreatingClip = true;
            createClipBtn.disabled = true;
            setClipButtonProgress(0);
            const settings = await commands.getSettings();
            playClipSound = settings.playRecordingSounds ?? false;
            const tracksResult = await commands.getClipAudioTracks(videoId);
            if (tracksResult.status === "error") {
                throw tracksResult.error;
            }

            let selectedAudioTrackIndex: number | null = null;
            if (tracksResult.data.length > 1) {
                const lang = settings.language || "en";
                const mode = await pickClipAudioMode(tracksResult.data, lang);
                if (mode === null) {
                    return;
                }
                selectedAudioTrackIndex = mode === "game-only" ? 1 : 0;
            } else if (tracksResult.data.length === 1) {
                selectedAudioTrackIndex = 0;
            }

            const clipResult = await commands.createClip(
                videoId,
                loopStart,
                loopEnd,
                selectedAudioTrackIndex === null ? null : false,
                selectedAudioTrackIndex,
            );
            if (clipResult.status === "error") {
                throw clipResult.error;
            }
            const newFile = clipResult.data;
            // Wait a bit or refresh? Ideally we should refresh the sidebar
            await  updateSidebar(); 
            if (playClipSound) playNotificationSound('clip');
            // Show simple alert using error modal for now as it's the only one available
            // Or console log.
            console.log(`Clip created: ${newFile}`);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            ui.showErrorModal(`Failed to create clip: ${message}`);
        } finally {
            isCreatingClip = false;
            createClipBtn.textContent = "Clip";
            updateClipBtnState();
        }
    };
}
// ---------------------

const keyboardHandlers = createKeyboardHandlers({
    player,
    ui,
    hasActivePlayback: () => remotePlaybackActive || ui.getActiveVideoId() !== null,
    matchesAction: (event, action) => isAction(event, action as any, currentKeybinds),
    getLoopState: () => ({ loopStart, loopEnd, isLooping }),
    setLoopState: (patch) => {
        if (patch.loopStart !== undefined) loopStart = patch.loopStart;
        if (patch.loopEnd !== undefined) loopEnd = patch.loopEnd;
        if (patch.isLooping !== undefined) isLooping = patch.isLooping;
    },
    loopStartInput,
    loopEndInput,
    loopEnabledCheckbox,
    formatLoopTime,
    updateClipBtnState,
});

console.log(MarkersPlugin);

await main();
async function main() {
    const startupStartedAt = perfNowMs();

    // Check if running in a Tauri environment
    // @ts-ignore
    if (!window.__TAURI_INTERNALS__) {
        console.warn("Tauri internals not found. Backend functionality will be disabled.");
        return;
    }


    // handle context menu based on developer mode
    const patchVersionStartedAt = perfNowMs();
    // Use the cached patch immediately. A slow Data Dragon request must never
    // hold back the first usable window.
    void initPatchVersion()
        .then(() => logPerf("startup:initPatchVersion(background)", patchVersionStartedAt))
        .catch((error) => console.warn("initPatchVersion failed during startup:", error));
    
    // Warm up DataDragon cache in background to avoid startup stalls on slow network.
    ensureDataLoaded("ja").catch((e) => console.warn("ensureDataLoaded failed during startup:", e));
    
    // --- ADDED WAD EXTRACTOR TRIGGER ---
    console.log("Initializing dynamic tooltip fallbacks...");
    setTimeout(() => {
        initTooltipFallback().catch(console.error);
    }, 1500);
    addEventListener("contextmenu", (event) => {
        // Avoid "stuck" focus/active highlight on Video.js controls after right-click.
        const active = document.activeElement as HTMLElement | null;
        if (active && typeof active.blur === "function") active.blur();
        const target = event.target as HTMLElement | null;
        if (target && typeof (target as any).blur === "function") (target as any).blur();

        // We check a global-ish flag to avoid async delay during the event
        if (!(window as any)._developerModeEnabled) {
            event.preventDefault();
        }
    });

    // configure and start marker plugin
    player.markers({
        markerTip: {
            display: false, // Temporarily disabled to prevent flickering
            innerHtml: (marker) => marker.text ?? "",
        },
        markerStyle: {
            minWidth: "2px",
            maxWidth: "16px",
            borderRadius: "0%",
        },
    });


    // Update ruler when duration is known
    player.on("loadedmetadata", () => {
        const duration = player.duration();
        if (typeof duration === "number" && duration > 0) {
            ui.createTimeRuler(duration);
        }
    });

    // Also update on durationchange in case it changes later
    player.on("durationchange", () => {
        const duration = player.duration();
        if (typeof duration === "number" && duration > 0) {
            ui.createTimeRuler(duration);
        }
    });

    player.on("sourceset", ({ src }: { src: string }) => {
        // if src is a blank string that means no recording is selected
        if (src === "") {
            player.markers().removeAll();
            ui.setActiveVideoId(null);

            // make sure the bigplaybutton and controlbar are hidden
            ui.showBigPlayButton(false);
            player.controls(false);
        } else {
            // re-show the bigplaybutton and controlbar when a new video src is set
            ui.showBigPlayButton(true);
            player.controls(true);
        }
    });

    player.on("error", () => {
        if (!remotePlaybackActive) return;
        const playerError = player.error();
        const message = String(playerError?.message || uiText("YouTube動画を再生できませんでした。", "Could not play the YouTube video."));
        console.error("[youtube-replay] Video.js player error", { code: playerError?.code, message });
        if (/disabled|101|150/i.test(message)) {
            updateYouTubeReplayStatus(uiText("この動画は所有者により埋め込み再生が許可されていません。", "The owner has disabled embedded playback for this video."), true);
        } else if (/private|find the video|100/i.test(message)) {
            updateYouTubeReplayStatus(uiText("YouTube動画が非公開、削除済み、または見つかりません。", "The YouTube video is private, deleted, or unavailable."), true);
        } else if (/153|referer|client identification/i.test(message)) {
            updateYouTubeReplayStatus(uiText("YouTubeプレイヤーのクライアント識別に失敗しました（エラー153）。", "YouTube player client identification failed (error 153)."), true);
        } else {
            updateYouTubeReplayStatus(message, true);
        }
    });

    // Loop Logic & Custom Time Display
    player.on("timeupdate", () => {
        const timeupdateStartedAt = seekDiagnosticsEnabled() ? perfNowMs() : 0;
        // Loop Logic
        if (isLooping && loopStart !== null && loopEnd !== null) {
            const current = player.currentTime();
            if (current && current >= loopEnd) {
                player.currentTime(loopStart);
                if (player.paused()) void player.play()?.catch(() => {});
            }
        }

        // --- Custom Game Time Display (Disabled) ---
        // We still need to calculate timeStr for Header and Tooltips.
        const offset = currentEvents?.recordingOffset ?? highlightEvents?.recordingOffset ?? 0;
        
        const current = player.currentTime() || 0;
        // const duration = player.duration() || 0; // Unused if we don't show full text
        
        const gameTime = current + offset + 0.15;
        
        const curMins = Math.floor(gameTime / 60);
        const curSecs = Math.floor(gameTime % 60);
        
        const timeStr = `${curMins}:${curSecs.toString().padStart(2, '0')}`;
        
        // Sync Header Time
        ui.updateHeaderTime(timeStr);

        // Also override the drag-handle tooltip (on the play head)
        const progressTooltip = document.querySelector(".vjs-play-progress .vjs-time-tooltip");
        if (progressTooltip) {
             progressTooltip.textContent = timeStr;
        }
        if (timeupdateStartedAt) {
            const elapsed = perfNowMs() - timeupdateStartedAt;
            if (elapsed > 8) {
                console.log(`[seek-diagnostics] main timeupdate ${elapsed.toFixed(1)}ms current=${current.toFixed(3)}`);
            }
        }
    });

    initializeProgressTooltips({
        player,
        playerElement,
        getRecordingOffset: () => currentEvents?.recordingOffset ?? highlightEvents?.recordingOffset ?? 0,
    });

    initializeMarkerHoverTooltips({
        playerElement,
        getMarkerDetails: () => markerDetails,
        getParticipants: () => currentEvents?.participants,
        getSelfParticipantId: () => currentEvents?.participantId ?? 0,
    });

    // add events to html elements
    ui.setRefreshBtnOnClickHandler(() => {
        window.location.reload();
    });
    ui.setRecordingsFolderBtnOnClickHandler(commands.openRecordingsFolder);
    ui.setSettingsBtnOnClickHandler(() => {
        commands.getSettings().then(settings => {
             const previousLanguage = settings.language || "en";
             ui.showSettingsModal(settings, async (s) => { 
                 await commands.saveSettings(s); 
                 
                 // Update developer mode state
                 (window as any)._developerModeEnabled = s.developerMode;
                 if (s.developerMode) {
                     document.body.classList.add("selectable");
                 } else {
                     document.body.classList.remove("selectable");
                 }

                 const markerFlagsChanged =
                     settings.markerFlags.kill !== s.markerFlags.kill ||
                     settings.markerFlags.death !== s.markerFlags.death ||
                     settings.markerFlags.assist !== s.markerFlags.assist ||
                     settings.markerFlags.structure !== s.markerFlags.structure ||
                     settings.markerFlags.dragon !== s.markerFlags.dragon ||
                     settings.markerFlags.voidgrub !== s.markerFlags.voidgrub ||
                     settings.markerFlags.herald !== s.markerFlags.herald ||
                     settings.markerFlags.baron !== s.markerFlags.baron;
                 if (markerFlagsChanged) {
                     changeMarkers();
                 }

                 const scoreboardLinksChanged =
                     settings.matchHistoryBaseUrl !== s.matchHistoryBaseUrl ||
                     (settings as any).matchHistorySubUrl !== (s as any).matchHistorySubUrl ||
                     settings.championWikiBaseUrl !== s.championWikiBaseUrl ||
                     (settings as any).championWikiSubUrl !== (s as any).championWikiSubUrl ||
                     settings.championMatchupUrl !== s.championMatchupUrl ||
                     (settings as any).championMatchupSubUrl !== (s as any).championMatchupSubUrl ||
                     settings.championBuildUrl !== s.championBuildUrl ||
                     (settings as any).championBuildSubUrl !== (s as any).championBuildSubUrl ||
                     (settings as any).scoreboardLinkModifier !== (s as any).scoreboardLinkModifier;
                 if (scoreboardLinksChanged) {
                     const activeVideoId = preferredActiveVideoId ?? ui.getActiveVideoId();
                     if (activeVideoId) {
                         metadataRenderSignatures.delete(normalizeVideoId(activeVideoId));
                         void setMetadata(activeVideoId);
                     }
                 }

                 const languageChanged = previousLanguage !== (s.language || "en");
                 if (languageChanged) {
                     ui.setCurrentLanguage(s.language || "en");
                     const activeVideoId = preferredActiveVideoId ?? ui.getActiveVideoId();
                     if (activeVideoId) {
                         metadataRenderSignatures.delete(normalizeVideoId(activeVideoId));
                         void setMetadata(activeVideoId);
                     }
                     setTimeout(() => {
                         window.location.reload();
                     }, 350);
                 }

                 const recordingsPathChanged =
                     settings.recordingsFolder !== s.recordingsFolder ||
                     settings.clipsFolder !== s.clipsFolder;
                 if (recordingsPathChanged || languageChanged) {
                     setTimeout(() => {
                         void updateSidebar();
                     }, 250);
                 }
             });
             return null;
        });
    });
    ui.setCheckboxOnClickHandler(() => {
        changeMarkers();
        commands.setMarkerFlags(ui.getMarkerFlags());
    });
    bindYouTubeReplaySidebar({
        loadReplay: async (url) => {
            const loaded = await loadReplayShare(url);
            await setYouTubeReplay(loaded);
            return loaded;
        },
        refreshOwnedReplays: refreshOwnedYouTubeReplays,
    });
    void bindReplayDeepLinks();
    document.querySelector<HTMLButtonElement>("#youtube-replay-history-clear")?.addEventListener("click", () => {
        clearYouTubeReplayHistory();
    });
    const restore = restoreYouTubeReplayHistory();
    void restore.finally(() => {
        void runDeletedYouTubeReplayCleanup();
    });
    window.addEventListener(YOUTUBE_AUTH_CHANGED_EVENT, () => {
        void runDeletedYouTubeReplayCleanup();
        if (document.querySelector<HTMLButtonElement>("#youtube-replay-owned-tab")?.getAttribute("aria-selected") === "true") {
            void refreshOwnedYouTubeReplays();
        }
    });
    initializeYouTubeUiComparison();
    // ui.setShowTimestampsOnClickHandler(showTimestamps);

    // listen if the videojs player fills the whole window
    // and keep the tauri fullscreen setting in sync
    addEventListener("fullscreenchange", (_e) => {
        const isFullscreen = !!document.fullscreenElement;
        ui.setFullscreen(isFullscreen);
        // Force background color change to separate JS thread from CSS rendering layout
        // to ensure no "theme-color" or window background shows through.
        document.documentElement.style.backgroundColor = isFullscreen ? "black" : "";
        document.body.style.backgroundColor = isFullscreen ? "black" : "";
    });

    // handle keybord shortcuts
    // handle keybord shortcuts
    addEventListener("keydown", keyboardHandlers.handleKeyDown, true);
    addEventListener("keyup", keyboardHandlers.handleKeyUp, true);

    // Mouse Controls (Wheel & Middle Click)
    const playerEl = document.getElementById("video_player");
    if (playerEl) {
        playerEl.addEventListener("wheel", (e: WheelEvent) => {
            if (currentMouseConfig.wheelAction === "speed") {
                e.preventDefault();
                // DeltaY negative means scrolling up (speed up)
                const direction = e.deltaY < 0 ? 1 : -1;
                let newRate = player.playbackRate()! + (direction * 0.1);
                
                // Clamp between 0.1 and 4.0 (arbitrary reasonable limits)
                newRate = Math.min(Math.max(newRate, 0.1), 4.0);
                
                // Fix floating point precision issues (e.g. 1.1000000001)
                newRate = Math.round(newRate * 10) / 10;
                
                player.playbackRate(newRate);
            }
        }, { passive: false });

        playerEl.addEventListener("auxclick", (e: MouseEvent) => {
            // Button 1 is Middle Click
            if (e.button === 1 && currentMouseConfig.middleClickAction === "resetSpeed") {
                e.preventDefault();
                player.playbackRate(1.0);
            }
        });
    }

    const listenerManager = new ListenerManager();
    listenerManager.listen_app("RecordingsChanged", () => {
        if (Date.now() < suppressRecordingsChangedUntil) {
            return;
        }
        scheduleRecordingsChangedRefresh();
    });
    listenerManager.listen_app("MarkerflagsChanged", () =>
        commands.getMarkerFlags().then((flags) => ui.setMarkerFlags(flags)),
    );
    listenerManager.listen_app("MetadataChanged", async ({ payload }) => {
        const activeVideoId = preferredActiveVideoId ?? ui.getActiveVideoId();
        scheduleRecordingsChangedRefresh(1500);

        // 2. Active Video Update (Refresh Detail View)
        // Backend sends filename (e.g. "video.mp4"), Frontend activeVideoId is Full Path.
        // We check if the active ID *contains* one of the payload IDs.
        if (activeVideoId !== null && payload.some(id => videoIdsMatch(activeVideoId, id))) {
            console.log("MetadataChanged event received for active video. Reloading.");
            // update metadata for currently selected recording
            void setMetadata(activeVideoId);
        }
    });
    listenerManager.listen_app("ClipProgress", ({ payload }) => {
        if (!isCreatingClip) return;
        setClipButtonProgress(payload.percent);
    });
    
    listenerManager.listen_app("RecordingStarted", () => {
        if (manualStartPending) {
            clearManualStartPending();
            return;
        }
        commands.getSettings().then(settings => {
            if (settings.playRecordingSounds) playNotificationSound('start');

        });
    });

    listenerManager.listen_app("ManualRecordingStarted", () => {
        armManualStartPending();
        commands.getSettings().then(settings => {
            if (settings.playRecordingSounds) playNotificationSound('start');
        });
    });

    listenerManager.listen_app("ManualRecordingStopped", () => {
        clearManualStartPending();
        commands.getSettings().then(settings => {
            if (settings.playRecordingSounds) playNotificationSound('stop');
        });
    });

    listenerManager.listen_app("GameDetected", () => {
        // GameDetected fires at loading screen start – no action needed for auto stop here.
        console.log("GameDetected: loading screen started.");
    });

    listenerManager.listen_app("GameStarted", () => {
        commands.getSettings().then(settings => {
            if (settings.autoStopPlayback) {
                player.pause();
                console.log("Auto-stopped playback: game started (loading finished).");
            }
        });
    });

    listenerManager.listen_app("RecordingFinished", ({ payload }) => {
        const [videoId, isManualStop] = payload;
        suppressRecordingsChangedEventsFor(8000);
        scheduleRecordingsChangedRefresh(2500);
        commands.getSettings().then(settings => {
            if (settings.playRecordingSounds && !isManualStop) playNotificationSound('stop');
        });
        
        // Check if we are currently viewing this video (e.g. user clicked it while recording)
        const activeId = ui.getActiveVideoId();
        
        if (!isManualStop) {
             commands.getSettings().then(async settings => {
                 if (settings.autoSelectRecording) {
                     let fullPath = videoId;
                     if (!videoId.includes("\\") && !videoId.includes("/")) {
                         try {
                            fullPath = await join(settings.recordingsFolder, videoId);
                         } catch (e) {
                             console.error("Failed to join path:", e);
                         }
                     }

                     console.log(`Auto-selecting recording: ${fullPath}`);
                     
                     // Standard delay to ensure file handle release
                     setTimeout(async () => {
                         // Force metadata update if already active (e.g. user clicked early)
                         if (activeId && videoIdsMatch(activeId, fullPath)) {
                             console.log("Recording finished for active video. Forcing initial metadata reload.");
                             const completed = await setMetadata(activeId);
                             if (!completed) {
                                 scheduleMetadataRetry(activeId);
                             }
                         }
                         // setVideo might return early if ID matches, but that's fine if we called setMetadata above.
                         // Crucially, rely on MetadataChanged event for the FINAL update.
                         void setVideo(fullPath);
                     }, 500);
                 } else {
                     // Auto-select OFF
                     const settingsVals = await commands.getSettings();
                     let fullPath = videoId;
                     if (!videoId.includes("\\") && !videoId.includes("/")) {
                         try {
                            fullPath = await join(settingsVals.recordingsFolder, videoId);
                         } catch (e) {}
                     }
                     if (activeId && videoIdsMatch(activeId, fullPath)) {
                          console.log("Recording finished for active video (Auto-select OFF). Forcing metadata reload.");
                          const completed = await setMetadata(activeId);
                          if (!completed) {
                              scheduleMetadataRetry(activeId);
                          }
                     }
                 }

                 if (settings.autoPopupOnEnd) {
                     console.log("Auto-popup triggered");
                     ui.showWindow();
                     ui.setFullscreen(false); 
                 }
             });
        } else {
             // Manual stop also needs reload if active
             const activeId = ui.getActiveVideoId();
             if (activeId && videoId) {
                 // Check match (simple includes check for safety if paths differ)
                 if (videoIdsMatch(activeId, videoId)) {
                      console.log("Manual stop for active video. Forcing metadata reload.");
                      void setMetadata(activeId);
                 }
             }
        }
    });

    // load data
    commands.getMarkerFlags().then(ui.setMarkerFlags);

    // Initialize Auto Buttons
    commands.getSettings().then(async settings => {
        ui.updateAutoStopBtn(settings.autoStopPlayback);
        ui.updateAutoPlayBtn(settings.autoplayVideo);
        ui.updateAutoSelectBtn(settings.autoSelectRecording);
        ui.setAutoPopupState(settings.autoPopupOnEnd);
        (window as any)._developerModeEnabled = settings.developerMode;
        
        if (settings.developerMode) {
            document.body.classList.add("selectable");
        } else {
            document.body.classList.remove("selectable");
        }

        // --- Startup Update Check ---
        // Use sessionStorage to ensure it only runs once per actual app launch, not on every F5 refresh
        if (settings.checkUpdatesOnStartup && !sessionStorage.getItem("hasCheckedForUpdates")) {
            sessionStorage.setItem("hasCheckedForUpdates", "true");
            try {
                const { check } = await import("./platform/updater");
                const update = await check();
                if (update) {
                    ui.showUpdateModal(update, settings.language || "ja");
                }
            } catch (e: any) {
                // Ignore remote update check failures in dev/unconfigured environments
                if (!e?.toString()?.includes("release JSON")) {
                    console.error("Startup update check failed:", e);
                }
            }
        }
    });

    ui.setAutoStopBtnOnClickHandler((e) => {
        const checked = (e.target as HTMLInputElement).checked;
        commands.getSettings().then(settings => {
            const newSettings = { ...settings, autoStopPlayback: checked };
            commands.saveSettings(newSettings).then(() => {
                 ui.updateAutoStopBtn(newSettings.autoStopPlayback);
            });
        });
    });

    ui.setAutoPlayBtnOnClickHandler((e) => {
        const checked = (e.target as HTMLInputElement).checked;
        commands.getSettings().then(settings => {
            const newSettings = { ...settings, autoplayVideo: checked };
            commands.saveSettings(newSettings).then(() => {
                 ui.updateAutoPlayBtn(newSettings.autoplayVideo);
            });
        });
    });

    ui.setAutoSelectBtnOnClickHandler((e) => {
        const checked = (e.target as HTMLInputElement).checked;
        commands.getSettings().then(settings => {
            const newSettings = { ...settings, autoSelectRecording: checked };
            commands.saveSettings(newSettings).then(() => {
                 ui.updateAutoSelectBtn(newSettings.autoSelectRecording);
            });
        });
    });

    ui.setAutoPopupOnClickHandler((e) => {
        const checked = (e.target as HTMLInputElement).checked;
        commands.getSettings().then(settings => {
            const newSettings = { ...settings, autoPopupOnEnd: checked };
            commands.saveSettings(newSettings).then(() => {
                ui.setAutoPopupState(newSettings.autoPopupOnEnd);
            });
        });
    });

    // Mouse Navigation for Seeking (Back = Rewind, Forward = Skip)
    window.addEventListener('mouseup', (e) => {
        const mouseConfig = loadMouseConfig();
        if (!mouseConfig.sideButtonSeek) return;

        if (e.button === 3) { // Back button
            e.preventDefault();
            // Seek back 5 seconds
            const newTime = Math.max(0, (player.currentTime() || 0) - 5);
            player.currentTime(newTime);
        } else if (e.button === 4) { // Forward button
            e.preventDefault();
            // Seek forward 5 seconds
            const duration = player.duration() || 0;
            const newTime = Math.min(duration, (player.currentTime() || 0) + 5);
            player.currentTime(newTime);
        }
    });

    const initialSidebarStartedAt = perfNowMs();
    const videoIds = await updateSidebar();
    logPerf("startup:updateSidebar(initial)", initialSidebarStartedAt);
    checkLatestAndRetry(videoIds);
    const firstVideo = videoIds.find((v: Recording) => v.videoExists);
    if (firstVideo && !replayDeepLinkTransitionActive && !remotePlaybackActive) {
        void (async () => {
            const initialSetVideoStartedAt = perfNowMs();
            await setVideo(firstVideo.videoId, false);
            logPerf("startup:setVideo(first)", initialSetVideoStartedAt);
        })();
        player.one("canplay", ui.showWindow);
    } else {
        if (!replayDeepLinkTransitionActive && !remotePlaybackActive) void setVideo(null);
        player.one("ready", ui.showWindow);
    }

    logPerf("startup:main(init path)", startupStartedAt);
}

// --- SIDEBAR, VIDEO PLAYER, DESCRIPTION  ---

// use this function to update the sidebar
async function updateSidebar(forceUpdateIds: string[] = []): Promise<Recording[]> {
    const startedAt = perfNowMs();
    const recordings = await refreshSidebar({
        ui,
        forceUpdateIds,
        getRecordingsList: commands.getRecordingsList,
        getRecordingsSize: () => getRecordingsSizeCached(false),
        setVideo,
        toggleFavorite: commands.toggleFavorite,
        showRenameModal,
        showDeleteModal,
        handleDeleteVideoOnly,
    });
    if (preferredActiveVideoId) {
        const matched = recordings.find((r) => videoIdsMatch(r.videoId, preferredActiveVideoId!));
        if (matched) {
            preferredActiveVideoId = matched.videoId;
            ui.setActiveVideoId(matched.videoId);
        }
    }
    logPerf(`updateSidebar(forceIds=${forceUpdateIds.length})`, startedAt);
    return recordings;
}

function checkLatestAndRetry(recordings: Recording[]) {
    const retryId = getLatestRetryVideoId(recordings);
    if (retryId) {
        console.log(`Latest recording ${retryId} is Unknown. Scheduling retries...`);
        retrySidebarUpdate(3, retryId);
    }
}

async function retrySidebarUpdate(attemptsLeft: number, targetId: string) {
    retrySidebarUpdateLoop({
        attemptsLeft,
        targetId,
        updateSidebar,
        resolveRetryState: getRetryState,
        delayMs: 1000,
    });
}


// use this function to set the video (null => no video)
async function setVideo(videoId: string | null, allowAutoplay: boolean = true) {
    const startedAt = perfNowMs();
    if (replayDeepLinkTransitionActive) {
        console.info("[replay-deep-link] ignored local video selection during shared replay transition", { videoId });
        return;
    }
    remotePlaybackActive = false;
    updateClipBtnState();
    if (videoId === null) {
        preferredActiveVideoId = null;
        ui.setActiveVideoId(null);
        player.src("");
        reviewComments.setActiveVideo(null);
        logPerf("setVideo(null)", startedAt);
    } else {
        const settings = await commands.getSettings();
        
        // Strip out existing extensions (.mp4, .json, .webm) if present to prevent '.mp4.mp4' duplication
        const cleanVideoId = videoId.replace(/\.(mp4|json|webm)$/i, "");

        if (preferredActiveVideoId && videoIdsMatch(preferredActiveVideoId, cleanVideoId)) {
            return;
        }
        preferredActiveVideoId = cleanVideoId;

        // VideoId is now an absolute path (base path without extension), so we use it directly
        ui.setActiveVideoId(cleanVideoId);
        reviewComments.setActiveVideo(cleanVideoId);
        clearMetadataRetry(cleanVideoId);
        const setMetadataStartedAt = perfNowMs();
        const completed = await setMetadata(cleanVideoId);
        logPerf("setVideo:setMetadata", setMetadataStartedAt);
        if (!completed) {
            scheduleMetadataRetry(cleanVideoId);
        }
        let normalizedVideoPath = toAssetPath(cleanVideoId + ".mp4");
        let mimeType = "video/mp4";
        if (!(await exists(normalizedVideoPath))) {
            const webmCandidate = toAssetPath(cleanVideoId + ".webm");
            if (await exists(webmCandidate)) {
                normalizedVideoPath = webmCandidate;
                mimeType = "video/webm";
            }
        }
        const videoSrc = convertFileSrc(normalizedVideoPath);
        console.log(`[diagnose] setVideo clean=${cleanVideoId} normalized=${normalizedVideoPath} src=${videoSrc}`);
        player.src({ type: mimeType, src: videoSrc });
        // Re-apply markers after source swap to avoid plugin/source timing clears.
        player.one("loadedmetadata", () => {
            changeMarkers();
        });
        if (settings.autoplayVideo && allowAutoplay) {
            void player.play()?.catch(() => {});
        }
        logPerf("setVideo(total)", startedAt);
    }
}

async function setYouTubeReplay(loaded: LoadedReplayShare): Promise<void> {
    console.info("[youtube-replay] initializing YouTube tech", { videoId: loaded.youtubeVideoId });
    ensureYouTubeTechLoaded();
    console.info("[youtube-replay] rendering shared metadata", { videoId: loaded.youtubeVideoId });
    metadataRenderRequestSerial++;
    preferredActiveVideoId = null;
    ui.setActiveVideoId(null);
    remotePlaybackActive = true;
    reviewComments.setActiveVideo(`youtube:${loaded.youtubeVideoId}`);
    updateClipBtnState();
    clearMetadataRetry(loaded.youtubeVideoId);

    const rendered = await renderMetadataState({
        data: loaded.metadataFile,
        requestedVideoId: `youtube:${loaded.youtubeVideoId}`,
        resolvedVideoId: `youtube:${loaded.youtubeVideoId}`,
        ui,
    });
    currentEvents = rendered.currentEvents;
    highlightEvents = rendered.highlightEvents;
    tftRoundEvents = rendered.tftRoundEvents;
    changeMarkers();
    addYouTubeReplayHistoryCard(loaded);

    let autoplayVideo = false;
    try {
        autoplayVideo = (await commands.getSettings()).autoplayVideo;
    } catch (error) {
        console.warn("[youtube-replay] could not read autoplay setting", error);
    }

    console.info("[youtube-replay] setting YouTube source", { videoId: loaded.youtubeVideoId });
    player.src({ type: "video/youtube", src: loaded.youtubeUrl });
    player.one("loadedmetadata", () => {
        console.info("[youtube-replay] YouTube metadata loaded", {
            videoId: loaded.youtubeVideoId,
            duration: player.duration(),
        });
        changeMarkers();
        const duration = player.duration();
        if (typeof duration === "number" && duration > 0) ui.createTimeRuler(duration);
        if (autoplayVideo) {
            void player.play()?.catch((error) => {
                console.warn("[youtube-replay] autoplay was blocked", error);
            });
        }
    });
    player.controls(true);
    ui.showBigPlayButton(true);
}

function addYouTubeReplayHistoryCard(
    loaded: LoadedReplayShare,
    options: { activate?: boolean; persist?: boolean; append?: boolean } = {},
): void {
    const history = document.querySelector<HTMLUListElement>("#youtube-replay-history");
    if (!history) return;
    const { activate = true, persist = true, append = false } = options;

    const sharedVideoId = `youtube:${loaded.youtubeVideoId}`;
    const previous = Array.from(history.querySelectorAll<HTMLElement>("[data-shared-replay-id]"))
        .find((candidate) => candidate.dataset.sharedReplayId === loaded.youtubeVideoId);
    // A startup restore must never replace a card that the user has already
    // selected while restoration was still in progress.
    if (previous && !activate) return;
    if (previous) {
        previous.remove();
    }
    const item = ui.createRecordingItem(
        {
            videoId: sharedVideoId,
            metadata: loaded.metadataFile,
            videoExists: true,
        },
        () => void setYouTubeReplay(loaded),
        async () => null,
        () => {},
        () => {},
    );
    // Shared replays use the familiar match card, with only a local history
    // removal action. Removing it never deletes the YouTube or Firestore data.
    item.querySelector(".sidebar-actions")?.remove();
    decorateYouTubeReplayCard(item, loaded);
    item.dataset.sharedReplayId = loaded.youtubeVideoId;
    addYouTubeReplayOpenAction(item, loaded.youtubeVideoId);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "youtube-replay-remove";
    removeButton.title = uiText("この履歴を削除", "Remove from history");
    removeButton.setAttribute("aria-label", uiText("この履歴を削除", "Remove from history"));
    removeButton.textContent = "✕";
    removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        removeYouTubeReplayHistoryItem(loaded.youtubeVideoId);
    });
    item.append(removeButton);
    if (append) history.append(item);
    else history.prepend(item);
    if (persist) rememberYouTubeReplay(loaded.youtubeVideoId);
    updateYouTubeReplayHistoryVisibility();
    if (activate) {
        history.querySelectorAll("li.active").forEach((candidate) => candidate.classList.remove("active"));
        item.classList.add("active");
        ui.setActiveVideoId(sharedVideoId);
    }
}

function resolveYouTubeUploadTimestamp(loaded: LoadedReplayShare): number | null {
    const localUpload = readYouTubeUploadHistory()
        .find((entry) => entry.youtubeVideoId === loaded.youtubeVideoId && entry.sourceVideoId !== null);
    return localUpload?.uploadedAt ?? loaded.uploadedAtMs;
}

function formatYouTubeUploadDate(timestamp: number | null): string {
    if (timestamp === null || !Number.isFinite(timestamp)) return uiText("アップロード日不明", "Upload date unavailable");
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return uiText("アップロード日不明", "Upload date unavailable");
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

function decorateYouTubeReplayCard(item: HTMLElement, loaded: LoadedReplayShare): void {
    const uploadTimestamp = resolveYouTubeUploadTimestamp(loaded);
    const date = item.querySelector<HTMLElement>(".sidebar-date");
    if (date) {
        date.textContent = formatYouTubeUploadDate(uploadTimestamp);
        date.title = uiText("YouTube動画のアップロード日時", "YouTube video upload date");
    }
    item.querySelector(".youtube-replay-video-id")?.remove();
    const id = document.createElement("div");
    id.className = "youtube-replay-video-id";
    id.title = uiText(`YouTube動画ID: ${loaded.youtubeVideoId}`, `YouTube video ID: ${loaded.youtubeVideoId}`);
    const label = document.createElement("span");
    label.textContent = "ID:";
    const value = document.createElement("strong");
    value.textContent = loaded.youtubeVideoId;
    id.append(label, value);
    const participants = item.querySelector<HTMLElement>(".sidebar-participants");
    if (participants) {
        participants.insertAdjacentElement("afterend", id);
        return;
    }
    item.querySelector<HTMLElement>(".sidebar-body-row")?.insertAdjacentElement("afterend", id);
}

async function loadYouTubePublishedDates(videoIds: string[]): Promise<Record<string, number>> {
    if (videoIds.length === 0) return {};
    const chunks = Array.from(
        { length: Math.ceil(videoIds.length / 50) },
        (_, index) => videoIds.slice(index * 50, index * 50 + 50),
    );
    const results = await Promise.all(chunks.map((chunk) => getYouTubeVideoPublishedDates(chunk)));
    return Object.assign({}, ...results);
}

function addYouTubeReplayOpenAction(item: HTMLElement, youtubeVideoId: string): void {
    const actions = document.createElement("div");
    actions.className = "sidebar-actions youtube-replay-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "replay-action youtube-replay-open";
    openButton.title = uiText("YouTubeページを規定ブラウザで開く", "Open this video on YouTube");
    openButton.setAttribute("aria-label", uiText("YouTubeページを規定ブラウザで開く", "Open this video on YouTube"));
    openButton.textContent = "↗";
    openButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const url = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`;
        void openExternalUrl(url).catch((error) => {
            console.error("[youtube-replay] could not open YouTube in browser", error);
            updateYouTubeReplayStatus(uiText("YouTubeページを開けませんでした。", "Could not open the YouTube page."), true);
        });
    });
    actions.append(openButton);
    item.append(actions);
}

async function restoreYouTubeReplayHistory(): Promise<void> {
    const restoreGeneration = ++youtubeReplayHistoryRestoreGeneration;
    const videoIds = readYouTubeReplayHistory();
    if (videoIds.length === 0) {
        updateYouTubeReplayHistoryVisibility();
        return;
    }

    let restoredCount = 0;
    for (const videoId of videoIds) {
        try {
            const loaded = await loadReplayShare(videoId);
            if (restoreGeneration !== youtubeReplayHistoryRestoreGeneration) return;
            addYouTubeReplayHistoryCard(loaded, { activate: false, persist: false, append: true });
            restoredCount++;
        } catch (error) {
            // Keep the ID in storage so a temporary network or Firestore issue
            // does not silently erase the user's history.
            console.warn("[youtube-replay] could not restore history item", { videoId, error });
        }
    }
    if (restoredCount > 0) {
        updateYouTubeReplayStatus(uiText(
            `${restoredCount}件の読み込み履歴を復元しました。`,
            `Restored ${restoredCount} item${restoredCount === 1 ? "" : "s"} from load history.`,
        ));
    }
}

async function refreshOwnedYouTubeReplays(): Promise<void> {
    const list = document.querySelector<HTMLUListElement>("#youtube-replay-owned");
    const status = document.querySelector<HTMLElement>("#youtube-replay-owned-status");
    if (!list || !status) return;
    status.classList.remove("is-error");
    status.textContent = uiText("自分の投稿を取得しています…", "Loading my uploads…");
    try {
        await connectReplayShareGoogle(await getYouTubeFirebaseIdToken());
        const videoIds = await listOwnedReplayShareIds();
        const [publishedDatesResult, results] = await Promise.all([
            loadYouTubePublishedDates(videoIds).catch((error) => {
                console.warn("[youtube-replay] YouTube publish dates unavailable; using Firestore dates", error);
                return {} as Record<string, number>;
            }),
            Promise.allSettled(videoIds.map((videoId) => loadReplayShare(videoId))),
        ]);
        const loadedReplays = results
            .flatMap((result) => result.status === "fulfilled"
                ? [{ ...result.value, uploadedAtMs: publishedDatesResult[result.value.youtubeVideoId] ?? result.value.uploadedAtMs }]
                : [])
            .toSorted((a, b) => (resolveYouTubeUploadTimestamp(b) ?? 0) - (resolveYouTubeUploadTimestamp(a) ?? 0));
        list.replaceChildren();
        for (const loaded of loadedReplays) {
            const sharedVideoId = `youtube:${loaded.youtubeVideoId}`;
            const item = ui.createRecordingItem(
                { videoId: sharedVideoId, metadata: loaded.metadataFile, videoExists: true },
                () => void setYouTubeReplay(loaded),
                async () => null,
                () => {},
                () => {},
            );
            item.querySelector(".sidebar-actions")?.remove();
            decorateYouTubeReplayCard(item, loaded);
            item.dataset.sharedReplayId = loaded.youtubeVideoId;
            addYouTubeReplayOpenAction(item, loaded.youtubeVideoId);
            list.append(item);
        }
        list.hidden = list.childElementCount === 0;
        const failed = results.filter((result) => result.status === "rejected").length;
        status.textContent = videoIds.length === 0
            ? uiText("このGoogleアカウントで投稿した共有リプレイはありません。", "This Google account has no uploaded shared replays.")
            : uiText(
                `${list.childElementCount}件を表示${failed > 0 ? `（${failed}件は動画を確認できませんでした）` : ""}`,
                `Showing ${list.childElementCount}${failed > 0 ? ` (${failed} video${failed === 1 ? "" : "s"} unavailable)` : ""}`,
            );
    } catch (error) {
        list.replaceChildren();
        list.hidden = true;
        status.classList.add("is-error");
        status.textContent = error instanceof Error ? error.message : String(error);
    }
}

async function setMetadata(videoId: string): Promise<boolean> {
    const startedAt = perfNowMs();
    const requestSerial = ++metadataRenderRequestSerial;
    const requestedVideoKey = normalizeVideoId(videoId);

    const loadStartedAt = perfNowMs();
    let { data, resolvedVideoId } = await getMetadataWithFallback(
        videoId,
        commands.getMetadata,
        buildMetadataCandidates,
    );
    logPerf("setMetadata:load", loadStartedAt);
    let kind = !data ? "null" : "Metadata" in data ? "Metadata" : "Deferred" in data ? "Deferred" : "NoData";
    console.log(`[diagnose] setMetadata kind=${kind} requested=${videoId} resolved=${resolvedVideoId}`);

    if (!data || "NoData" in data) {
        const listFallback = await getMetadataFromRecordingsList(
            videoId,
            commands.getRecordingsList,
            videoIdsMatch,
        );
        if (listFallback?.data && ("Metadata" in listFallback.data || "Deferred" in listFallback.data)) {
            data = listFallback.data;
            resolvedVideoId = listFallback.resolvedVideoId;
            kind = "Metadata" in data ? "Metadata" : "Deferred";
            console.log(`[diagnose] setMetadata upgraded-by-list kind=${kind} requested=${videoId} resolved=${resolvedVideoId}`);
        }
    }

    // Ignore stale async responses when the active video changed while metadata was loading.
    const latestActiveVideoId = preferredActiveVideoId ?? ui.getActiveVideoId();
    if (
        requestSerial !== metadataRenderRequestSerial ||
        !latestActiveVideoId ||
        !videoIdsMatch(latestActiveVideoId, requestedVideoKey)
    ) {
        const completed = !!(data && "Metadata" in data);
        console.log(
            `[diagnose] setMetadata stale-skip requested=${videoId} active=${latestActiveVideoId ?? "null"} serial=${requestSerial}/${metadataRenderRequestSerial}`,
        );
        return completed;
    }

    // Cache by requested video id so different recordings never share a skip key.
    const cacheKey = requestedVideoKey;
    const signature = metadataDataSignature(data);
    const previousSignature = metadataRenderSignatures.get(cacheKey);
    if (previousSignature === signature && lastRenderedMetadataVideoKey === cacheKey) {
        const completed = !!(data && "Metadata" in data);
        console.log(`[diagnose] setMetadata skip-same-signature kind=${kind} key=${cacheKey}`);
        return completed;
    }

    const rendered = await renderMetadataState({
        data,
        requestedVideoId: videoId,
        resolvedVideoId,
        ui,
    });
    metadataRenderSignatures.set(cacheKey, signature);
    lastRenderedMetadataVideoKey = cacheKey;
    if (rendered.clearRetry) {
        clearMetadataRetry(videoId);
    }
    currentEvents = rendered.currentEvents;
    highlightEvents = rendered.highlightEvents;
    tftRoundEvents = rendered.tftRoundEvents;
    changeMarkers();
    logPerf(`setMetadata(total kind=${kind})`, startedAt);
    return rendered.completed;
}

function changeMarkers() {
    const built = buildMarkers(currentEvents, highlightEvents, tftRoundEvents, ui.getMarkerFlags(), EVENT_DELAY);
    const markers = built.markers;
    markerDetails = built.details;

    player.markers().removeAll();
    player.markers().add(markers);
    console.log("[diagnose] changeMarkers", {
        markers: markers.length,
        currentEvents: currentEvents?.events.length ?? 0,
        highlightEvents: highlightEvents?.events.length ?? 0,
        tftRoundEvents: tftRoundEvents?.events.length ?? 0,
        markerFlags: ui.getMarkerFlags(),
    });
    if (currentEvents !== null && currentEvents.events.length > 0 && markers.length === 0) {
        console.warn("[markers] No markers generated. Check marker flags / participant mapping.", {
            participantId: currentEvents.participantId,
            markerFlags: ui.getMarkerFlags(),
            events: currentEvents.events.length,
        });
    }
}

// --- MODAL ---

async function showRenameModal(videoId: string): Promise<void> {
    return openRenameModal({
        videoId,
        getRecordingsList: commands.getRecordingsList,
        showRenameModal: ui.showRenameModal,
        onRename: renameVideo,
    });
}

async function renameVideo(videoId: string, newVideoId: string): Promise<void> {
    return renameVideoFlow({
        videoId,
        newVideoId,
        getActiveVideoId: ui.getActiveVideoId,
        renameVideo: commands.renameVideo,
        getCurrentTime: () => player.currentTime() || 0,
        setCurrentTime: (seconds) => {
            player.currentTime(seconds);
        },
        updateSidebar: () => updateSidebar(),
        setVideo: async (id) => {
            await setVideo(id);
        },
        showErrorModal: ui.showErrorModal,
    });
}

function showDeleteModal(videoId: string, isFavorite: boolean = false) {
    showDeleteWithConfirm({
        videoId,
        isFavorite,
        confirmDelete: commands.confirmDelete,
        showDeleteModal: ui.showDeleteModal,
        deleteVideo,
    });
}

function handleDeleteVideoOnly(videoId: string, isFavorite: boolean = false) {
    suppressRecordingsChangedEventsFor();
    deleteVideoOnlyWithConfirm({
        videoId,
        isFavorite,
        confirmDelete: commands.confirmDelete,
        showDeleteVideoOnlyModal: ui.showDeleteVideoOnlyModal,
        markRecordingAsVideoDeleted: ui.markRecordingAsVideoDeleted,
        deleteVideoOnly: async (id) => {
            await prepareVideoForDelete(id);
            return commands.deleteVideoOnly(id);
        },
        showErrorModal: ui.showErrorModal,
        updateSidebar: () => updateSidebar(),
    });
}

async function deleteVideo(videoId: string): Promise<void> {
    suppressRecordingsChangedEventsFor();
    return deleteVideoFlow({
        videoId,
        getActiveVideoId: ui.getActiveVideoId,
        clearPlayerSource: () => {
            releasePlayerSourceForDelete();
        },
        removeRecordingItem: ui.removeRecordingItem,
        deleteVideo: async (id) => {
            await prepareVideoForDelete(id, true);
            return commands.deleteVideo(id);
        },
        updateSidebar: () => updateSidebar(),
        showErrorModal: ui.showErrorModal,
    });
}

async function showTimestamps() {
    const markerEventNameForTimeline = (event: GameEvent, participantId: number, _teamId: number | null): string | null => {
        return markerEventName(event, participantId, ui.getMarkerFlags());
    };
    const timelineEvents = buildTimelineRows({
        currentEvents,
        highlightEvents,
        tftRoundEvents,
        markerEventName: markerEventNameForTimeline,
    });

    const settings = await commands.getSettings();
    ui.showTimelineModal(
        timelineEvents,
        (secs) => player.currentTime(secs / 1000 - EVENT_DELAY),
    );
}

if (import.meta.hot) {
    import.meta.hot.accept();
}
