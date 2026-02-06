import type videojs from "video.js";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { SR_QUEUES } from "./queues";
import type { ContentDescriptor } from "video.js/dist/types/utils/dom";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";

import { commands, type GameMetadata, type GoldFrame, type ParticipantGold, type MarkerFlags, type Recording, type Settings, type MatchTeam, type Participant, type GameEvent } from "./bindings";
import { getChampionIconUrl, getChampionIconUrlById, getItemIconUrl, getRuneIconUrl, getSpellIconUrl, downloadAllAssets, ensureItemDataLoaded, getItemPrice } from "./datadragon";
import { getCurrentPatchVersion, getSpawnTimers } from "./version";
import { InventoryTimeline } from "./timeline";
import { getObjectiveConfig } from "./objectives";
import { formatKeyCombo, saveKeybinds, keyComboToBackendString, loadMouseConfig, saveMouseConfig, type ActionName, type KeyCombo, type MouseConfig } from "./keybinds";


import { currentKeybinds, reloadKeybinds } from "./main";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

import { toVideoId, toVideoName, isFavorite } from "./util";

import monoTower from "../assets/match-history-icons/mono-tower.png";
import monoVoidgrub from "../assets/match-history-icons/mono-voidgrub.png";
import monoDrake from "../assets/match-history-icons/mono-drake.png";
import monoBaron from "../assets/match-history-icons/mono-baron.png";
import monoHerald from "../assets/match-history-icons/mono-herald.png";

let appWindow: WebviewWindow | null = null;
try {
    appWindow = getCurrentWebviewWindow();
} catch (error) {
    console.warn("Failed to get current window (likely running in browser):", error);
}

export default class UI {
    private readonly modal;
    private readonly modalContent;
    private readonly sidebar;
    private readonly videoFolderBtn;
    private readonly settingsBtn;
    // private readonly recordingsSize; // Removed
    private readonly autoStopCb;
    private readonly autoPlayCb;
    private readonly autoSelectCb;
    private readonly autoPopupCb;

    private readonly filterStarBtn;
    private readonly filterClipBtn;
    private readonly filterRankedBtn;
    private readonly filterSearchBtn;
    private readonly searchBarContainer;
    private readonly searchInput;

    // Storage Elements
    private readonly segClip;
    private readonly segStar;
    private readonly segNorm;
    private readonly sizeTotalText;
    private readonly sizeMaxText;

    private maxStorageGb: number = 0; // Loaded from settings

    private filterStar = false;
    private filterClip = false;
    private filterRanked = false;
    private filterSearch = false;
    private searchQuery = "";
    
    // Store latest recordings to re-render locally
    private lastRecordings: ReadonlyArray<Recording> = [];

    private currentQueueId: number = 0;



    private readonly checkboxKill;
    private readonly checkboxDeath;
    private readonly checkboxAssist;
    private readonly checkboxStructure;
    private readonly checkboxDragon;
    private readonly checkboxVoidgrub;
    private readonly checkboxHerald;
    
    private readonly checkboxBaron;
    
    private videoHeader: HTMLElement | null = null;
    private player: any = null;
    
    private sidebarContainer: HTMLDivElement | null = null;
    private scoreboardEl: HTMLElement | null = null;
    private scoreboardScale: number | null = null;
    
    // Core methods
    
