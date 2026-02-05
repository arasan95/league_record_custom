import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import { type MarkerOptions, MarkersPlugin, type Settings } from "@fffffffxxxxxxx/videojs-markers";

import { convertFileSrc } from "@tauri-apps/api/core";
import { join, sep } from "@tauri-apps/api/path";

import { commands, type GameEvent, type MarkerFlags } from "./bindings";
import ListenerManager from "./listeners";
import UI from "./ui";
import { splitRight, UnreachableError } from "./util";
import { DEFAULT_KEYBINDS, isAction, loadKeybinds, loadMouseConfig, type KeybindMap, type MouseConfig } from "./keybinds";
import { TitleBar } from "./titlebar";
import { initPatchVersion } from "./version";

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

type RecordingEvents = {
    participantId: number;
    recordingOffset: number;
    events: Array<GameEvent>;
};

type HighlightEvents = {
    recordingOffset: number;
    events: Array<number>;
};

let currentEvents: RecordingEvents | null = null;
let highlightEvents: HighlightEvents | null = null;

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
    if (!createClipBtn) return;
    if (loopStart !== null && loopEnd !== null && loopEnd > loopStart) {
        createClipBtn.disabled = false;
    } else {
        createClipBtn.disabled = true;
    }
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
            const newFile = await commands.createClip(videoId, loopStart, loopEnd);
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

console.log(MarkersPlugin);

