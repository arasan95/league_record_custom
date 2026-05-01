import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import { MarkersPlugin, type Settings } from "@fffffffxxxxxxx/videojs-markers";
import "@fffffffxxxxxxx/videojs-markers";

import { convertFileSrc } from "@tauri-apps/api/core";
import { join, sep } from "@tauri-apps/api/path";

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
import { buildMarkers, markerEventName, type HighlightEvents, type MarkerDetail, type RecordingEvents } from "./main_markers_usecase";
import { initializeProgressTooltips } from "./main_progress_tooltip_usecase";
import { initializeMarkerHoverTooltips } from "./main_marker_tooltip_usecase";
import { createKeyboardHandlers } from "./main_keyboard_usecase";
import { refreshSidebar, retrySidebarUpdateLoop } from "./main_recordings_usecase";
import { buildTimelineRows } from "./main_timeline_usecase";
import {
    deleteVideoFlow,
    deleteVideoOnlyWithConfirm,
    openRenameModal,
    renameVideoFlow,
    showDeleteWithConfirm,
} from "./main_video_management_usecase";

// initDebug();

// sets the time a marker jumps to before the actual event happens
// jumps to (eventTime - EVENT_DELAY) when a marker is clicked
const EVENT_DELAY = 2;

const ui = new UI(videojs);
// new TitleBar();

// Load keybinds & mouse config
export let currentKeybinds: KeybindMap = loadKeybinds();
export let currentMouseConfig: MouseConfig = loadMouseConfig();

export function reloadKeybinds() {
    currentKeybinds = loadKeybinds();
    currentMouseConfig = loadMouseConfig();
}

let currentEvents: RecordingEvents | null = null;
let highlightEvents: HighlightEvents | null = null;
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

function perfNowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function logPerf(label: string, startedAtMs: number): void {
    const PERF_LOG_ENABLED = false;
    if (!PERF_LOG_ENABLED) return;
    const elapsedMs = perfNowMs() - startedAtMs;
    console.log(`[perf] ${label}: ${elapsedMs.toFixed(1)}ms`);
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
        return `Metadata|pid=${m.participantId}|pc=${m.participants?.length ?? 0}|p=${participantKey}|ev=${eventCount}|last=${lastEventTs}|hi=${highlightsCount}|q=${m.queue?.id ?? 0}|gv=${m.gameVersion ?? ""}`;
    }
    if ("Deferred" in data) {
        const d = data.Deferred;
        const eventCount = Array.isArray(d.events) ? d.events.length : 0;
        const lastEventTs = eventCount > 0 ? Number(d.events[eventCount - 1]?.timestamp ?? -1) : -1;
        const participantKey = Array.isArray(d.participants)
            ? d.participants.map((p: any) => `${p.participantId}:${p.championId}:${p.honorReceived ? 1 : 0}`).join("|")
            : "";
        const highlightsCount = Array.isArray(d.highlights) ? d.highlights.length : 0;
        return `Deferred|pc=${d.participants?.length ?? 0}|p=${participantKey}|ev=${eventCount}|last=${lastEventTs}|hi=${highlightsCount}|off=${d.ingameTimeRecStartOffset ?? 0}`;
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
    autoplay: false,
    controls: true,
    preload: "auto",
    enableSourceset: true,
    notSupportedMessage: " ",
    userActions: {
        doubleClick: false,
    },
    bigPlayButton: false,
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

function updateClipBtnState() {
    const canCreateClip = loopStart !== null && loopEnd !== null && loopEnd > loopStart;
    if (createClipBtn) createClipBtn.disabled = !canCreateClip;
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
if (createClipBtn) {
    createClipBtn.onclick = async () => {
        const videoId = ui.getActiveVideoId();
        if (!videoId || loopStart === null || loopEnd === null) return;
        
        try {
            createClipBtn.disabled = true;
            createClipBtn.textContent = "...";
            const tracksResult = await commands.getClipAudioTracks(videoId);
            if (tracksResult.status === "error") {
                throw tracksResult.error;
            }

            let selectedAudioTrackIndex: number | null = null;
            if (tracksResult.data.length > 1) {
                const settings = await commands.getSettings();
                const lang = settings.language || "en";
                const mode = await pickClipAudioMode(tracksResult.data, lang);
                if (mode === null) {
                    return;
                }
                selectedAudioTrackIndex = mode === "game-only" ? 1 : 0;
            } else if (tracksResult.data.length === 1) {
                selectedAudioTrackIndex = tracksResult.data[0].index;
            }

            const clipResult = selectedAudioTrackIndex === null
                ? await commands.createClip(videoId, loopStart, loopEnd, null)
                : await commands.createClipWithAudioTrack(videoId, loopStart, loopEnd, selectedAudioTrackIndex);
            if (clipResult.status === "error") {
                throw clipResult.error;
            }
            const newFile = clipResult.data;
            // Wait a bit or refresh? Ideally we should refresh the sidebar
            await  updateSidebar(); 
            // Show simple alert using error modal for now as it's the only one available
            // Or console log.
            console.log(`Clip created: ${newFile}`);
        } catch (e) {
            ui.showErrorModal(`Failed to create clip: ${e}`);
        } finally {
            createClipBtn.textContent = "Clip";
            updateClipBtnState();
        }
    };
}
// ---------------------

const keyboardHandlers = createKeyboardHandlers({
    player,
    ui,
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
    await initPatchVersion();
    logPerf("startup:initPatchVersion", patchVersionStartedAt);
    
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

    // Loop Logic & Custom Time Display
    player.on("timeupdate", () => {
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

        // Resolve payload IDs (which may be filename-only) to actual sidebar IDs (absolute path/base id).
        const recordings = await commands.getRecordingsList();
        const resolvedIds: string[] = [];

        for (const changedId of payload) {
            const matched = recordings.find((r) => videoIdsMatch(r.videoId, changedId));
            if (matched) {
                resolvedIds.push(matched.videoId);
                ui.updateRecordingItem(matched);
                continue;
            }

            // Fallback path when matching list item is not found yet.
            const metadata = await commands.getMetadata(changedId);
            ui.updateRecordingItem({ videoId: changedId, metadata, videoExists: true });
        }

        if (resolvedIds.length > 0) {
            await updateSidebar(resolvedIds);
        }

        // 2. Active Video Update (Refresh Detail View)
        // Backend sends filename (e.g. "video.mp4"), Frontend activeVideoId is Full Path.
        // We check if the active ID *contains* one of the payload IDs.
        if (activeVideoId !== null && payload.some(id => videoIdsMatch(activeVideoId, id))) {
            console.log("MetadataChanged event received for active video. Reloading.");
            // update metadata for currently selected recording
            void setMetadata(activeVideoId);
        }
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
                const { check } = await import("@tauri-apps/plugin-updater");
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
    if (firstVideo) {
        void (async () => {
            const initialSetVideoStartedAt = perfNowMs();
            await setVideo(firstVideo.videoId, false);
            logPerf("startup:setVideo(first)", initialSetVideoStartedAt);
        })();
        player.one("canplay", ui.showWindow);
    } else {
        void setVideo(null);
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
    if (videoId === null) {
        preferredActiveVideoId = null;
        ui.setActiveVideoId(null);
        player.src("");
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
        clearMetadataRetry(cleanVideoId);
        const setMetadataStartedAt = perfNowMs();
        const completed = await setMetadata(cleanVideoId);
        logPerf("setVideo:setMetadata", setMetadataStartedAt);
        if (!completed) {
            scheduleMetadataRetry(cleanVideoId);
        }
        const normalizedVideoPath = toAssetPath(cleanVideoId + ".mp4");
        const videoSrc = convertFileSrc(normalizedVideoPath);
        console.log(`[diagnose] setVideo clean=${cleanVideoId} normalized=${normalizedVideoPath} src=${videoSrc}`);
        player.src({ type: "video/mp4", src: videoSrc });
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
    changeMarkers();
    logPerf(`setMetadata(total kind=${kind})`, startedAt);
    return rendered.completed;
}

function changeMarkers() {
    const built = buildMarkers(currentEvents, highlightEvents, ui.getMarkerFlags(), EVENT_DELAY);
    const markers = built.markers;
    markerDetails = built.details;

    player.markers().removeAll();
    player.markers().add(markers);
    console.log("[diagnose] changeMarkers", {
        markers: markers.length,
        currentEvents: currentEvents?.events.length ?? 0,
        highlightEvents: highlightEvents?.events.length ?? 0,
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
        deleteVideoOnly: commands.deleteVideoOnly,
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
            player.src(null);
        },
        removeRecordingItem: ui.removeRecordingItem,
        deleteVideo: commands.deleteVideo,
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