    public setSidebarWidth(newWidth: number) {
        if (!this.sidebarContainer) return;
        const container = document.getElementById("container");

        // Max Cap (325px)
        const MAX_WIDTH = 325;
        if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;

        const dateLimit = 220; 
        const collapseLimit = 80;

        // Compact Class
        if (newWidth < dateLimit) {
            this.sidebarContainer.classList.add("sidebar-compact");
        } else {
            this.sidebarContainer.classList.remove("sidebar-compact");
        }

        // Collapsed Class
        if (newWidth < collapseLimit) {
            this.sidebarContainer.classList.add("sidebar-collapsed");
            if (container) container.style.setProperty("--sidebar-width", "15px");
            
            const info = this.sidebarContainer.querySelector("#sidebar-info");
            const content = this.sidebarContainer.querySelector("#sidebar-content");
            if (info) (info as any).style.zoom = "1";
            if (content) (content as any).style.zoom = "1";
            return; 
        } else {
            this.sidebarContainer.classList.remove("sidebar-collapsed");
        }

        // Apply Width
        if (container) container.style.setProperty("--sidebar-width", `${newWidth}px`);
        
        // Scale logic
        let targetBase = MAX_WIDTH;
        if (newWidth < dateLimit) targetBase = 220;
        
        let scale = newWidth / targetBase;
        scale = Math.max(scale, 0.4); 
        scale = Math.min(scale, 1.2); 

        const info = this.sidebarContainer.querySelector("#sidebar-info");
        if (info) (info as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
        if (this.sidebar) (this.sidebar as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
    }

    public setScoreboardHeight(targetHeight: number, baseHeight: number) {
        if (!this.scoreboardEl) return;
        
        if (targetHeight < 40) {
            this.scoreboardEl.classList.add("collapsed");
            (this.scoreboardEl.style as any).zoom = ""; 
            this.scoreboardEl.style.removeProperty("height");
            return;
        }

        this.scoreboardEl.classList.remove("collapsed");
        this.scoreboardEl.style.removeProperty("height");
        
        let newZoom = targetHeight / baseHeight;
        newZoom = Math.max(newZoom, 0.2); 
        newZoom = Math.min(newZoom, 1.5);

        (this.scoreboardEl.style as any).zoom = newZoom.toFixed(3);
    }
    
    public checkWindowSize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        
        // Sidebar Responsive
        if (w < 800) {
            this.setSidebarWidth(79); 
        } else if (w < 1200) { 
             this.setSidebarWidth(219);
        } else {
             this.setSidebarWidth(325);
        }
        
        // Scoreboard Responsive
        const SB_BASE = 220;
        const SCALE_START_H = 850; // Above this, max size
        const SCALE_END_H = 600;   // Below this, collapse

        if (this.scoreboardScale !== null && this.scoreboardScale > 0) {
            this.setScoreboardHeight(this.scoreboardScale * SB_BASE, SB_BASE);
            // If we want to strictly enforce "zoom", setScoreboardHeight does that via zoom property.
            // But we might want to respect the "Force collapse" if window is TINY?
            // "height returns to prescribed" - User dislikes the auto-reset.
            // Let's assume user setting overrides everything except maybe extreme cases?
            // Actually, simply returning here ensures user setting sticks.
            return;
        }

        if (h <= SCALE_END_H) {
            this.setScoreboardHeight(30, SB_BASE); // Force collapse
        } else if (h >= SCALE_START_H) {
            this.setScoreboardHeight(SB_BASE, SB_BASE); // Max size
        } else {
            // Linear interpolate between Min Visible and Max
            const MIN_VISIBLE = 90;
            const MAX_VISIBLE = SB_BASE;
            
            const ratio = (h - SCALE_END_H) / (SCALE_START_H - SCALE_END_H);
            const targetH = MIN_VISIBLE + (MAX_VISIBLE - MIN_VISIBLE) * ratio;
            
            this.setScoreboardHeight(targetH, SB_BASE);
        }
    }

    private timeline: InventoryTimeline | null = null;
    private scoreboardRefs: Map<number, { items: HTMLImageElement[], trinket: HTMLImageElement, goldText: HTMLElement, participantId: number }> = new Map();
    private goldTimeline: GoldFrame[] = [];
    private goldDiffRefs: HTMLElement[] = [];
    private participants: Participant[] = [];
    
    private team100GoldText: HTMLElement | null = null;
    private team200GoldText: HTMLElement | null = null;
    private team100LeadText: HTMLElement | null = null;
    private team200LeadText: HTMLElement | null = null;
    private team100KillsText: HTMLElement | null = null;
    private team200KillsText: HTMLElement | null = null;
    private team100TowerText: HTMLElement | null = null;
    private team200TowerText: HTMLElement | null = null;
    private team100DragonText: HTMLElement | null = null;
    private team200DragonText: HTMLElement | null = null;
    private team100BaronText: HTMLElement | null = null;
    private team200BaronText: HTMLElement | null = null;
    private team100VoidgrubText: HTMLElement | null = null;
    private team200VoidgrubText: HTMLElement | null = null;
    private team100HeraldText: HTMLElement | null = null;
    private team200HeraldText: HTMLElement | null = null;


    private baronTimerText: HTMLElement | null = null;
    private baronTimerIcon: HTMLImageElement | null = null;
    private baronTimerGroup2: HTMLElement | null = null;
    private baronTimerText2: HTMLElement | null = null;
    private baronTimerIcon2: HTMLImageElement | null = null;
    private dragonTimerText: HTMLElement | null = null;
    private dragonTimerIcon: HTMLImageElement | null = null;

    private headerTimeText: HTMLElement | null = null;

    private kdaRefs: HTMLElement[] = [];
    private csRefs: HTMLElement[] = [];
    
    private events: GameEvent[] = [];
    private recordingOffset: number = 0;
    private metadataRenderId = 0;
    private currentGameVersion: string = "";
    private scrollFrameStepModifier: string = "Shift";
    private seekTarget: number | null = null;
    private seekDebounce: any = null; // Timeout ID
    private seekRaf: number | null = null;
    private frameDuration: number = 1/60; // Default to 60fps

    private readonly vjs: typeof videojs;

    constructor(vjs: typeof videojs) {
        this.vjs = vjs;

        this.modal = document.querySelector<HTMLDivElement>("#modal")!;
        this.modalContent = document.querySelector<HTMLDivElement>("#modal-content")!;
        this.sidebar = document.querySelector<HTMLUListElement>("#sidebar-content")!;
        this.videoFolderBtn = document.querySelector<HTMLButtonElement>("#vid-folder-btn")!;
        this.settingsBtn = document.querySelector<HTMLButtonElement>("#settings-btn")!;
        // this.recordingsSize = document.querySelector<HTMLSpanElement>("#size-inner")!; // Removed in favor of storage bar
        this.autoStopCb = document.querySelector<HTMLInputElement>("#auto-stop-cb")!;
        this.autoPlayCb = document.querySelector<HTMLInputElement>("#auto-play-cb")!;
        this.autoSelectCb = document.querySelector<HTMLInputElement>("#auto-select-cb")!;
        this.autoPopupCb = document.querySelector<HTMLInputElement>("#auto-popup-cb")!;

        this.filterStarBtn = document.querySelector<HTMLButtonElement>("#filter-star-btn")!;
        this.filterClipBtn = document.querySelector<HTMLButtonElement>("#filter-clip-btn")!;
        this.filterRankedBtn = document.querySelector<HTMLButtonElement>("#filter-ranked-btn")!;
        this.filterSearchBtn = document.querySelector<HTMLButtonElement>("#filter-search-btn")!;
        this.searchBarContainer = document.querySelector<HTMLDivElement>("#search-bar-container")!;
        this.searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
        
        // Storage Elements
        this.segClip = document.querySelector<HTMLDivElement>(".seg-clip")!;
        this.segStar = document.querySelector<HTMLDivElement>(".seg-star")!;
        this.segNorm = document.querySelector<HTMLDivElement>(".seg-norm")!;
        this.sizeTotalText = document.querySelector<HTMLSpanElement>("#size-total")!;
        this.sizeMaxText = document.querySelector<HTMLSpanElement>("#size-max")!;
        
        // Resize Handler for Physical Pixel Layout
        this.handleResize(); // Initial check
        window.addEventListener("resize", this.handleResize);
        
        // Filter Click Handlers
        if (this.filterStarBtn) {
            this.filterStarBtn.addEventListener("click", () => {
                this.filterStar = !this.filterStar;
                
                // Toggle active class updates visual state
                if (this.filterStar) {
                    this.filterStarBtn.classList.add("active");
                    this.filterStarBtn.style.color = "gold";
                } else {
                    this.filterStarBtn.classList.remove("active");
                    this.filterStarBtn.style.color = "";
                }
                
                // Re-render sidebar with current list
                // We need to pass the callbacks again. 
                // Issue: callbacks are passed in updateSideBar. 
                // Solution: Store callbacks or just trigger a refresh from main if possible?
                // Or better: updateSideBar is the render function. 
                // We can just call it again if we have the data.
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }

        if (this.filterClipBtn) {
            this.filterClipBtn.addEventListener("click", () => {
                this.filterClip = !this.filterClip;
                
                if (this.filterClip) {
                    this.filterClipBtn.classList.add("active");
                    this.filterClipBtn.style.color = "#00d2ff"; // Cyan for clips
                } else {
                    this.filterClipBtn.classList.remove("active");
                    this.filterClipBtn.style.color = "";
                }
                
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }

        if (this.filterRankedBtn) {
            this.filterRankedBtn.addEventListener("click", () => {
                this.filterRanked = !this.filterRanked;
                
                if (this.filterRanked) {
                    this.filterRankedBtn.classList.add("active");
                    this.filterRankedBtn.style.color = "#2de09e"; // Greenish for rank
                } else {
                    this.filterRankedBtn.classList.remove("active");
                    this.filterRankedBtn.style.color = "";
                }
                
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }

        if (this.filterSearchBtn) {
            this.filterSearchBtn.addEventListener("click", () => {
                this.filterSearch = !this.filterSearch;

                if (this.filterSearch) {
                    this.filterSearchBtn.classList.add("active");
                    this.filterSearchBtn.style.color = "#ffaa00"; // Orange for search
                    if (this.searchBarContainer) {
                         this.searchBarContainer.style.display = "block";
                         if (this.searchInput) this.searchInput.focus();
                    }
                } else {
                    this.filterSearchBtn.classList.remove("active");
                    this.filterSearchBtn.style.color = "";
                    if (this.searchBarContainer) this.searchBarContainer.style.display = "none";
                    
                    // Clear search on close
                    if (this.searchQuery !== "") {
                        this.searchQuery = "";
                        if (this.searchInput) this.searchInput.value = "";
                        if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
                    }
                }
            });
        }
        
        if (this.searchInput) {
            this.searchInput.addEventListener("input", (e) => {
                this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }

        this.checkboxKill = document.querySelector<HTMLInputElement>("#kill")!;
        this.checkboxDeath = document.querySelector<HTMLInputElement>("#death")!;
        this.checkboxAssist = document.querySelector<HTMLInputElement>("#assist")!;
        this.checkboxStructure = document.querySelector<HTMLInputElement>("#structure")!;
        this.checkboxDragon = document.querySelector<HTMLInputElement>("#dragon")!;
        this.checkboxVoidgrub = document.querySelector<HTMLInputElement>("#voidgrub")!;
        this.checkboxHerald = document.querySelector<HTMLInputElement>("#herald")!;
        
        this.checkboxBaron = document.querySelector<HTMLInputElement>("#baron")!;
        
        // --- Sidebar Resizing Logic ---
        this.sidebarContainer = document.querySelector<HTMLDivElement>("#sidebar")!;
        if (this.sidebarContainer) {
            const handle = document.createElement("div");
            handle.className = "sidebar-resize-handle";
            this.sidebarContainer.appendChild(handle);

            let startX = 0;
            let startWidth = 0;
            const container = document.getElementById("container");

            const onMouseMove = (e: MouseEvent) => {
                const dx = e.clientX - startX;
                let newWidth = startWidth + dx;

                this.setSidebarWidth(newWidth);
            };

            const stopDrag = () => {
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", stopDrag);
                document.body.style.cursor = "";
            };

            handle.addEventListener("mousedown", (e: MouseEvent) => {
                e.preventDefault();
                startX = e.clientX;
                if (this.sidebarContainer) {
                    const rect = this.sidebarContainer.getBoundingClientRect();
                    startWidth = rect.width;
                }
                document.body.style.cursor = "col-resize";
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", stopDrag);
            });
        }
        
        // Window Resize Listener for Responsive UI
        window.addEventListener("resize", () => this.checkWindowSize());
        // Initial check
        setTimeout(() => this.checkWindowSize(), 500); // Delay slightly for init

        // Load initial settings for modifier
        commands.getSettings().then(s => {
            if ((s as any).scrollFrameStepModifier) {
                this.scrollFrameStepModifier = (s as any).scrollFrameStepModifier;
            }
            if (s.framerate && Array.isArray(s.framerate) && s.framerate.length === 2 && s.framerate[0] > 0) {
                this.frameDuration = s.framerate[1] / s.framerate[0];
            }
            if (s.maxRecordingsSizeGb) {
                this.maxStorageGb = s.maxRecordingsSizeGb;
            } else {
                this.maxStorageGb = 0; // Unlimited or unknown
            }
            if (s.scoreboardScale) {
                this.scoreboardScale = s.scoreboardScale;
            }
        }).catch(err => console.error("Failed to load settings:", err));
    }

    public setPlayer = (player: any) => {
        this.player = player;
        
        if (this.player) {
            this.player.ready(() => {
                const el = this.player.el();
                if (el) {
                    el.addEventListener("wheel", (e: WheelEvent) => {
                        let isModifierPressed = false;
                        if (this.scrollFrameStepModifier === "Shift") isModifierPressed = e.shiftKey;
                        else if (this.scrollFrameStepModifier === "Ctrl") isModifierPressed = e.ctrlKey;
                        else if (this.scrollFrameStepModifier === "Alt") isModifierPressed = e.altKey;
                        else if (this.scrollFrameStepModifier === "Meta") isModifierPressed = e.metaKey;
                        else if (this.scrollFrameStepModifier === "None") isModifierPressed = true;

                        if (isModifierPressed) {
                            e.preventDefault();
                            e.stopImmediatePropagation(); // Use stopImmediatePropagation to ensure other listeners (like speed control) don't fire
                            
                            
                            // User Request: Smooth low-latency scrolling
                            // Logic: Track target time independently to avoid read-back lag from player.currentTime()
                            
                            const step = this.frameDuration;
                            const direction = e.deltaY > 0 ? -1 : 1; 

                            // Initialize target from current time if starting a new sequence
                            if (this.seekTarget === null) {
                                // Pause playback on start of scroll to prioritize seeking resources and prevent conflict
                                if (!this.player.paused()) {
                                    this.player.pause();
                                }
                                this.seekTarget = this.player.currentTime();
                            }

                            // Update target IMMEDIATELY
                            this.seekTarget! += (step * direction);
                            if (this.seekTarget! < 0) this.seekTarget = 0;
                            // Optional: Clamp to duration if available
                            const duration = this.player.duration();
                            if (duration && this.seekTarget! > duration) this.seekTarget = duration;

                            // Debounce the reset of the sequence
                            if (this.seekDebounce) clearTimeout(this.seekDebounce);
                            this.seekDebounce = setTimeout(() => {
                                this.seekTarget = null;
                            }, 200);

                            // Apply via RAF to avoid choking the browser/player
                            if (!this.seekRaf) {
                                this.seekRaf = requestAnimationFrame(() => {
                                    if (this.seekTarget !== null) {
                                        // Use fastSeek if available/supported for lower latency, though less precise?
                                        // For frame-by-frame, accuracy is key. Standard property set is best.
                                        // However, ensure we don't spam if the player is still seeking?
                                        // Checking seeking() prop might help but could drop inputs.
                                        // Just setting currentTime via RAF is the standard "smooth scrub" pattern.
                                        this.player.currentTime(this.seekTarget);
                                    }
                                    this.seekRaf = null;
                                });
                            }
                        }
                    }, { passive: false });
                }
            });
        }
    };

    public showWindow = () => {
        if (appWindow) {
            void appWindow.unminimize();
            void appWindow.show();
            void appWindow.setFocus();
        }
    };

    public setFullscreen = (fullscreen: boolean) => {
        void appWindow?.setFullscreen(fullscreen);
    };

    public setRecordingsFolderBtnOnClickHandler = (handler: (e: MouseEvent) => void) => {
        this.videoFolderBtn.addEventListener("click", handler);
    };

    public setSettingsBtnOnClickHandler = (handler: (e: MouseEvent) => void) => {
        this.settingsBtn.addEventListener("click", handler);
    };

    public setCheckboxOnClickHandler = (handler: (e: MouseEvent) => void) => {
        this.checkboxKill.addEventListener("click", handler);
        this.checkboxDeath.addEventListener("click", handler);
        this.checkboxAssist.addEventListener("click", handler);
        this.checkboxStructure.addEventListener("click", handler);
        this.checkboxDragon.addEventListener("click", handler);
        this.checkboxVoidgrub.addEventListener("click", handler);
        this.checkboxHerald.addEventListener("click", handler);

        this.checkboxBaron.addEventListener("click", handler);
    };
    
    public setAutoPopupOnClickHandler = (handler: (e: MouseEvent) => void) => {
        this.autoPopupCb.addEventListener("click", handler);
    };

    public getAutoPopupState = () => {
        return this.autoPopupCb.checked;
    };
    
    public setAutoPopupState = (checked: boolean) => {
        this.autoPopupCb.checked = checked;
    };




    public setRecordingOffset = (offset: number) => {
        this.recordingOffset = offset;
    };
    
    public updateHeaderTime = (text: string) => {
        if (this.headerTimeText) {
            this.headerTimeText.textContent = text;
        }
    };

    public initVideoHeader = (mainContainer: HTMLElement, playerEl: HTMLElement) => {
        if (this.videoHeader) this.videoHeader.remove();

        this.videoHeader = this.vjs.dom.createEl("div", {}, { id: "video-header" }) as HTMLElement;
        mainContainer.insertBefore(this.videoHeader, playerEl);
    };

    // Store callbacks for re-rendering
    private lastOnVideo: any;
    private lastOnFavorite: any;
    private lastOnRename: any;
    private lastOnDelete: any;
    private lastRecordingsSizeGb: number = 0;
    
    // DOM Cache to prevent image flickering
    private recordingElementMap = new Map<string, HTMLElement>();

    public updateSideBar = (
        recordingsSizeGb: number,
        recordings: ReadonlyArray<Recording>,
        onVideo: (videoId: string) => void,
        onFavorite: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void,
        onDelete: (videoId: string) => void,
        forceUpdateIds: string[] = []
    ) => {
        // Cache data for local re-filtering
        this.lastRecordingsSizeGb = recordingsSizeGb;
        this.lastRecordings = recordings;
        this.lastOnVideo = onVideo;
        this.lastOnFavorite = onFavorite;
        this.lastOnRename = onRename;
        this.lastOnDelete = onDelete;

        // --- UPDATE STORAGE BAR ---
        // Calculate distribution
        let clipCount = 0;
        let starCount = 0;
        let normCount = 0;
        let totalFiles = recordings.length;
        
        recordings.forEach(r => {
             // Logic: Unique categorization for visualization (Clip > Star > Norm)
             // A clip is small, but let's count it.
             // If we really want accurate size, we need file size.
             // We fallback to counts.
             if (r.videoId.includes("_clip")) {
                 clipCount++;
             } else if (isFavorite(r.metadata)) {
                 starCount++;
             } else {
                 normCount++;
             }
        });

        // Avoid division by zero
        if (totalFiles === 0) totalFiles = 1;

        // Proportional GB (Estimation)
        const clipGb = (clipCount / totalFiles) * recordingsSizeGb;
        const starGb = (starCount / totalFiles) * recordingsSizeGb;
        const normGb = (normCount / totalFiles) * recordingsSizeGb; // Reminder to fix precision
        
        // Width Percentages (of Total Capacity OR of Current Usage?)
        // Usually usage bar shows % of Max.
        // But since we have segments, they should stack to Current Usage %.
        
        let maxRef = this.maxStorageGb > 0 ? this.maxStorageGb : (recordingsSizeGb * 1.2); // Fallback if no limit
        if (recordingsSizeGb > maxRef) maxRef = recordingsSizeGb; // Handle overflow

        const clipPct = (clipGb / maxRef) * 100;
        const starPct = (starGb / maxRef) * 100;
        const normPct = (normGb / maxRef) * 100;

        // Update UI
        if (this.segClip) this.segClip.style.width = `${clipPct}%`;
        if (this.segStar) this.segStar.style.width = `${starPct}%`;
        if (this.segNorm) this.segNorm.style.width = `${normPct}%`;
        
        if (this.sizeTotalText) this.sizeTotalText.textContent = recordingsSizeGb.toFixed(1);
        if (this.sizeMaxText) this.sizeMaxText.textContent = this.maxStorageGb > 0 ? this.maxStorageGb.toString() : "∞";

        const videoLiElements = recordings.map((recording, index) => {
            // STRICT FILTERING: If metadata is missing or "Unknown Queue", do NOT display it.
            // User requested: "If it can't be acquired, it's fine to display nothing."
            let shouldHide = true;
            if (recording.metadata && "Metadata" in recording.metadata) {
                const m = recording.metadata.Metadata;
                // Broaden check: If queue is missing OR name contains "Unknown" (case insensitive), hide it ONLY IF STATS ARE MISSING.
                // If stats are present, it's a finished game (e.g. AI game with unmapped ID), so show it.
                if (m.stats || (m.queue && m.queue.name && !m.queue.name.toLowerCase().includes("unknown"))) {
                    shouldHide = false;
                }
                
                // Search Filter
                if (this.searchQuery && this.searchQuery !== "") {
                    // Check champion name
                    const champName = m.championName;
                    if (champName && !champName.toLowerCase().includes(this.searchQuery)) {
                        shouldHide = true;
                    }
                }
            }
            
            // Allow clips to be visible even without metadata
            if (recording.videoId.includes("_clip")) {
                shouldHide = false;
            }
            
            if (shouldHide) {
                return undefined;
            }

            // Retrieve from cache or create new
            let li = this.recordingElementMap.get(recording.videoId);
            const hasMetadata = recording.metadata && ("Metadata" in recording.metadata) && recording.metadata.Metadata.queue.name !== "Unknown Queue";
            
            // Check for forced update OR ALWAYS force update for the latest item (index 0)
            // This guarantees that the latest recording (which changes from Unknown -> Known) is always fresh.
            if (forceUpdateIds.includes(recording.videoId) || index === 0) {
                li = undefined;
            }
            // Invalidate cache if metadata state changed (e.g. Unknown -> Known)
            else if (li) {
                const cachedHasMeta = li.dataset.hasMetadata === "true";
                // Helper to check validity
                const isNowValid = recording.metadata && ("Metadata" in recording.metadata) && 
                    (recording.metadata.Metadata.stats || (recording.metadata.Metadata.queue.name && !recording.metadata.Metadata.queue.name.toLowerCase().includes("unknown")));
                
                if (Boolean(isNowValid) !== cachedHasMeta) {
                     li = undefined; // Force recreate
                }
            }

            if (!li) {
                li = this.createRecordingItem(recording, onVideo, onFavorite, onRename, onDelete);
                this.recordingElementMap.set(recording.videoId, li);
            }

            // Apply Filters (Visibility Toggle)
            let isVisible = true;
            // 1. Star Filter
            if (this.filterStar) {
                if (!isFavorite(recording.metadata)) isVisible = false;
            }
            // 2. Clip Filter
            const isClip = recording.videoId.includes("_clip");
            if (this.filterClip) {
                // If filter is ON, show ONLY clips
                if (!isClip) isVisible = false;
            } else {
                // If filter is OFF, show ONLY normal recordings (hide clips)
                if (isClip) isVisible = false;
            }
            // 3. Ranked Filter
            if (this.filterRanked) {
                if (recording.metadata && "Metadata" in recording.metadata) {
                    const m = recording.metadata.Metadata;
                    if (!m.queue || !m.queue.isRanked) {
                        isVisible = false;
                    }
                } else {
                    // No metadata = Unknown, assume not ranked
                    isVisible = false;
                }
            }


            if (isVisible) {
                li.style.display = "";
            } else {
                li.style.display = "none";
            }
            
            return li;
        }).filter(li => li !== undefined) as HTMLElement[];
        
        // Prune Loop: Remove map entries not in current recordings (handle deletion/rename)
        if (recordings.length !== this.recordingElementMap.size) {
             const currentIds = new Set(recordings.map(r => r.videoId));
             for (const id of this.recordingElementMap.keys()) {
                 if (!currentIds.has(id)) {
                     this.recordingElementMap.delete(id);
                 }
             }
        }

        this.vjs.dom.insertContent(this.sidebar, videoLiElements);
        // this.vjs.dom.insertContent(this.recordingsSize, recordingsSizeGb.toFixed(2).toString()); // Removed
    };

    public createRecordingItem = (
        recording: Recording,
        onVideo: (videoId: string) => void,
        onFavorite: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void,
        onDelete: (videoId: string) => void,
    ) => {
        const videoName = toVideoName(recording.videoId);
        let displayContent: HTMLElement[] = [this.vjs.dom.createEl("span", {}, { class: "video-name" }, videoName) as HTMLElement];
        let liClass = "recording-item";
        
        // Layout Elements
        const mainContent = document.createElement("div");
        mainContent.className = "recording-content";

        if (recording.metadata && "Metadata" in recording.metadata) {
            liClass += " has-metadata";
            const meta = recording.metadata.Metadata;
            const parts = videoName.split("_");
            
            // Date Formatting
            let dateStr = videoName;
            if (parts.length === 2) {
                const dParts = parts[0].split("-"); // YYYY-MM-DD
                const tParts = parts[1].split("-"); // HH-MM-SS
                if (dParts.length === 3 && tParts.length >= 2) {
                        // YYYY/MM/DD HH:MM
                        dateStr = `${dParts[0]}/${parseInt(dParts[1])}/${parseInt(dParts[2])} ${tParts[0]}:${tParts[1]}`;
                }
            }

            const champion = meta.championName;
            const kda = `${meta.stats.kills}/${meta.stats.deaths}/${meta.stats.assists}`;
            const result = meta.stats.gameEndedInEarlySurrender 
                ? "Remake" 
                : meta.stats.win ? "Victory" : "Defeat";
            
            const resultClass = meta.stats.gameEndedInEarlySurrender 
                ? "remake-text" 
                : meta.stats.win ? "win-text" : "loss-text";
            
            let queueName = meta.queue?.name ?? "Custom";
            // Shorten Names
            const qLower = queueName.toLowerCase();
            if (qLower.includes("practice") || qLower.includes("プラクティス")) {
                queueName = "Practice";
            } else if (qLower.includes("custom") || qLower.includes("カスタム")) {
                queueName = "Custom";
            } else if (qLower.includes("bot") || qLower.includes("ai") || qLower.includes("intro") || qLower.includes("intermediate") || qLower.includes("入門") || qLower.includes("初級") || qLower.includes("中級")) {
                queueName = "vs AI";
            } else if (qLower.includes("aram")) {
                queueName = "ARAM";
            } else if (qLower.includes("flex")) {
                queueName = "Flex";
            } else if (qLower.includes("solo")) {
                queueName = "Solo/Duo";
            } else if (qLower.includes("arena")) {
                queueName = "Arena";
            } else if (qLower.includes("draft")) {
                queueName = "Draft";
            } else if (qLower.includes("blind")) {
                queueName = "Blind";
            } else if (qLower.includes("quick")) {
                queueName = "Quick";
            } else if (qLower.includes("clash")) {
                queueName = "Clash";
            } else if (qLower.includes("ranked") || qLower.includes("rank")) {
                queueName = "Ranked";
            } else if (qLower.includes("normal") || qLower.includes("draft") || qLower.includes("blind")) {
                queueName = "Normal";
            }

            if (queueName === "Unknown Queue") {
                queueName = "Unknown";
            }

            // Determine Side for Border Color and Sidebar Indicator
            let isRedSide = false;
            const selfPart = meta.participants.find(p => p.participantId === meta.participantId);
            
            if (selfPart && "teamId" in selfPart) {
                    // @ts-ignore
                    if (selfPart.teamId === 200) isRedSide = true;
            } else {
                const pIndex = meta.participants.findIndex(p => p.participantId === meta.participantId);
                if (pIndex !== -1) {
                        if (pIndex >= 5) isRedSide = true;
                } else {
                        if (meta.participantId > 5) isRedSide = true;
                }
            }

            if (isRedSide) {
                liClass += " side-red";
            } else {
                liClass += " side-blue"; // Default to blue
            }

            const dateEl = this.vjs.dom.createEl("div", {}, { class: "rec-date" }, dateStr);
            const champEl = this.vjs.dom.createEl("div", {}, { class: "rec-champ" }, champion);
            const kdaEl = this.vjs.dom.createEl("div", {}, { class: "rec-kda" }, kda);
            const resultEl = this.vjs.dom.createEl("div", {}, { class: `rec-result ${resultClass}` }, result);
            const queueEl = this.vjs.dom.createEl("div", {}, { class: "rec-queue" }, queueName);

            // --- Game Duration Calculation ---
            let rawDuration = 0;
            if ("gameDuration" in meta) {
                    // @ts-ignore
                    rawDuration = meta.gameDuration;
            }
            
            // Fallback: Use Gold Timeline timestamp if duration is 0
            if (rawDuration === 0 && meta.goldTimeline && meta.goldTimeline.length > 0) {
                    const lastFrame = meta.goldTimeline[meta.goldTimeline.length - 1];
                    // Timeline is in Milliseconds, convert to Seconds immediately.
                    rawDuration = Math.floor(lastFrame.timestamp / 1000);
            }
            
            // Heuristic: If > 20000, assume Milliseconds. Else Seconds.
            let durationSec = rawDuration;
            if (rawDuration > 20000) { 
                durationSec = Math.floor(rawDuration / 1000);
            }

            const minutes = Math.floor(durationSec / 60);
            const seconds = durationSec % 60;
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            // --- CS Calculation ---
            const totalCS = meta.stats.totalMinionsKilled + meta.stats.neutralMinionsKilled;
            const csPerMin = durationSec > 0 ? (totalCS / (durationSec / 60)).toFixed(1) : "0.0";

            // --- Flattened Layout Elements (Refactored) ---
            
            // 1. Header: Time and Mode
            const headerRow = this.vjs.dom.createEl("div", {}, { class: "sidebar-header-row" });
            const timeSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-time" }, timeStr);
            
            // Rename Swiftplay -> Swift
            // Rename Swiftplay -> Swift based on ID 480
            let displayMode = queueName;
            const queueId = meta.queue?.id;
            
            if (displayMode.toLowerCase() === "swiftplay" || queueId === 480) {
                displayMode = "Swift";
            }
            const modeSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-mode" }, displayMode);
            headerRow.append(timeSpan, modeSpan);

            // 2. Body: Icon + Stats
            const bodyRow = this.vjs.dom.createEl("div", {}, { class: "sidebar-body-row" });
            
            // Icon
            const mainIconImg = this.vjs.dom.createEl("img", {}, { class: "main-champ-img" }) as HTMLImageElement;
            
            // Stats Column (KDA, CS, Result)
            const statsCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-stats" });
            const kdaSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-kda" }, kda);
            const csSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-cs" }, `${totalCS} CS (${csPerMin}/m)`);
            const resultSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-result " + resultClass }, result);
            
            statsCol.append(kdaSpan, csSpan, resultSpan);

            // Add LP Diff if available
            if (meta.lpDiff !== undefined && meta.lpDiff !== null) {
                const diff = meta.lpDiff;
                const diffStr = diff >= 0 ? `+${diff} LP` : `${diff} LP`;
                const lpClass = "sidebar-lp " + resultClass; // Reuse result color logic
                const lpSpan = this.vjs.dom.createEl("span", {}, { class: lpClass }, diffStr);
                statsCol.append(lpSpan);
            }

            bodyRow.append(mainIconImg, statsCol);

            // Main Column (Header + Body)
            const mainCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-main" });
            mainCol.append(headerRow, bodyRow);

            // Right: Meta (Date, Participants)
            const rightCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-right" });
            
            // Date Row
            const dateSpan = this.vjs.dom.createEl("div", {}, { class: "sidebar-date" }, dateStr);
            
            // Participants
            const participantsContainer = this.vjs.dom.createEl("div", {}, { class: "sidebar-participants" });
            const team1Row = this.vjs.dom.createEl("div", {}, { class: "participant-row" }) as HTMLElement; // Blue
            const team2Row = this.vjs.dom.createEl("div", {}, { class: "participant-row" }) as HTMLElement; // Red
            participantsContainer.append(team1Row, team2Row);

            rightCol.append(dateSpan, participantsContainer);

            // Append All to Grid Container
            mainContent.append(mainCol, rightCol);

            // Load Icons Async
            void (async () => {
                try {
                    const selfParticipant = meta.participants.find((p) => p.participantId === meta.participantId);
                    if (selfParticipant) {
                            const url = await getChampionIconUrlById(selfParticipant.championId);
                            mainIconImg.src = url;
                            mainIconImg.onerror = () => { console.error("Failed to load main icon:", url); };
                    } else {
                            const url = await getChampionIconUrl(champion);
                            mainIconImg.src = url;
                    }
                } catch (e) {
                    console.error("Error fetching main icon:", e);
                }
                
                const p100 = meta.participants.filter(p => {
                    if ("teamId" in p && p.teamId === 200) return false;
                    if ("teamId" in p && p.teamId === 100) return true;
                    return p.participantId <= 5;
                });
                const p200 = meta.participants.filter(p => {
                    if ("teamId" in p && p.teamId === 200) return true;
                    if ("teamId" in p && p.teamId === 100) return false;
                    return p.participantId > 5;
                });

                const appendIcon = async (p: Participant, row: HTMLElement) => {
                        const img = this.vjs.dom.createEl("img", { src: "" }, { class: "sub-champ-icon" }) as HTMLImageElement;
                        row.append(img);
                        try {
                            const url = await getChampionIconUrlById(p.championId);
                            img.src = url;
                            img.onerror = () => { img.style.display = "none"; };
                        } catch (e) {
                            img.style.display = "none";
                        }
                };

                for (const p of p100) void appendIcon(p, team1Row);
                for (const p of p200) void appendIcon(p, team2Row);
            })();

            displayContent = [mainContent];

        } else {
             // do nothing, just show filename
        }
        
        // Buttons (reuse logic)
        const favorite = isFavorite(recording.metadata);
        const favoriteBtn = this.vjs.dom.createEl("span", {
                onclick: (e: MouseEvent) => {
                    e.stopPropagation();
                    // eslint-disable-next-line always-return
                    onFavorite(recording.videoId).then((fav) => {
                        if (fav !== null) {
                            favoriteBtn.innerHTML = fav ? "★" : "☆";
                            favoriteBtn.style.color = fav ? "gold" : "";
                        }
                    });
                },
            },
            { class: "favorite", ...(favorite ? { style: "color: gold" } : {}) },
            favorite ? "★" : "☆",
        ) as HTMLSpanElement;

        const renameBtn = this.vjs.dom.createEl("span", {
                onclick: (e: MouseEvent) => { e.stopPropagation(); onRename(recording.videoId); },
            }, { class: "rename" }, "✎",
        );
        const deleteBtn = this.vjs.dom.createEl("span", {
                onclick: (e: MouseEvent) => { e.stopPropagation(); onDelete(recording.videoId); },
            }, { class: "delete" }, "×",
        );

        // Wrap buttons
        const actionsDiv = this.vjs.dom.createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, renameBtn, deleteBtn]);

        // Append everything to LI
        const li = this.vjs.dom.createEl("li", { onclick: () => onVideo(recording.videoId) }, { id: recording.videoId, class: liClass }) as HTMLElement;
        
        // Add Dataset for ID lookup
        li.dataset.videoId = recording.videoId;

        if (recording.metadata && "Metadata" in recording.metadata) {
            // Check for Unknown Queue (treated as no metadata for display purposes? No, we show it but as "Unknown")
            // But for cache invalidation, we want to know if it's "Rich" metadata.
            // If "Unknown Queue", we treat it as "incomplete".
            if (recording.metadata.Metadata.queue.name !== "Unknown Queue") {
                li.dataset.hasMetadata = "true";
            } else {
                li.dataset.hasMetadata = "false";
            }
            li.append(mainContent);
        } else {
             // Fallback for non-metadata
             li.dataset.hasMetadata = "false";
             li.append(...displayContent);
        }
        li.append(actionsDiv);
        
        return li;
    };

    public removeRecordingItem = (videoId: string) => {
        const li = document.getElementById(videoId);
        if (li) {
            li.remove();
        }
        this.recordingElementMap.delete(videoId);
    };
            
    public updateRecordingItem = (recording: Recording) => {
        const existingLi = document.getElementById(recording.videoId);
        
        if (existingLi && this.lastOnVideo) {
            // "Only reload ... the ones that haven't been loaded"
            // If it already has metadata class, it's loaded.
            if (existingLi.classList.contains("has-metadata")) {
               // Skip update if requested by logic (optional, but requested by user to be efficient/minimal)
               // However, maybe metadata CHANGED? Let's check user intent.
               // "Sidebar delay... filename only... process to retry... Only reload ones not loaded"
               // So if it IS loaded (has-metadata), we can skip.
               // BUT if we just renamed it? Rename calls full updateSidebar usually.
               // Here we are reacting to MetadataChanged.
               // If MetadataChanged fires for an already loaded item, it might be a fix or improvement.
               // But respecting "Only reload ... not loaded":
               // Let's check if recording has metadata NOW.
               if (recording.metadata && "Metadata" in recording.metadata) {
                   // New data is full. Old data was full.
                   console.log(`Skipping UI update for ${recording.videoId} as it already has metadata.`);
                   return;
               }
            }
            
            const newLi = this.createRecordingItem(
                recording, 
                this.lastOnVideo, 
                this.lastOnFavorite, 
                this.lastOnRename, 
                this.lastOnDelete
            );
            
            existingLi.replaceWith(newLi);
            this.recordingElementMap.set(recording.videoId, newLi);
            console.log(`Updated sidebar item: ${recording.videoId}`);
        }
    };

    public showModal = (content: ContentDescriptor) => {
        this.vjs.dom.insertContent(this.modalContent, content);
        this.modal.style.display = "block";
    };

    public hideModal = () => {
        this.vjs.dom.emptyEl(this.modalContent);
        this.modalContent.classList.remove("settings-mode");
        this.modal.style.display = "none";
    };

    public modalIsOpen = () => {
        return this.modal.style.display === "block";
    };

    public showErrorModal = (text: string) => {
        this.showModal([
            this.vjs.dom.createEl("p", {}, {}, text),
            this.vjs.dom.createEl(
                "p",
                {},
                {},
                this.vjs.dom.createEl("button", { onclick: this.hideModal }, { class: "btn" }, "Close"),
            ),
        ]);
    };

    public showRenameModal = (
        videoId: string,
        videoIds: ReadonlyArray<string>,
        rename: (videoId: string, newVideoId: string) => void,
    ) => {
        const videoName = toVideoName(videoId);

        const input = this.vjs.dom.createEl(
            "input",
            {},
            {
                type: "text",
                id: "new-name",
                value: videoName,
                placeholder: "new name",
                spellcheck: "false",
                autocomplete: "off",
            },
        ) as HTMLInputElement;

        // Helper to extract directory
        const getDir = (p: string) => {
             const last = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
             return last === -1 ? "" : p.substring(0, last + 1);
        };
        const currentDir = getDir(videoId);

        // set validity checker initial value and add 'input' event listener
        const validityChecker = (_e: Event) => {
            const newName = toVideoId(input.value);
            // Check if any existing video (in the same directory) matches the new name
            const exists = videoIds.some(id => {
                if (getDir(id) !== currentDir) return false;
                const name = id.split(/[/\\]/).pop();
                return name === newName;
            });

            if (exists) {
                input.setCustomValidity("there is already a file with this name");
                saveButton.setAttribute("disabled", "true");
            } else {
                input.setCustomValidity("");
                saveButton.removeAttribute("disabled");
            }

            input.reportValidity();
        };
        input.addEventListener("input", validityChecker);
        input.setCustomValidity("there is already a file with this name");
        input.reportValidity();

        const renameHandler = (e: KeyboardEvent | MouseEvent) => {
            // if the event is a KeyboardEvent also check if the key pressed was 'enter'
            const keyboardEvent = "key" in e;
            if (input.checkValidity() && (!keyboardEvent || e.key === "Enter")) {
                e.preventDefault();
                this.hideModal();
                rename(videoId, toVideoId(input.value));

                // clean up eventlisteners for this renameHandler and the validityChecker
                input.removeEventListener("keydown", renameHandler);
                input.removeEventListener("input", validityChecker);
            }
        };
        input.addEventListener("keydown", renameHandler);

        const saveButton = this.vjs.dom.createEl(
            "button",
            {
                onclick: renameHandler,
            },
            { class: "btn", disabled: true },
            "Save",
        ) as HTMLButtonElement;
        const cancelButton = this.vjs.dom.createEl(
            "button",
            { onclick: this.hideModal },
            { class: "btn" },
            "Cancel",
        ) as HTMLButtonElement;

        this.showModal([
            this.vjs.dom.createEl("p", {}, {}, ["Change name of: ", this.vjs.dom.createEl("u", {}, {}, videoName)]),
            this.vjs.dom.createEl("p", {}, {}, input),
            this.vjs.dom.createEl("p", {}, {}, [saveButton, cancelButton]),
        ]);

        input.setSelectionRange(input.value.length, input.value.length);
        input.focus();
    };

    // --- Resize Logic ---
    private handleResize = () => {
        // Calculate Physical width (approx)
        const dpr = window.devicePixelRatio || 1;
        const physicalWidth = window.innerWidth * dpr;
        
        // Threshold: 1200 physical pixels.
        // FHD (1920) -> 1920 > 1200 (Show)
        // FHD Half (960) -> 960 < 1200 (Hide)
        // WQHD (2560) 1.5x -> WQHD Half Logically ~853. Physically ~1280.
        // 1280 > 1200 (Show!) -> This solves the "Trigger point changes" issue.
        // Even though logical width (853) is small, we show labels because physical screen is detailed enough.
        
        if (physicalWidth < 1200) {
            document.body.classList.add("compact-labels");
        } else {
            document.body.classList.remove("compact-labels");
        }
    };
    
    public showDeleteModal = (videoId: string, deleteVideo: (videoId: string) => void) => {
        const videoName = toVideoName(videoId);

        let confirmDelete = true;
        const toggleDelete = () => {
            confirmDelete = !confirmDelete;
        };

        const prompt = this.vjs.dom.createEl("p", {}, {}, [
            "Delete recording: ",
            this.vjs.dom.createEl("u", {}, {}, videoName),
            "?",
        ]);

        const dontAskMeAgain = this.vjs.dom.createEl("p", {}, { style: "font-size: 18px" }, [
            this.vjs.dom.createEl(
                "input",
                { onchange: toggleDelete },
                { type: "checkbox", id: "dont-ask-again", style: "vertical-align: middle; margin: 0;" },
                [],
            ),
            this.vjs.dom.createEl(
                "label",
                {},
                { for: "dont-ask-again", style: "vertical-align: middle" },
                "  don't ask again",
            ),
        ]);

        const deleteFn = () => {
            this.hideModal();
            deleteVideo(videoId);

            if (!confirmDelete) {
                commands.disableConfirmDelete();
            }
        };

        const buttons = this.vjs.dom.createEl("p", {}, {}, [
            this.vjs.dom.createEl("button", { onclick: deleteFn }, { class: "btn" }, "Delete"),
            this.vjs.dom.createEl("button", { onclick: this.hideModal }, { class: "btn" }, "Cancel"),
        ]);

        this.showModal([prompt, dontAskMeAgain, buttons]);
    };

    public showTimelineModal = (
        timelineEvents: Array<{ timestamp: number; text: string }>,
        setTime: (secs: number) => void,
    ) => {
        const closeButton = this.vjs.dom.createEl(
            "span",
            { onclick: this.hideModal },
            { class: "timeline-event-close-button" },
            "×",
        );

        const timelineList = this.vjs.dom.createEl(
            "ul",
            {},
            { class: "timeline-event-list" },
            timelineEvents.map(({ timestamp, text }) =>
                this.vjs.dom.createEl(
                    "li",
                    {
                        onclick: () => {
                            setTime(timestamp);
                            this.hideModal();
                        },
                    },
                    { class: "timeline-event-list-item" },
                    text,
                ),
            ),
        );

        const copyToClipboardButton = this.vjs.dom.createEl(
            "button",
            { onclick: () => clipboard.writeText(timelineEvents.map((e) => e.text).join("\n")) },
            { class: "btn" },
            "Copy to Clipboard",
        );

        this.showModal([closeButton, timelineList, copyToClipboardButton]);
    };

    public getActiveVideoId = (): string | null => {
        return this.sidebar.querySelector<HTMLLIElement>("li.active")?.id ?? null;
    };

    public setActiveVideoId = (videoId: string | null) => {
        this.sidebar.querySelector<HTMLLIElement>("li.active")?.classList.remove("active");
        if (videoId !== null) {
            // querySelector fails with backslashes in IDs (absolute paths), so use getElementById
            const videoLi = document.getElementById(videoId) as HTMLLIElement | null;
            if (videoLi && this.sidebar.contains(videoLi)) {
                videoLi.classList.add("active");
                return true;
            }
            return false;
        }

        return true;
    };

    public playNextVideo = () => {
        const activeLi = this.sidebar.querySelector<HTMLLIElement>("li.active");
        if (!activeLi) return;
        
        let next = activeLi.nextElementSibling as HTMLLIElement;
        // Skip hidden elements or non-recording items (e.g. headers)
        while (next) {
            if (next.style.display !== "none" && next.tagName === "LI" && next.id) {
                break;
            }
            next = next.nextElementSibling as HTMLLIElement;
        }

        if (next) {
            next.click();
            next.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    };

    public playPrevVideo = () => {
        const activeLi = this.sidebar.querySelector<HTMLLIElement>("li.active");
        if (!activeLi) return;
        
        let prev = activeLi.previousElementSibling as HTMLLIElement;
        while (prev) {
            if (prev.style.display !== "none" && prev.tagName === "LI" && prev.id) {
                break;
            }
            prev = prev.previousElementSibling as HTMLLIElement;
        }

        if (prev) {
            prev.click();
            prev.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    };




    public async setVideoDescriptionMetadata(data: GameMetadata) {
        this.metadataRenderId++;
        this.currentQueueId = data.queue?.id ?? 0;
        
        // Metadata Injection
        console.log("Setting Video Description Metadata", data);

        const currentRenderId = this.metadataRenderId;

        this.currentGameVersion = data.gameVersion || (await getCurrentPatchVersion());
        await ensureItemDataLoaded(this.currentGameVersion);
        
        // Build ID Map: Event participant_id (1-10 fixed slots) -> Real participantId
        // Events usually use 1-5 for Blue (100) and 6-10 for Red (200).
        // Metadata participantIds might be shuffled or arbitrary (e.g. 1 in Red Team).
        const idMap = new Map<number, number>();
        
        const blueParticipants = data.participants.filter(p => p.teamId === 100).sort((a,b) => a.participantId - b.participantId);
        const redParticipants = data.participants.filter(p => p.teamId === 200).sort((a,b) => a.participantId - b.participantId);
        
        // Map 1-5 to Team 100
        blueParticipants.forEach((p, idx) => {
            if (idx < 5) idMap.set(idx + 1, p.participantId);
        });
        
        // Map 6-10 to Team 200
        redParticipants.forEach((p, idx) => {
            if (idx < 5) idMap.set(idx + 6, p.participantId);
        });

        // Initialize timeline
        this.timeline = new InventoryTimeline(data.events, data.participants.map(p => p.participantId), idMap);
        this.goldTimeline = data.goldTimeline || [];
        this.goldDiffRefs = [];
        this.participants = data.participants;
        this.team100GoldText = null;
        this.team200GoldText = null;
        this.team100LeadText = null;
        this.team200LeadText = null;
        this.team100KillsText = null;
        this.team200KillsText = null;
        this.team100TowerText = null;
        this.team200TowerText = null;
        this.team100DragonText = null;
        this.team200DragonText = null;
        this.team100BaronText = null;
        this.team200BaronText = null;
        this.team100VoidgrubText = null;
        this.team200VoidgrubText = null;
        this.kdaRefs = [];
        this.csRefs = [];
        this.scoreboardRefs.clear();
        this.events = data.events;
        this.recordingOffset = data.ingameTimeRecStartOffset;
        
        // DEBUG: Trace ID Map and Refs
        // console.log("DEBUG: Metadata Participants:", data.participants.map(p => `${p.participantId}:${p.championId}`));
        // console.log("DEBUG: ID Map:", Array.from(idMap.entries()));

        // Note: The rest of this function renders the *final* state as the initial view.
        // We will then start updating it on timeupdate.
        
        // We use the Main Container #video-header for flex ordering.
        // It is created by initVideoHeader in main.ts and sits in #main.
        // Cast to HTMLElement to satisfy TS
        let spectatorHeader = document.getElementById("video-header") as HTMLElement | null;
        
        if (!spectatorHeader) {
            // Fallback if not found (should be init by main.ts)
            const mainContainer = document.getElementById("main");
            if (mainContainer) {
                 spectatorHeader = this.vjs.dom.createEl("div", {}, { class: "spectator-header", id: "video-header" }) as HTMLElement;
                 const playerEl = document.getElementById("video_player");
                 // Handle null playerEl just in case, though unlikely
                 if (playerEl) {
                     mainContainer.insertBefore(spectatorHeader, playerEl);
                 } else {
                     mainContainer.appendChild(spectatorHeader);
                 }
            }
        } else {
            // Clear existing content
            this.vjs.dom.emptyEl(spectatorHeader);
            // Ensure class is correct
            spectatorHeader.className = "spectator-header";
        }
        
        if (!spectatorHeader) return; // Should be created above or returned if mainContainer missing
        
        // Remove ANY old internal headers just in case
        const playerEl = this.player.el() as HTMLElement;
        const oldInternalHeader = playerEl.querySelector(".spectator-header");
        // Only remove if it's NOT the same element (which it shouldn't be, since IDs are unique)
        if (oldInternalHeader && oldInternalHeader.id !== "video-header") oldInternalHeader.remove();
        
        // If there's another nested one, nuke it.
        const nestedHeader = playerEl.querySelector("#video-header");
        if (nestedHeader && nestedHeader !== spectatorHeader) nestedHeader.remove();
        
        // Also remove old scoreboard on refresh
        const oldScoreboard = playerEl.querySelector(".scoreboard");
        if (oldScoreboard) oldScoreboard.remove();
        
        // Use existing spectatorHeader variable for appending content...
        
        const team100 = data.teams.find(t => t.teamId === 100);
        const team200 = data.teams.find(t => t.teamId === 200);
        const participants100 = data.participants.filter(p => p.teamId === 100);
        const participants200 = data.participants.filter(p => p.teamId === 200);

        // Sort by Role: TOP, JUNGLE, MID, BOT, SUPPORT
        // New Sorting Logic: Team Composition Fitting & Standard Mode Participant ID Priority
        const sortParticipants = (team: Participant[]) => {
            const slots: { [key: number]: Participant } = {};
            const remaining: Participant[] = [];

            // 1. Identify Fixed Roles: JUNGLE (Smite), SUPPORT (Support Item)
            // Support Items including upgrades
            const supportItems = [3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877];
            const hasSmite = (p: Participant) => p.spell1Id === 11 || p.spell2Id === 11;
            
            // Check Stats AND Events for Items (Role Detection Stability)
            const hasSupportItem = (p: Participant) => {
                 // Check current stats
                 const items = [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5];
                 if (items.some(id => supportItems.includes(id))) return true;
                 
                 // Check full event log (for initial rendering stability)
                 if (this.events) {
                     const boughtSupport = this.events.some(e => 
                        "ItemPurchased" in e && 
                        e.ItemPurchased.participant_id === p.participantId && 
                        supportItems.includes(e.ItemPurchased.item_id)
                     );
                     if (boughtSupport) return true;
                 }
                 return false;
            };
            
            // Marksman List (Heuristic) for Fallback
            const marksmen = [22, 51, 119, 81, 202, 145, 18, 29, 110, 67, 11, 21, 15, 236, 429, 203, 498, 96, 222, 221, 523, 134, 496, 711]; 

            // --- STANDARD QUEUE MODE CHECK ---
            const queueName = data.queue?.name || "";
            const qId = data.queue?.id || 0;
            const qLower = queueName.toLowerCase();
            
            const isStandardMode = 
                qLower.includes("ranked") || qLower.includes("rank") || // Ranked
                qLower.includes("normal") || qLower.includes("draft") || qLower.includes("blind") || // Normal
                qLower.includes("swift") || qLower.includes("swiftplay") || qId === 480; // Swiftplay

            
            // Step A: Assign Jungle & Support (Universal Priority)
            team.forEach(p => {
                // Priority: Smite > Support Item > Others
                if (hasSmite(p)) {
                    if (!slots[2]) slots[2] = p; // Slot 2 = Jungle
                    else remaining.push(p);
                } else if (hasSupportItem(p)) {
                    if (!slots[5]) slots[5] = p; // Slot 5 = Support
                    else remaining.push(p);
                } else {
                     remaining.push(p);
                }
            });

            if (isStandardMode) {
                // Step B: Native Slot Assignment for Standard Modes
                // Logic: Assign remaining players to their "Native" slot (based on ID) if empty.
                // Native Slots:
                // 1-5 (Blue): 1=Top, 2=Jg, 3=Mid, 4=Bot, 5=Sup
                // 6-10 (Red): 6=Top, 7=Jg, 8=Mid, 9=Bot, 10=Sup
                // Target Slots in UI: 1=Top, 2=Jg, 3=Mid, 4=Bot, 5=Sup
                
                // We iterate using a standard loop to handle potential modification of `remaining` if needed,
                // but simpler to just filter/find.
                
                // Clone remaining to avoid mutation issues during iteration
                const currentRemaining = [...remaining];
                
                currentRemaining.forEach(p => {
                    // Calculate Native UI Slot (1-5)
                    // (p.id - 1) % 5 gives 0..4. +1 gives 1..5.
                    const nativeSlot = ((p.participantId - 1) % 5) + 1;
                    
                    // We only care about Top(1), Mid(3), Bot(4) here.
                    // Jg(2) and Sup(5) are already handled or will be filled by fallback.
                    if ([1, 3, 4].includes(nativeSlot)) {
                        if (!slots[nativeSlot]) {
                            slots[nativeSlot] = p;
                            // Remove from remaining
                            const idx = remaining.indexOf(p);
                            if (idx > -1) remaining.splice(idx, 1);
                        }
                    }
                });
                
                // Step C: Fallback for any still empty slots
                // (e.g. Swapped roles or Off-meta picks that didn't match Jg/Sup logic)
            } else {
                // --- SPATIAL SORTING FOR AI/CUSTOM ---
                // User Request: Use average X,Y from events < 14 mins to determine lane.
                // Score = AvgY - AvgX.
                // Top: High Y, Low X -> High Positive.
                // Mid: Y ~ X -> Near Zero.
                // Bot: Low Y, High X -> High Negative.
                
                const posSums = new Map<number, { x: number, y: number, count: number }>();
                const TIME_LIMIT = 14 * 60 * 1000; // 14 mins

                // Initialize sums for remaining participants
                remaining.forEach(p => posSums.set(p.participantId, { x: 0, y: 0, count: 0 }));

                // Aggregate positions
                if (this.events) {
                    for (const e of this.events) {
                        if (e.timestamp > TIME_LIMIT) break; 
                        
                        if ("ChampionKill" in e) {
                            const kill = e.ChampionKill;
                            const pos = kill.position;
                            
                            // Helper to update
                            const update = (pid: number) => {
                                const entry = posSums.get(pid);
                                if (entry) {
                                    entry.x += pos.x;
                                    entry.y += pos.y;
                                    entry.count++;
                                }
                            };

                            update(kill.victim_id);
                            update(kill.killer_id);
                            kill.assisting_participant_ids.forEach(aid => update(aid));
                        }
                    }
                }

                // Calculate Scores
                const getSpatialScore = (p: Participant) => {
                    // Check for Server-Side Persisted Score (laneScore)
                    // We need to cast 'p' to any because 'laneScore' is not yet in type definition in bindings.ts
                    // stored locally until we update bindings.
                    const pAny = p as any;
                    if (typeof pAny.laneScore === 'number' && pAny.laneScore !== 0) {
                         return pAny.laneScore;
                    }

                    const entry = posSums.get(p.participantId);
                    // If no data, return 0 (Neutral).
                    if (!entry || entry.count === 0) return 0;
                    
                    const avgX = entry.x / entry.count;
                    const avgY = entry.y / entry.count;
                    return avgY - avgX;
                };

                // Sort Remaining by Score Descending (Top -> Mid -> Bot)
                // If scores are equal (e.g. 0), keep original order (stable sort ideally).
                remaining.sort((a, b) => {
                    const sA = getSpatialScore(a);
                    const sB = getSpatialScore(b);
                    return sB - sA; // Descending
                });

                // Assign to Empty Target Slots [1, 3, 4]
                // 1=Top (Highest Score), 3=Mid, 4=Bot (Lowest Score)
                const targetSlots = [1, 3, 4].filter(s => !slots[s]);
                
                remaining.forEach((p, i) => {
                     if (i < targetSlots.length) {
                         slots[targetSlots[i]] = p;
                     }
                });
                
                // Remove assigned participants from remaining to prevent double assignment in fallback
                if (remaining.length > 0 && targetSlots.length > 0) {
                     remaining.splice(0, Math.min(remaining.length, targetSlots.length));
                }
                /*
                // --- LEGACY / FALLBACK LOGIC for non-standard modes (ARAM, Arena, etc) ---
                // Or if user wants Standard Logic everywhere? Request said "Ranked, Normal, Swiftplay".
                // We keep the heuristic sorts for unknown modes.
                
                // 2. Identify BOT (ADC) from remaining
                // Traits: Heal(7), Barrier(21), Cleanse(1). Marksman Class.
                const getBotScore = (p: Participant) => {
                    let score = 0;
                    if (p.spell1Id === 7 || p.spell2Id === 7) score += 50; // Heal
                    if (p.spell1Id === 21 || p.spell2Id === 21) score += 20; // Barrier
                    if (p.spell1Id === 1 || p.spell2Id === 1) score += 20; // Cleanse
                    if (marksmen.includes(p.championId)) score += 30;
                    return score;
                };

                // If Slot 4 (Bot) is empty, find best candidate
                if (!slots[4]) {
                    let bestBot: Participant | null = null;
                    let maxScore = -1;
                    let bestIdx = -1;

                    remaining.forEach((p, i) => {
                        const score = getBotScore(p);
                        if (score > maxScore && score > 0) {
                            maxScore = score;
                            bestBot = p;
                            bestIdx = i;
                        }
                    });

                    if (bestBot && bestIdx !== -1) {
                        slots[4] = bestBot;
                        remaining.splice(bestIdx, 1);
                    }
                }

                // 3. Identify TOP vs MID from remaining
                const getTopScore = (p: Participant) => {
                    let score = 0;
                    if (p.spell1Id === 12 || p.spell2Id === 12) score += 20; // Teleport
                    if (p.spell1Id === 6 || p.spell2Id === 6) score += 10; // Ghost
                    return score;
                };

                // Fill Slots 1 (Top) and 3 (Mid)
                if (remaining.length === 2 && !slots[1] && !slots[3]) {
                     const pA = remaining[0];
                     const pB = remaining[1];
                     const aTop = getTopScore(pA);
                     const bTop = getTopScore(pB);
                     
                     if (aTop >= bTop) {
                         slots[1] = pA;
                         slots[3] = pB;
                     } else {
                         slots[1] = pB;
                         slots[3] = pA;
                     }
                     // Clear remaining as we assigned both
                     remaining.length = 0; 
                }
                */
            }
            
            // Universal Fallback: Fill sequentially 1, 3, 4 (and 2, 5 if somehow missed)
            const emptySlots = [1, 2, 3, 4, 5].filter(s => !slots[s]);
            remaining.forEach((p, i) => {
                if (i < emptySlots.length) {
                    slots[emptySlots[i]] = p;
                }
            });

            // Construct Final Array [1, 2, 3, 4, 5]
            const result: Participant[] = [];
            [1, 2, 3, 4, 5].forEach(i => {
                if (slots[i]) result.push(slots[i]);
            });
            // Append any left over (should vary rarely happen unless >5 players)
            remaining.forEach(p => {
                 if (!Object.values(slots).includes(p)) result.push(p);
            });
            return result;
        };
        
        // Remove ID Map (it was based on incorrect assumption about Event ID = Slot ID)
        this.timeline = new InventoryTimeline(this.events, data.participants.map(p => p.participantId), undefined);

        const sorted100 = sortParticipants(participants100);
        const sorted200 = sortParticipants(participants200);

        // Sync class property with sorted list so index-based updates work correctly
        this.participants = [...sorted100, ...sorted200];


        // Stats Calculation
        const t100_Kills = participants100.reduce((a, p) => a + p.stats.kills, 0);
        const t200_Kills = participants200.reduce((a, p) => a + p.stats.kills, 0);
        
        // Calculate Gold based on Items
        const calculateTeamGold = (participants: Participant[]) => {
             return participants.reduce((total, p) => {
                 let pTotal = 0;
                 [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5, p.stats.item6].forEach(id => {
                     if (id) pTotal += getItemPrice(id, this.currentGameVersion);
                 });
                 return total + pTotal;
             }, 0);
        };

        const t100_Gold = calculateTeamGold(participants100);
        const t200_Gold = calculateTeamGold(participants200);
        
        const formatGold = (g: number) => (g / 1000).toFixed(1) + "k";

        // Local Icons (Inline SVGs) to avoid 404s and ensure masking works
        // All set to fill='black' for mask usage
        const svgHeader = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>";
        const svgFooter = "</svg>";
        
        const towerPath = "<path fill='black' d='M6 22h12v-4h-2v-8h2V5h-4V2h-4v3H6v5h2v8H6v4z'/>";
        const dragonPath = "<path fill='black' d='M12 2C6.48 2 2 8 2 12c0 4 3 8 3 8s7-3 7-3 7 3 7 3 3-4 3-8 0-4-4.48-10-10-10zm0 12c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z'/>"; // Abstract Eye/Dragon
        const baronPath = "<path fill='black' d='M5 5h14l-2 14H7L5 5zm5 4h1v3h-1V9zm3 0h1v3h-1V9z'/>"; // Simple Head
        const grubPath = "<circle cx='7' cy='12' r='3' fill='black'/><circle cx='17' cy='12' r='3' fill='black'/><circle cx='12' cy='7' r='3' fill='black'/>"; // 3 Grubs
        const heraldPath = "<path fill='black' d='M12 2L2 12h3v8h6v-6h2v6h6v-8h3L12 2z'/>"; // Shell shape

        const towerIcon = `${svgHeader}${towerPath}${svgFooter}`;
        const dragonIcon = `${svgHeader}${dragonPath}${svgFooter}`;
        const baronIcon = `${svgHeader}${baronPath}${svgFooter}`;
        const hordeIcon = `${svgHeader}${grubPath}${svgFooter}`;
        const heraldIcon = `${svgHeader}${heraldPath}${svgFooter}`;

        // Calculate Objectives from Events
        let t100_Towers = 0, t200_Towers = 0;
        let t100_Dragons = 0, t200_Dragons = 0;
        let t100_Barons = 0, t200_Barons = 0;
        let t100_Grubs = 0, t200_Grubs = 0;
        let t100_Heralds = 0, t200_Heralds = 0;

        this.events.forEach(e => {
            if ("BuildingKill" in e && e.BuildingKill.building_type.buildingType === "TOWER_BUILDING") {
                 const teamId = e.BuildingKill.team_id as unknown as number;
                 if (teamId === 100) t200_Towers++;
                 else t100_Towers++;

            }
            if ("EliteMonsterKill" in e) {
                 const kId = e.EliteMonsterKill.killer_id;
                 
                 // Determine Team dynamically
                 let teamId = 0;
                 // 1. Check Killer
                 // Use loose equality (==) to handle potential string/number mismatch
                 const killer = this.participants.find(p => p.participantId == kId);
                 if (killer) {
                     teamId = killer.teamId;
                     // console.warn(`[DEBUG-INIT] EliteKill Found: kId=${kId} Team=${teamId} Type=${e.EliteMonsterKill.monster_type.monsterType}`);
                 } else {
                     // 2. Check Assists if killer is neutral/minion
                     const assists = e.EliteMonsterKill.assisting_participant_ids;
                     if (assists && assists.length > 0) {
                         const assister = this.participants.find(p => assists.includes(p.participantId));
                         if (assister) teamId = assister.teamId;
                         // console.warn(`[DEBUG-INIT] EliteKill Assist: kId=${kId} Team=${teamId} Assists=${JSON.stringify(assists)}`);
                     } else {
                         // console.error(`[DEBUG-INIT] EliteKill UNKNOWN: kId=${kId} No Killer/Assists found!`);
                     }
                 }
                 
                 const type = e.EliteMonsterKill.monster_type;
                 
                 // console.log(`[DEBUG] Init EliteKill: kId=${kId} Team=${teamId} Type=${type.monsterType}`);
                 
                 if (teamId === 100) {
                    if (type.monsterType === "DRAGON") t100_Dragons++;
                    else if (type.monsterType === "BARON_NASHOR") t100_Barons++;
                    else if (type.monsterType === "HORDE") t100_Grubs++;
                    else if (type.monsterType === "RIFTHERALD") t100_Heralds++;
                 } else if (teamId === 200) {
                    if (type.monsterType === "DRAGON") t200_Dragons++;
                    else if (type.monsterType === "BARON_NASHOR") t200_Barons++;
                    else if (type.monsterType === "HORDE") t200_Grubs++;
                    else if (type.monsterType === "RIFTHERALD") t200_Heralds++;
                 }
            }
        });


        // DIRECT MAPPING: Use participantId as requested.
        // Assumes Event ID matches Metadata ID exactly.
        idMap.clear();
        // No mapping needed if IDs are identical, or we can explicit set Identity.
        // Passing undefined to InventoryTimeline makes it use event.pid directly.
        
        // console.log("DEBUG: Using Direct ParticipantID Mapping (No ID Map)");
        this.timeline = new InventoryTimeline(this.events, data.participants.map(p => p.participantId), undefined);

        // Render Header Team Side
        const createStat = (val: string | number, sub: string, iconUrl?: string, isGold = false, side?: "blue" | "red", useMask = false, iconClass?: string) => {
            const el = this.vjs.dom.createEl("div", {}, { class: "spec-stat" });
            
            if (iconUrl) {
                if (useMask) {
                    const maskEl = this.vjs.dom.createEl("div", {}, { 
                        class: `spec-icon-masked ${iconClass || ""}`,
                        style: `-webkit-mask-image: url("${iconUrl}"); mask-image: url("${iconUrl}");` 
                    });
                    el.append(maskEl);
                } else {
                    el.append(this.vjs.dom.createEl("img", { src: iconUrl }, { class: `spec-icon ${iconClass || ""}` }));
                }
            }
            
            const contentDiv = this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column; align-items: center;" });
            const valDiv = this.vjs.dom.createEl("div", {}, { class: "spec-val" }, `${val}`);
            contentDiv.append(valDiv);

            if (isGold && side) {
                const leadDiv = this.vjs.dom.createEl("div", {}, { class: "gold-lead", style: "font-size: 12px; height: 12px; line-height: 12px; font-weight: bold;" }, ""); 
                contentDiv.append(leadDiv);
                
                if (side === "blue") {
                    this.team100GoldText = valDiv as HTMLElement;
                    this.team100LeadText = leadDiv as HTMLElement;
                } else {
                    this.team200GoldText = valDiv as HTMLElement;
                    this.team200LeadText = leadDiv as HTMLElement;
                }
            }

            if (side) {
                if (sub === "Kills") {
                    if (side === "blue") this.team100KillsText = valDiv as HTMLElement;
                    else this.team200KillsText = valDiv as HTMLElement;
                } else if (sub === "Towers") {
                    if (side === "blue") this.team100TowerText = valDiv as HTMLElement;
                    else this.team200TowerText = valDiv as HTMLElement;
                } else if (sub === "Dragons") {
                    if (side === "blue") this.team100DragonText = valDiv as HTMLElement;
                    else this.team200DragonText = valDiv as HTMLElement;
                } else if (sub === "Barons") {
                    if (side === "blue") this.team100BaronText = valDiv as HTMLElement;
                    else this.team200BaronText = valDiv as HTMLElement;
                } else if (sub === "Grubs") {
                    if (side === "blue") this.team100VoidgrubText = valDiv as HTMLElement;
                    else this.team200VoidgrubText = valDiv as HTMLElement;
                } else if (sub === "Heralds") {
                    if (side === "blue") this.team100HeraldText = valDiv as HTMLElement;
                    else this.team200HeraldText = valDiv as HTMLElement;
                }
            }

            el.append(contentDiv);
            return el;
        };

        const createTeamHeader = (side: "blue" | "red") => {
            const kills = side === "blue" ? t100_Kills : t200_Kills;
            const gold = side === "blue" ? t100_Gold : t200_Gold;
            
            const _towers = side === "blue" ? t100_Towers : t200_Towers;
            const _dragons = side === "blue" ? t100_Dragons : t200_Dragons;
            const _barons = side === "blue" ? t100_Barons : t200_Barons;
            const _grubs = side === "blue" ? t100_Grubs : t200_Grubs;
            const _heralds = side === "blue" ? t100_Heralds : t200_Heralds;

            const container = this.vjs.dom.createEl("div", {}, { class: `spec-team ${side}` }) as HTMLElement;
            
            // Objectives - Specific Mono Icons requested. Others hidden.
            // "Use as is" -> useMask = false.
            const towers = createStat(_towers, "Towers", monoTower, false, side, false);
            const grubs = createStat(_grubs, "Grubs", monoVoidgrub, false, side, false);
            const dragons = createStat(_dragons, "Dragons", monoDrake, false, side, false);
            
            // Hidden objectives: Heralds, Barons (and others not listed)
            
            const objList = [towers, grubs, dragons];
            if (side === "blue") {
                objList.reverse();
            }
            
            const objectivesDiv = this.vjs.dom.createEl("div", {}, { class: "spec-obj-group" }, objList);

            // Gold & Kills
            const goldDiv = createStat(formatGold(gold), "Gold", undefined, true, side);
            goldDiv.classList.add("gold-stat");
            const killsDiv = createStat(kills, "Kills", undefined, false, side);
            killsDiv.classList.add("kill-stat");

            if (side === "blue") {
                container.append(objectivesDiv, goldDiv, killsDiv);
                container.style.justifyContent = "flex-end"; 
            } else {
                container.append(killsDiv, goldDiv, objectivesDiv);
                container.style.justifyContent = "flex-start"; 
            }
            return container;
        };

        // Create Timers
        // Create Timers
        const createTimer = (className: string) => {
             const container = this.vjs.dom.createEl("div", {}, { class: `spec-timer-container ${className}` }) as HTMLElement;
             container.style.display = "flex";
             container.style.alignItems = "center";
             container.style.gap = "5px";
             container.style.minWidth = "90px";
             container.style.justifyContent = "center";
             
             // Primary Group
             const primaryGroup = this.vjs.dom.createEl("div", {}, { class: "timer-group primary" }) as HTMLElement;
             primaryGroup.style.display = "flex";
             primaryGroup.style.alignItems = "center";
             primaryGroup.style.gap = "5px"; // restore gap inside group

             const icon = this.vjs.dom.createEl("img", {}, { class: "spec-timer-icon" }) as HTMLImageElement;
             icon.style.width = "40px";
             icon.style.height = "40px";
             icon.style.objectFit = "contain";
             
             const t = this.vjs.dom.createEl("div", {}, { class: "spec-timer-text" }, "05:00") as HTMLElement;
             t.style.fontSize = "1.2rem";
             t.style.fontWeight = "bold";
             t.style.textAlign = "center";
             
             if (className.includes("baron")) {
                 primaryGroup.append(icon, t);
             } else {
                 primaryGroup.append(t, icon);
             }

             // Secondary Group (for upcoming objective on Baron side)
             const secondaryGroup = this.vjs.dom.createEl("div", {}, { class: "timer-group secondary" }) as HTMLElement;
             secondaryGroup.style.display = "none";
             secondaryGroup.style.alignItems = "center";
             secondaryGroup.style.gap = "5px";
             secondaryGroup.style.marginLeft = "10px";

             const icon2 = this.vjs.dom.createEl("img", {}, { class: "spec-timer-icon" }) as HTMLImageElement;
             icon2.style.width = "32px"; // slightly smaller
             icon2.style.height = "32px";
             icon2.style.objectFit = "contain";
             icon2.style.opacity = "0.8";

             const t2 = this.vjs.dom.createEl("div", {}, { class: "spec-timer-text" }, "00:00") as HTMLElement;
             t2.style.fontSize = "1.0rem";
             t2.style.fontWeight = "bold";
             t2.style.color = "#ccc";

             secondaryGroup.append(icon2, t2); // Always Icon then Text for secondary? Or match side?
             // User requested: "Right of Grub" -> so likely Icon Text order matches left side (Icon-Text) structure 
             // but placed to the right. 

             container.append(primaryGroup, secondaryGroup);
             
             return { container, text: t, icon: icon, group2: secondaryGroup, text2: t2, icon2: icon2 };
        };

        const bTimer = createTimer("baron-timer");
        this.baronTimerText = bTimer.text as HTMLElement;
        this.baronTimerIcon = bTimer.icon as HTMLImageElement;
        this.baronTimerGroup2 = bTimer.group2 as HTMLElement;
        this.baronTimerText2 = bTimer.text2 as HTMLElement;
        this.baronTimerIcon2 = bTimer.icon2 as HTMLImageElement;
        this.baronTimerIcon.src = monoVoidgrub; /* Initial icon (Grub); timeupdate will switch to Herald/Baron if needed */

        const dTimer = createTimer("dragon-timer");
        this.dragonTimerText = dTimer.text as HTMLElement;
        this.dragonTimerIcon = dTimer.icon as HTMLImageElement;
        this.dragonTimerIcon.src = monoDrake; // Always dragon

        const isPractice = data.queue?.name?.toLowerCase().includes("practice") ?? false;
        const isSR = SR_QUEUES.includes((data.queue.id as any)) || isPractice;
        
        if (!isSR) {
            bTimer.container.style.display = "none";
            dTimer.container.style.display = "none";
        }

        // Order: [BaronTimer] [BlueTeam] [CenterTime] [RedTeam] [DragonTimer]
        spectatorHeader.append(bTimer.container);
        spectatorHeader.append(createTeamHeader("blue"));
        const centerParams = this.vjs.dom.createEl("div", {}, { class: "spec-center" }, "00:00"); 
        this.headerTimeText = centerParams as HTMLElement;
        spectatorHeader.append(centerParams);
        spectatorHeader.append(createTeamHeader("red"));
        spectatorHeader.append(dTimer.container);

        
        // Append Header to Player - NO, it is already in #main
        // playerEl.prepend(spectatorHeader); 
        // Just verify it's visible
        if (spectatorHeader) spectatorHeader.style.display = "flex";

        // Scoreboard (Bottom)
        this.scoreboardEl = this.vjs.dom.createEl("div", {}, { class: "scoreboard" }) as HTMLElement;
        if (this.scoreboardScale) {
            (this.scoreboardEl.style as any).zoom = this.scoreboardScale.toFixed(3);
        }
        
        // --- Scoreboard Resizing Logic ---
        const resizeHandle = this.vjs.dom.createEl("div", {}, { class: "scoreboard-resize-handle" });
        this.scoreboardEl.append(resizeHandle);

        // Resizing Logic using BASE_HEIGHT mapping
        const BASE_HEIGHT = 220; // Approx height at Zoom 1.0
        let startY = 0;
        let startHeight = 0;

        const onMouseMove = (e: MouseEvent) => {
             const dy = startY - e.clientY; 
             let targetHeight = startHeight + dy;
             this.setScoreboardHeight(targetHeight, BASE_HEIGHT);
        };

        const stopDrag = () => {
             window.removeEventListener("mousemove", onMouseMove);
             window.removeEventListener("mouseup", stopDrag);
             document.body.style.cursor = "";
             
             // Save Setting
             if (this.scoreboardEl) {
                 const finalZoom = (this.scoreboardEl.style as any).zoom;
                 if (finalZoom) {
                     this.scoreboardScale = parseFloat(finalZoom);
                     commands.getSettings().then(s => {
                         s.scoreboardScale = this.scoreboardScale;
                         commands.saveSettings(s);
                     });
                 }
             }
        };

        resizeHandle.addEventListener("mousedown", (e: Event) => {
             const evt = e as MouseEvent;
             evt.preventDefault();
             startY = evt.clientY;
             const rect = this.scoreboardEl!.getBoundingClientRect();
             startHeight = rect.height;
             document.body.style.cursor = "ns-resize";
             window.addEventListener("mousemove", onMouseMove);
             window.addEventListener("mouseup", stopDrag);
        });
        
        const renderTeam = async (teamId: number, participants: Participant[], opponents: Participant[]) => {
            // Race check
            if (this.metadataRenderId !== currentRenderId) return null;

            const settings = await commands.getSettings();
            
            // Race check again
            if (this.metadataRenderId !== currentRenderId) return null;

            const teamDiv = this.vjs.dom.createEl("div", {}, { class: `team team-${teamId}` });
            
            // Cache Logic
            const activeVideoId = this.getActiveVideoId();
            let cacheData: any = null;
            const cachePath = activeVideoId ? activeVideoId.replace(/\.mp4$/i, "") + ".sb.json" : null;
            
            if (cachePath) {
                // try {
                //      const res = await commands.loadScoreboardCache(activeVideoId!);
                //      if (res.status === "ok") {
                //          cacheData = JSON.parse(res.data);
                //      }
                // } catch (e) { 
                //     // console.warn("Cache load failed", e); 
                // }
            }

            // Parallelize fetching and rendering
            const rowPromises = participants.slice(0, 5).map(async (p) => {
                const cDragonUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${p.championId}.png`;
                
                let cachedChampIcon: string, spell1Url: string, spell2Url: string, runeUrl: string, itemUrls: string[];
                let assetsToSave: any = null;

                if (cacheData && cacheData[p.participantId]) {
                    const c = cacheData[p.participantId];
                    cachedChampIcon = c.champ;
                    spell1Url = c.sp1;
                    spell2Url = c.sp2;
                    runeUrl = c.rune;
                    itemUrls = c.items;
                } else {
                    // Fetch all assets parallel
                    cachedChampIcon = await import("./assets").then(m => m.getCachedAssetUrl(cDragonUrl, "champion", `${p.championId}.png`));
                    
                    spell1Url = await getSpellIconUrl(p.spell1Id);
                    spell2Url = await getSpellIconUrl(p.spell2Id);
                    runeUrl = await getRuneIconUrl(p.stats.perk0 ?? 0);
                    
                    itemUrls = await Promise.all([
                        p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5, p.stats.item6
                    ].map(id => getItemIconUrl(id)));

                    assetsToSave = {
                        champ: cachedChampIcon,
                        sp1: spell1Url,
                        sp2: spell2Url,
                        rune: runeUrl,
                        items: itemUrls
                    };
                }

                // Check cancel info
                if (this.metadataRenderId !== currentRenderId) return null;

                const row = this.vjs.dom.createEl("div", {}, { class: "player-row" }) as HTMLElement;
                const img = this.vjs.dom.createEl("img", { src: cachedChampIcon }, { class: "champ-icon" }) as HTMLImageElement;
                img.onerror = () => {
                    if (img.src !== cDragonUrl) {
                        console.warn(`Local cache failed for champion ${p.championId}, retrying remote: ${cDragonUrl}`);
                        img.src = cDragonUrl;
                    }
                };
                
                const spells = this.vjs.dom.createEl("div", {}, { class: "spells" }, [
                    this.vjs.dom.createEl("img", { src: spell1Url }, { class: "spell-icon" }),
                    this.vjs.dom.createEl("img", { src: spell2Url }, { class: "spell-icon" })
                ]) as HTMLElement;
                
                const runesDiv = this.vjs.dom.createEl("div", {}, { class: "runes" }, [
                   this.vjs.dom.createEl("img", { src: runeUrl }, { class: "rune-icon" })
                ]) as HTMLElement;
                
                // Separation of Stats
                const csDiv = this.vjs.dom.createEl("div", {}, { class: "cs-stat" }, `${p.stats.totalMinionsKilled}`) as HTMLElement;

                const kdaDiv = this.vjs.dom.createEl("div", {}, { class: "kda" }, `${p.stats.kills} / ${p.stats.deaths} / ${p.stats.assists}`) as HTMLElement;

                // Separation of Items (0-5) and Trinket (6)
                const coreItemUrls = itemUrls.slice(0, 6);
                const trinketUrl = itemUrls[6];

                const itemsGrid = this.vjs.dom.createEl("div", {}, { class: "items-grid" }) as HTMLElement;
                
                const itemImgs: HTMLImageElement[] = [];
                // Initialize with final stats, but we will update them via timeline
                coreItemUrls.forEach((url, idx) => {
                    const itemId = [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5][idx];
                    
                    // Wrapper for slot frame
                    const slotDiv = this.vjs.dom.createEl("div", {}, { class: "item-slot" });
                    
                    const i = this.vjs.dom.createEl("img", { src: url }, { class: "item-icon" }) as HTMLImageElement;
                    i.dataset.itemId = itemId.toString();
                    
                    // Handle load error
                    i.onerror = () => {
                        // Transparent pixel or generic empty icon
                         i.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                    };

                    if (itemId === 0) {
                        i.style.visibility = "hidden";
                    }
                    
                    slotDiv.append(i);
                    itemsGrid.append(slotDiv);
                    itemImgs.push(i);
                });
                
                // Trinket Slot Wrapper
                const trinketSlotDiv = this.vjs.dom.createEl("div", {}, { class: "item-slot trinket-slot-frame" });
                
                const trinketImg = this.vjs.dom.createEl("img", { src: trinketUrl }, { class: "item-icon trinket-icon" }) as HTMLImageElement;
                trinketImg.dataset.itemId = p.stats.item6.toString();
                if (p.stats.item6 === 0) {
                    trinketImg.style.visibility = "hidden";
                }
                trinketImg.onerror = () => {
                     trinketImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                };

                trinketSlotDiv.append(trinketImg);
                const trinketDiv = this.vjs.dom.createEl("div", {}, { class: "trinket-container" }, [ trinketSlotDiv ]) as HTMLElement;
                
                const goldDiv = this.vjs.dom.createEl("div", {}, { class: "total-gold" }, "0") as HTMLElement;

                // DATA-BINDING ROBUSTNESS
                // Embed PID in the DOM row for easy debugging
                row.dataset.pid = p.participantId.toString();
                
                const isMe = p.participantId === data.participantId;
                // Priority: 1. Populated summonerName (New recordings), 2. data.player (Old recordings - Me), 3. Fallback ID
                const nameStr = p.summonerName || (isMe ? `${data.player.gameName}#${data.player.tagLine}` : `P${p.participantId}`); 
                const name = this.vjs.dom.createEl("div", {}, { class: "player-name" }, nameStr) as HTMLElement;

                // Match History Link
                if (settings.matchHistoryBaseUrl) {
                     name.style.cursor = "pointer";
                     name.title = `Open Match History for ${nameStr}`;
                     name.addEventListener("click", async (e) => {
                         e.stopPropagation(); // prevent player toggle play/pause if applicable
                         if (!settings.matchHistoryBaseUrl) return; 

                         // Logic: Replace first '#' with '-' then encode? Or replace ALL?
                         // User example: "MEIY FANBOY#LAU9H" -> "MEIY FANBOY-LAU9H"
                         // Usually riot IDs are Name#Tag
                         const targetId = nameStr.replace("#", "-");
                         
                         // Note: We do NOT encodeURIComponent right away because some sites might want Raw, 
                         // but typically URL params should be encoded. 
                         // However, the User's example "MEIY%20FANBOY-LAU9H" suggests standard encoding.
                         const encodedId = encodeURIComponent(targetId);
                         
                         let url = "";
                         if (settings.matchHistoryBaseUrl.includes("{q}")) {
                             url = settings.matchHistoryBaseUrl.replace("{q}", encodedId);
                         } else {
                             // Fallback for legacy/simple append behavior if {q} is missing
                             url = `${settings.matchHistoryBaseUrl}${encodedId}`;
                         }
                         
                         try {
                             await open(url);
                         } catch (err) {
                             console.error("Failed to open URL:", err);
                         }
                     });
                } else {
                    name.style.cursor = "default";
                }

                // Append all chunks - Order controlled by CSS Order OR explicit append order
                // Team 100 (Blue, Left): Standard Order
                // [Icon] [CS] [KDA] [Items] [Trinket] [Spells] [Runes] [Name]
                
                // Team 200 (Red, Right): Mirrored Order? 
                // User: "Symmetry means ... [Red] fills from side closer to center".
                // If Team 2 is on Right, Center is Left.
                // Standard order: [Icon] ... [Name]. This puts Icon on the Left (Center) if the row is right-aligned?
                // Wait, typical scoreboard:
                // [Icon] [Name] [Items] [KDA] ... VS ... [KDA] [Items] [Name] [Icon]
                // Let's implement full Mirror for Team 200.
                
                // Ensure row is flex
                row.style.display = "flex";
                row.style.flexDirection = "row"; // Always LTR, we control order via "order" property or strict append
                


                // Assign Order based on User Request
                if (teamId === 200) {
                    // Red Team (Right Side)
                    // Desired: [Icon][CS][KDA][Items][Trinket][Spells][Runes][Gold][Name]
                    img.style.order = "1";
                    csDiv.style.order = "2";
                    kdaDiv.style.order = "3";
                    itemsGrid.style.order = "4";
                    trinketDiv.style.order = "5";
                    spells.style.order = "6";
                    runesDiv.style.order = "7";
                    goldDiv.style.order = "8";
                    name.style.order = "9";
                    
                    // Items in standard order (1-6) -> LTR
                    itemsGrid.style.flexDirection = "row";
                    itemsGrid.style.justifyContent = "flex-start";
                    
                } else {
                    // Blue Team (Left Side)
                    // Desired: [Name][Gold][Runes][Spells][Trinket][Items][KDA][CS][Icon]
                    name.style.order = "1";
                    goldDiv.style.order = "2";
                    runesDiv.style.order = "3";
                    spells.style.order = "4";
                    trinketDiv.style.order = "5";
                    itemsGrid.style.order = "6";
                    kdaDiv.style.order = "7";
                    csDiv.style.order = "8";
                    img.style.order = "9";
                    
                    // Items in reverse order (6-1) -> RTL inside grid
                    itemsGrid.style.flexDirection = "row-reverse";
                    itemsGrid.style.justifyContent = "flex-end";
                }
                
                // Append all to row (Order doesn't matter for append if style.order is set, but keeping logical is good)
                row.append(img, csDiv, kdaDiv, itemsGrid, trinketDiv, spells, runesDiv, goldDiv, name);
                
                return {
                    row,
                    csDiv,
                    kdaDiv,
                    itemImgs,
                    trinketImg,
                    goldDiv,
                    participantId: p.participantId,
                    p,
                    assets: assetsToSave
                };
            });

            const results = await Promise.all(rowPromises);
            
            // Race check
            if (this.metadataRenderId !== currentRenderId) return null;


            // Save Cache if new data was fetched
            // We only save if we didn't start with cache, and we have valid results
            /*
            if (!cacheData && cachePath && results.length > 0) {
                 const newCache: Record<string, any> = {};
                 let hasData = false;
                 results.forEach(r => {
                     if (r && r.assets) {
                         newCache[r.participantId.toString()] = r.assets;
                         hasData = true;
                     }
                 });
                 
                 if (hasData) {
                     try {
                         // Asynchronous save, fire and forget or await
                         if (activeVideoId) {
                            await commands.saveScoreboardCache(activeVideoId, JSON.stringify(newCache));
                         }
                     } catch(e) {
                         console.warn("Failed to write scoreboard cache:", e);
                     }
                 }
            }
            */

            for (const res of results) {
                if (!res) continue;

                teamDiv.append(res.row);
                this.csRefs.push(res.csDiv);
                this.kdaRefs.push(res.kdaDiv);

                this.scoreboardRefs.set(res.participantId, {
                    items: res.itemImgs,
                    trinket: res.trinketImg,
                    goldText: res.goldDiv,
                    participantId: res.participantId 
                });
            }
            return teamDiv;
        };

        const topDiv = await renderTeam(100, sorted100, sorted200);
        const botDiv = await renderTeam(200, sorted200, sorted100);

        if (this.metadataRenderId !== currentRenderId) return;
        if (!topDiv || !botDiv) return;

        // Center Gold Diff
        const centerDiv = this.vjs.dom.createEl("div", {}, { class: "scoreboard-center" });

        for (let i = 0; i < 5; i++) {
            const p1 = participants100[i];
            const p2 = participants200[i];
            
            // Handle missing participants (e.g. < 5v5)
            if (!p1 || !p2) continue;

            const diff = p1.stats.goldEarned - p2.stats.goldEarned;
            const absDiff = Math.abs(diff);
            const diffStr = absDiff >= 1000 ? `${(absDiff / 1000).toFixed(1)}k` : `${absDiff}`;
            const diffRow = this.vjs.dom.createEl("div", {}, { class: "center-diff-row" }) as HTMLElement;
            if (diff > 0) {
                diffRow.classList.add("blue-win");
                // Arrow is absolute anchored to the value
                diffRow.innerHTML = `<span class="diff-val"><span class="arrow arrow-left">◀</span>${diffStr}</span>`;
            } else if (diff < 0) {
                diffRow.classList.add("red-win");
                diffRow.innerHTML = `<span class="diff-val">${diffStr}<span class="arrow arrow-right">▶</span></span>`;
            } else {
                diffRow.innerHTML = `<span class="diff-val">-</span>`;
            }
            centerDiv.append(diffRow);
            this.goldDiffRefs.push(diffRow);
        }

        if (this.scoreboardEl) {
            this.scoreboardEl.append(topDiv, centerDiv, botDiv);
            
            // Remove ALL possible duplicate scoreboards
            // Reuse 'playerEl' from earlier scope
            const oldScoreboards = playerEl.querySelectorAll(".scoreboard");
            oldScoreboards.forEach(el => el.remove());

            // Append Scoreboard to Player
            const controlBar = this.player.controlBar.el() as HTMLElement;
            if (controlBar) {
                playerEl.insertBefore(this.scoreboardEl, controlBar);
            } else {
                playerEl.appendChild(this.scoreboardEl);
            }
        }
        
        // Attach timeupdate listener
        this.player.off("timeupdate", this.updateTimelineItems);
        this.player.on("timeupdate", this.updateTimelineItems);
    }
    
    private updateTimelineItems = () => {
         if (!this.timeline || !this.player) return;
         
         const currentTime = (this.player.currentTime() * 1000) + 2000; // ms + 2s offset
         
         // Keep track of item gold for each participant
         const itemGoldMap = new Map<number, number>();
         // Game version for item pricing
         const gameVersion = this.currentGameVersion || getCurrentPatchVersion(); 
         // Debug log once per roughly second to avoid spam
         // if (Math.floor(currentTime / 1000) % 5 === 0 && Math.floor(currentTime) % 10 === 0) {
         //     console.log("UpdateTimeline: Version:", gameVersion, "ItemPrice(1001 boots):", getItemPrice(1001, gameVersion));
         // }

         this.scoreboardRefs.forEach((refs, pid) => {
             const state = this.timeline!.getStateAt(pid, currentTime);
             // Default to 0 gold if no state
             let currentGold = 0;

             if (!state) {
                 itemGoldMap.set(pid, 0);
                 return;
             }

             // Update Items (0-5)
             for (let i = 0; i < 6; i++) {
                 const itemId = (state.items.length > i) ? (state.items[i] || 0) : 0;
                 if (itemId !== 0) {
                     currentGold += getItemPrice(itemId, gameVersion);
                 }

                 const img = refs.items[i];
                 if (!img) continue; // Should have 6 images created
                 
                 const currentId = parseInt(img.dataset.itemId || "0", 10);
                 if (currentId !== itemId) {
                     img.dataset.itemId = itemId.toString();
                     // Fetch new URL
                     getItemIconUrl(itemId).then(url => {
                         // Double check race condition
                         if (img.dataset.itemId === itemId.toString()) {
                             img.src = url;
                             img.style.visibility = (itemId === 0) ? "hidden" : "visible";
                         }
                     });
                 }
             }
             
             // Update Trinket (6) (Trinkets usually 0 cost but good to be consistent)
             const trinketId = state.trinket || 0;
             if (trinketId !== 0) {
                 currentGold += getItemPrice(trinketId, gameVersion);
             }

             const tImg = refs.trinket;
             const currentTrinketId = parseInt(tImg.dataset.itemId || "0", 10);
             if (currentTrinketId !== trinketId) {
                 tImg.dataset.itemId = trinketId.toString();
                 getItemIconUrl(trinketId).then(url => {
                     if (tImg.dataset.itemId === trinketId.toString()) {
                         tImg.src = url;
                         tImg.style.visibility = (trinketId === 0) ? "hidden" : "visible";
                     }
                 });
             }

             // Update Gold Text
             const gText = refs.goldText;
             if (gText) {
                 const formatted = currentGold >= 1000 ? `${(currentGold / 1000).toFixed(1)}k` : `${currentGold}`;
                 gText.textContent = formatted;
             }

             itemGoldMap.set(pid, currentGold);
             
             // DEBUG: Trace Update for PID 4 (Zed) and 5 (Caitlyn)
             // if (pid === 4 || pid === 5) {
             //    // Throttle log
             //    if (Math.floor(currentTime / 1000) % 10 === 0 && Math.floor(currentTime) % 20 === 0) {
             //        console.log(`DEBUG: UpdateTimeline PID ${pid} Items:`, state ? state.items : "No State", "DOM:", refs.items.length);
             //    }
             // }
         });

         // Update Gold Diffs
         if (this.goldTimeline.length > 0 && this.goldDiffRefs.length === 5 && this.participants.length >= 10) {
             let frameIndex = -1;
             // Find frame index
             for (let i = this.goldTimeline.length - 1; i >= 0; i--) {
                 if (this.goldTimeline[i].timestamp <= currentTime) {
                     frameIndex = i;
                     break;
                 }
             }

             if (frameIndex !== -1) {
                 const currentFrame = this.goldTimeline[frameIndex];
                  const frameDataMap = new Map<number, ParticipantGold>();
                  currentFrame.participants.forEach(pg => {
                      frameDataMap.set(pg.participantId, pg);
                  });

                 // Update Diffs & CS
                 let t100Total = 0;
                 let t200Total = 0;

                 // Separate teams for Diff calculation
                 const p100 = this.participants.filter(p => p.teamId === 100);
                 const p200 = this.participants.filter(p => p.teamId === 200);

                 // Update CS and Calculate Team Gold Totals
                 this.participants.forEach((p) => {
                     // Find the correct CS/KDA ref for this participant
                     // csRefs / kdaRefs are pushed in order of *rendering* (sorted)
                     // this.participants is now also SORTED (due to sync at line ~1322)
                     // So index 'i' should match 'p' if everything is consistent.
                     // BUT, let's verify if p matches the rendering order.

                     // In renderTeam:
                     // this.csRefs.push(csDiv);
                     // this.kdaRefs.push(kdaDiv);
                     
                     // We iterate renderTeam(100) then renderTeam(200).
                     // this.participants = [...sorted100, ...sorted200];
                     
                     // So this.participants[i] corresponds to this.csRefs[i].
                     
                     // However, we need to ensure we are updating the UI with the DATA for 'p'.
                     
                     const idx = this.participants.indexOf(p);
                     const ref = this.csRefs[idx];
                     
                     if (ref) {
                         const data = frameDataMap.get(p.participantId);
                         const cs = data?.minions || 0;
                         ref.textContent = `${cs}`;
                     }

                     const g = itemGoldMap.get(p.participantId) || 0;
                     if (p.teamId === 100) t100Total += g;
                     else if (p.teamId === 200) t200Total += g;
                 });

                 // Update Gold Diffs (Center)
                 for (let i = 0; i < 5; i++) {
                     const row = this.goldDiffRefs[i];
                     if (!row) continue;

                     const p1 = p100[i];
                     const p2 = p200[i];
                     
                     if (p1 && p2) {
                         // Use Calculated Item Gold
                         const g1 = itemGoldMap.get(p1.participantId) || 0;
                         const g2 = itemGoldMap.get(p2.participantId) || 0;
                         
                         const diff = g1 - g2;
                         const absDiff = Math.abs(diff);
                         const diffStr = absDiff >= 1000 ? `${(absDiff / 1000).toFixed(1)}k` : `${Math.round(absDiff)}`;
                         
                         if (diff > 0) {
                             if (!row.classList.contains("blue-win")) row.className = "center-diff-row blue-win";
                             row.innerHTML = `<span class="diff-val"><span class="arrow arrow-left">◀</span>${diffStr}</span>`;
                         } else if (diff < 0) {
                             if (!row.classList.contains("red-win")) row.className = "center-diff-row red-win";
                             row.innerHTML = `<span class="diff-val">${diffStr}<span class="arrow arrow-right">▶</span></span>`;
                         } else {
                             row.className = "center-diff-row";
                             row.innerHTML = `<span class="diff-val">-</span>`;
                         }
                     } else {
                         // Missing opponent or empty slot
                         row.className = "center-diff-row";
                         row.innerHTML = `<span class="diff-val">-</span>`;
                     }
                 }

                 // Update Header
                 if (this.team100GoldText) this.team100GoldText.textContent = `${(t100Total / 1000).toFixed(1)}k`;
                 if (this.team200GoldText) this.team200GoldText.textContent = `${(t200Total / 1000).toFixed(1)}k`;

                 const lead = t100Total - t200Total;
                 const leadAbs = Math.abs(lead);
                 const leadStr = leadAbs >= 1000 ? `${(leadAbs / 1000).toFixed(1)}k` : `${Math.round(leadAbs)}`;

                 if (this.team100LeadText) {
                     this.team100LeadText.textContent = (lead > 0) ? `+${leadStr}` : "";
                     this.team100LeadText.style.color = (lead > 0) ? "gold" : "transparent";
                 }
                 if (this.team200LeadText) {
                     this.team200LeadText.textContent = (lead < 0) ? `+${leadStr}` : "";
                     this.team200LeadText.style.color = (lead < 0) ? "gold" : "transparent";
                 }
             }
             }
             

         // Update KDA
         if (this.kdaRefs.length === 10 && this.events.length > 0) {
             const kda = new Array(10).fill(0).map(() => ({ k: 0, d: 0, a: 0 }));
             let t100K = 0;
             let t200K = 0;
             
             // Find last event index
             let endIndex = -1;
             let low = 0, high = this.events.length - 1;
             while (low <= high) {
                 const mid = (low + high) >>> 1;
                 if (this.events[mid].timestamp <= currentTime) {
                     endIndex = mid;
                     low = mid + 1;
                 } else {
                     high = mid - 1;
                 }
             }

             let towers = { 100: 0, 200: 0 };
             let dragons = { 100: 0, 200: 0 };
             let barons = { 100: 0, 200: 0 };
             let grubs = { 100: 0, 200: 0 };
             let heralds = { 100: 0, 200: 0 };

             if (endIndex !== -1) {
                 for (let i = 0; i <= endIndex; i++) {
                     const e = this.events[i];
                     if ("ChampionKill" in e) {
                         const ck = e.ChampionKill;
                         const kId = ck.killer_id; // 1-10
                         const vId = ck.victim_id;
                         
                         // Killer
                         const killer = this.participants.find(p => p.participantId === kId);
                         if (killer) {
                             kda[kId - 1].k++;
                             if (killer.teamId === 100) t100K++; else t200K++;
                         }
                         
                         // Victim
                         if (vId >= 1 && vId <= 10) {
                             kda[vId - 1].d++;
                         }
                         // Assists
                         ck.assisting_participant_ids.forEach(aid => {
                             if (aid >= 1 && aid <= 10) {
                                 kda[aid - 1].a++;
                             }
                         });
                     } else if ("BuildingKill" in e && e.BuildingKill.building_type.buildingType === "TOWER_BUILDING") {
                        const teamId = e.BuildingKill.team_id as unknown as number;
                        if (teamId === 100) towers[200]++;
                        else towers[100]++;
 
                     } else if ("EliteMonsterKill" in e) {
                         const kId = e.EliteMonsterKill.killer_id;
                         let tId = 0;
                         
                         const killer = this.participants.find(p => p.participantId == kId);
                         if (killer) {
                             tId = killer.teamId;
                            // console.warn(`[DEBUG-TL] EliteKill Found: kId=${kId} Team=${tId} Type=${e.EliteMonsterKill.monster_type.monsterType}`);
                         } else {
                             // Fallback: If killer is neutral/minion (0), check assists
                             const assists = e.EliteMonsterKill.assisting_participant_ids;
                             if (assists && assists.length > 0) {
                                 const assister = this.participants.find(p => assists.includes(p.participantId));
                                 if (assister) tId = assister.teamId;
                                // console.warn(`[DEBUG-TL] EliteKill Assist: kId=${kId} Team=${tId}`);
                             } else {
                                // console.error(`[DEBUG-TL] EliteKill UNKNOWN: kId=${kId} No Killer/Assists found!`);
                             }
                         }
                         
                         if (tId === 100 || tId === 200) {
                             const team = tId as 100 | 200;
                             const type = e.EliteMonsterKill.monster_type;
                             
                             // console.log(`[DEBUG] Timeline EliteKill: kId=${kId} Team=${team} Type=${type.monsterType}`);

                             if (type.monsterType === "DRAGON") dragons[team]++;
                             else if (type.monsterType === "BARON_NASHOR") barons[team]++;
                             else if (type.monsterType === "HORDE") grubs[team]++;
                             else if (type.monsterType === "RIFTHERALD") heralds[team]++;
                         }
                     }
                 }
             }
             
             // Update DOM
             // Update DOM
             // Update DOM (KDA) based on sorted participants
             this.participants.forEach((p, i) => {
                 const ref = this.kdaRefs[i];
                 // KDA array is indexed 0-9 corresponding to Participant ID 1-10
                 const stats = kda[p.participantId - 1]; 
                 if (ref && stats) {
                     ref.textContent = `${stats.k} / ${stats.d} / ${stats.a}`;
                 }
             });
             
             // Update Header KDA
             if (this.team100KillsText) this.team100KillsText.textContent = `${t100K}`;
             if (this.team200KillsText) this.team200KillsText.textContent = `${t200K}`;

             // Update Header Objectives
             if (this.team100TowerText) this.team100TowerText.textContent = `${towers[100]}`;
             if (this.team200TowerText) this.team200TowerText.textContent = `${towers[200]}`;
             if (this.team100DragonText) this.team100DragonText.textContent = `${dragons[100]}`;
             if (this.team200DragonText) this.team200DragonText.textContent = `${dragons[200]}`;
             if (this.team100BaronText) this.team100BaronText.textContent = `${barons[100]}`;
             if (this.team200BaronText) this.team200BaronText.textContent = `${barons[200]}`;
             if (this.team100VoidgrubText) this.team100VoidgrubText.textContent = `${grubs[100]}`;
             if (this.team200VoidgrubText) this.team200VoidgrubText.textContent = `${grubs[200]}`;
             if (this.team100HeraldText) this.team100HeraldText.textContent = `${heralds[100]}`;
             if (this.team200HeraldText) this.team200HeraldText.textContent = `${heralds[200]}`;
        }
        
             // --- Update Spawn Timers ---
             // Calculate Next Spawn
             // SYNC FIX: Use raw player time (seconds) + recording offset.
             // Do NOT use 'currentTime' variable from above as it has a +2000ms hack for inventory sync.
             const rawVideoSeconds = this.player.currentTime();
             const gameTimeFloat = rawVideoSeconds + this.recordingOffset;
             const now = Math.floor(gameTimeFloat);

             // Update Central Game Timer
             if (this.headerTimeText) {
                 const absNow = Math.abs(now);
                 const m = Math.floor(absNow / 60);
                 const s = Math.floor(absNow % 60);
                 this.headerTimeText.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
             }

             // Get Config based on Queue ID
             const queueId = this.currentQueueId;
             const config = getObjectiveConfig(queueId);

             const getNextSpawn = (category: "baron" | "dragon"): { time: number, type: string } => {
                 let events = this.events.filter(e => "EliteMonsterKill" in e);
                 if (category === "baron") {
                     events = events.filter(e => {
                         const t = e.EliteMonsterKill.monster_type.monsterType;
                         return t === "BARON_NASHOR" || t === "RIFTHERALD" || t === "HORDE";
                     });
                 } else {
                     events = events.filter(e => e.EliteMonsterKill.monster_type.monsterType === "DRAGON");
                 }
                 
                 events.sort((a, b) => a.timestamp - b.timestamp);
                 
                 let lastEvent = null;
                 for (const e of events) {
                     if (e.timestamp <= now * 1000) {
                         lastEvent = e;
                     } else {
                         break;
                     }
                 }

                 // --- INITIAL SPAWNS (No previous kills) ---
                 if (!lastEvent) {
                     if (category === "dragon") {
                         // Standard: 5:00. Swiftplay: 5:00 (Per user)
                         // Both use 5:00 initial now? User only said interval 5m. 
                         // Assuming 5:00 initial for both for now.
                         return { time: 300, type: "dragon" }; 
                     }
                     
                     // Baron Pit Logic
                     // Swiftplay: No Grubs/Herald. Baron @ 12:00.
                     if (!config.hasGrubs && !config.hasHerald) {
                         return { time: config.baronSpawnTime, type: "baron" };
                     }

                     // Standard: Grubs(5:00) -> Herald(14:00) -> Baron(20:00)
                     if (now < 14 * 60 + 45) return { time: 480, type: "grub" }; 
                     if (now < 19 * 60) return { time: 900, type: "herald" }; 
                     return { time: config.baronSpawnTime, type: "baron" }; 
                 }

                 // --- RESPAWN LOGIC ---
                 const killTime = Math.floor(lastEvent.timestamp / 1000);
                 const type = (lastEvent as any).EliteMonsterKill.monster_type.monsterType;
                 const subType = (lastEvent as any).EliteMonsterKill.monster_type?.monsterSubType;

                 if (category === "baron") {
                     if (type === "HORDE") { // Grubs
                          // If User requested single spawn (8:00) then Herald (15:00).
                          return { time: 900, type: "herald" };
                      } else if (type === "RIFTHERALD") {
                         // Herald killed. Next is Baron.
                         return { time: config.baronSpawnTime, type: "baron" }; 
                     } else if (type === "BARON_NASHOR") {
                         // Baron killed. Respawn.
                         return { time: killTime + config.baronRespawnTime, type: "baron" };
                     }
                 } else { // Dragon
                     if (subType === "ELDER_DRAGON") {
                         return { time: killTime + config.elderRespawnTime, type: "dragon" };
                     }
                     // Check if next is Elder (Soul Logic or Fixed Time)
                     // Swiftplay: Elder @ 15:00 fixed?
                     if (config.elderSpawnTime > 0) {
                         // Fixed Elder Time Mode
                         // If we are past Elder time, next is Elder
                         // Note: If Dragon killed at 14:00, next is Elder at 15:00? Or Respawn?
                         // Usually Elder overrides normal dragon after a certain time/soul condition.
                         // For Swiftplay, "Elder is 15:00".
                         const nextSpawn = killTime + config.dragonInterval;
                         if (nextSpawn >= config.elderSpawnTime) {
                             // Force Elder if next predicted spawn is past Elder Time?
                             // Or just if *now* is past it?
                             // Let's assume after 15:00 all dragons are Elder.
                             return { time: Math.max(nextSpawn, config.elderSpawnTime), type: "dragon" };
                         }
                         return { time: nextSpawn, type: "dragon" };
                     }

                     // Standard Soul Logic (simplified: just interval)
                     return { time: killTime + config.dragonInterval, type: "dragon" };
                 }
                 return { time: 0, type: "" };
             };

             const formatTimer = (next: { time: number, type: string }, el: HTMLElement, iconEl: HTMLImageElement | null, defaultColor = "white") => {
                 if (iconEl) {
                     if (next.type === "grub") iconEl.src = monoVoidgrub;
                     else if (next.type === "herald") iconEl.src = monoHerald;
                     else if (next.type === "baron") iconEl.src = monoBaron;
                     else if (next.type === "dragon") iconEl.src = monoDrake;
                 }
             
                 // Check Elder condition for Icon
                 // If we are predicting Dragon, checks if it is Elder?
                 // Visual only: "dragon" type covers both.
                 // Maybe check time?
                 if (next.type === "dragon" && config.elderSpawnTime > 0 && next.time >= config.elderSpawnTime) {
                     // It is likely Elder
                     // format color?
                 }

                 if (now >= next.time) {
                     el.textContent = "LIVE";
                     el.style.color = "#ffffff"; 
                 } else {
                     let diff = next.time - now;
                     const m = Math.floor(diff / 60);
                     const s = Math.floor(diff % 60);
                     el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                     el.style.color = defaultColor;
                 }
             };

             if (this.baronTimerText) {
                 const t = getNextSpawn("baron");
                 
                 // Check for active Baron Buff (Duration 180s = 3m)
                 let isBuffActive = false;
                 let buffRemaining = 0;
                 
                 const events = this.events.filter(e => "EliteMonsterKill" in e && e.EliteMonsterKill.monster_type.monsterType === "BARON_NASHOR");
                 events.sort((a, b) => a.timestamp - b.timestamp);
                 let lastBaronKill = null;
                 for (const e of events) {
                     if (e.timestamp <= now * 1000) lastBaronKill = e;
                     else break;
                 }

                 if (lastBaronKill) {
                     const killTime = Math.floor(lastBaronKill.timestamp / 1000);
                     if (now < killTime + 180) {
                         isBuffActive = true;
                         buffRemaining = (killTime + 180) - now;
                     }
                 }

                 if (isBuffActive) {
                     const m = Math.floor(buffRemaining / 60);
                     const s = Math.floor(buffRemaining % 60);
                     this.baronTimerText.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                     this.baronTimerText.style.color = "#a335ee"; // Purple Text
                     if (this.baronTimerIcon) {
                         this.baronTimerIcon.src = monoBaron; 
                         this.baronTimerIcon.style.filter = "drop-shadow(0 0 5px #a335ee)"; 
                     }
                 } else {
                     if (this.baronTimerIcon) this.baronTimerIcon.style.filter = "none";
                     formatTimer(t, this.baronTimerText, this.baronTimerIcon, "#ffffffff"); 
                 }

                 // Secondary Timer Logic (Upcoming) - Only if enabled (Standard)
                 if (this.baronTimerGroup2 && this.baronTimerText2 && this.baronTimerIcon2) {
                     let showSecondary = false;
                     let next2 = { time: 0, type: "" };
                     
                     // Only logic for Grubs->Herald->Baron chain (Standard)
                     if (config.hasGrubs) {
                         const HERALD_SPAWN = 900; // 15:00
                         const BARON_SPAWN = config.baronSpawnTime; // 20:00

                         if (t.type === "grub" && now >= 480 && now >= (HERALD_SPAWN - 120)) {
                             showSecondary = true;
                             next2 = { time: HERALD_SPAWN, type: "herald" };
                         }
                         else if (t.type === "herald" && now >= HERALD_SPAWN && now >= (BARON_SPAWN - 120)) {
                             showSecondary = true;
                             next2 = { time: BARON_SPAWN, type: "baron" };
                         }
                     }

                     if (showSecondary) {
                         this.baronTimerGroup2.style.display = "flex";
                         formatTimer(next2, this.baronTimerText2, this.baronTimerIcon2, "#cccccc");
                     } else {
                         this.baronTimerGroup2.style.display = "none";
                     }
                 }
             }

             if (this.dragonTimerText) {
                 const t = getNextSpawn("dragon");
                 
                 // Check for active Elder Dragon Buff (Duration 150s = 2m 30s)
                 let isBuffActive = false;
                 let buffRemaining = 0;

                 const events = this.events.filter(e => "EliteMonsterKill" in e && 
                                                   e.EliteMonsterKill.monster_type.monsterType === "DRAGON" &&
                                                   e.EliteMonsterKill.monster_type.monsterSubType === "ELDER_DRAGON");
                 events.sort((a, b) => a.timestamp - b.timestamp);
                 let lastElderKill = null;
                 for (const e of events) {
                     if (e.timestamp <= now * 1000) lastElderKill = e;
                     else break;
                 }
                 
                 if (lastElderKill) {
                     const killTime = Math.floor(lastElderKill.timestamp / 1000);
                     if (now < killTime + 150) {
                         isBuffActive = true;
                         buffRemaining = (killTime + 150) - now;
                     }
                 }

                 if (isBuffActive) {
                     const m = Math.floor(buffRemaining / 60);
                     const s = Math.floor(buffRemaining % 60);
                     this.dragonTimerText.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                     this.dragonTimerText.style.color = "#aaddff"; // Pale Blue
                     if (this.dragonTimerIcon) {
                         this.dragonTimerIcon.style.filter = "drop-shadow(0 0 5px #aaddff)"; 
                     }
                 } else {
                     if (this.dragonTimerIcon) this.dragonTimerIcon.style.filter = "none";
                     formatTimer(t, this.dragonTimerText, this.dragonTimerIcon, "#ffffffff"); 
                 }
             }
    };

    public showBigPlayButton = (show: boolean) => {
        const bpb = document.querySelector<HTMLButtonElement>(".vjs-big-play-button");
        if (bpb !== null) {
            bpb.style.display = show ? "block !important" : "none !important";
        }
    };

    public setMarkerFlags = (settings: MarkerFlags) => {
        this.checkboxKill.checked = settings.kill;
        this.checkboxDeath.checked = settings.death;
        this.checkboxAssist.checked = settings.assist;
        this.checkboxStructure.checked = settings.structure;
        this.checkboxDragon.checked = settings.dragon;
        this.checkboxVoidgrub.checked = settings.voidgrub;
        this.checkboxHerald.checked = settings.herald;

        this.checkboxBaron.checked = settings.baron;
    };

    public getMarkerFlags = (): MarkerFlags => {
        return {
            kill: this.checkboxKill.checked,
            death: this.checkboxDeath.checked,
            assist: this.checkboxAssist.checked,
            structure: this.checkboxStructure.checked,
            dragon: this.checkboxDragon.checked,
            voidgrub: this.checkboxVoidgrub.checked,
            herald: this.checkboxHerald.checked,

            baron: this.checkboxBaron.checked,
        };
    };

    public showMarkerFlags = (show: boolean) => {
        // this.descriptionRight.style.visibility = show ? "visible" : "hidden";
    };

    public updateAutoStopBtn = (enabled: boolean) => {
        this.autoStopCb.checked = enabled;
    };

    public updateAutoPlayBtn = (enabled: boolean) => {
        this.autoPlayCb.checked = enabled;
    };

    public updateAutoSelectBtn = (enabled: boolean) => {
        this.autoSelectCb.checked = enabled;
    };

    public setAutoStopBtnOnClickHandler = (handler: (e: Event) => void) => {
        this.autoStopCb.addEventListener("change", handler);
    };

    public setAutoPlayBtnOnClickHandler = (handler: (e: Event) => void) => {
        this.autoPlayCb.addEventListener("change", handler);
    };

    public setAutoSelectBtnOnClickHandler = (handler: (e: Event) => void) => {
        this.autoSelectCb.addEventListener("change", handler);
    };

    public showSettingsModal = (
        settings: Settings,
        saveCallback: (s: Settings) => Promise<void>,
    ) => {
        const createGroup = (label: string, element: HTMLElement, fullWidth = false) => {
            const div = this.vjs.dom.createEl("div", {}, { class: `settings-group ${fullWidth ? "full-width" : ""}` });
            div.append(this.vjs.dom.createEl("label", {}, {}, label));
            div.append(element);
            return div;
        };

        // Recordings Folder
        const folderInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            value: settings.recordingsFolder,
            style: "flex: 1;"
        }) as HTMLInputElement;

        const browseBtn = this.vjs.dom.createEl("button", {
            onclick: () => {
                invoke<string | null>("pick_recordings_folder")
                    .then((path) => {
                        if (path) {
                            folderInput.value = path;
                        }
                    })
                    .catch((err) => console.error("Failed to pick folder:", err));
            }
        }, { class: "btn", style: "margin-left: 10px;" }, "Browse");

        const folderContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; align-items: center; width: 100%;" }, [
            folderInput,
            browseBtn
        ]);

        // Clips Folder
        const clipsFolderInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            value: settings.clipsFolder || "",
            style: "flex: 1;"
        }) as HTMLInputElement;

        const browseClipsBtn = this.vjs.dom.createEl("button", {
            onclick: () => {
                invoke<string | null>("pick_clips_folder")
                    .then((path) => {
                        if (path) {
                            clipsFolderInput.value = path;
                        }
                    })
                    .catch((err) => console.error("Failed to pick folder:", err));
            }
        }, { class: "btn", style: "margin-left: 10px;" }, "Browse");

        const clipsFolderContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; align-items: center; width: 100%;" }, [
            clipsFolderInput,
            browseClipsBtn
        ]);

        // Filename Format
        const filenameInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            value: settings.filenameFormat,
            style: "width: 100%; box-sizing: border-box;"
        }) as HTMLInputElement;

