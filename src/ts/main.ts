import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import { MarkersPlugin, type Settings } from "@fffffffxxxxxxx/videojs-markers";
import "@fffffffxxxxxxx/videojs-markers";

import { sep } from "@tauri-apps/api/path";

import { commands, type ClipAudioTrack, type GameEvent, type Recording, type RecordingSnapshot } from "./bindings";
import ListenerManager from "./listeners";
import UI from "./ui";
import { splitRight, playNotificationSound } from "./util";
import { DEFAULT_KEYBINDS, isAction, createKeybindSettings } from "./keybinds";
import { TitleBar } from "./titlebar";
import { initPatchVersion } from "./version";
import { initTooltipFallback } from "./tooltip";
import { getText } from "./i18n";
import { createVideoSelection } from "./main_video_selection_usecase";
import { bindClipCreation } from "./main_clip_usecase";
import { ensureDataLoaded } from "./datadragon";
import { videoIdsMatch } from "./main_video_id_usecase";
import { getLatestRetryVideoId, getRetryState } from "./main_sidebar_usecase";
import { createMetadataController } from "./main_metadata_render_usecase";
import { buildMarkers, markerEventName, type HighlightEvents, type MarkerDetail, type RecordingEvents, type TftRoundEvents } from "./main_markers_usecase";
import { initializeProgressTooltips } from "./main_progress_tooltip_usecase";
import { initializeMarkerHoverTooltips } from "./main_marker_tooltip_usecase";
import { createKeyboardHandlers } from "./main_keyboard_usecase";
import { createRecordingRefresh, handleRecordingFinished, refreshSidebar, retrySidebarUpdateLoop } from "./main_recordings_usecase";
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

const keybinds = createKeybindSettings();
const ui = new UI(videojs, keybinds);

let currentEvents: RecordingEvents | null = null;
let highlightEvents: HighlightEvents | null = null;
let tftRoundEvents: TftRoundEvents | null = null;
let markerDetails: Array<MarkerDetail | undefined> = [];
let lastRecordingsSnapshot: RecordingSnapshot | null = null;
let recordingsRefresh: Promise<RecordingSnapshot | null> | null = null;

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

const {
    flush: flushRecordingsChangedRefresh,
    schedule: scheduleRecordingsChangedRefresh,
} = createRecordingRefresh(updateSidebar);

const storageStatus = document.querySelector<HTMLElement>("#recordings-unavailable")!;
const storageRetry = storageStatus.querySelector("button")!;
storageRetry.addEventListener("click", () => void flushRecordingsChangedRefresh());
let storageRetryTimer: ReturnType<typeof setTimeout> | undefined;

function showStorageStatus(unavailable: boolean) {
    storageStatus.hidden = !unavailable;
    clearTimeout(storageRetryTimer);
    if (!unavailable) return;
    storageRetryTimer = setTimeout(() => void flushRecordingsChangedRefresh(), 5000);
    void commands.getSettings().then(settings => {
        const lang = settings.language as Parameters<typeof getText>[0];
        storageStatus.querySelector("span")!.textContent = getText(lang, "recordingsUnavailable");
        storageRetry.textContent = getText(lang, "retry");
    });
}

function refreshRecordingsSnapshot(): Promise<RecordingSnapshot | null> {
    recordingsRefresh ??= commands.getRecordingsSnapshot().then((result) => {
        if (result.status === "error") throw new Error(result.error);
        showStorageStatus(result.data.stale);
        lastRecordingsSnapshot = result.data;
        return result.data;
    }).catch((error) => {
        console.warn("Failed to refresh recording library:", error);
        showStorageStatus(true);
        return lastRecordingsSnapshot;
    }).finally(() => {
        recordingsRefresh = null;
    });
    return recordingsRefresh;
}

const getVisibleRecordings = async () => lastRecordingsSnapshot?.recordings ?? [];
const metadata = createMetadataController({
    ui,
    getActiveVideoId: () => videoSelection.getActiveId() ?? ui.getActiveVideoId(),
    getMetadata: commands.getMetadata,
    getVisibleRecordings,
    onRender: (rendered) => {
        currentEvents = rendered.currentEvents;
        highlightEvents = rendered.highlightEvents;
        tftRoundEvents = rendered.tftRoundEvents;
        changeMarkers();
    },
});

const videoSelection = createVideoSelection({
    ui,
    metadata,
    getAutoplay: async () => (await commands.getSettings()).autoplayVideo,
    resetMarkers: () => {
        currentEvents = highlightEvents = tftRoundEvents = null;
        changeMarkers();
    },
    changeMarkers,
    logPerf,
    perfNowMs,
});
const setVideo = videoSelection.setVideo;

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
ui.setPlayer(player);
videoSelection.setPlayer(player);

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
const clipStatus = document.querySelector<HTMLSpanElement>("#clip-status")!;
const clipProgress = document.querySelector<HTMLProgressElement>("#clip-progress")!;