await main();
async function main() {
    // Check if running in a Tauri environment
    // @ts-ignore
    if (!window.__TAURI_INTERNALS__) {
        console.warn("Tauri internals not found. Backend functionality will be disabled.");
        return;
    }


    // handle context menu based on developer mode
    await initPatchVersion();
    addEventListener("contextmenu", (event) => {
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

    // Tooltip Override Logic using MutationObserver
    // This ensures we catch Video.js updates and correct them immediately based on offset.
    // Tooltip Override Logic using MutationObserver
    // Custom Tooltip Logic - Replaces default Video.js tooltips containing internal video time
    const progressControl = document.querySelector(".vjs-progress-control");
    let customTooltip = document.getElementById("custom-tooltip");
    let customPlayTooltip = document.getElementById("custom-play-tooltip");
    
    // Create tooltips if not exist
    if (playerElement) {
        if (!customTooltip && progressControl) {
            customTooltip = document.createElement("div");
            customTooltip.id = "custom-tooltip";
            playerElement.appendChild(customTooltip);
        }
        if (!customPlayTooltip) {
            customPlayTooltip = document.createElement("div");
            customPlayTooltip.id = "custom-play-tooltip";
            playerElement.appendChild(customPlayTooltip);
        }
    }

    // State for tooltip visibility
    let isProgressHovered = false;
    
    if (progressControl) {
        progressControl.addEventListener("mouseenter", () => { isProgressHovered = true; });
        progressControl.addEventListener("mouseleave", () => { isProgressHovered = false; });
    }

    // Smooth Update Loop for Play Tooltip
    // Fixes "choppy" movement by updating every frame, but keeps resource usage low by checking visibility first.
    const updatePlayTooltipLoop = () => {
         if (customPlayTooltip) {
             // Check if user is scrubbing (dragging) the seek bar. Video.js adds 'vjs-scrubbing' class to the player or control.
             // Usually on the player element or the progress control. Checking playerElement is safest.
             const isDragging = playerElement?.classList.contains("vjs-scrubbing") || 
                                progressControl?.classList.contains("vjs-sliding"); // vjs-sliding is sometimes used

             if (isProgressHovered || isDragging) {
                 const offset = currentEvents?.recordingOffset ?? highlightEvents?.recordingOffset ?? 0;
                 const current = player.currentTime() || 0;
                 const gameTime = current + offset;
                 
                 const mins = Math.floor(gameTime / 60);
                 const secs = Math.floor(gameTime % 60);
                 const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
                 
                 // Update text only if changed to minimize layout thrashing
                 if (customPlayTooltip.textContent !== timeStr) {
                    customPlayTooltip.textContent = timeStr;
                 }
                 customPlayTooltip.style.display = "block";
                 
                 // Sync position with play progress bar end
                 const playProgressBar = document.querySelector(".vjs-play-progress");
                 if (playProgressBar && playerElement) {
                     const barRect = playProgressBar.getBoundingClientRect();
                     const playerRect = playerElement.getBoundingClientRect();
                     // Position at the right edge of the progress bar
                     const relX = barRect.right - playerRect.left;
                     customPlayTooltip.style.left = `${relX}px`;
                 }
             } else {
                 customPlayTooltip.style.display = "none";
             }
         }
         
         requestAnimationFrame(updatePlayTooltipLoop);
    };
    
    // Start the loop
    requestAnimationFrame(updatePlayTooltipLoop);

    if (progressControl && customTooltip) {
        // Mouse Move (Hover Tooltip)
        progressControl.addEventListener("mousemove", (e) => {
             const offset = currentEvents?.recordingOffset ?? highlightEvents?.recordingOffset ?? 0;
             
             const rect = progressControl.getBoundingClientRect();
             const mouseX = (e as MouseEvent).clientX;
             
             // Calculate time
             const x = mouseX - rect.left;
             const width = rect.width;
             const percent = Math.max(0, Math.min(1, x / width));
             const duration = player.duration() || 0;
             const videoTime = percent * duration;
             const gameTime = videoTime + offset;
             
             const mins = Math.floor(gameTime / 60);
             const secs = Math.floor(gameTime % 60);
             const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
             
             if (customTooltip) {
                 customTooltip.textContent = timeStr;
                 customTooltip.style.display = "block";
                 
                 const playerRect = playerElement?.getBoundingClientRect();
                 if (playerRect) {
                     const relX = mouseX - playerRect.left;
                     customTooltip.style.left = `${relX}px`;
                 }
             }
        });

        // Mouse Leave
        progressControl.addEventListener("mouseleave", () => {
             if (customTooltip) {
                 customTooltip.style.display = "none";
             }
        });
    }

    // add events to html elements
    ui.setRecordingsFolderBtnOnClickHandler(commands.openRecordingsFolder);
    ui.setSettingsBtnOnClickHandler(() => {
        commands.getSettings().then(settings => {
             ui.showSettingsModal(settings, async (s) => { 
                 await commands.saveSettings(s); 
                 
                 // Update developer mode state
                 (window as any)._developerModeEnabled = s.developerMode;
                 if (s.developerMode) {
                     document.body.classList.add("selectable");
                 } else {
                     document.body.classList.remove("selectable");
                 }

                 const activeId = ui.getActiveVideoId();
                 if (activeId) {
                     await setMetadata(activeId);
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
    addEventListener("keydown", handleKeyboardEvents);

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
    listenerManager.listen_app("RecordingsChanged", async () => {
        const recordings = await updateSidebar();
        checkLatestAndRetry(recordings);
    });
    listenerManager.listen_app("MarkerflagsChanged", () =>
        commands.getMarkerFlags().then((flags) => ui.setMarkerFlags(flags)),
    );
    listenerManager.listen_app("MetadataChanged", ({ payload }) => {
        const activeVideoId = ui.getActiveVideoId();
        
        // 1. Partial Sidebar Update (Refresh List Items)
        payload.forEach(videoId => {
            commands.getMetadata(videoId).then(metadata => {
                // Construct strictly typed Recording object
                const recording = { videoId, metadata }; 
                ui.updateRecordingItem(recording);
            });
        });

        // 2. Active Video Update (Refresh Detail View)
        if (activeVideoId !== null && payload.includes(activeVideoId)) {
            // update metadata for currently selected recording
            setMetadata(activeVideoId);
        }
    });
    
    listenerManager.listen_app("RecordingStarted", () => {
        commands.getSettings().then(settings => {
            if (settings.autoStopPlayback) {
                player.pause();
                console.log("Auto-stopped playback due to new game start.");
            }
        });
    });

    listenerManager.listen_app("RecordingFinished", ({ payload }) => {
        const [videoId, isManualStop] = payload;
        if (!isManualStop) {
             commands.getSettings().then(settings => {
                 if (settings.autoSelectRecording) {
                     console.log(`Auto-selecting recording: ${videoId}`);
                     void setVideo(videoId);
                 }
                 if (settings.autoPopupOnEnd) {
                     console.log("Auto-popup triggered");
                     ui.showWindow();
                     // Also unminimize if needed (show() does that usually)
                     ui.setFullscreen(false); // Maybe exit fullscreen to see handled window?
                 }
             });
        }
    });

    // load data
    commands.getMarkerFlags().then(ui.setMarkerFlags);

    // Initialize Auto Buttons
    commands.getSettings().then(settings => {
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

    const videoIds = await updateSidebar();
    checkLatestAndRetry(videoIds);
    const firstVideo = videoIds[0];
    if (firstVideo) {
        void setVideo(firstVideo.videoId, false);
        player.one("canplay", ui.showWindow);
    } else {
        void setVideo(null);
        player.one("ready", ui.showWindow);
    }
}

// --- SIDEBAR, VIDEO PLAYER, DESCRIPTION  ---

// use this function to update the sidebar
async function updateSidebar(forceUpdateIds: string[] = []) {
    const activeVideoId = ui.getActiveVideoId();

    const [recordings, recordingsSize] = await Promise.all([
        commands.getRecordingsList(),
        commands.getRecordingsSize(),
    ]);
    ui.updateSideBar(recordingsSize, recordings, setVideo, commands.toggleFavorite, showRenameModal, showDeleteModal, forceUpdateIds);

    if (!ui.setActiveVideoId(activeVideoId)) {
        void setVideo(null);
    }

    // Check latest recording for Unknown status and retry if needed
    // Logic moved to checkLatestAndRetry called by consumers
    return recordings;
}

function checkLatestAndRetry(recordings: any[]) {
    if (recordings.length > 0) {
        const latest = recordings[0];
        // Clips never have metadata, so don't retry for them
        if (latest.videoId.includes("_clip_")) {
            return;
        }

        let isUnknown = !latest.metadata || ("NoData" in latest.metadata);
        
        if (!isUnknown && latest.metadata && "Metadata" in latest.metadata) {
             const m = latest.metadata.Metadata;
             // Check if queue is missing OR named Unknown Queue (or contains Unknown)
             if (!m.queue || !m.queue.name || m.queue.name.toLowerCase().includes("unknown")) {
                 isUnknown = true;
             }
        }

        if (isUnknown) {
            console.log(`Latest recording ${latest.videoId} is Unknown. Scheduling retries...`);
            retrySidebarUpdate(10, latest.videoId);
        }
    }
}

async function retrySidebarUpdate(attemptsLeft: number, targetId: string) {
    if (attemptsLeft <= 0) return;

    setTimeout(async () => {
        try {
            console.log(`Retrying Sidebar Update for ${targetId}... Attempts left: ${attemptsLeft}`);
            // Force update the specific item to bypass cache, ensuring F5-like behavior
            const recordings = await updateSidebar([targetId]);
            
            if (recordings.length > 0) {
                // 1. Try to find the original target
                let latest = recordings.find(r => r.videoId === targetId);
                let currentTargetId = targetId;

                // 2. If lost (renamed?), switch tracking to the ACTUAL latest recording
                if (!latest) {
                    console.log(`Target ID ${targetId} lost. Switching focus to latest recording.`);
                    latest = recordings[0];
                    currentTargetId = latest.videoId;
                }
                
                if (latest) {
                    let isUnknown = !latest.metadata || ("NoData" in latest.metadata);
                    
                    if (!isUnknown && latest.metadata && "Metadata" in latest.metadata) {
                        const m = latest.metadata.Metadata;
                        // Queue missing or "Unknown Queue" -> keep retrying
                        if (!m.queue || m.queue.name === "Unknown Queue") {
                            isUnknown = true;
                        }
                    }

                    if (isUnknown) {
                        retrySidebarUpdate(attemptsLeft - 1, currentTargetId);
                    } else {
                        console.log("Retry successful: Data is valid.");
                    }
                }
            }
        } catch (e) {
            console.error("Error in retry loop:", e);
            retrySidebarUpdate(attemptsLeft - 1, targetId);
        }
    }, 1000); // 1 second interval
}


// use this function to set the video (null => no video)
async function setVideo(videoId: string | null, allowAutoplay: boolean = true) {
    if (videoId === ui.getActiveVideoId()) {
        return;
    }

    if (videoId === null) {
        player.src("");
    } else {
        const settings = await commands.getSettings();
        // VideoId is now an absolute path, so we use it directly
        ui.setActiveVideoId(videoId);
        setMetadata(videoId);
        player.src({ type: "video/mp4", src: convertFileSrc(videoId) });
        if (settings.autoplayVideo && allowAutoplay) {
            void player.play()?.catch(() => {});
        }
    }
}

async function setMetadata(videoId: string) {
    const data = await commands.getMetadata(videoId);
    if (data && "Metadata" in data) {
        ui.showMarkerFlags(true);
        ui.setVideoDescriptionMetadata(data.Metadata);
        // Ensure UI offset is set (redundant but safe)
        ui.setRecordingOffset(data.Metadata.ingameTimeRecStartOffset);

        currentEvents = {
            participantId: data.Metadata.participantId,
            recordingOffset: data.Metadata.ingameTimeRecStartOffset,
            events: data.Metadata.events,
        };
        highlightEvents = {
            recordingOffset: data.Metadata.ingameTimeRecStartOffset,
            events: data.Metadata.highlights ?? [],
        };
    } else if (data && "Deferred" in data) {
        ui.showMarkerFlags(false);
        // Explicitly set offset for UI as setVideoDescriptionMetadata is NOT called
        ui.setRecordingOffset(data.Deferred.ingameTimeRecStartOffset);
        
        currentEvents = null;
        highlightEvents = {
            recordingOffset: data.Deferred.ingameTimeRecStartOffset,
            events: data.Deferred.highlights ?? [],
        };
    } else {
        ui.showMarkerFlags(false);
        ui.setRecordingOffset(0);
        currentEvents = null;
        highlightEvents = null;
    }

    changeMarkers();
}

function changeMarkers() {
    const markers = new Array<MarkerOptions>();

    if (highlightEvents !== null) {
        for (const event of highlightEvents.events) {
            markers.push(createMarker(event, highlightEvents.recordingOffset, "Highlight"));
        }
    }

    if (currentEvents !== null) {
        const checkbox = ui.getMarkerFlags();
        const { participantId, recordingOffset } = currentEvents;

        for (const event of currentEvents.events) {
            const name = eventName(event, participantId, checkbox);
            if (name === null) {
                continue;
            }
            markers.push(createMarker(event.timestamp, recordingOffset, name));
        }
    }

    player.markers().removeAll();
    player.markers().add(markers);
}

type EventType =
    | "Kill"
    | "Death"
    | "Assist"
    | "Turret"
    | "Inhibitor"
    | "Voidgrub"
    | "Herald"

    | "Baron"
    | "Infernal-Dragon"
    | "Ocean-Dragon"
    | "Mountain-Dragon"
    | "Cloud-Dragon"
    | "Hextech-Dragon"
    | "Chemtech-Dragon"
    | "Elder-Dragon"
    | "Highlight";

function eventName(gameEvent: GameEvent, participantId: number, checkbox: MarkerFlags | null): EventType | null {
    if ("ChampionKill" in gameEvent) {
        if ((checkbox?.kill ?? true) && gameEvent.ChampionKill.killer_id === participantId) {
            return "Kill";
        }
        if ((checkbox?.assist ?? true) && gameEvent.ChampionKill.assisting_participant_ids.includes(participantId)) {
            return "Assist";
        }
        if ((checkbox?.death ?? true) && gameEvent.ChampionKill.victim_id === participantId) {
            return "Death";
        }
    } else if ("BuildingKill" in gameEvent) {
        if ((checkbox?.structure ?? true) && gameEvent.BuildingKill.building_type.buildingType === "TOWER_BUILDING") {
            return "Turret";
        }
        if ((checkbox?.structure ?? true) && gameEvent.BuildingKill.building_type.buildingType === "INHIBITOR_BUILDING") {
            return "Inhibitor";
        }
    } else if ("EliteMonsterKill" in gameEvent) {
        const monsterType = gameEvent.EliteMonsterKill.monster_type;
        if ((checkbox?.voidgrub ?? true) && monsterType.monsterType === "HORDE" && gameEvent.EliteMonsterKill.killer_id > 0) {
            return "Voidgrub";
        }
        if ((checkbox?.herald ?? true) && monsterType.monsterType === "RIFTHERALD") {
            return "Herald";
        }

        if ((checkbox?.baron ?? true) && monsterType.monsterType === "BARON_NASHOR") {
            return "Baron";
        }
        if ((checkbox?.dragon ?? true) && monsterType.monsterType === "DRAGON") {
            switch (monsterType.monsterSubType) {
                case "FIRE_DRAGON":
                    return "Infernal-Dragon";
                case "EARTH_DRAGON":
                    return "Mountain-Dragon";
                case "WATER_DRAGON":
                    return "Ocean-Dragon";
                case "AIR_DRAGON":
                    return "Cloud-Dragon";
                case "HEXTECH_DRAGON":
                    return "Hextech-Dragon";
                case "CHEMTECH_DRAGON":
                    return "Chemtech-Dragon";
                case "ELDER_DRAGON":
                    return "Elder-Dragon";
                default:
                    throw new UnreachableError(monsterType.monsterSubType);
            }
        }
    }

    return null;
}

function createMarker(timestamp: number, recordingOffset: number, eventType: EventType): MarkerOptions {
    return {
        time: timestamp / 1000 - recordingOffset - EVENT_DELAY,
        text: eventType,
        class: eventType.toLowerCase(),
        duration: 2 * EVENT_DELAY,
    };
}

// --- MODAL ---

async function showRenameModal(videoId: string) {
    ui.showRenameModal(
        videoId,
        (await commands.getRecordingsList()).map((r) => r.videoId),
        renameVideo,
    );
}

async function renameVideo(videoId: string, newVideoId: string) {
    const activeVideoId = ui.getActiveVideoId();

    const ok = await commands.renameVideo(videoId, newVideoId);
    if (ok) {
        if (videoId === activeVideoId) {
            const time = player.currentTime()!;
            void updateSidebar();
            setVideo(newVideoId).then(() => player.currentTime(time));
        }
    } else {
        ui.showErrorModal("Error renaming video!");
    }
}

function showDeleteModal(videoId: string) {
    // eslint-disable-next-line always-return
    commands.confirmDelete().then((confirmDelete) => {
        if (confirmDelete) {
            ui.showDeleteModal(videoId, deleteVideo);
        } else {
            deleteVideo(videoId);
        }
    });
}

async function deleteVideo(videoId: string) {
    if (videoId === ui.getActiveVideoId()) {
        player.src(null);
    }

    const ok = await commands.deleteVideo(videoId);
    if (!ok) {
        ui.showErrorModal("Error deleting video!");
    }
}

async function showTimestamps() {
    const timelineEvents = new Array<{ timestamp: number; text: string }>();

    if (highlightEvents !== null) {
        for (const event of highlightEvents.events) {
            timelineEvents.push({ timestamp: event, text: `${formatTimestamp(event)} Highlight` });
        }
    }

    if (currentEvents !== null) {
        for (const event of currentEvents.events) {
            const name = eventName(event, currentEvents.participantId, null);
            if (name !== null) {
                const text = `${formatTimestamp(event.timestamp)} ${name}`;
                const timestamp = event.timestamp;
                timelineEvents.push({ timestamp, text });
            }
        }
    }

    const settings = await commands.getSettings();
    ui.showTimelineModal(
        timelineEvents.toSorted((a, b) => a.timestamp - b.timestamp),
        (secs) => player.currentTime(secs / 1000 - EVENT_DELAY),
    );
}

function formatTimestamp(timestamp: number): string {
    let secs = timestamp / 1000;

    let minutes = Math.floor(secs / 60);
    secs -= minutes * 60;

    const hours = Math.floor(minutes / 60);
    minutes -= hours * 60;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${Math.floor(secs).toString().padStart(2, "0")}`;
}

// --- KEYBOARD SHORTCUTS ---

function handleKeyboardEvents(event: KeyboardEvent) {
    if (ui.modalIsOpen()) {
        // Allow Escape to close modal, unless captured by rebind logic (which should stop prop before here)
        if (event.key === "Escape") {
             ui.hideModal();
        }
        return;
    } 

    if (ui.getActiveVideoId() === null) return;

    let handled = false;
    const binds = currentKeybinds;

    // Check actions
    if (isAction(event, "playPause", binds)) {
            player.paused() ? player.play() : player.pause();
            handled = true;
    }
    // Shift checks must come before non-shift if they share keys? 
    // No, isAction checks exact modifier match. So Shift+Right won't trigger Right (shift=false).
    else if (isAction(event, "nextEvent", binds)) {
        player.markers().next();
        handled = true;
    }
    else if (isAction(event, "prevEvent", binds)) {
        player.markers().prev();
        handled = true;
    }
    else if (isAction(event, "seekForward", binds)) {
        player.currentTime(player.currentTime()! + 5);
        handled = true;
    }
    else if (isAction(event, "seekBackward", binds)) {
        player.currentTime(player.currentTime()! - 5);
        handled = true;
    }
    else if (isAction(event, "volUp", binds)) {
            player.volume(player.volume()! + 0.1);
            handled = true;
    }
    else if (isAction(event, "volDown", binds)) {
            player.volume(player.volume()! - 0.1);
            handled = true;
    }
    else if (isAction(event, "fullscreen", binds)) {
            player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
            handled = true;
    }
    else if (isAction(event, "mute", binds)) {
            player.muted(!player.muted());
            handled = true;
    }
    else if (isAction(event, "speedUp", binds)) {
            if (player.playbackRate()! < 3) player.playbackRate(player.playbackRate()! + 0.25);
            handled = true;
    }
    else if (isAction(event, "speedDown", binds)) {
            if (player.playbackRate()! > 0.25) player.playbackRate(player.playbackRate()! - 0.25);
            handled = true;
    }
    else if (isAction(event, "exitFullscreen", binds)) {
        if (player.isFullscreen()) player.exitFullscreen();
        handled = true;
    }
    else if (isAction(event, "setLoopA", binds)) {
        const now = player.currentTime();
        if (now !== undefined) {
            loopStart = now;
            if (loopStartInput) loopStartInput.value = formatLoopTime(now);
            updateClipBtnState();
        }
        handled = true;
    }
    else if (isAction(event, "setLoopB", binds)) {
        const now = player.currentTime();
         if (now !== undefined) {
            loopEnd = now;
            if (loopEndInput) loopEndInput.value = formatLoopTime(now);
            updateClipBtnState();
            
            // Auto-enable if valid
            if (loopStart !== null && loopEnd > loopStart) {
                isLooping = true;
                if (loopEnabledCheckbox) loopEnabledCheckbox.checked = true;
            }
        }
        handled = true;
    }
    else if (isAction(event, "toggleLoop", binds)) {
        if (loopEnabledCheckbox) {
            loopEnabledCheckbox.checked = !loopEnabledCheckbox.checked;
            isLooping = loopEnabledCheckbox.checked;
        }
        handled = true;
    }
    else if (isAction(event, "stepForward", binds)) {
        player.currentTime(player.currentTime()! + 0.03);
        handled = true;
    }
    else if (isAction(event, "stepBackward", binds)) {
        player.currentTime(player.currentTime()! - 0.03);
        handled = true;
    }
    else if (isAction(event, "resetSpeed", binds)) {
        player.playbackRate(1.0);
        handled = true;
    }
    else if (isAction(event, "nextVideo", binds)) {
        ui.playNextVideo();
        handled = true;
    }
    else if (isAction(event, "prevVideo", binds)) {
        ui.playPrevVideo();
        handled = true;
    }
    
    // Legacy support for Enter on play/pause if desired? 
    // User requested specifically Space. If they want Enter they can rebind it.

    if (handled) {
        event.preventDefault();
    }
}