        // --- Assets Section ---
        // --- Assets Section ---
        const assetsContainer = this.vjs.dom.createEl("div", {}, { class: "assets-container" });
        const assetsTitle = this.vjs.dom.createEl("div", {}, { class: "assets-title" }, "Local Assets");
        
        const downloadAssetsBtn = this.vjs.dom.createEl("button", {}, { class: "btn small-btn" }, "Download All Icons (Champions/Items)") as HTMLButtonElement;
        const assetsStatus = this.vjs.dom.createEl("span", {}, { class: "assets-status" }, "");

        downloadAssetsBtn.onclick = async () => {
            downloadAssetsBtn.disabled = true;
            await downloadAllAssets((msg) => {
                assetsStatus.textContent = msg;
            });
            downloadAssetsBtn.disabled = false;
        };

        assetsContainer.append(assetsTitle, downloadAssetsBtn, assetsStatus);

        // --- Keybinds Section ---
        // --- Tab Containers ---
        const generalTabContent = this.vjs.dom.createEl("div", {}, { class: "settings-tab-content" });
        const hotkeysTabContent = this.vjs.dom.createEl("div", {}, { class: "settings-tab-content hidden" });

        // Hotkeys Grid
        const hotkeysGrid = this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(2, 1fr); gap: 10px;" });
        hotkeysTabContent.append(hotkeysGrid);

