import { join } from "@tauri-apps/api/path";
import { commands } from "./bindings";
import { playNotificationSound } from "./util";
import { videoIdsMatch } from "./main_video_id_usecase";
import type { Recording, RecordingSnapshot } from "./bindings";
import { invoke } from "@tauri-apps/api/core";
import { beginSidebarImageRun, waitForSidebarImageRun } from "./ui/recording_sidebar_item_usecase";
const PERF_LOG_ENABLED = false;

type UiSidebarLike = {
    getActiveVideoId(): string | null;
    setActiveVideoId(videoId: string | null): boolean;
    updateSideBar(
        recordingsSizeGb: number,
        recordings: ReadonlyArray<Recording>,
        onClick: (videoId: string | null) => void | Promise<void>,
        onStar: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void | Promise<void>,
        onDelete: (videoId: string, isFavorite?: boolean) => void,
        onDeleteVideoOnly: ((videoId: string, isFavorite?: boolean) => void) | undefined,
        forceUpdateIds?: string[],
    ): void;
};

function perfNowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function sendPerfToBackend(line: string): Promise<void> {
    if (!PERF_LOG_ENABLED) return;
    try {
        await invoke("perf_log", { message: line });
    } catch {
        // Ignore when command is unavailable in constrained builds.
    }
}

export async function refreshSidebar(input: {
    ui: UiSidebarLike;
    forceUpdateIds?: string[];
    getRecordingsSnapshot: () => Promise<RecordingSnapshot | null>;
    setVideo: (videoId: string | null) => void | Promise<void>;
    toggleFavorite: (videoId: string) => Promise<boolean | null>;
    showRenameModal: (videoId: string) => void | Promise<void>;
    showDeleteModal: (videoId: string, isFavorite?: boolean) => void;
    handleDeleteVideoOnly: (videoId: string, isFavorite?: boolean) => void;
}): Promise<Recording[]> {
    const startedAt = perfNowMs();
    const {
        ui,
        forceUpdateIds = [],
        getRecordingsSnapshot,
        setVideo,
        toggleFavorite,
        showRenameModal,
        showDeleteModal,
        handleDeleteVideoOnly,
    } = input;

    const dataFetchStarted = perfNowMs();
    const snapshot = await getRecordingsSnapshot();
    if (!snapshot) return [];
    const { recordings, sizeGb: recordingsSize } = snapshot;
    const activeVideoId = ui.getActiveVideoId();
    const imageRunId = beginSidebarImageRun();
    const dataFetchMs = perfNowMs() - dataFetchStarted;
    const renderStarted = perfNowMs();
    ui.updateSideBar(
        recordingsSize,
        recordings,
        setVideo,
        toggleFavorite,
        showRenameModal,
        showDeleteModal,
        handleDeleteVideoOnly,
        forceUpdateIds,
    );
    const renderSyncMs = perfNowMs() - renderStarted;

    if (!ui.setActiveVideoId(activeVideoId)) {
        void setVideo(null);
    }

    void (async () => {
        const paintStarted = perfNowMs();
        await nextFrame();
        await nextFrame();
        const paintMs = perfNowMs() - paintStarted;

        const imagesStarted = perfNowMs();
        const imageStats = await waitForSidebarImageRun(imageRunId, 12000);
        const imagesMs = perfNowMs() - imagesStarted;
        const totalMs = perfNowMs() - startedAt;

        const timedOut = imageStats.pendingItems > 0;
        const line = `[perf] sidebar_gui_complete total=${totalMs.toFixed(1)}ms data=${dataFetchMs.toFixed(1)}ms render_sync=${renderSyncMs.toFixed(1)}ms paint=${paintMs.toFixed(1)}ms images_wait=${imagesMs.toFixed(1)}ms img_items=${imageStats.totalItems} img_items_done=${imageStats.completedItems} img_items_pending=${imageStats.pendingItems} img_resolve_ms=${imageStats.resolveMs.toFixed(1)}ms img_dom_ms=${imageStats.domLoadMs.toFixed(1)}ms img_resolve_count=${imageStats.resolveCount} img_load_count=${imageStats.loadCount} img_error_count=${imageStats.errorCount} timed_out=${timedOut ? 1 : 0} force_ids=${forceUpdateIds.length} recordings=${recordings.length}`;
        if (PERF_LOG_ENABLED) console.log(line);
        await sendPerfToBackend(line);

        if (timedOut) {
            const fullWaitStarted = perfNowMs();
            const finalStats = await waitForSidebarImageRun(imageRunId);
            const fullImagesMs = imagesMs + (perfNowMs() - fullWaitStarted);
            const fullTotalMs = perfNowMs() - startedAt;
            const finalLine = `[perf] sidebar_gui_complete_full total=${fullTotalMs.toFixed(1)}ms data=${dataFetchMs.toFixed(1)}ms render_sync=${renderSyncMs.toFixed(1)}ms paint=${paintMs.toFixed(1)}ms images_wait=${fullImagesMs.toFixed(1)}ms img_items=${finalStats.totalItems} img_items_done=${finalStats.completedItems} img_items_pending=${finalStats.pendingItems} img_resolve_ms=${finalStats.resolveMs.toFixed(1)}ms img_dom_ms=${finalStats.domLoadMs.toFixed(1)}ms img_resolve_count=${finalStats.resolveCount} img_load_count=${finalStats.loadCount} img_error_count=${finalStats.errorCount} force_ids=${forceUpdateIds.length} recordings=${recordings.length}`;
            if (PERF_LOG_ENABLED) console.log(finalLine);
            await sendPerfToBackend(finalLine);
        }
    })();

    return recordings;
}

