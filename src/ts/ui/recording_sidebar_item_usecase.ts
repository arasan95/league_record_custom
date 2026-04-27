import { commands, type Participant, type Recording } from "../bindings";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { open } from "@tauri-apps/plugin-shell";
import xLogoIcon from "../../assets/share-icons/x-logo.svg";
import discordSymbolIcon from "../../assets/share-icons/discord-symbol.svg";
import {
    getChampionIconUrl,
    getChampionIconUrlById,
    getTftItemIconUrl,
    getTftTraitIconUrl,
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

function createShareIcon(kind: "x" | "discord"): HTMLImageElement {
    const img = document.createElement("img");
    img.className = "recording-share-option-icon";
    img.alt = "";
    img.draggable = false;
    img.src = kind === "x" ? xLogoIcon : discordSymbolIcon;
    return img;
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

async function showShareModal(videoId: string): Promise<void> {
    closeShareModal();
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

        const cancelButton = document.createElement("button");
        cancelButton.className = "recording-share-cancel";
        cancelButton.type = "button";
        cancelButton.textContent = getText(currentLanguage as any, "close" as any) || "Close";
        cancelButton.onclick = () => closeShareModal();

        options.append(xButton, discordButton);
        content.append(title, options, cancelButton);
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
    apply: (url: string) => void;
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
    apply(url);
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

    if (recording.metadata && "Metadata" in recording.metadata) {
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
            statsCol.append(
                createEl("span", {}, { class: "sidebar-kda" }, kda),
                createEl("span", {}, { class: "sidebar-cs" }, `${totalCS} CS (${csPerMin}/m)`),
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
            sidebarBadges.append(createEl("span", {}, { class: "sidebar-favorite-badge", title: "Favorite" }, "\u2605"));
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
                            if (itemImgs && unit.itemNames) {
                                for (let j = 0; j < Math.min(itemImgs.length, unit.itemNames.length); j++) {
                                    const itemImg = itemImgs[j] as HTMLImageElement;
                                    tasks.push(
                                        enqueueSidebarImageTask(() => resolveAndApplyImage({
                                            stats: perfStats,
                                            label: "tft_item_icon",
                                            resolver: async () => getTftItemIconUrl(unit.itemNames[j]),
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
                            tasks.push(
                                enqueueSidebarImageTask(() => resolveAndApplyMask({
                                    stats: perfStats,
                                    label: "tft_trait_icon",
                                    resolver: async () => getTftTraitIconUrl(activeTraits[i].name),
                                    apply: (url) => {
                                    el.style.webkitMaskImage = `url("${url}")`;
                                    el.style.webkitMaskSize = "contain";
                                    el.style.webkitMaskRepeat = "no-repeat";
                                    el.style.webkitMaskPosition = "center";
                                    el.style.backgroundColor = "currentColor";
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
                if (badgeContainer) {
                    const existingFavoriteBadge = badgeContainer.querySelector(".sidebar-favorite-badge");
                    if (fav && !existingFavoriteBadge) {
                        badgeContainer.append(createEl("span", {}, { class: "sidebar-favorite-badge", title: "Favorite" }, "\u2605"));
                    } else if (!fav && existingFavoriteBadge) {
                        existingFavoriteBadge.remove();
                    }
                }
                if (filterStar && !fav && onRefreshForStarUnfavorite) onRefreshForStarUnfavorite();
            });
        },
    }, { class: "favorite", ...(favorite ? { style: "color: gold" } : {}) }, favorite ? "\u2605" : "\u2606") as HTMLSpanElement;

    const shareBtn = createEl("span", {
        onclick: (e: MouseEvent) => {
            e.stopPropagation();
            void showShareModal(recording.videoId);
        },
    }, { class: "share", title: getText(currentLanguage as any, "share" as any) || "Share" }, "\u21AA");
    const renameBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); onRename(recording.videoId); } }, { class: "rename" }, "\u270E");
    const deleteBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); onDelete(recording.videoId, isFavorite(recording.metadata)); } }, { class: "delete", title: getText(currentLanguage as any, "delete" as any) || "Delete" }, "\u2716");
    const deleteVideoOnlyBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); if (onDeleteVideoOnly) onDeleteVideoOnly(recording.videoId, isFavorite(recording.metadata)); } }, { class: "delete-video-only", title: getText(currentLanguage as any, "deleteVideoOnly" as any) || "Delete Video Only" }, "\uD83D\uDDD1");
    const actionsDiv = createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, shareBtn, renameBtn, deleteVideoOnlyBtn, deleteBtn]);

    if (recording.metadata && "Metadata" in recording.metadata) {
        li.dataset.hasMetadata = recording.metadata.Metadata.queue.name !== "Unknown Queue" ? "true" : "false";
        li.append(mainContent);
    } else {
        li.dataset.hasMetadata = "false";
        li.append(...displayContent);
    }
    li.append(actionsDiv);
    scheduleImageLoadForItem?.(li);
    return li;
}