        // General Grid
        const generalGrid = this.vjs.dom.createEl("div", {}, { class: "settings-grid" });
        generalTabContent.append(generalGrid);
        generalTabContent.append(generalGrid);
        // assetsContainer appended to generalGrid below

        // Local copy of binds and mouse config to edit before saving
        const pendingBinds = { ...currentKeybinds };
        const pendingMouseConfig: MouseConfig = loadMouseConfig();

        const labels: Record<ActionName, string> = {
            playPause: "Play / Pause",
            seekForward: "Seek Forward (+5s)",
            seekBackward: "Seek Backward (-5s)",
            nextEvent: "Next Event (Shift+Right)",
            prevEvent: "Prev Event (Shift+Left)",
            volUp: "Volume Up",
            volDown: "Volume Down",
            fullscreen: "Toggle Fullscreen",
            mute: "Toggle Mute",
            speedUp: "Speed Up (+0.25)",
            speedDown: "Speed Down (-0.25)",
            setLoopA: "Set Loop Start (A)",
            setLoopB: "Set Loop End (B)",
            toggleLoop: "Toggle Loop (L)",
            exitFullscreen: "Exit Fullscreen (Esc)",
            stepForward: "Frame Step Forward (.)",
            stepBackward: "Frame Step Backward (,)",
            resetSpeed: "Reset Playback Speed (BS)",
            nextVideo: "Next Recording (Shift+N)",
            prevVideo: "Previous Recording (Shift+P)"
        };