export function retrySidebarUpdateLoop(input: {
    attemptsLeft: number;
    targetId: string;
    updateSidebar: (forceUpdateIds?: string[]) => Promise<Recording[]>;
    resolveRetryState: (recordings: Recording[], targetId: string) => { shouldRetry: boolean; nextTargetId: string };
    delayMs?: number;
}): void {
    const { attemptsLeft, targetId, updateSidebar, resolveRetryState, delayMs = 1000 } = input;
    if (attemptsLeft <= 0) return;

    setTimeout(async () => {
        try {
            console.log(`Retrying Sidebar Update for ${targetId}... Attempts left: ${attemptsLeft}`);
            const recordings = await updateSidebar([targetId]);
            if (recordings.length > 0) {
                const retryState = resolveRetryState(recordings, targetId);
                if (retryState.nextTargetId !== targetId) {
                    console.log(`Target ID ${targetId} lost. Switching focus to latest recording.`);
                }
                if (retryState.shouldRetry) {
                    retrySidebarUpdateLoop({
                        attemptsLeft: attemptsLeft - 1,
                        targetId: retryState.nextTargetId,
                        updateSidebar,
                        resolveRetryState,
                        delayMs,
                    });
                } else {
                    console.log("Retry successful: Data is valid.");
                }
            }
        } catch (error) {
            console.error("Error in retry loop:", error);
            retrySidebarUpdateLoop({
                attemptsLeft: attemptsLeft - 1,
                targetId,
                updateSidebar,
                resolveRetryState,
                delayMs,
            });
        }
    }, delayMs);
}


export function createRecordingRefresh(refresh: () => Promise<unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let queued = false;
    async function flush() {
        if (running) {
            queued = true;
            return;
        }
        running = true;
        try {
            do {
                queued = false;
                await refresh();
            } while (queued);
        } finally {
            running = false;
        }
    }

    function schedule(delay = 120) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            void flush().catch(error => console.error("Could not refresh recordings:", error));
        }, delay);
    }
    return { flush, schedule };
}

export async function handleRecordingFinished(
    [videoId, manual]: [string, boolean],
    input: {
        scheduleRefresh: (delay: number) => void;
        getActiveId: () => string | null;
        loadMetadata: (id: string) => Promise<boolean>;
        scheduleMetadataRetry: (id: string) => void;
        setVideo: (id: string) => Promise<void>;
        popup: () => void;
    },
) {
    input.scheduleRefresh(2500);
    const settings = await commands.getSettings();
    const path = /[\\/]/.test(videoId) ? videoId : await join(settings.recordingsFolder, videoId);
    if (!manual && settings.playRecordingSounds) playNotificationSound("stop");
    if (!manual && settings.autoPopupOnEnd) input.popup();
    if (!manual && settings.autoSelectRecording) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    const activeId = input.getActiveId();
    if (activeId && videoIdsMatch(activeId, path)) {
        if (!(await input.loadMetadata(activeId)) && !manual) input.scheduleMetadataRetry(activeId);
    }
    if (!manual && settings.autoSelectRecording) await input.setVideo(path);
}