let loopStart: number | null = null;
let loopEnd: number | null = null;
let isLooping = false;
const updateClipBtnState = bindClipCreation({
    button: createClipBtn,
    status: clipStatus,
    progressBar: clipProgress,
    getRange: () => ({ start: loopStart, end: loopEnd }),
    getVideoId: ui.getActiveVideoId,
    pickAudioMode: pickClipAudioMode,
    showError: (message) => ui.showErrorModal(message),
    onSaved: scheduleRecordingsChangedRefresh,
});

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
// ---------------------

const keyboardHandlers = createKeyboardHandlers({
    player,
    ui,
    matchesAction: (event, action) => isAction(event, action as any, keybinds.getKeybinds()),
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
                 const result = await commands.saveSettings(s);
                 if (result.status === "error") throw new Error("Settings save failed"); 
                 
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
                     const activeVideoId = videoSelection.getActiveId() ?? ui.getActiveVideoId();
                     if (activeVideoId) {
                         metadata.invalidate(activeVideoId);
                         void metadata.load(activeVideoId);
                     }
                 }

                 const languageChanged = previousLanguage !== (s.language || "en");
                 if (languageChanged) {
                     ui.setCurrentLanguage(s.language || "en");
                     const activeVideoId = videoSelection.getActiveId() ?? ui.getActiveVideoId();
                     if (activeVideoId) {
                         metadata.invalidate(activeVideoId);
                         void metadata.load(activeVideoId);
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
            if (keybinds.getMouse().wheelAction === "speed") {
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
            if (e.button === 1 && keybinds.getMouse().middleClickAction === "resetSpeed") {
                e.preventDefault();
                player.playbackRate(1.0);
            }
        });
    }

    const listenerManager = new ListenerManager();
    listenerManager.listen_app("RecordingsChanged", () => {
        scheduleRecordingsChangedRefresh();
    });
    listenerManager.listen_app("MarkerflagsChanged", () =>
        commands.getMarkerFlags().then((flags) => ui.setMarkerFlags(flags)),
    );
    listenerManager.listen_app("MetadataChanged", async ({ payload }) => {
        const activeVideoId = videoSelection.getActiveId() ?? ui.getActiveVideoId();
        scheduleRecordingsChangedRefresh(1500);

        // 2. Active Video Update (Refresh Detail View)
        // Backend sends filename (e.g. "video.mp4"), Frontend activeVideoId is Full Path.
        // We check if the active ID *contains* one of the payload IDs.
        if (activeVideoId !== null && payload.some(id => videoIdsMatch(activeVideoId, id))) {
            console.log("MetadataChanged event received for active video. Reloading.");
            // update metadata for currently selected recording
            void metadata.load(activeVideoId);
        }
    });
    
    listenerManager.listen_app("RecordingPhaseChanged", ({ payload }) => {
        if (payload === "recording" || payload === "idle") scheduleRecordingsChangedRefresh();
        if (payload === "recording") {
            void commands.getSettings().then(settings => {
                if (settings.playRecordingSounds) playNotificationSound("start");
            });
        }
    });

    listenerManager.listen_app("ManualRecordingStopped", () => {
        void commands.getSettings().then(settings => {
            if (settings.playRecordingSounds) playNotificationSound("stop");
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

    listenerManager.listen_app("RecordingFailed", ({ payload }) => {
        console.error("Recording finalization failed:", payload);
        void commands.getSettings().then(settings =>
            ui.showErrorModal(getText(settings.language as Parameters<typeof getText>[0], "recordingFinalizeFailed"))
        );
    });

    listenerManager.listen_app("RecordingMetadataSaveFailed", ({ payload }) => {
        console.error("Could not save recording metadata:", payload);
        void commands.getSettings().then(settings =>
            ui.showErrorModal(getText(settings.language as Parameters<typeof getText>[0], "metadataSaveFailed"))
        );
    });
    listenerManager.listen_app("RecordingFinished", ({ payload }) => {
        void handleRecordingFinished(payload, {
            scheduleRefresh: scheduleRecordingsChangedRefresh,
            getActiveId: ui.getActiveVideoId,
            setVideo,
            loadMetadata: metadata.load,
            scheduleMetadataRetry: metadata.scheduleRetry,
            popup: () => {
                ui.showWindow();
                ui.setFullscreen(false);
            },
        }).catch(error => console.error("Could not show finished recording:", error));
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
        const mouseConfig = keybinds.getMouse();
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
        getRecordingsSnapshot: refreshRecordingsSnapshot,
        setVideo,
        toggleFavorite: async id => {
            const favorite = await commands.toggleFavorite(id);
            if (favorite === null) {
                const settings = await commands.getSettings();
                ui.showErrorModal(getText(settings.language as Parameters<typeof getText>[0], "metadataSaveFailed"));
            }
            return favorite;
        },
        showRenameModal,
        showDeleteModal,
        handleDeleteVideoOnly,
    });
    videoSelection.reconcile(recordings);
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
        getRecordingsList: getVisibleRecordings,
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
    return deleteVideoFlow({
        videoId,
        getActiveVideoId: ui.getActiveVideoId,
        clearPlayerSource: () => { void setVideo(null); },
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