        const createKeybindRow = (action: ActionName) => {
             const labelText = labels[action];
             const container = this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column;" });
             
             const label = this.vjs.dom.createEl("span", {}, { style: "font-size: 0.9em; margin-bottom: 2px; color: #ccc;" }, labelText);
             
             // Use a closure variable to track the handler for removal
             let keydownHandler: ((kEvent: KeyboardEvent) => void) | null = null;

             const btn = this.vjs.dom.createEl("button", {}, { 
                 class: "settings-input", 
                 style: "text-align: center; cursor: pointer; width: 100%;" 
             }, formatKeyCombo(pendingBinds[action])) as HTMLButtonElement;

             btn.onclick = (e: MouseEvent) => {
                 e.preventDefault();
                 e.stopPropagation();
                 
                 // If already binding, cancel and Unbind
                 if (btn.classList.contains("binding")) {
                    if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                    keydownHandler = null;
                    
                    // Unbind
                    pendingBinds[action] = null;
                    btn.textContent = "None";
                    btn.classList.remove("binding");
                    return;
                 }

                 // Start Binding
                 btn.textContent = "Press any key...";
                 btn.classList.add("binding");

                 keydownHandler = (kEvent: KeyboardEvent) => {
                     kEvent.preventDefault();
                     kEvent.stopPropagation();
                     
                     if (["Shift","Control","Alt","Meta"].includes(kEvent.key)) return;

                     const newCombo: KeyCombo = {
                         key: kEvent.key,
                         shift: kEvent.shiftKey,
                         ctrl: kEvent.ctrlKey,
                         alt: kEvent.altKey,
                         meta: kEvent.metaKey
                     };

                     pendingBinds[action] = newCombo;
                     btn.textContent = formatKeyCombo(newCombo);
                     btn.classList.remove("binding");
                     
                     if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                     keydownHandler = null;
                 };
                 
                 window.addEventListener("keydown", keydownHandler, { capture: true });
             };

             container.append(label, btn);
             return container;
        };

        const bindOrder: ActionName[] = [
            "playPause", "fullscreen",
            "seekForward", "seekBackward",
            "stepForward", "stepBackward",
            "nextEvent", "prevEvent", 
            "volUp", "volDown",
            "speedUp", "speedDown",
            "resetSpeed",
            "setLoopA", "setLoopB", "toggleLoop",
            "mute", "exitFullscreen",
            "nextVideo", "prevVideo"
        ];


        // Backend Hotkeys
        const createBackendHotkeyRow = (label: string, initialValue: string | null, onUpdate: (val: string | null) => void) => {
            // Match styles of createKeybindRow
            const container = this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column;" });
            const labelEl = this.vjs.dom.createEl("span", {}, { style: "font-size: 0.9em; margin-bottom: 2px; color: #ccc;" }, label);
            
            const btn = this.vjs.dom.createEl("button", {}, { 
                class: "settings-input",
                style: "text-align: center; cursor: pointer; width: 100%;"
            }, initialValue || "None") as HTMLButtonElement;
            
            let keydownHandler: ((kEvent: KeyboardEvent) => void) | null = null;

            btn.onclick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                // If already binding, cancel and Unbind
                if (btn.classList.contains("binding")) {
                   if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                   keydownHandler = null;
                   
                   // Unbind
                   onUpdate(null);
                   btn.textContent = "None";
                   btn.classList.remove("binding");
                   return;
                }

                btn.textContent = "Press any key...";
                btn.classList.add("binding");
                
                keydownHandler = (kEvent: KeyboardEvent) => {
                    kEvent.preventDefault();
                    kEvent.stopPropagation();
                    
                    if (["Shift","Control","Alt","Meta"].includes(kEvent.key)) return;

                    const newCombo: KeyCombo = {
                        key: kEvent.key,
                        shift: kEvent.shiftKey,
                        ctrl: kEvent.ctrlKey,
                        alt: kEvent.altKey,
                        meta: kEvent.metaKey
                    };

                    const backendStr = keyComboToBackendString(newCombo);
                    const displayStr = formatKeyCombo(newCombo);

                    btn.textContent = displayStr;
                    btn.classList.remove("binding");
                    onUpdate(backendStr);
                    
                    if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                    keydownHandler = null;
                };
                
                window.addEventListener("keydown", keydownHandler, { capture: true });
            };
            
            container.append(labelEl, btn);
            return container;
        };

        let highlightHotkeyValue = settings.hightlightHotkey;
        let startRecHotkeyValue = settings.startRecordingHotkey;
        let stopRecHotkeyValue = settings.stopRecordingHotkey;
        
        // 1. In-Game Hotkeys Section
        hotkeysGrid.append(this.vjs.dom.createEl("h3", {}, { style: "grid-column: 1/-1; margin-top: 0; margin-bottom: 5px; border-bottom: 1px solid #555; padding-bottom: 5px;" }, "In-Game Hotkeys"));
        hotkeysGrid.append(createBackendHotkeyRow("Highlight", highlightHotkeyValue, (val) => { highlightHotkeyValue = val; }));
        hotkeysGrid.append(createBackendHotkeyRow("Start Record", startRecHotkeyValue, (val) => { startRecHotkeyValue = val; }));
        hotkeysGrid.append(createBackendHotkeyRow("Stop Record", stopRecHotkeyValue, (val) => { stopRecHotkeyValue = val; }));

        // 2. Replay Shortcuts Section
        hotkeysGrid.append(this.vjs.dom.createEl("h3", {}, { style: "grid-column: 1/-1; margin-top: 15px; margin-bottom: 5px; border-bottom: 1px solid #555; padding-bottom: 5px;" }, "Replay Shortcuts"));

        // 3. Replay Hotkeys Section
        // (Header implied by separator, or add plain header if preferred. User asked for separator)
        
        bindOrder.forEach(action => {
            hotkeysGrid.append(createKeybindRow(action));
        });

        // 3. Mouse Controls Section
        hotkeysGrid.append(this.vjs.dom.createEl("h3", {}, { style: "grid-column: 1/-1; margin-top: 15px; margin-bottom: 5px; border-bottom: 1px solid #555; padding-bottom: 5px;" }, "Mouse Controls"));

        const createMouseSwitch = (label: string, checked: boolean, onClick: (checked: boolean) => void) => {
             const input = this.vjs.dom.createEl("input", {
                 onchange: (e: Event) => onClick((e.target as HTMLInputElement).checked)
             }, { type: "checkbox", ...(checked ? {checked: "true"} : {}) }) as HTMLInputElement;
             
             const labelEl = this.vjs.dom.createEl("label", {}, { class: "switch" }, [
                 input,
                 this.vjs.dom.createEl("span", {}, { class: "slider round" })
             ]);
             return this.vjs.dom.createEl("div", {}, { class: "settings-checkbox-group" }, [
                 labelEl,
                 this.vjs.dom.createEl("span", {}, {}, label)
             ]);
        };

        hotkeysGrid.append(createMouseSwitch(
            "Wheel adjusts Speed (±0.1)", 
            pendingMouseConfig.wheelAction === "speed",
            (checked) => { pendingMouseConfig.wheelAction = checked ? "speed" : "none"; }
        ));

        hotkeysGrid.append(createMouseSwitch(
            "Middle Click resets Speed", 
            pendingMouseConfig.middleClickAction === "resetSpeed",
            (checked) => { pendingMouseConfig.middleClickAction = checked ? "resetSpeed" : "none"; }
        ));

        hotkeysGrid.append(createMouseSwitch(
            "Side Button Seek (Back/Fwd)", 
            pendingMouseConfig.sideButtonSeek,
            (checked) => { pendingMouseConfig.sideButtonSeek = checked; }
        ));

        // Scroll Frame Step Modifier
        const scrollModLabel = this.vjs.dom.createEl("span", {}, { style: "font-size: 0.9em; margin-bottom: 2px; color: #ccc;" }, "Scroll Frame Step Modifier");
        const scrollModSelect = this.vjs.dom.createEl("select", {}, { class: "settings-input", style: "width: 100%;" }, [
             this.vjs.dom.createEl("option", { value: "Shift" }, {}, "Shift"),
             this.vjs.dom.createEl("option", { value: "Ctrl" }, {}, "Ctrl"),
             this.vjs.dom.createEl("option", { value: "Alt" }, {}, "Alt"),
             this.vjs.dom.createEl("option", { value: "None" }, {}, "None")
        ]) as HTMLSelectElement;
        
        scrollModSelect.value = (settings as any).scrollFrameStepModifier || "Shift";
        scrollModSelect.onchange = () => {
             (settings as any).scrollFrameStepModifier = scrollModSelect.value;
             this.scrollFrameStepModifier = scrollModSelect.value; // Update live
        };

        const scrollModContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column;" }, [
             scrollModLabel,
             scrollModSelect
        ]);
        hotkeysGrid.append(scrollModContainer);

        // Encoding Quality (Slider)
        const qualityInput = this.vjs.dom.createEl("input", {
            oninput: () => { qualityLabel.textContent = qualityInput.value; }
        }, {
            class: "slider-input",
            type: "range",
            min: "0",
            max: "50",
            value: settings.encodingQuality.toString(),
            width: "100%"
        }) as HTMLInputElement;
        const qualityLabel = this.vjs.dom.createEl("span", {}, { style: "margin-left: 10px;" }, settings.encodingQuality.toString());
        const qualityContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; align-items: center;" }, [
            qualityInput,
            qualityLabel
        ]);

        // Resolution
        // Resolution
        // Map display labels to backend enum values (StdResolution)
        const resolutions = [
            { label: "Auto (Window)", value: "" },
            { label: "720p", value: "1280x720p" },
            { label: "1080p", value: "1920x1080p" },
            { label: "1440p", value: "2560x1440p" },
            { label: "2160p (4K)", value: "3840x2160p" },
            { label: "2560x1080 (21:9)", value: "2560x1080p" },
            { label: "3440x1440 (21:9)", value: "3440x1440p" },
            { label: "2880p (5K)", value: "5120x2880p" }
        ];
        const resSelect = this.vjs.dom.createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
        resolutions.forEach(res => {
            const opt = this.vjs.dom.createEl("option", {}, { value: res.value }, res.label) as HTMLOptionElement;
            // Backend sends null for Auto, or canonical string "1920x1080p" etc.
            if (settings.outputResolution === res.value || (settings.outputResolution === null && res.value === "")) {
                opt.selected = true;
            }
            resSelect.append(opt);
        });

        // Framerate
        const frSelect = this.vjs.dom.createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
        // Common framerates
        const framerates = [[30,1], [60,1], [120,1], [144,1], [240,1]];
        // logic to verify current framerate exists or add custom
        let frFound = false;
        framerates.forEach(fr => {
            const val = `${fr[0]}/${fr[1]}`;
            const opt = this.vjs.dom.createEl("option", {}, { value: val }, `${fr[0]} fps`) as HTMLOptionElement;
            if (settings.framerate[0] === fr[0] && settings.framerate[1] === fr[1]) {
                opt.selected = true;
                frFound = true;
            }
            frSelect.append(opt);
        });
        if (!frFound) {
             const val = `${settings.framerate[0]}/${settings.framerate[1]}`;
             const opt = this.vjs.dom.createEl("option", {}, { value: val, selected: "true" }, `${settings.framerate[0]}/${settings.framerate[1]} fps`);
             frSelect.append(opt);
        }

        // Audio
        const audioSelect = this.vjs.dom.createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
        ["NONE", "APPLICATION", "SYSTEM", "ALL"].forEach(a => {
            const opt = this.vjs.dom.createEl("option", {}, { value: a }, a) as HTMLOptionElement;
            if (a === settings.recordAudio) opt.selected = true;
            audioSelect.append(opt);
        });

        // Marker Flags
        const createMarkerSwitch = (label: string, checked: boolean) => {
             const input = this.vjs.dom.createEl("input", {}, { type: "checkbox", ...(checked ? {checked: "true"} : {}) }) as HTMLInputElement;
             const labelEl = this.vjs.dom.createEl("label", {}, { class: "switch" }, [
                 input,
                 this.vjs.dom.createEl("span", {}, { class: "slider round" })
             ]);
             return { container: this.vjs.dom.createEl("div", {}, { class: "settings-checkbox-group" }, [
                 labelEl,
                 this.vjs.dom.createEl("span", {}, {}, label)
             ]), input };
        };

        const flags = settings.markerFlags;
        const mfKill = createMarkerSwitch("Kill", flags.kill);
        const mfDeath = createMarkerSwitch("Death", flags.death);
        const mfAssist = createMarkerSwitch("Assist", flags.assist);
        const mfStructure = createMarkerSwitch("Structure", flags.structure);
        const mfDragon = createMarkerSwitch("Dragon", flags.dragon);
        const mfVoidgrub = createMarkerSwitch("Voidgrub", flags.voidgrub);
        const mfHerald = createMarkerSwitch("Herald", flags.herald);

        const mfBaron = createMarkerSwitch("Baron", flags.baron);

        const markerFlagsContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width" }, [
            this.vjs.dom.createEl("label", {}, {}, "Marker Flags (Default Visibility)"),
            this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 5px;" }, [
                mfKill.container, mfDeath.container, mfAssist.container, mfStructure.container,
                mfDragon.container, mfVoidgrub.container, mfHerald.container, mfBaron.container
            ])
        ]) as HTMLDivElement;

        // Game Modes
        const currentModes = settings.gameModes || [];
        const createModeSwitch = (label: string, modeId: string) => {
             const checked = currentModes.includes(modeId);
             const input = this.vjs.dom.createEl("input", {}, { type: "checkbox", ...(checked ? {checked: "true"} : {}) }) as HTMLInputElement;
             const labelEl = this.vjs.dom.createEl("label", {}, { class: "switch" }, [
                 input,
                 this.vjs.dom.createEl("span", {}, { class: "slider round" })
             ]);
             return { container: this.vjs.dom.createEl("div", {}, { class: "settings-checkbox-group" }, [
                 labelEl,
                 this.vjs.dom.createEl("span", {}, {}, label)
             ]), input, modeId };
        };

        const gmRanked = createModeSwitch("Ranked (Solo/Flex)", "RANKED");
        const gmNormal = createModeSwitch("Normal (Blind/Draft)", "NORMAL");
        const gmAram = createModeSwitch("ARAM", "ARAM");
        const gmArena = createModeSwitch("Arena (Cherry)", "CHERRY");
        const gmPractice = createModeSwitch("Practice Tool", "PRACTICE_TOOL");
        const gmCustom = createModeSwitch("Custom", "CUSTOM");
        const gmCoop = createModeSwitch("vs AI", "COOP_VS_AI");
        const gmTft = createModeSwitch("TFT", "TFT");
        const gmSwiftplay = createModeSwitch("Swiftplay", "SWIFTPLAY");

        const gameModesContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width" }, [
            this.vjs.dom.createEl("label", {}, {}, "Allowed Game Modes (Uncheck All = Record All)"),
            this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 5px;" }, [
                gmRanked.container, gmNormal.container, gmAram.container, gmArena.container,
                gmPractice.container, gmCustom.container, gmCoop.container, gmTft.container, gmSwiftplay.container
            ])
        ]) as HTMLDivElement;


        // Switches
        const createSwitch = (label: string, checked: boolean) => {
            const input = this.vjs.dom.createEl("input", {}, { type: "checkbox", ...(checked ? {checked: "true"} : {}) }) as HTMLInputElement;
            const labelEl = this.vjs.dom.createEl("label", {}, { class: "switch" }, [
                input,
                this.vjs.dom.createEl("span", {}, { class: "slider round" })
            ]);
            return { container: this.vjs.dom.createEl("div", {}, { class: "settings-checkbox-group" }, [
                labelEl,
                this.vjs.dom.createEl("span", {}, {}, label)
            ]), input };
        };


        const autostart = createSwitch("Autostart", settings.autostart);
        const autoplayVideo = createSwitch("Autoplay Video", settings.autoplayVideo);
        const autoStopPlayback = createSwitch("Auto Stop Playback", settings.autoStopPlayback);
        const autoSelectRecording = createSwitch("Auto Select Recording", settings.autoSelectRecording);
        const confirmDel = createSwitch("Confirm Delete", settings.confirmDelete);
        const devMode = createSwitch("Developer Mode", settings.developerMode);
        const playSounds = createSwitch("Play Recording Sounds", settings.playRecordingSounds ?? false);

        const matchHistoryUrlInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            placeholder: "e.g. https://www.deeplol.gg/summoner/jp/{q}",
            value: settings.matchHistoryBaseUrl || "",
            style: "flex: 1;"
        }) as HTMLInputElement;

        const switchesContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width" }, [
            this.vjs.dom.createEl("label", {}, {}, "Other Options"),
            this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 5px;" }, [

                autostart.container, 
                autoplayVideo.container,
                autoStopPlayback.container,
                autoSelectRecording.container,
                confirmDel.container, 
                devMode.container,
                playSounds.container
            ]),
            this.vjs.dom.createEl("div", {}, { style: "margin-top: 15px;" }, [
                this.vjs.dom.createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, "Tracking Site URL (Use {q} for ID placeholder)"),
                this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #aaa; margin-bottom: 5px;" }, "Example: https://www.deeplol.gg/summoner/jp/{q}"),
                matchHistoryUrlInput
            ])
        ]) as HTMLDivElement;
        
        // Hotkeys

        // Cleanup Settings
        const maxAgeInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "number",
            min: "0",
            placeholder: "Unlimited",
            value: settings.maxRecordingAgeDays === null ? "" : settings.maxRecordingAgeDays.toString()
        }) as HTMLInputElement;

        const maxSizeInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "number",
            min: "0",
            placeholder: "Unlimited",
            value: settings.maxRecordingsSizeGb === null ? "" : settings.maxRecordingsSizeGb.toString()
        }) as HTMLInputElement;

        // FFmpeg Path
        const ffmpegPathInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            placeholder: "Default (ffmpeg in PATH)",
            value: settings.ffmpegPath || "",
            style: "flex: 1;"
        }) as HTMLInputElement;
        
        ffmpegPathInput.addEventListener("change", () => {
             const val = ffmpegPathInput.value.trim();
             settings.ffmpegPath = val === "" ? null : val;
        });

        const ffmpegBtn = this.vjs.dom.createEl("button", {
             onclick: () => {
                 commands.pickFfmpegPath().then(path => {
                     if (path) {
                         ffmpegPathInput.value = path;
                         settings.ffmpegPath = path;
                     }
                 });
             }
        }, { class: "btn", style: "margin-left: 10px;" }, "Browse") as HTMLButtonElement;

        const ffmpegContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; align-items: center; width: 100%;" }, [
             ffmpegPathInput,
             ffmpegBtn
        ]);

        // Grid Layout
        const clearCacheBtn = this.vjs.dom.createEl("button", {
             onclick: async () => {
                 // eslint-disable-next-line no-alert
                 if (confirm("Clear image and item cache? This will re-download assets on next use.")) {
                      try {
                         await commands.clearCache();
                         // eslint-disable-next-line no-alert
                         alert("Cache cleared successfully.");
                      } catch (e) {
                          // eslint-disable-next-line no-alert
                          alert("Failed to clear cache: " + e);
                      }
                 }
             }
        }, { class: "btn", style: "width: 100%; color: #ff6b6b; border-color: #ff6b6b;" }, "Clear Asset Cache");

        const cacheContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; align-items: center; width: 100%;" }, [
             clearCacheBtn
        ]);

        // Populate General Grid
        generalGrid.append(
            createGroup("Recordings Folder", folderContainer as HTMLElement, true),
            createGroup("Clips Folder", clipsFolderContainer as HTMLElement, true),
            createGroup("Filename Format", filenameInput, true),
            createGroup("Encoding Quality (0-50)", qualityContainer as HTMLElement),
            createGroup("Output Resolution", resSelect),
            createGroup("Framerate", frSelect),
            createGroup("Record Audio", audioSelect),
            createGroup("Max Age (Days)", maxAgeInput),
            createGroup("Max Size (GB)", maxSizeInput),
            createGroup("FFmpeg Path", ffmpegContainer as HTMLElement, true)
        );

        generalGrid.append(
            markerFlagsContainer as HTMLElement,
            gameModesContainer as HTMLElement,
            switchesContainer,
            assetsContainer as HTMLElement
        );

        if (settings.developerMode) {
            generalGrid.append(createGroup("Troubleshooting", cacheContainer as HTMLElement, true));
        }

        // Tab Buttons
        const createTabBtn = (label: string, active: boolean, onClick: () => void) => {
            const btn = this.vjs.dom.createEl("button", {
                onclick: onClick
            }, { class: `tab-btn ${active ? "active" : ""}` }, label);
            return btn;
        };

        const switchTab = (showGeneral: boolean) => {
             if (showGeneral) {
                 btnGeneral.classList.add("active");
                 btnHotkeys.classList.remove("active");
                 generalTabContent.classList.remove("hidden");
                 hotkeysTabContent.classList.add("hidden");
             } else {
                 btnGeneral.classList.remove("active");
                 btnHotkeys.classList.add("active");
                 generalTabContent.classList.add("hidden");
                 hotkeysTabContent.classList.remove("hidden");
             }
        };

        const btnGeneral = createTabBtn("General", true, () => switchTab(true));
        const btnHotkeys = createTabBtn("Hotkeys", false, () => switchTab(false));

        const tabsContainer = this.vjs.dom.createEl("div", {}, { class: "settings-tabs" }, [btnGeneral, btnHotkeys]);

        // Main Content Assembly
        const modalBody = this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column; overflow: hidden; flex: 1;" }, [
            tabsContainer,
            generalTabContent,
            hotkeysTabContent
        ]);

        // Actions
        const saveBtn = this.vjs.dom.createEl("button", {
            onclick: () => {
                const newSettings: Settings = {
                    ...settings,
                    recordingsFolder: folderInput.value,
                    clipsFolder: clipsFolderInput.value,
                    filenameFormat: filenameInput.value,
                    encodingQuality: parseInt(qualityInput.value, 10),
                    outputResolution: resSelect.value || null as any,
                    framerate: [
                        parseInt(frSelect.value.split('/')[0], 10),
                        parseInt(frSelect.value.split('/')[1], 10)
                    ],
                    recordAudio: audioSelect.value as any,
                    maxRecordingAgeDays: maxAgeInput.value === "" ? null : parseInt(maxAgeInput.value, 10),
                    maxRecordingsSizeGb: maxSizeInput.value === "" ? null : parseInt(maxSizeInput.value, 10),
                    hightlightHotkey: highlightHotkeyValue,
                    startRecordingHotkey: startRecHotkeyValue,
                    stopRecordingHotkey: stopRecHotkeyValue,
                    markerFlags: {
                        kill: mfKill.input.checked,
                        death: mfDeath.input.checked,
                        assist: mfAssist.input.checked,
                        structure: mfStructure.input.checked,
                        dragon: mfDragon.input.checked,
                        voidgrub: mfVoidgrub.input.checked,
                        herald: mfHerald.input.checked,
                        baron: mfBaron.input.checked,
                    },
                    gameModes: (() => {
                        const modes = [];
                        if (gmRanked.input.checked) modes.push(gmRanked.modeId);
                        if (gmNormal.input.checked) modes.push(gmNormal.modeId);
                        if (gmAram.input.checked) modes.push(gmAram.modeId);
                        if (gmArena.input.checked) modes.push(gmArena.modeId);
                        if (gmPractice.input.checked) modes.push(gmPractice.modeId);
                        if (gmCustom.input.checked) modes.push(gmCustom.modeId);
                        if (gmCoop.input.checked) modes.push(gmCoop.modeId);
                        if (gmTft.input.checked) modes.push(gmTft.modeId);
                        if (gmSwiftplay.input.checked) modes.push(gmSwiftplay.modeId);
                        return modes.length > 0 ? modes : null;
                    })(),

                    autostart: autostart.input.checked,
                    autoplayVideo: autoplayVideo.input.checked,
                    autoStopPlayback: autoStopPlayback.input.checked,
                    autoSelectRecording: autoSelectRecording.input.checked,
                    confirmDelete: confirmDel.input.checked,
                    developerMode: devMode.input.checked,
                    playRecordingSounds: playSounds.input.checked,
                    matchHistoryBaseUrl: matchHistoryUrlInput.value.trim() || null
                };
                
                // Save Keybinds & Mouse Config
                saveKeybinds(pendingBinds);
                saveMouseConfig(pendingMouseConfig);
                reloadKeybinds();
                
                // Update UI buttons immediately
                this.updateAutoStopBtn(newSettings.autoStopPlayback);
                this.updateAutoPlayBtn(newSettings.autoplayVideo);
                this.updateAutoSelectBtn(newSettings.autoSelectRecording);

                void saveCallback(newSettings).then(() => {
                    this.hideModal();
                    (window as any)._developerModeEnabled = newSettings.developerMode;
                });
            }
        }, { class: "btn-save" }, "Save");

        const cancelBtn = this.vjs.dom.createEl("button", {
            onclick: this.hideModal
        }, { class: "btn-cancel" }, "Cancel");

        const actions = this.vjs.dom.createEl("div", {}, { class: "settings-actions" }, [cancelBtn, saveBtn]);

        const content = this.vjs.dom.createEl("div", {}, { id: "settings-modal-content" }, [
            this.vjs.dom.createEl("h2", {}, { style: "text-align: center; margin-bottom: 5px;" }, "Settings"),
            this.vjs.dom.createEl("div", {}, { style: "text-align: center; margin-bottom: 20px; color: #888; font-size: 0.8em;" }, `Patch ${getCurrentPatchVersion()}`),
            modalBody,
            actions
        ]);

        this.modalContent.classList.add("settings-mode");
        this.showModal(content);
    };

    public createTimeRuler = (duration: number) => {
        // Find progress holder
        const progressControl = document.querySelector(".vjs-progress-holder");
        if (!progressControl) return;

        // Remove existing ruler
        const existingRuler = progressControl.querySelector(".vjs-ruler-container");
        if (existingRuler) existingRuler.remove();

        // Create container
        const container = document.createElement("div");
        container.className = "vjs-ruler-container";

        // Generate ticks
        // duration is in seconds, create a tick for every 30 seconds
        const stepSeconds = 30;
        const steps = Math.floor(duration / stepSeconds);

        for (let i = 0; i <= steps; i++) {
            if (i === 0) continue; 

            const tick = document.createElement("div");
            tick.className = "vjs-ruler-tick";
            
            // Calculate position
            const currentSeconds = i * stepSeconds;
            const percent = (currentSeconds / duration) * 100;
            tick.style.left = `${percent}%`;

            // Determine size and add number
            // 30s: small
            // 1 min (60s): medium
            // 2 min (120s): large (50% height)
            
            if (currentSeconds % 60 === 0) {
                tick.classList.add("large");
                
                // Add number for every minute
                const number = document.createElement("div");
                number.className = "vjs-ruler-number";
                number.innerText = `${currentSeconds / 60}`;
                tick.appendChild(number);

            } else {
                tick.classList.add("medium");
            }

            container.appendChild(tick);
        }

        progressControl.appendChild(container);
    };
    private async updateScoreboard(timestamp: number) {
        if (!this.timeline) return;

        for (const [pid, refs] of this.scoreboardRefs.entries()) {
            const state = this.timeline.getStateAt(pid, timestamp);
            if (!state) continue;

            // Update Items (0-5)
            const itemIds = state.items; // Array of item IDs
            
            // We have 6 slots in UI
            for (let i = 0; i < 6; i++) {
                const img = refs.items[i];
                if (!img) continue; // Should have 6

                const newItemId = itemIds[i] || 0;
                
                // Optimization: Store current ID on element to avoid redundant updates?
                // Or just update img.src. Async fetch might be jittery if we await inside animation frame.
                // getItemIconUrl is async.
                // We shouldn't await in a timeupdate loop if possible, or we should cache urls.
                // getItemIconUrl uses getCachedAssetUrl which IS async.
                // However, since items are finite, we can fire and forget?
                
                // Better approach: timeline should return item URLs? No, logic separation.
                // We can fire the async update and let it resolve.
                
                this.updateItemIcon(img, newItemId);
            }

            // Update Trinket
            this.updateItemIcon(refs.trinket, state.trinket || 0);
        }
    }

    private lastIconUpdate: Map<HTMLImageElement, number> = new Map();

    private async updateItemIcon(img: HTMLImageElement, itemId: number) {
         // Prevent redundant updates
         if (this.lastIconUpdate.get(img) === itemId) return;
         
         this.lastIconUpdate.set(img, itemId);
         
         if (itemId === 0) {
             // Empty slot transparent or placeholder?
             // Existing code uses 1x1 pixel or similar if 0? 
             // getItemIconUrl(0) returns nothing?
             // Let's use a transparent image or hide it.
             // DataDragon 0 -> might return nothing.
             // Let's set src to empty or transparent.
             img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // 1x1 transparent
             img.style.opacity = "0"; // or just hide
         } else {
             const url = await getItemIconUrl(itemId);
             img.src = url;
             img.style.opacity = "1";
         }
    }
}
