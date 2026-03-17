import type videojs from "video.js";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { SR_QUEUES } from "./queues";
import type { ContentDescriptor } from "video.js/dist/types/utils/dom";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import { commands, type GameMetadata, type GoldFrame, type ParticipantGold, type MarkerFlags, type Recording, type Settings, type MatchTeam, type Participant, type GameEvent } from "./bindings";
import { getChampionIconUrl, getChampionIconUrlById, getTftUnitIconUrl, getTftTraitIconUrl, getItemIconUrl, getRuneIconUrl, getSpellIconUrl, downloadAllAssets, ensureItemDataLoaded, ensureTftDataLoaded, getItemPrice, getChampionNameById, getChampionEnglishNameByIdSync, getChampionLocalizedNameByIdSync, getDetailedChampionData, getLocalChampionTooltips, getSummonerSpellData, getItemData, getRuneData, getTftItemIconUrl, getGameModeByQueueId } from "./datadragon";
import { getCurrentPatchVersion, getSpawnTimers } from "./version";
import { InventoryTimeline } from "./timeline";
import { getObjectiveConfig } from "./objectives";
import { formatKeyCombo, saveKeybinds, keyComboToBackendString, loadMouseConfig, saveMouseConfig, type ActionName, type KeyCombo, type MouseConfig } from "./keybinds";
import { currentKeybinds, reloadKeybinds } from "./main";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-shell";
import { toVideoId, toVideoName, isFavorite } from "./util";
import { showGlobalTooltip, hideGlobalTooltip, buildChampionTooltipHtml, buildLocalChampionTooltipHtml, buildLocalChampionTooltipHtmlLite, buildSummonerSpellTooltipHtml, buildItemTooltipHtml, buildTrinketTooltipHtml, buildRuneTooltipHtml, evaluateLocalTooltipSafety } from "./tooltip";
import { getText, type Language } from "./i18n";
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
const globalSlowTooltipKeys = new Set<string>();
const loggedTooltipLiteKeys = new Set<string>();

function getShortQueueLabel(queueId?: number, queueName: string = ""): string {
    const id = queueId ?? 0;
    const staticMap: Record<number, string> = {
        0: "Custom",
        400: "Draft",
        420: "Solo",
        430: "Blind",
        440: "Flex",
        450: "ARAM",
        480: "Swift",
        490: "Swift",
        700: "Clash",
        830: "AI",
        840: "AI",
        850: "AI",
        890: "AI",
        1090: "TFT",
        1100: "TFT",
        1130: "TFT",
        1160: "TFT",
        1220: "TFT",
        1700: "Arena",
        3140: "Practice",
    };
    if (staticMap[id]) return staticMap[id];

    const lower = queueName.toLowerCase();
    if (lower.includes("rank")) return "Ranked";
    if (lower.includes("normal")) return "Normal";
    if (lower.includes("practice")) return "Practice";
    if (lower.includes("custom")) return "Custom";
    if (lower.includes("bot") || lower.includes("ai") || lower.includes("co-op") || lower.includes("intro") || lower.includes("intermediate")) return "AI";
    if (lower.includes("aram")) return "ARAM";
    if (lower.includes("arena")) return "Arena";
    if (lower.includes("swift")) return "Swift";
    if (lower.includes("clash")) return "Clash";
    if (lower.includes("draft")) return "Draft";
    if (lower.includes("blind")) return "Blind";
    if (lower.includes("solo")) return "Solo";
    if (lower.includes("flex")) return "Flex";
    if (lower.includes("quick")) return "Quick";
    if (lower.includes("urf")) return "URF";
    if (lower.includes("tft") || lower.includes("teamfight")) return "TFT";

    const modeGroup = getGameModeByQueueId(id, queueName);
    if (modeGroup === "TFT") return "TFT";
    if (modeGroup === "ARAM") return "ARAM";
    if (modeGroup === "SR") return "SR";
    return "Match";
}


export default class UI {
    private readonly modal;
    private readonly modalContent;
    private readonly sidebar;
    private readonly refreshBtn;
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
    private readonly searchAllyInput;
    private readonly searchEnemyInput;
    private readonly searchUserInput;
    private readonly searchQueueInput;

    // Storage Elements
    private readonly segClip;
    private readonly segStar;
    private readonly segNorm;
    private readonly sizeTotalText;
    private readonly sizeMaxText;
    private readonly storagePctText;
    private readonly storageInfoEl;

    private maxStorageGb: number = 0; // Loaded from settings

    private filterStar = false;
    private filterClip = false;
    private filterRanked = false;
    private filterSearch = false;
    private searchQuery: string = "";
    private searchAllyQuery: string = "";
    private searchEnemyQuery: string = "";
    private searchUserQuery: string = "";
    private searchQueueQuery: string = "";
    
    // Server Nav Filter
    private filterServer: 'ALL' | 'LOL' | 'TFT' | 'SR' | 'ARAM' | 'OTHER' = 'ALL';
    private readonly navFilterAllBtn;
    private readonly navFilterLolBtn;
    private readonly navFilterSrBtn;
    private readonly navFilterAramBtn;
    private readonly navFilterOtherBtn;
    private readonly navFilterTftBtn;
    
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
        const sbcontent = this.sidebarContainer.querySelector("#sidebar-content");
        if (info) (info as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
        if (sbcontent) (sbcontent as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
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
        this.updateStorageInfoVisibility();
        
        // Sidebar Responsive
        if (w < 800) {
            this.setSidebarWidth(79); 
        } else if (w < 1200) { 
             this.setSidebarWidth(219);
        } else {
             this.setSidebarWidth(325);
        }
        
        const SB_BASE = 220;
        const SCALE_START_H = 850; // Above this, max size
        const SCALE_END_H = 600;   // Below this, collapse

        if (this.scoreboardScale !== null && this.scoreboardScale > 0) {
            this.setScoreboardHeight(this.scoreboardScale * SB_BASE, SB_BASE);
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

    private updateStorageInfoVisibility() {
        if (!this.storageInfoEl) return;

        const currentHeight = window.outerHeight || window.innerHeight;
        const maxHeight = window.screen?.availHeight || window.innerHeight;
        const hideThreshold = maxHeight * 0.7;
        const shouldHide = currentHeight <= hideThreshold;

        this.storageInfoEl.style.display = shouldHide ? "none" : "";
    }

    private timeline: InventoryTimeline | null = null;
    private scoreboardRefs: Map<number, { items: HTMLImageElement[], trinket: HTMLImageElement, goldText: HTMLElement, champLevelText: HTMLElement, participantId: number }> = new Map();
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
    private roleFiltersContainer: HTMLDivElement | null = null;
    private roleFilterBtns: HTMLButtonElement[] | null = null;
    private filterRole: string | null = null;
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
        this.refreshBtn = document.querySelector<HTMLButtonElement>("#refresh-btn")!;
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
        this.searchAllyInput = document.querySelector<HTMLInputElement>("#search-ally-input")!;
        this.searchEnemyInput = document.querySelector<HTMLInputElement>("#search-enemy-input")!;
        this.searchUserInput = document.querySelector<HTMLInputElement>("#search-user-input")!;
        this.searchQueueInput = document.querySelector<HTMLInputElement>("#search-queue-input")!;
        
        // Navigation Buttonsts
        this.navFilterAllBtn = document.querySelector<HTMLButtonElement>("#nav-filter-all")!;
        this.navFilterLolBtn = document.querySelector<HTMLButtonElement>("#nav-filter-lol")!;
        this.navFilterSrBtn = document.querySelector<HTMLButtonElement>("#nav-filter-sr")!;
        this.navFilterAramBtn = document.querySelector<HTMLButtonElement>("#nav-filter-aram")!;
        this.navFilterOtherBtn = document.querySelector<HTMLButtonElement>("#nav-filter-other")!;
        this.navFilterTftBtn = document.querySelector<HTMLButtonElement>("#nav-filter-tft")!;
        
        // Role Filters
        this.roleFiltersContainer = document.querySelector<HTMLDivElement>("#role-filters")!;
        this.roleFilterBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".role-icon"));

        // Storage Elementsts
        this.segClip = document.querySelector<HTMLDivElement>(".seg-clip")!;
        this.segStar = document.querySelector<HTMLDivElement>(".seg-star")!;
        this.segNorm = document.querySelector<HTMLDivElement>(".seg-norm")!;
        this.sizeTotalText = document.querySelector<HTMLSpanElement>("#size-total")!;
        this.sizeMaxText = document.querySelector<HTMLSpanElement>("#size-max")!;
        this.storagePctText = document.querySelector<HTMLDivElement>("#storage-pct")!;
        this.storageInfoEl = document.querySelector<HTMLDivElement>(".storage-info")!;
        
        // Resize Handler for Physical Pixel Layout
        this.handleResize(); // Initial check
        window.addEventListener("resize", this.handleResize);

        // Server Nav Handlers
        const updateServerNavActiveState = () => {
            this.navFilterAllBtn?.classList.remove('active');
            this.navFilterLolBtn?.classList.remove('active');
            this.navFilterSrBtn?.classList.remove('active');
            this.navFilterAramBtn?.classList.remove('active');
            this.navFilterOtherBtn?.classList.remove('active');
            this.navFilterTftBtn?.classList.remove('active');

            if (this.filterServer === 'ALL') this.navFilterAllBtn?.classList.add('active');
            if (this.filterServer === 'LOL' || this.filterServer === 'SR' || this.filterServer === 'ARAM' || this.filterServer === 'OTHER') {
                this.navFilterLolBtn?.classList.add('active'); // LoL itself stays active for submodes
            }
            if (this.filterServer === 'SR') this.navFilterSrBtn?.classList.add('active');
            if (this.filterServer === 'ARAM') this.navFilterAramBtn?.classList.add('active');
            if (this.filterServer === 'OTHER') this.navFilterOtherBtn?.classList.add('active');
            if (this.filterServer === 'TFT') this.navFilterTftBtn?.classList.add('active');

            // Handle Role Filter Container Visibility
            if (this.roleFiltersContainer) {
                if (this.filterServer === 'SR' || this.filterServer === 'LOL' || this.filterServer === 'ARAM' || this.filterServer === 'OTHER') {
                    // It makes most sense for SR/LOL, let's keep it visible for those.
                    if (this.filterServer === 'SR') {
                        this.roleFiltersContainer.classList.remove('hidden');
                    } else {
                        // For ARAM or TFT, roles don't really apply same way, reset it.
                        this.roleFiltersContainer.classList.add('hidden');
                        this.filterRole = null; 
                    }
                } else {
                    this.roleFiltersContainer.classList.add('hidden');
                    this.filterRole = null;
                }
            }

            // Update Role filter Buttons Active state 
            if (this.roleFilterBtns) {
                this.roleFilterBtns.forEach((btn: HTMLButtonElement) => {
                    const r = btn.getAttribute('data-role');
                    if (this.filterRole && r === this.filterRole) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            }
        };

        if (this.navFilterAllBtn) {
            this.navFilterAllBtn.addEventListener("click", () => {
                this.filterServer = 'ALL';
                updateServerNavActiveState();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.navFilterLolBtn) {
            this.navFilterLolBtn.addEventListener("click", () => {
                this.filterServer = this.filterServer === 'LOL' ? 'ALL' : 'LOL';
                updateServerNavActiveState();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.navFilterSrBtn) {
            this.navFilterSrBtn.addEventListener("click", () => {
                this.filterServer = this.filterServer === 'SR' ? 'LOL' : 'SR';
                updateServerNavActiveState();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.navFilterAramBtn) {
            this.navFilterAramBtn.addEventListener("click", () => {
                this.filterServer = this.filterServer === 'ARAM' ? 'LOL' : 'ARAM';
                updateServerNavActiveState();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.navFilterOtherBtn) {
            this.navFilterOtherBtn.addEventListener("click", () => {
                this.filterServer = this.filterServer === 'OTHER' ? 'LOL' : 'OTHER';
                updateServerNavActiveState();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.navFilterTftBtn) {
            this.navFilterTftBtn.addEventListener("click", () => {
                this.filterServer = this.filterServer === 'TFT' ? 'ALL' : 'TFT';
                updateServerNavActiveState();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        
        // Role Button Handlers
        if (this.roleFilterBtns) {
            this.roleFilterBtns.forEach((btn: HTMLButtonElement) => {
                btn.addEventListener("click", () => {
                    const role = btn.getAttribute('data-role');
                    if (this.filterRole === role) {
                        this.filterRole = null; // Toggle off
                    } else {
                        this.filterRole = role; // Toggle on
                    }
                    updateServerNavActiveState();
                    if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
                });
            });
        }
        
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
                         this.searchBarContainer.classList.remove("hidden");
                         this.searchBarContainer.style.display = ""; // clear inline
                         if (this.searchInput) this.searchInput.focus();
                    }
                    // Show stats container immediately when search activates
                    if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
                } else {
                    this.filterSearchBtn.classList.remove("active");
                    this.filterSearchBtn.style.color = "";
                    if (this.searchBarContainer) {
                        this.searchBarContainer.classList.add("hidden");
                    }
                    
                    // Clear all search queries on close
                    if (this.searchInput) this.searchInput.value = "";
                    if (this.searchAllyInput) this.searchAllyInput.value = "";
                    if (this.searchEnemyInput) this.searchEnemyInput.value = "";
                    if (this.searchUserInput) this.searchUserInput.value = "";
                    if (this.searchQueueInput) this.searchQueueInput.value = "";
                    this.searchQuery = "";
                    this.searchAllyQuery = "";
                    this.searchEnemyQuery = "";
                    this.searchUserQuery = "";
                    this.searchQueueQuery = "";
                    
                    // Always re-render to hide stats container and reset filters
                    if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
                }
            });
        }
        if (this.searchInput) {
            this.searchInput.addEventListener("input", (e) => {
                this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        
        if (this.searchAllyInput) {
            this.searchAllyInput.addEventListener("input", (e) => {
                this.searchAllyQuery = (e.target as HTMLInputElement).value.toLowerCase();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.searchEnemyInput) {
            this.searchEnemyInput.addEventListener("input", (e) => {
                this.searchEnemyQuery = (e.target as HTMLInputElement).value.toLowerCase();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.searchUserInput) {
            this.searchUserInput.addEventListener("input", (e) => {
                this.searchUserQuery = (e.target as HTMLInputElement).value.toLowerCase();
                if (this.lastOnVideo) this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
            });
        }
        if (this.searchQueueInput) {
            this.searchQueueInput.addEventListener("input", (e) => {
                this.searchQueueQuery = (e.target as HTMLInputElement).value.toLowerCase();
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
            if (s.language) {
                this.currentLanguage = s.language;
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
                        const tooltipEl = document.querySelector(".league-tooltip") as HTMLElement | null;
                        if (tooltipEl && tooltipEl.style.display !== "none") {
                            const r = tooltipEl.getBoundingClientRect();
                            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                                // Let tooltip consume wheel for scrolling.
                                return;
                            }
                        }

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

    public setRefreshBtnOnClickHandler = (handler: (e: MouseEvent) => void) => {
        this.refreshBtn.addEventListener("click", handler);
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
    private lastOnDeleteVideoOnly: any;
    private lastRecordingsSizeGb: number = 0;
    private currentLanguage: string = "ja";
    
    // DOM Cache to prevent image flickering
    private recordingElementMap = new Map<string, HTMLElement>();

    public updateSideBar = (
        recordingsSizeGb: number,
        recordings: ReadonlyArray<Recording>,
        onVideo: (videoId: string) => void,
        onFavorite: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void,
        onDelete: (videoId: string, isFavorite: boolean) => void,
        onDeleteVideoOnly?: (videoId: string, isFavorite: boolean) => void,
        forceUpdateIds: string[] = []
    ) => {
        // Cache data for local re-filtering
        this.lastRecordingsSizeGb = recordingsSizeGb;
        this.lastRecordings = recordings;
        this.lastOnVideo = onVideo;
        this.lastOnFavorite = onFavorite;
        this.lastOnRename = onRename;
        this.lastOnDelete = onDelete;
        if (onDeleteVideoOnly) this.lastOnDeleteVideoOnly = onDeleteVideoOnly;

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
        if (this.segClip) this.segClip.style.height = `${clipPct}%`;
        if (this.segStar) this.segStar.style.height = `${starPct}%`;
        if (this.segNorm) this.segNorm.style.height = `${normPct}%`;
        
        let totalPct = clipPct + starPct + normPct;
        if (totalPct > 100) totalPct = 100;
        if (this.storagePctText) this.storagePctText.textContent = `${Math.round(totalPct)}%`;
        
        if (this.sizeTotalText) this.sizeTotalText.textContent = recordingsSizeGb.toFixed(0);
        if (this.sizeMaxText) this.sizeMaxText.textContent = this.maxStorageGb > 0 ? this.maxStorageGb.toString() : "∞";

        // Prepare variables for calculating stats within this render cycle
        let totalGames = 0;
        let totalWins = 0;
        let blueGames = 0;
        let blueWins = 0;
        let redGames = 0;
        let redWins = 0;
        let totalKills = 0;
        let totalDeaths = 0;
        let totalAssists = 0;
        const recent20Wins: boolean[] = [];

        // Loop through all recordings and apply all filters (search, server, type)
        const videoLiElements = recordings.map((recording, index) => {
            // STRICT FILTERING: Hide logic disabled per user request to show all videos.
            let shouldHide = false;
            let isWin: boolean = false;
            let isBlueSide: boolean = false;
            let isRedSide: boolean = false;
            let kills: number = 0;
            let deaths: number = 0;
            let assists: number = 0;
            let isFinishedGame: boolean = false;
            
            if (recording.metadata && "Metadata" in recording.metadata) {
                const m = recording.metadata.Metadata;
                // Broaden check: If queue is missing OR name contains "Unknown" (case insensitive), hide it ONLY IF STATS ARE MISSING.
                // If stats are present, it's a finished game (e.g. AI game with unmapped ID), so show it.
                // if (m.stats || (m.queue && m.queue.name && !m.queue.name.toLowerCase().includes("unknown"))) {
                //    shouldHide = false;
                // }
                
                // Search Filter (Self Champion)
                if (!shouldHide && this.searchQuery && this.searchQuery !== "") {
                    let matchedSelf = false;
                    const champNameLoc = m.championName;
                    if (champNameLoc && champNameLoc.toLowerCase().includes(this.searchQuery)) {
                        matchedSelf = true;
                    } else if (m.participantId !== undefined) {
                        try {
                            const myPar = m.participants?.find((p: any) => p.participantId === m.participantId);
                            if (myPar && myPar.championId) {
                                const enName = getChampionEnglishNameByIdSync(myPar.championId);
                                const locName = getChampionLocalizedNameByIdSync(myPar.championId);
                                if ((enName && enName.toLowerCase().includes(this.searchQuery)) || 
                                    (locName && locName.toLowerCase().includes(this.searchQuery))) {
                                    matchedSelf = true;
                                }
                            }
                        } catch (e) {}
                    }
                    if (!matchedSelf) shouldHide = true;
                }

                // Team/Enemy Search Filter
                const myPar = m.participants?.find((p: any) => p.participantId === m.participantId);
                const myTeamId = myPar ? myPar.teamId : undefined;

                if (!shouldHide && this.searchAllyQuery && this.searchAllyQuery !== "") {
                    const terms = this.searchAllyQuery.split(',').map(t => t.trim()).filter(t => t.length > 0);
                    if (terms.length > 0) {
                        for (const term of terms) {
                            let matchedAlly = false;
                            if (m.participants && Array.isArray(m.participants) && myTeamId !== undefined) {
                                for (const p of m.participants) {
                                    if (p.participantId === m.participantId) continue;
                                    if (p.teamId === myTeamId && p.championId) {
                                        const enName = getChampionEnglishNameByIdSync(p.championId);
                                        const locName = getChampionLocalizedNameByIdSync(p.championId);
                                        if ((enName && enName.toLowerCase().includes(term)) || 
                                            (locName && locName.toLowerCase().includes(term))) {
                                            matchedAlly = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (!matchedAlly) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }

                if (!shouldHide && this.searchEnemyQuery && this.searchEnemyQuery !== "") {
                    const terms = this.searchEnemyQuery.split(',').map(t => t.trim()).filter(t => t.length > 0);
                    if (terms.length > 0) {
                        for (const term of terms) {
                            let matchedEnemy = false;
                            if (m.participants && Array.isArray(m.participants) && myTeamId !== undefined) {
                                for (const p of m.participants) {
                                    if (p.participantId === m.participantId) continue;
                                    if (p.teamId !== myTeamId && p.championId) {
                                        const enName = getChampionEnglishNameByIdSync(p.championId);
                                        const locName = getChampionLocalizedNameByIdSync(p.championId);
                                        if ((enName && enName.toLowerCase().includes(term)) || 
                                            (locName && locName.toLowerCase().includes(term))) {
                                            matchedEnemy = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (!matchedEnemy) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }
                
                // Search Filter (User Name)
                if (!shouldHide && this.searchUserQuery && this.searchUserQuery !== "") {
                    const terms = this.searchUserQuery.split(',').map(t => t.trim()).filter(t => t.length > 0);
                    if (terms.length > 0) {
                        for (const term of terms) {
                            let matchedUser = false;
                            if (m.participants && Array.isArray(m.participants)) {
                                for (const p of m.participants) {
                                    const pAny = p as any;
                                    const riotId = pAny.riotIdGameName ? `${pAny.riotIdGameName}#${pAny.riotIdTagline}`.toLowerCase() : "";
                                    const gameName = pAny.riotIdGameName ? pAny.riotIdGameName.toLowerCase() : "";
                                    const summName = p.summonerName ? p.summonerName.toLowerCase() : "";
                                    
                                    if (riotId.includes(term) || gameName.includes(term) || summName.includes(term)) {
                                        matchedUser = true;
                                        break;
                                    }
                                }
                            }
                            if (!matchedUser) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }
                
                // Search Filter (Game Mode)
                if (!shouldHide && this.searchQueueQuery && this.searchQueueQuery !== "") {
                    const terms = this.searchQueueQuery.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
                    if (terms.length > 0) {
                        for (const term of terms) {
                            let matchedQueue = false;
                            
                            // 1. Check against raw JSON queue name (e.g. "Ranked Solo/Duo")
                            if (m.queue && m.queue.name) {
                                const qName = m.queue.name.toLowerCase();
                                if (qName.includes(term)) {
                                    matchedQueue = true;
                                }
                            }
                            
                            // 2. Check against sidebar display names (the short English labels shown in UI)
                            if (!matchedQueue && m.queue) {
                                const qId = m.queue.id || 0;
                                const displayName = getShortQueueLabel(qId, m.queue.name || "").toLowerCase();
                                
                                // Check if the user's search term matches the display name (partial)
                                if (displayName.includes(term) || term.includes(displayName)) {
                                    matchedQueue = true;
                                }
                                
                                // Also check by queueId group as final fallback
                                if (!matchedQueue) {
                                    const queueFilterMode = getGameModeByQueueId(qId, m.queue.name || "");
                                    if (queueFilterMode.toLowerCase().includes(term)) {
                                        matchedQueue = true;
                                    }
                                }
                            }

                            if (!matchedQueue) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }
                
                // Data Extraction for Stats
                if (m.participants && m.participantId !== undefined) {
                    const myParInner = m.participants.find((p: any) => p.participantId === m.participantId);
                    if (myParInner) {
                        isWin = myParInner.stats?.win === true;
                        isBlueSide = myParInner.teamId === 100;
                        isRedSide = myParInner.teamId === 200;
                        if (myParInner.stats) {
                            kills = myParInner.stats.kills || 0;
                            deaths = myParInner.stats.deaths || 0;
                            assists = myParInner.stats.assists || 0;
                            isFinishedGame = true; // Only count if stats exist
                        }
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
                li = this.createRecordingItem(recording, onVideo, onFavorite, onRename, onDelete, onDeleteVideoOnly);
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
            
            // 4. Server Nav Filter (ALL / LOL / TFT / SR / ARAM / OTHER)
            if (this.filterServer !== 'ALL') {
                const isClipObj = recording.videoId.includes("_clip");
                let queueFilterMode = 'UNKNOWN';
                
                if (recording.metadata && "Metadata" in recording.metadata) {
                    const m = recording.metadata.Metadata;
                    if (m.queue) {
                        const qId = m.queue.id || 0;
                        const qName = m.queue.name || "";
                        queueFilterMode = getGameModeByQueueId(qId, qName);
                        console.log(`[DEBUG Filter] ID: ${qId}, Name: ${qName}, queueFilterMode: ${queueFilterMode}, Server: ${this.filterServer}`);
                    }
                }
                
                if (this.filterServer === 'TFT') {
                    if (queueFilterMode !== 'TFT' && !isClipObj) isVisible = false; 
                    if (isClipObj && queueFilterMode !== 'TFT') {
                        isVisible = false;
                    }
                } else if (this.filterServer === 'LOL' || this.filterServer === 'SR' || this.filterServer === 'ARAM' || this.filterServer === 'OTHER') {
                    if (queueFilterMode === 'TFT') {
                        isVisible = false; // Hide TFT from LOL views
                    } else if (this.filterServer === 'SR' && queueFilterMode !== 'SR') {
                        isVisible = false;
                    } else if (this.filterServer === 'ARAM' && queueFilterMode !== 'ARAM') {
                        isVisible = false;
                    } else if (this.filterServer === 'OTHER' && queueFilterMode !== 'OTHER') {
                        isVisible = false;
                    }
                }
            }

            // 5. Role Filter (TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY)
            if (this.filterRole && isVisible) {
                if (recording.metadata && "Metadata" in recording.metadata) {
                    const m = recording.metadata.Metadata;
                    let matchesRole = false;
                    
                    if (m.participants && m.participantId !== undefined) {
                        const myPar = m.participants.find((p: any) => p.participantId === m.participantId);
                        if (myPar) {
                            // Extract My Team
                            const myTeamId = myPar.teamId;
                            const myTeam = m.participants.filter((p: any) => p.teamId === myTeamId);
                            
                            // To match scoreboard, we need to sort the team.
                            // We can use a simplified inline version of `sortParticipants` for the sidebar list.
                            // Warning: without full `events` it might differ slightly in edge cases from full scoreboard,
                            // but `teamPosition` is usually available in standard games.
                            let derivedRole = (myPar as any).teamPosition || "";

                            // If teamPosition is missing or "INVALID" (e.g. older matches or custom), try the fallback logic
                            if (!derivedRole || derivedRole === "INVALID") {
                                const hasSmite = myPar.spell1Id === 11 || myPar.spell2Id === 11;
                                const supportItems = [3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877];
                                const hasSupportItem = [myPar.stats?.item0, myPar.stats?.item1, myPar.stats?.item2, myPar.stats?.item3, myPar.stats?.item4, myPar.stats?.item5].some(id => id && supportItems.includes(id));
                                
                                if (hasSmite) derivedRole = "JUNGLE";
                                else if (hasSupportItem) derivedRole = "UTILITY";
                                else {
                                    // Fallback Native Slot logic
                                    const nativeSlot = ((myPar.participantId - 1) % 5) + 1;
                                    if (nativeSlot === 1) derivedRole = "TOP";
                                    else if (nativeSlot === 3) derivedRole = "MIDDLE";
                                    else if (nativeSlot === 4) derivedRole = "BOTTOM";
                                    else derivedRole = "MIDDLE"; // blind guess for unexpected
                                }
                            }
                            
                            if (derivedRole.toUpperCase() === this.filterRole) {
                                matchesRole = true;
                            }
                        }
                    }
                    if (!matchesRole) {
                        isVisible = false;
                    }
                } else {
                    isVisible = false; // No metadata, cannot match role
                }
            }


            if (li) {
                if (isVisible) {
                    li.style.display = "";
                    
                    // Accumulate stats for visible items
                    const isClipRecording = recording.videoId.includes("_clip");
                    if (isFinishedGame && !isClipRecording) {
                        totalGames++;
                        if (isWin) totalWins++;
                        
                        if (isBlueSide) {
                            blueGames++;
                            if (isWin) blueWins++;
                        } else if (isRedSide) {
                            redGames++;
                            if (isWin) redWins++;
                        }
                        
                        totalKills += kills;
                        totalDeaths += deaths;
                        totalAssists += assists;
                        
                        if (recent20Wins.length < 20) {
                            recent20Wins.push(isWin);
                        }
                    }
                } else {
                    li.style.display = "none";
                }
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
        
        // --- Calculate and Update Filtered Stats ---
        const statsContainer = document.getElementById("filtered-stats-container");
        if (statsContainer) {
            // Show when search mode is active (button toggled ON)
            if (this.filterSearch) {
                statsContainer.style.display = "flex";
            } else {
                statsContainer.style.display = "none";
            }

            // Update UI Elements
            const setStat = (id: string, value: string) => {
                const el = document.getElementById(id);
                if (el) el.textContent = value;
            };

            if (totalGames > 0) {
                const winRate = ((totalWins / totalGames) * 100).toFixed(1);
                setStat("stat-winrate", `${winRate}% (${totalWins}W ${totalGames - totalWins}L)`);
                
                const recentWins = recent20Wins.filter(w => w).length;
                const recentRate = ((recentWins / recent20Wins.length) * 100).toFixed(1);
                setStat("stat-recent20", `${recentRate}% (${recentWins}W ${recent20Wins.length - recentWins}L)`);
                
                const blueRate = blueGames > 0 ? ((blueWins / blueGames) * 100).toFixed(1) + "%" : "-%";
                setStat("stat-blue-winrate", blueRate);
                
                const redRate = redGames > 0 ? ((redWins / redGames) * 100).toFixed(1) + "%" : "-%";
                setStat("stat-red-winrate", redRate);
                
                const avgK = (totalKills / totalGames).toFixed(1);
                const avgD = (totalDeaths / totalGames).toFixed(1);
                const avgA = (totalAssists / totalGames).toFixed(1);
                setStat("stat-kda", `${avgK} / ${avgD} / ${avgA}`);
                
                const kdaRatio = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(2) : "Perfect";
                setStat("stat-kda-ratio", `${kdaRatio}:1 KDA`);
            } else {
                setStat("stat-winrate", "0.0% (0W 0L)");
                setStat("stat-recent20", "0.0% (0W 0L)");
                setStat("stat-blue-winrate", "-%");
                setStat("stat-red-winrate", "-%");
                setStat("stat-kda", "0.0 / 0.0 / 0.0");
                setStat("stat-kda-ratio", "0.00:1 KDA");
            }
        }
    };

    public createRecordingItem = (
        recording: Recording,
        onVideo: (videoId: string) => void,
        onFavorite: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void,
        onDelete: (videoId: string, isFavorite: boolean) => void,
        onDeleteVideoOnly?: (videoId: string, isFavorite: boolean) => void,
    ) => {
        console.log("createRecordingItem:", recording.videoId, recording.metadata);
        const videoName = toVideoName(recording.videoId);
        const isClipRecording = recording.videoId.includes("_clip");
        const favorite = isFavorite(recording.metadata);
        const createClipIconEl = (): SVGSVGElement => {
            const ns = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(ns, "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "14");
            svg.setAttribute("height", "14");
            svg.setAttribute("class", "sidebar-clip-icon");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2");
            const make = (tag: string, attrs: Record<string, string>) => {
                const el = document.createElementNS(ns, tag);
                for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                return el;
            };
            svg.append(
                make("rect", { x: "2", y: "2", width: "20", height: "20", rx: "2.18", ry: "2.18" }),
                make("line", { x1: "7", y1: "2", x2: "7", y2: "22" }),
                make("line", { x1: "17", y1: "2", x2: "17", y2: "22" }),
                make("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
                make("line", { x1: "2", y1: "7", x2: "7", y2: "7" }),
                make("line", { x1: "2", y1: "17", x2: "7", y2: "17" }),
                make("line", { x1: "17", y1: "17", x2: "22", y2: "17" }),
                make("line", { x1: "17", y1: "7", x2: "22", y2: "7" }),
            );
            return svg;
        };
        const formatSidebarDate = (name: string): string => {
            // Normal recording: YYYY-MM-DD_HH-MM(-SS)
            let m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})(?:-\d{2})?$/);
            if (m) {
                return `${m[1]}/${parseInt(m[2], 10)}/${parseInt(m[3], 10)} ${m[4]}:${m[5]}`;
            }
            // Clip suffix: *_clip_YYYYMMDD_HHMMSS
            m = name.match(/_clip_(\d{8})_(\d{6})$/);
            if (!m) {
                // Generic fallback: *YYYYMMDD_HHMMSS
                m = name.match(/(\d{8})_(\d{6})$/);
            }
            if (m) {
                const d = m[1];
                const t = m[2];
                const y = d.slice(0, 4);
                const mo = parseInt(d.slice(4, 6), 10);
                const da = parseInt(d.slice(6, 8), 10);
                return `${y}/${mo}/${da} ${t.slice(0, 2)}:${t.slice(2, 4)}`;
            }
            return name;
        };
        let displayContent: HTMLElement[] = [this.vjs.dom.createEl("span", {}, { class: "video-name" }, videoName) as HTMLElement];
        let liClass = "recording-item";
        if (isClipRecording) {
            liClass += " recording-clip";
        }
        
        if (!recording.videoExists) {
            liClass += " video-deleted";
        }

        // Layout Elements
        const mainContent = document.createElement("div");
        mainContent.className = "recording-content";

        if (recording.metadata && "Metadata" in recording.metadata) {
            liClass += " has-metadata";
            const meta = recording.metadata.Metadata;
            const dateStr = formatSidebarDate(videoName);

            const champion = meta.championName;
            const kda = `${meta.stats.kills}/${meta.stats.deaths}/${meta.stats.assists}`;
            const result = meta.stats.gameEndedInEarlySurrender 
                ? "Remake" 
                : meta.stats.win ? "Victory" : "Defeat";
            
            const resultClass = meta.stats.gameEndedInEarlySurrender 
                ? "remake-text" 
                : meta.stats.win ? "win-text" : "loss-text";
            
            const queueName = getShortQueueLabel(meta.queue?.id, meta.queue?.name ?? "Custom");

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
            const dateSpan = this.vjs.dom.createEl("div", {}, { class: "sidebar-date" }, dateStr);

            // --- CS Calculation ---
            const totalCS = meta.stats.totalMinionsKilled + meta.stats.neutralMinionsKilled;
            const csPerMin = durationSec > 0 ? (totalCS / (durationSec / 60)).toFixed(1) : "0.0";

            // Flattened Layout Elements
            const mainCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-main" });
            const rightCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-right" });
            
            // 1. Header: Time and Mode
            const headerRow = this.vjs.dom.createEl("div", {}, { class: "sidebar-header-row" });
            const timeSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-time" }, timeStr);
            
            const displayMode = queueName;
            const modeSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-mode" }, displayMode);
            headerRow.append(timeSpan, modeSpan);

            const bodyRow = this.vjs.dom.createEl("div", {}, { class: "sidebar-body-row" });
            const mainIconImg = this.vjs.dom.createEl("img", {}, { class: "main-champ-img" }) as HTMLImageElement;

            const participantsContainer = this.vjs.dom.createEl("div", {}, { class: "sidebar-participants" });
            const team1Row = this.vjs.dom.createEl("div", {}, { class: "participant-row" }) as HTMLElement; // Blue
            const team2Row = this.vjs.dom.createEl("div", {}, { class: "participant-row" }) as HTMLElement; // Red
            participantsContainer.append(team1Row, team2Row);

            if (queueName === "TFT") {
                // =============== TFT Layout ===============
                liClass += " tft-match";
                
                const statsCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-stats tft-stats" });
                const placementClass = selfPart?.placement === 1 ? "tft-1st" : (selfPart?.placement && selfPart?.placement <= 4 ? "tft-top4" : "tft-bot4");
                const placementStr = selfPart?.placement ? `#${selfPart.placement}` : "-";
                
                const placementSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-placement " + placementClass }, placementStr);
                
                // Append Placement and Date to the header row
                headerRow.append(placementSpan, dateSpan);
                
                const tftTraits = this.vjs.dom.createEl("div", {}, { class: "sidebar-tft-traits" });
                if (selfPart?.traits) {
                    // Sort traits by tierCurrent, then numUnits
                    const activeTraits = [...selfPart.traits]
                        .filter(t => t.tierCurrent > 0)
                        .sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits)
                        .slice(0, 7); // display up to 7 traits
                        
                    for (const trait of activeTraits) {
                        let styleClass = "tft-inactive";
                        const { tierCurrent, tierTotal } = trait;
                        
                        if (tierCurrent > 0) {
                            if (tierTotal === 1 && tierCurrent === 1) styleClass = "tft-unique";
                            else if (tierTotal === 2) {
                                if (tierCurrent === 1) styleClass = "tft-bronze";
                                else if (tierCurrent >= 2) styleClass = "tft-gold";
                            }
                            else if (tierTotal === 3) {
                                if (tierCurrent === 1) styleClass = "tft-bronze";
                                else if (tierCurrent === 2) styleClass = "tft-silver";
                                else if (tierCurrent >= 3) styleClass = "tft-gold";
                            }
                            else if (tierTotal === 4) {
                                if (tierCurrent === 1) styleClass = "tft-bronze";
                                else if (tierCurrent === 2) styleClass = "tft-silver";
                                else if (tierCurrent === 3) styleClass = "tft-gold";
                                else if (tierCurrent >= 4) styleClass = "tft-prismatic";
                            }
                            else if (tierTotal >= 5) {
                                if (tierCurrent === 1) styleClass = "tft-bronze";
                                else if (tierCurrent === 2) styleClass = "tft-silver";
                                else if (tierCurrent === 3) styleClass = "tft-silver";
                                else if (tierCurrent === 4) styleClass = "tft-gold";
                                else if (tierCurrent >= 5) styleClass = "tft-prismatic";
                            }
                        }
                        
                        const trWrapper = this.vjs.dom.createEl("div", { title: trait.name.replace(/^TFT\d+_/, "") }, { class: "tft-trait-wrapper " + styleClass });
                        const trImg = this.vjs.dom.createEl("div", {}, { class: "tft-trait" }) as HTMLElement;
                        const trNum = this.vjs.dom.createEl("span", {}, { class: "tft-trait-num" }, `${trait.numUnits}`);
                        trWrapper.append(trImg, trNum);
                        tftTraits.append(trWrapper);
                    }
                }
                
                // Add Units
                const tftUnits = this.vjs.dom.createEl("div", {}, { class: "sidebar-tft-units" });
                if (selfPart?.units) {
                    // Only show 1+ cost units, limit to reasonable amount
                    const activeUnits = [...selfPart.units].slice(0, 10);
                    
                    for (const unit of activeUnits) {
                        let cost = 1;
                        if (unit.rarity === 0) cost = 1;
                        else if (unit.rarity === 1) cost = 2;
                        else if (unit.rarity === 2) cost = 3;
                        else if (unit.rarity === 3 || unit.rarity === 4) cost = 4;
                        else if (unit.rarity >= 5) cost = 5;
                        
                        const costClass = `tft-cost-${cost}`;
                        const unitContainer = this.vjs.dom.createEl("div", {}, { class: `tft-unit-wrapper ${costClass}` });
                        const unitImg = this.vjs.dom.createEl("img", { title: unit.characterId.replace(/^TFT\d+_/, "") }, { class: "tft-unit-img" }) as HTMLImageElement;
                        unitContainer.append(unitImg);
                        
                        if (unit.tier > 1) {
                            const starClass = unit.tier === 3 ? "star-gold" : "star-silver";
                            const starSpan = this.vjs.dom.createEl("span", {}, { class: `tft-unit-stars ${starClass}` }, "\u2605".repeat(unit.tier));
                            unitContainer.append(starSpan);
                        }

                        // Add Items Container
                        const itemsContainer = this.vjs.dom.createEl("div", {}, { class: "tft-unit-items" });
                        if (unit.itemNames && unit.itemNames.length > 0) {
                            for (const itemName of unit.itemNames) {
                                const itemImg = this.vjs.dom.createEl("img", { title: itemName.replace(/^TFT\d+_Item_/, "") }, { class: "tft-unit-item-img" }) as HTMLImageElement;
                                itemsContainer.append(itemImg);
                            }
                        }
                        unitContainer.append(itemsContainer);

                        tftUnits.append(unitContainer);
                    }
                }
                
                statsCol.append(tftTraits, tftUnits);
                bodyRow.append(statsCol);
                
            } else {
                // =============== Normal Layout ===============
                // Stats Column (KDA, CS, Result)
                const statsCol = this.vjs.dom.createEl("div", {}, { class: "sidebar-stats" });
                const kdaSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-kda" }, kda);
                const csSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-cs" }, `${totalCS} CS (${csPerMin}/m)`);
                const resultSpan = this.vjs.dom.createEl("span", {}, { class: "sidebar-result " + resultClass }, result);
                
                statsCol.append(kdaSpan, csSpan, resultSpan);

                // Add LP Diff if available (ONLY for Ranked Queues)
                if (meta.lpDiff !== undefined && meta.lpDiff !== null && meta.queue?.isRanked) {
                    const diff = meta.lpDiff;
                    const diffStr = diff >= 0 ? `+${diff} LP` : `${diff} LP`;
                    const lpClass = "sidebar-lp " + resultClass; // Reuse result color logic
                    const lpSpan = this.vjs.dom.createEl("span", {}, { class: lpClass }, diffStr);
                    statsCol.append(lpSpan);
                }

                bodyRow.append(mainIconImg, statsCol);
            }

            // Main Column (Header + Body)
            mainCol.append(headerRow, bodyRow);
            const sidebarBadges = this.vjs.dom.createEl("div", {}, { class: "sidebar-badges" });
            if (isClipRecording) {
                const clipBadge = this.vjs.dom.createEl("span", {}, { class: "sidebar-clip-badge", title: "Clip" });
                clipBadge.append(createClipIconEl());
                sidebarBadges.append(clipBadge);
            }
            if (favorite) {
                const favoriteBadge = this.vjs.dom.createEl("span", {}, { class: "sidebar-favorite-badge", title: "Favorite" }, "\u2605");
                sidebarBadges.append(favoriteBadge);
            }

            if (queueName === "TFT") {
                mainCol.append(sidebarBadges);
                mainContent.append(mainCol);
            } else {
                participantsContainer.append(team1Row, team2Row);
                rightCol.append(dateSpan, participantsContainer, sidebarBadges);
                mainContent.append(mainCol, rightCol);
            }

            // Load Icons Async
            void (async () => {
                try {
                    const selfParticipant = meta.participants.find((p) => p.participantId === meta.participantId);
                    
                    if (queueName === "TFT" && selfParticipant) {
                     // For TFT, set Main Icon directly to Companion if available, otherwise fallback
                     if (selfParticipant.companion) {
                         // DataDragon companion URL format (approximate logic, can enhance later)
                         const comp = selfParticipant.companion;
                         // Just as fallback, leave it blank or load a companion icon if we know the URL mapping
                         // For now, let's keep it generic or use their first unit
                         const url = await getTftUnitIconUrl(selfParticipant.units?.[0]?.characterId || "");
                         if (url) mainIconImg.src = url;
                     }

                     // Load Unit and Trait icons
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
                                 // Don't await inline, run async block
                                 getTftUnitIconUrl(unit.characterId).then(url => {
                                     if (url) {
                                         img.src = url;
                                         img.onerror = () => { img.style.opacity = "0"; };
                                     }
                                 }).catch(console.error);
                             }

                             const itemImgs = wrapper.querySelectorAll(".tft-unit-item-img");
                             if (itemImgs && unit.itemNames) {
                                 for (let j = 0; j < Math.min(itemImgs.length, unit.itemNames.length); j++) {
                                     const itemImg = itemImgs[j] as HTMLImageElement;
                                     // Don't await inline
                                     getTftItemIconUrl(unit.itemNames[j]).then(itemUrl => {
                                         if (itemUrl) {
                                             itemImg.src = itemUrl;
                                             itemImg.onerror = () => { itemImg.style.display = "none"; };
                                         }
                                     }).catch(console.error);
                                 }
                             }
                         }
                     }
                     
                     if (traitImgs && selfParticipant.traits) {
                         const activeTraits = [...selfParticipant.traits]
                             .filter(t => t.tierCurrent > 0)
                             .sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits)
                             .slice(0, 7);
                         for (let i = 0; i < Math.min(traitImgs.length, activeTraits.length); i++) {
                             const el = traitImgs[i] as HTMLElement;
                             // Don't await inline
                             getTftTraitIconUrl(activeTraits[i].name).then(url => {
                                 if (url) {
                                     el.style.webkitMaskImage = `url("${url}")`;
                                     el.style.webkitMaskSize = "contain";
                                     el.style.webkitMaskRepeat = "no-repeat";
                                     el.style.webkitMaskPosition = "center";
                                     el.style.backgroundColor = "currentColor";
                                 }
                             }).catch(console.error);
                         }
                     }

                } else {
                    try {
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
                } catch (e) {
                    console.error("Error loading icons in sidebar:", e);
                }
            })();

            displayContent = [mainContent];

        } else {
            if (isClipRecording) {
                const clipName = this.vjs.dom.createEl("span", {}, { class: "video-name" }) as HTMLSpanElement;
                clipName.append(createClipIconEl(), document.createTextNode(` ${videoName}`));
                displayContent = [
                    clipName
                ];
            }
        }
        
        // Buttons (reuse logic)
        const favoriteBtn = this.vjs.dom.createEl("span", {
                onclick: (e: MouseEvent) => {
                    e.stopPropagation();
                    // eslint-disable-next-line always-return
                    onFavorite(recording.videoId).then((fav) => {
                        if (fav !== null) {
                            favoriteBtn.innerHTML = fav ? "★" : "☆";
                            favoriteBtn.style.color = fav ? "gold" : "";
                            
                            // 譖ｴ譁ｰ諠・ｱ繧貞・驛ｨ繝｡繧ｿ繝・・繧ｿ縺ｫ蜊ｳ譎ょ渚譏縺吶ｋ
                            if (recording.metadata) {
                                if ("Metadata" in recording.metadata) recording.metadata.Metadata.favorite = fav;
                                else if ("Deferred" in recording.metadata) recording.metadata.Deferred.favorite = fav;
                                else if ("NoData" in recording.metadata) recording.metadata.NoData.favorite = fav;
                            }
                            const badgeContainer = li.querySelector(".sidebar-badges");
                            if (badgeContainer) {
                                const existingFavoriteBadge = badgeContainer.querySelector(".sidebar-favorite-badge");
                                if (fav && !existingFavoriteBadge) {
                                    const favoriteBadge = this.vjs.dom.createEl("span", {}, { class: "sidebar-favorite-badge", title: "Favorite" }, "\u2605");
                                    badgeContainer.append(favoriteBadge);
                                } else if (!fav && existingFavoriteBadge) {
                                    existingFavoriteBadge.remove();
                                }
                            }
                            if (this.filterStar && this.lastOnVideo && !fav) {
                                this.updateSideBar(this.lastRecordingsSizeGb, this.lastRecordings, this.lastOnVideo, this.lastOnFavorite, this.lastOnRename, this.lastOnDelete);
                            }
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
                onclick: (e: MouseEvent) => { e.stopPropagation(); onDelete(recording.videoId, isFavorite(recording.metadata)); },
            }, { class: "delete", title: getText(this.currentLanguage as any, "delete" as any) || "Delete" }, "✖",
        );
        const deleteVideoOnlyBtn = this.vjs.dom.createEl("span", {
                onclick: (e: MouseEvent) => { e.stopPropagation(); if (onDeleteVideoOnly) onDeleteVideoOnly(recording.videoId, isFavorite(recording.metadata)); },
            }, { class: "delete-video-only", title: getText(this.currentLanguage as any, "deleteVideoOnly" as any) || "Delete Video Only" }, "🗑",
        );

        // Wrap buttons
        const actionsDiv = this.vjs.dom.createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, renameBtn, deleteVideoOnlyBtn, deleteBtn]);

        // Append everything to LI
        const li = this.vjs.dom.createEl("li", { 
            onclick: () => {
                if (recording.videoExists) {
                    onVideo(recording.videoId);
                } else {
                    console.log("Video file no longer exists for this recording.");
                }
            } 
        }, { id: recording.videoId, class: liClass }) as HTMLElement;
        
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

    public markRecordingAsVideoDeleted = (videoId: string) => {
        const li = document.getElementById(videoId);
        if (li) {
            li.classList.add("video-deleted");
        }
    };
            
    public updateRecordingItem = (recording: Recording) => {
        const existingLi = document.getElementById(recording.videoId);
        
        if (existingLi && this.lastOnVideo) {
            const newLi = this.createRecordingItem(
                recording, 
                this.lastOnVideo, 
                this.lastOnFavorite, 
                this.lastOnRename, 
                this.lastOnDelete,
                this.lastOnDeleteVideoOnly
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

    /**
     * Shows a rich update modal with release notes and a direct update button.
     */
    public showUpdateModal = (update: any, lang: string) => {
        // Ensure settings-mode is removed so the modal gets its standard background and styling, preventing double-box on startup
        this.modalContent.classList.remove("settings-mode");
        
        const title = this.vjs.dom.createEl("h2", {}, { style: "color: #e8d154; margin-top: 0; margin-bottom: 15px;" }, `${getText(lang as any, "updateAvailable" as any)} (v${update.version})`);
        
        const contentBox = this.vjs.dom.createEl("div", {}, { 
            style: "background: rgba(0,0,0,0.3); border: 1px solid #444; border-radius: 4px; padding: 15px; max-height: 400px; overflow-y: auto; text-align: left; font-size: 0.9em; white-space: pre-wrap; line-height: 1.5; color: #ddd; margin-bottom: 20px;" 
        }, update.body || "No release notes provided.");

        const statusMsg = this.vjs.dom.createEl("div", {}, { style: "color: #aaa; margin-bottom: 15px; min-height: 20px;" }, "") as HTMLElement;

        const updateBtn = this.vjs.dom.createEl("button", {
            onclick: async () => {
                updateBtn.disabled = true;
                laterBtn.disabled = true;
                statusMsg.innerText = getText(lang as any, "updateDownloading" as any) || "Downloading update...";
                statusMsg.style.color = "#00d2ff";
                try {
                    await update.downloadAndInstall();
                    statusMsg.innerText = getText(lang as any, "updateRestart" as any) || "Restarting...";
                    statusMsg.style.color = "#4CAF50";
                    const { relaunch } = await import("@tauri-apps/plugin-process");
                    await relaunch();
                } catch (e) {
                    console.error("Install update failed", e);
                    statusMsg.innerText = getText(lang as any, "updateError" as any) || "Update failed.";
                    statusMsg.style.color = "#ff5555";
                    updateBtn.disabled = false;
                    laterBtn.disabled = false;
                }
            }
        }, { class: "btn-browse", style: "border: 1px solid #c8aa6e; padding: 8px 16px; font-weight: bold; background: #222; color: #c8aa6e; cursor: pointer;" }, getText(lang as any, "updateRestart" as any) || "Update & Restart") as HTMLButtonElement;

        const laterBtn = this.vjs.dom.createEl("button", {
            onclick: this.hideModal
        }, { class: "btn", style: "margin-right: 15px;" }, getText(lang as any, "updateLater" as any) || "Later") as HTMLButtonElement;

        const btnContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; justify-content: flex-end; align-items: center;" }, [laterBtn, updateBtn]);

        // Wrap the content, relying on #modal-content for the primary background and border
        const wrapper = this.vjs.dom.createEl("div", {}, { 
            style: "width: 100%; max-width: 600px; margin: 0 auto; padding: 10px;" 
        }, [title, contentBox, statusMsg, btnContainer]);

        this.showModal([wrapper]);
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
    
    public showDeleteVideoOnlyModal = (videoId: string, deleteVideoOnly: (videoId: string) => void, isFavorite: boolean = false) => {
        let confirmDelete = true;
        const toggleDelete = () => {
            confirmDelete = !confirmDelete;
        };

        let videoName: string;
        if (videoId.includes("\\")) videoName = videoId.split("\\").pop()!;
        else if (videoId.includes("/")) videoName = videoId.split("/").pop()!;
        else videoName = videoId;

        const warningTexts = isFavorite ? [
            this.vjs.dom.createEl("br"),
            this.vjs.dom.createEl("br"),
            this.vjs.dom.createEl("strong", { style: "color: orange;" }, {}, "Warning: This is a favorite recording!"),
        ] : [];

        const prompt = this.vjs.dom.createEl("p", {}, {}, [
            "Delete Video Only (Keep JSON): ",
            this.vjs.dom.createEl("u", {}, {}, videoName),
            "?",
            ...warningTexts
        ]);

        const dontAskMeAgain = this.vjs.dom.createEl("p", {}, { style: "font-size: 18px" }, [
            this.vjs.dom.createEl(
                "input",
                { onchange: toggleDelete },
                { type: "checkbox", id: "dont-ask-again-vdo", style: "vertical-align: middle; margin: 0;" },
                [],
            ),
            this.vjs.dom.createEl(
                "label",
                {},
                { for: "dont-ask-again-vdo", style: "vertical-align: middle" },
                "  don't ask again",
            ),
        ]);

        const deleteFn = () => {
            this.hideModal();
            deleteVideoOnly(videoId);

            if (!confirmDelete && !isFavorite) {
                commands.disableConfirmDelete();
            }
        };

        const buttons = this.vjs.dom.createEl("p", {}, {}, [
            this.vjs.dom.createEl("button", { onclick: deleteFn }, { class: "btn" }, "Delete Video"),
            this.vjs.dom.createEl("button", { onclick: this.hideModal }, { class: "btn" }, "Cancel"),
        ]);

        this.showModal([prompt, dontAskMeAgain, buttons]);
    };

    public showDeleteModal = (videoId: string, deleteVideo: (videoId: string) => void, isFavorite: boolean = false) => {
        const videoName = toVideoName(videoId);

        let confirmDelete = true;
        const toggleDelete = () => {
            confirmDelete = !confirmDelete;
        };

        const warningTexts = isFavorite ? [
            this.vjs.dom.createEl("br"),
            this.vjs.dom.createEl("br"),
            this.vjs.dom.createEl("strong", { style: "color: orange;" }, {}, "Warning: This is a favorite recording!"),
        ] : [];

        const prompt = this.vjs.dom.createEl("p", {}, {}, [
            "Delete recording: ",
            this.vjs.dom.createEl("u", {}, {}, videoName),
            "?",
            ...warningTexts
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

            if (!confirmDelete && !isFavorite) {
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




    public clearVideoMetadata() {
        const playerEl = document.getElementById("video_player");
        if (playerEl) {
            const oldScoreboard = playerEl.querySelector(".scoreboard");
            if (oldScoreboard) oldScoreboard.remove();
            
            const spectatorHeader = document.getElementById("video-header");
            if (spectatorHeader) this.vjs.dom.emptyEl(spectatorHeader);
        }
    }

    public async setVideoDescriptionMetadata(data: GameMetadata) {
        this.metadataRenderId++;
        this.currentQueueId = data.queue?.id ?? 0;
        
        // Metadata Injection
        console.log("Setting Video Description Metadata", data);

        const currentRenderId = this.metadataRenderId;

        this.currentGameVersion = data.gameVersion || (await getCurrentPatchVersion());
        await ensureItemDataLoaded(this.currentGameVersion);
        if (getGameModeByQueueId(data.queue?.id ?? 0, data.queue?.name ?? "") === "TFT") {
            await ensureTftDataLoaded();
        }
        
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
        
        let spectatorHeader = document.getElementById("video-header") as HTMLElement | null;
        
        if (!spectatorHeader) {
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

        const sortParticipants = (team: Participant[]) => {
            const slots: { [key: number]: Participant } = {};
            const remaining: Participant[] = [];

            const supportItems = [3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877];
            const hasSmite = (p: Participant) => p.spell1Id === 11 || p.spell2Id === 11;
            
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
                

            } else {
                // --- SPATIAL SORTING FOR AI/CUSTOM ---
                
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

                const targetSlots = [1, 3, 4].filter(s => !slots[s]);
                
                remaining.forEach((p, i) => {
                     if (i < targetSlots.length) {
                         slots[targetSlots[i]] = p;
                     }
                });
                
                if (remaining.length > 0 && targetSlots.length > 0) {
                     remaining.splice(0, Math.min(remaining.length, targetSlots.length));
                }
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
                     // Found generic match
                 } else {
                     // 2. Check Assists if killer is neutral/minion
                     const assists = e.EliteMonsterKill.assisting_participant_ids;
                     if (assists && assists.length > 0) {
                         const assister = this.participants.find(p => assists.includes(p.participantId));

                     }
                 }
                 
                 const type = e.EliteMonsterKill.monster_type;
                 

                 
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


        idMap.clear();

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
        
        const blueHeader = createTeamHeader("blue");
        spectatorHeader.append(blueHeader);
        
        const centerParams = this.vjs.dom.createEl("div", {}, { class: "spec-center" }, "00:00"); 
        this.headerTimeText = centerParams as HTMLElement;
        spectatorHeader.append(centerParams);
        
        const redHeader = createTeamHeader("red");
        spectatorHeader.append(redHeader);
        
        spectatorHeader.append(dTimer.container);

        const isTFT = getGameModeByQueueId(data.queue?.id ?? 0, data.queue?.name ?? "") === "TFT";
        if (isTFT) {
            blueHeader.style.display = "none";
            redHeader.style.display = "none";
        }

        
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
                const isMe = p.participantId === data.participantId;
                const img = this.vjs.dom.createEl("img", { src: cachedChampIcon }, { class: "champ-icon" }) as HTMLImageElement;
                const initialChampLevel = (typeof p.champLevel === "number" && p.champLevel > 0) ? p.champLevel : 1;
                const champLevelEl = this.vjs.dom.createEl("div", {}, { class: "champ-level-overlay" }, `${initialChampLevel}`) as HTMLElement;
                const champIconWrap = this.vjs.dom.createEl("div", {}, { class: "champ-icon-wrap" }, [img, champLevelEl]) as HTMLElement;
                let hideTooltipTimer: number | null = null;
                const cancelHideTooltip = () => {
                    if (hideTooltipTimer !== null) {
                        window.clearTimeout(hideTooltipTimer);
                        hideTooltipTimer = null;
                    }
                };
                const scheduleHideTooltip = () => {
                    // Visibility should strictly follow whether the cursor is on the icon element.
                    cancelHideTooltip();
                    hideTooltipTimer = window.setTimeout(() => {
                        hideGlobalTooltip();
                        hideTooltipTimer = null;
                    }, 30);
                };
                img.onerror = () => {
                    if (img.src !== cDragonUrl) {
                        console.warn(`Local cache failed for champion ${p.championId}, retrying remote: ${cDragonUrl}`);
                        img.src = cDragonUrl;
                    }
                };

                // Add Tooltip for Champion Skills
                let isHovered = false;
                let hoverRequestId = 0;
                const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
                    return await Promise.race<T | null>([
                        promise,
                        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
                    ]);
                };
                img.addEventListener("mouseenter", async () => {
                    cancelHideTooltip();
                    isHovered = true;
                    const requestId = ++hoverRequestId;
                    const lang = settings.language || "ja";
                    try {
                        // Try local tooltip JSON first and show immediately.
                        const tooltips = await getLocalChampionTooltips(p.championId, lang);
                        if (!isHovered || requestId !== hoverRequestId) return;

                        if (tooltips) {
                            const championEn = (getChampionEnglishNameByIdSync(p.championId) || "").toLowerCase();
                            const tooltipKey = `${championEn || p.championId}:${lang}`;
                            const safety = evaluateLocalTooltipSafety(tooltips);
                            const useLiteBySafety = safety.useLite || globalSlowTooltipKeys.has(tooltipKey);
                            const startedAt = Date.now();
                            let html = "";
                            if (useLiteBySafety) {
                                html = buildLocalChampionTooltipHtmlLite(tooltips, lang);
                                if (!loggedTooltipLiteKeys.has(tooltipKey)) {
                                    console.warn(`[tooltip-lite] using local lite tooltip for ${championEn || p.championId} (${lang}) reason=${safety.reason || "slow_history"}`);
                                    loggedTooltipLiteKeys.add(tooltipKey);
                                }
                            } else {
                                try {
                                    html = buildLocalChampionTooltipHtml(tooltips, lang, null);
                                    const elapsed = Date.now() - startedAt;
                                    if (elapsed > 120) {
                                        globalSlowTooltipKeys.add(tooltipKey);
                                        if (!loggedTooltipLiteKeys.has(tooltipKey)) {
                                            console.warn(`[tooltip-lite] mark slow tooltip key=${tooltipKey} (${elapsed}ms)`);
                                            loggedTooltipLiteKeys.add(tooltipKey);
                                        }
                                    }
                                } catch (e) {
                                    globalSlowTooltipKeys.add(tooltipKey);
                                    console.warn(`[tooltip-lite] fallback after render exception key=${tooltipKey}`, e);
                                    html = buildLocalChampionTooltipHtmlLite(tooltips, lang);
                                }
                            }
                            if (html && isHovered && requestId === hoverRequestId) {
                                showGlobalTooltip(img, html);
                            }
                        } else {
                            // Fallback to DataDragon only when local tooltip is unavailable.
                            const data = await withTimeout(
                                getDetailedChampionData(p.championId, getCurrentPatchVersion(), settings.language),
                                3000,
                            );
                            if (!isHovered || requestId !== hoverRequestId) return;
                            if (data && data.spells) {
                                const html = buildChampionTooltipHtml(data, lang);
                                if (html) showGlobalTooltip(img, html);
                            }
                        }
                    } catch (e) {
                        console.error("Champion tooltip hover failed:", e);
                    }
                });
                img.addEventListener("mouseleave", () => {
                    isHovered = false;
                    hoverRequestId++;
                    scheduleHideTooltip();
                });

                // Champion Wiki Link
                if (settings.championWikiBaseUrl) {
                    img.style.cursor = "pointer";
                    img.title = `Open Wiki`;
                    img.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        if (!settings.championWikiBaseUrl) return;
                        
                        const champName = await getChampionNameById(p.championId);
                        if (!champName) {
                            console.warn(`Could not resolve champion name for ID ${p.championId}`);
                            return;
                        }

                        const champEng = getChampionEnglishNameByIdSync(p.championId) || champName;
                        let url = settings.championWikiBaseUrl;
                        if (url.includes("{")) {
                            url = url
                                .replace(/{id}/g, champName)
                                .replace(/{name}/g, champEng)
                                .replace(/{name_}/g, champEng.replace(/\s+/g, "_"))
                                .replace(/{nameEsc}/g, encodeURIComponent(champEng))
                                .replace(/{Q}/g, champName)
                                .replace(/{q}/g, champName.toLowerCase());
                        } else {
                            url = `${url}${champName}`;
                        }
                        
                        try {
                            await open(url);
                        } catch (err) {
                            console.error("Failed to open Wiki URL:", err);
                        }
                    });
                }
                
                const spell1El = this.vjs.dom.createEl("img", { src: spell1Url }, { class: "spell-icon" }) as HTMLImageElement;
                const spell2El = this.vjs.dom.createEl("img", { src: spell2Url }, { class: "spell-icon" }) as HTMLImageElement;

                // Add Tooltips for Summoner Spells
                [
                    {el: spell1El, id: p.spell1Id},
                    {el: spell2El, id: p.spell2Id}
                ].forEach(({el, id}) => {
                    let spellHoverRequestId = 0;
                    el.addEventListener("mouseenter", async () => {
                        cancelHideTooltip();
                        const requestId = ++spellHoverRequestId;
                        const spellData = await getSummonerSpellData(id, getCurrentPatchVersion(), settings.language);
                        if (requestId !== spellHoverRequestId) return;
                        if (spellData) {
                            showGlobalTooltip(el, buildSummonerSpellTooltipHtml(spellData));
                        }
                    });
                    el.addEventListener("mouseleave", () => {
                        spellHoverRequestId++;
                        scheduleHideTooltip();
                    });
                });

                const spells = this.vjs.dom.createEl("div", {}, { class: "spells" }, [ spell1El, spell2El ]) as HTMLElement;
                
                const runeUrlValue = runeUrl; // store for local context
                const runeIconEl = this.vjs.dom.createEl("img", { src: runeUrlValue }, { class: "rune-icon" }) as HTMLImageElement;
                
                // Add Tooltip for Rune
                let runeHoverRequestId = 0;
                runeIconEl.addEventListener("mouseenter", async () => {
                    cancelHideTooltip();
                    const requestId = ++runeHoverRequestId;
                    if (p.stats.perk0 && p.stats.perk0 !== 0) {
                        const runeData = await getRuneData(p.stats.perk0, settings.language || "ja");
                        if (requestId !== runeHoverRequestId) return;
                        if (runeData) {
                            showGlobalTooltip(runeIconEl, buildRuneTooltipHtml(runeData));
                        }
                    }
                });
                runeIconEl.addEventListener("mouseleave", () => {
                    runeHoverRequestId++;
                    scheduleHideTooltip();
                });

                const runesDiv = this.vjs.dom.createEl("div", {}, { class: "runes" }, [
                   runeIconEl
                ]) as HTMLElement;
                
                // Separation of Stats
                const csDiv = this.vjs.dom.createEl("div", {}, { class: "cs-stat" }, `${p.stats.totalMinionsKilled}`) as HTMLElement;

                const kdaDiv = this.vjs.dom.createEl("div", {}, { class: "kda" }, `${p.stats.kills} / ${p.stats.deaths} / ${p.stats.assists}`) as HTMLElement;

                // Separation of Items (0-5) and Trinket (6)
                const coreItemUrls = itemUrls.slice(0, 6);
                const trinketUrl = itemUrls[6];

                const itemsGrid = this.vjs.dom.createEl("div", {}, { class: "items-grid" }) as HTMLElement;
                
                // Champion Build Link (Click on Items)
                if (settings.championBuildUrl) {
                     itemsGrid.style.cursor = "pointer";
                     itemsGrid.title = `Open Champion Build`;
                     itemsGrid.addEventListener("click", async (e) => {
                         e.stopPropagation();
                         if (!settings.championBuildUrl) return;

                         const champName = await getChampionNameById(p.championId);
                         if (!champName) {
                             console.warn(`Could not resolve champion name for ID ${p.championId}`);
                             return;
                         }

                         const champEng = getChampionEnglishNameByIdSync(p.championId) || champName;
                         let url = settings.championBuildUrl;
                         if (url.includes("{")) {
                             url = url
                                .replace(/{id}/g, champName)
                                .replace(/{name}/g, champEng)
                                .replace(/{name_}/g, champEng.replace(/\s+/g, "_"))
                                .replace(/{nameEsc}/g, encodeURIComponent(champEng))
                                .replace(/{Q}/g, champName)
                                .replace(/{q}/g, champName.toLowerCase());
                         } else {
                             url = `${url}${champName}`;
                         }
                         
                         try {
                             await open(url);
                         } catch (err) {
                             console.error("Failed to open Build URL:", err);
                         }
                     });
                }
                
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
                    let itemHoverRequestId = 0;
                    i.addEventListener("mouseenter", async (e) => {
                        cancelHideTooltip();
                        const requestId = ++itemHoverRequestId;
                        const target = e.target as HTMLElement;
                        const currentId = parseInt(target.dataset.itemId || "0", 10);
                        if (currentId === 0) return;
                        const itemData = await getItemData(currentId, settings.language || "ja");
                        if (requestId !== itemHoverRequestId) return;
                        if (itemData) {
                            showGlobalTooltip(target, buildItemTooltipHtml(itemData));
                        }
                    });
                    i.addEventListener("mouseleave", () => {
                        itemHoverRequestId++;
                        scheduleHideTooltip();
                    });
                    
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
                
                let trinketHoverRequestId = 0;
                trinketImg.addEventListener("mouseenter", async (e) => {
                    cancelHideTooltip();
                    const requestId = ++trinketHoverRequestId;
                    const target = e.target as HTMLElement;
                    const currentId = parseInt(target.dataset.itemId || "0", 10);
                    if (currentId === 0) return;
                    const itemData = await getItemData(currentId, settings.language || "ja");
                    if (requestId !== trinketHoverRequestId) return;
                    if (itemData) {
                        showGlobalTooltip(target, buildTrinketTooltipHtml(itemData));
                    }
                });
                trinketImg.addEventListener("mouseleave", () => {
                    trinketHoverRequestId++;
                    scheduleHideTooltip();
                });
                
                trinketImg.onerror = () => {
                     trinketImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                };

                trinketSlotDiv.append(trinketImg);
                const trinketDiv = this.vjs.dom.createEl("div", {}, { class: "trinket-container" }, [ trinketSlotDiv ]) as HTMLElement;
                
                const goldDiv = this.vjs.dom.createEl("div", {}, { class: "total-gold" }, "0") as HTMLElement;
                row.dataset.pid = p.participantId.toString();
                const nameStr = p.summonerName || (isMe ? `${data.player.gameName}#${data.player.tagLine}` : `P${p.participantId}`); 
                const name = this.vjs.dom.createEl("div", {}, { class: "player-name" }, nameStr) as HTMLElement;

                // Match History Link
                if (settings.matchHistoryBaseUrl) {
                     name.style.cursor = "pointer";
                     name.title = `Open Match History for ${nameStr}`;
                     name.addEventListener("click", async (e) => {
                         e.stopPropagation(); // prevent player toggle play/pause if applicable
                         if (!settings.matchHistoryBaseUrl) return; 
                         const targetId = nameStr.replace("#", "-");
                         const encodedId = encodeURIComponent(targetId);
                         
                         let url = "";
                         if (settings.matchHistoryBaseUrl.includes("{q}")) {
                             url = settings.matchHistoryBaseUrl.replace("{q}", encodedId);
                         } else {
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
                


                // Summoner Level & Rank (Between Name and Gold)
                const metaDiv = this.vjs.dom.createEl("div", {}, { class: "player-meta" }) as HTMLElement;
                
                // Rank (if available)
                if (p.rank && p.rank !== "Unranked" && p.rank !== "UNRANKED") {
                   const formatRank = (r: string) => {
                       const parts = r.split(" ");
                       if (parts.length < 1) return r;
                       
                       const tier = parts[0].toUpperCase();
                       const division = parts.length > 1 ? parts[1] : "";
                       
                       let shortTier = tier[0]; // Default to first letter
                       
                       if (tier === "GRANDMASTER") shortTier = "GM";
                       if (tier === "CHALLENGER") shortTier = "C";
                       
                       // Roman Numeral Formatting: I, II, III, IV -> 1, 2, 3, 4
                       let shortDiv = division;
                       if (division === "1" || division === "I") shortDiv = "1";
                       if (division === "2" || division === "II") shortDiv = "2";
                       if (division === "3" || division === "III") shortDiv = "3";
                       if (division === "4" || division === "IV" || division === "IIII") shortDiv = "4";

                       // e.g. "G4", "P1"
                       return `${shortTier}${shortDiv}`;
                   };
                   
                   const rankStr = formatRank(p.rank as string);
                   const rankEl = this.vjs.dom.createEl("div", {}, { class: "player-rank" }, rankStr);
                   
                   // Add Rank Color Class
                   try {
                       const parts = (p.rank as string).split(" ");
                       if (parts.length > 0) {
                           const tier = parts[0].toLowerCase();
                           rankEl.classList.add(`rank-${tier}`);
                       }
                   } catch(e) {}
                   
                   metaDiv.append(rankEl);
                }
                
                // Summoner Level
                const sLevel = p.summonerLevel || 0;
                if (sLevel > 0) {
                    const lvlEl = this.vjs.dom.createEl("div", {}, { class: "player-level" }, `Lv.${sLevel}`);
                    metaDiv.append(lvlEl);
                }
                
                if (teamId === 200) {
                    // Red Team (Right Side)
                    // Desired: ... [Gold] [Meta] [Name]
                    champIconWrap.style.order = "1";
                    csDiv.style.order = "2";
                    kdaDiv.style.order = "3";
                    itemsGrid.style.order = "4";
                    trinketDiv.style.order = "5";
                    spells.style.order = "6";
                    runesDiv.style.order = "7";
                    goldDiv.style.order = "8";
                    metaDiv.style.order = "9"; // Swapped
                    name.style.order = "10";   // Swapped
                    
                    metaDiv.style.textAlign = "center"; 
                    metaDiv.style.marginRight = "0px"; 
                    metaDiv.style.marginLeft = "0px";
                    
                    // Items in standard order (1-6) -> LTR
                    itemsGrid.style.flexDirection = "row";
                    itemsGrid.style.justifyContent = "flex-start";
                    
                } else {
                    name.style.order = "1";
                    metaDiv.style.order = "2"; // Swapped
                    goldDiv.style.order = "3";
                    runesDiv.style.order = "4";
                    spells.style.order = "5";
                    trinketDiv.style.order = "6";
                    itemsGrid.style.order = "7";
                    kdaDiv.style.order = "8";
                    csDiv.style.order = "9";
                    champIconWrap.style.order = "10";
                    metaDiv.style.textAlign = "center"; 
                    metaDiv.style.marginLeft = "0px";
                    metaDiv.style.marginRight = "0px";
                    // Items in reverse order (6-1) -> RTL inside grid
                    itemsGrid.style.flexDirection = "row-reverse";
                    itemsGrid.style.justifyContent = "flex-end";
                }
                
                // Append all to row
                row.append(metaDiv, champIconWrap, csDiv, kdaDiv, itemsGrid, trinketDiv, spells, runesDiv, goldDiv, name);
                
                return {
                    row,
                    csDiv,
                    kdaDiv,
                    itemImgs,
                    trinketImg,
                    goldDiv,
                    champLevelEl,
                    participantId: p.participantId,
                    p,
                    assets: assetsToSave
                };
            });

            const results = await Promise.all(rowPromises);
            
            // Race check
            if (this.metadataRenderId !== currentRenderId) return null;
            for (const res of results) {
                if (!res) continue;
                teamDiv.append(res.row);
                this.csRefs.push(res.csDiv);
                this.kdaRefs.push(res.kdaDiv);
                this.scoreboardRefs.set(res.participantId, {
                    items: res.itemImgs,
                    trinket: res.trinketImg,
                    goldText: res.goldDiv,
                    champLevelText: res.champLevelEl,
                    participantId: res.participantId 
                });
            }
            return teamDiv;
        };

        if (getGameModeByQueueId(data.queue?.id ?? 0, data.queue?.name ?? "") === "TFT") {
            if (this.scoreboardEl) {
                this.scoreboardEl.style.display = "none";
            }
            this.player.off("timeupdate", this.updateTimelineItems);
            return;
        }

        const topDiv = await renderTeam(100, sorted100, sorted200);
        const botDiv = await renderTeam(200, sorted200, sorted100);

        if (this.metadataRenderId !== currentRenderId) return;
        if (!topDiv || !botDiv) return;

        const settings = await commands.getSettings();

        // Center Gold Diff
        const centerDiv = this.vjs.dom.createEl("div", {}, { class: "scoreboard-center" });

        for (let i = 0; i < 5; i++) {
            const p1 = sorted100[i];
            const p2 = sorted200[i];
            
            // Handle missing participants (e.g. < 5v5)
            if (!p1 || !p2) continue;

            const diff = p1.stats.goldEarned - p2.stats.goldEarned;
            const absDiff = Math.abs(diff);
            const diffStr = absDiff >= 1000 ? `${(absDiff / 1000).toFixed(1)}k` : `${absDiff}`;
            const diffRow = this.vjs.dom.createEl("div", {}, { class: "center-diff-row" }) as HTMLElement;
            if (diff > 0) {
                diffRow.classList.add("blue-win");
                // Arrow is absolute anchored to the value
                diffRow.innerHTML = `<span class="diff-val"><span class="arrow arrow-left">\u25C0</span>${diffStr}</span>`;
            } else if (diff < 0) {
                diffRow.classList.add("red-win");
                diffRow.innerHTML = `<span class="diff-val">${diffStr}<span class="arrow arrow-right">\u25B6</span></span>`;
            } else {
                diffRow.innerHTML = `<span class="diff-val">-</span>`;
            }

            // Matchup Link (Click on Gold Diff)
            if (settings.championMatchupUrl) {
                diffRow.style.cursor = "pointer";
                diffRow.title = `Open Matchup`;
                diffRow.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!settings.championMatchupUrl) return;

                    // Target selection based on Team IDs: 
                    let myP = p1;
                    let oppP = p2;

                    // If user is playing, find which team they are on and make that team {My}
                    if (data.participantId) {
                        const userIsRed = sorted200.some(p => p && p.participantId === data.participantId);
                        if (userIsRed) {
                             myP = p2;
                             oppP = p1;
                        }
                    }

                    const myChampName = await getChampionNameById(myP.championId);
                    const targetChampName = await getChampionNameById(oppP.championId);

                    if (!myChampName || !targetChampName) {
                        console.warn("Could not resolve champion names for matchup");
                        return;
                    }

                    const myEng = getChampionEnglishNameByIdSync(myP.championId) || myChampName;
                    const oppEng = getChampionEnglishNameByIdSync(oppP.championId) || targetChampName;

                    // Replace placeholders
                    const url = settings.championMatchupUrl
                        .replace(/{My_id}/g, myChampName)
                        .replace(/{My_name}/g, myEng)
                        .replace(/{My_name_}/g, myEng.replace(/\s+/g, "_"))
                        .replace(/{My_nameEsc}/g, encodeURIComponent(myEng))
                        .replace(/{My}/g, myChampName)
                        .replace(/{my}/g, myChampName.toLowerCase())
                        .replace(/{Opp_id}/g, targetChampName)
                        .replace(/{Opp_name}/g, oppEng)
                        .replace(/{Opp_name_}/g, oppEng.replace(/\s+/g, "_"))
                        .replace(/{Opp_nameEsc}/g, encodeURIComponent(oppEng))
                        .replace(/{Opponent}/g, targetChampName)
                        .replace(/{opponent}/g, targetChampName.toLowerCase());
                    try {
                        await open(url);
                    } catch (err) {
                        console.error("Failed to open Matchup URL:", err);
                    }
                });
            }

            centerDiv.append(diffRow);
            this.goldDiffRefs.push(diffRow);
        }

        if (this.scoreboardEl) {
            this.scoreboardEl.style.display = "";
            this.scoreboardEl.append(topDiv, centerDiv, botDiv);
            
            // Remove ALL possible duplicate scoreboards
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

                 let t100Total = 0;
                 let t200Total = 0;

                 const p100 = this.participants.filter(p => p.teamId === 100);
                 const p200 = this.participants.filter(p => p.teamId === 200);

                 this.participants.forEach((p) => {
                     const idx = this.participants.indexOf(p);
                     const ref = this.csRefs[idx];
                     
                     if (ref) {
                         const data = frameDataMap.get(p.participantId);
                         const cs = data?.minions || 0;
                         ref.textContent = `${cs}`;
                         const level = data?.level ?? null;
                         const champLevelText = this.scoreboardRefs.get(p.participantId)?.champLevelText;
                         if (champLevelText && level !== null && level > 0) {
                             champLevelText.textContent = `${level}`;
                         }
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
                             row.innerHTML = `<span class="diff-val"><span class="arrow arrow-left">\u25C0</span>${diffStr}</span>`;
                         } else if (diff < 0) {
                             if (!row.classList.contains("red-win")) row.className = "center-diff-row red-win";
                             row.innerHTML = `<span class="diff-val">${diffStr}<span class="arrow arrow-right">\u25B6</span></span>`;
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
             
             this.participants.forEach((p, i) => {
                 const ref = this.kdaRefs[i];
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

                 if (!lastEvent) {
                     if (category === "dragon") {
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
                     if (config.elderSpawnTime > 0) {
                         const nextSpawn = killTime + config.dragonInterval;
                         if (nextSpawn >= config.elderSpawnTime) {
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

        const lang = ((settings as any).language || "en") as Language;

        // Language Selector
        const langSelect = this.vjs.dom.createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
        const languages = [
            { value: "en", label: "English" },
            { value: "ja", label: "Japanese" },
            { value: "zh", label: "Chinese" },
            { value: "ko", label: "Korean" },
            { value: "vi", label: "Vietnamese" },
            { value: "pt", label: "Portuguese" },
            { value: "es", label: "Spanish" },
            { value: "fr", label: "French" },
            { value: "de", label: "Deutsch" },
            { value: "ru", label: "Russian" },
            { value: "tr", label: "Turkish" },
            { value: "pl", label: "Polski" },
            { value: "it", label: "Italiano" }
        ];
        languages.forEach(l => {
            const opt = this.vjs.dom.createEl("option", {}, { value: l.value }, l.label) as HTMLOptionElement;
            if (l.value === lang) opt.selected = true;
            langSelect.append(opt);
        });
        
        langSelect.onchange = () => {
            const newLang = langSelect.value;
            (settings as any).language = newLang;
            // Re-render modal to apply language change immediately
            this.modalContent.innerHTML = "";
            this.showSettingsModal(settings, saveCallback);
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
        }, { class: "btn-browse" }, getText(lang, "browse"));

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
        }, { class: "btn-browse" }, getText(lang, "browse"));

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
        // --- Assets Section ---
        const downloadAssetsBtn = this.vjs.dom.createEl("button", {}, { class: "btn-browse" }, getText(lang, "downloadIcons")) as HTMLButtonElement;
        const assetsStatus = this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #888; margin-top: 5px; text-align: center; min-height: 1.2em;" }, "");

        downloadAssetsBtn.onclick = async () => {
            downloadAssetsBtn.disabled = true;
            downloadAssetsBtn.textContent = getText(lang, "downloading");
            await downloadAllAssets((msg) => {
                assetsStatus.textContent = msg;
            });
            downloadAssetsBtn.textContent = getText(lang, "downloadComplete");
            setTimeout(() => { 
                downloadAssetsBtn.disabled = false; 
                downloadAssetsBtn.textContent = getText(lang, "downloadIcons");
                assetsStatus.textContent = "";
            }, 3000);
        };
        
        const assetsWrapper = this.vjs.dom.createEl("div", {}, { style: "width: 100%;" }, [downloadAssetsBtn, assetsStatus]);

        // --- Keybinds Section ---
        // --- Tab Containers ---
        // Scroll containers (handle scrollbar at edge)
        const generalTabContent = this.vjs.dom.createEl("div", {}, { class: "settings-tab-content settings-scroll-container" });
        const hotkeysTabContent = this.vjs.dom.createEl("div", {}, { class: "settings-tab-content settings-scroll-container hidden" });

        // Content Wrappers (handle padding)
        const generalWrapper = this.vjs.dom.createEl("div", {}, { class: "settings-content-wrapper" });
        const hotkeysWrapper = this.vjs.dom.createEl("div", {}, { class: "settings-content-wrapper" });

        // Hotkeys Grid
        const hotkeysGrid = this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: 1fr; gap: 8px;" });
        hotkeysWrapper.append(hotkeysGrid);
        hotkeysTabContent.append(hotkeysWrapper);

        // General Grid
        const generalGrid = this.vjs.dom.createEl("div", {}, { class: "settings-grid" });
        generalWrapper.append(generalGrid);
        generalTabContent.append(generalWrapper);
        // assetsContainer appended to generalGrid below
        const pendingBinds = { ...currentKeybinds };
        const pendingMouseConfig: MouseConfig = loadMouseConfig();

        const labels: Record<ActionName, string> = {
            playPause: getText(lang, "playPause"),
            seekForward: getText(lang, "seekForward"),
            seekBackward: getText(lang, "seekBackward"),
            nextEvent: getText(lang, "nextEvent"),
            prevEvent: getText(lang, "prevEvent"),
            volUp: getText(lang, "volUp"),
            volDown: getText(lang, "volDown"),
            fullscreen: getText(lang, "fullscreen"),
            mute: getText(lang, "mute"),
            speedUp: getText(lang, "speedUp"),
            speedDown: getText(lang, "speedDown"),
            setLoopA: getText(lang, "setLoopA"),
            setLoopB: getText(lang, "setLoopB"),
            toggleLoop: getText(lang, "toggleLoop"),
            exitFullscreen: getText(lang, "exitFullscreen"),
            stepForward: getText(lang, "stepForward"),
            stepBackward: getText(lang, "stepBackward"),
            resetSpeed: getText(lang, "resetSpeed"),
            nextVideo: getText(lang, "nextVideo"),
            prevVideo: getText(lang, "prevVideo")
        };

        const createKeybindRow = (action: ActionName) => {
             const labelText = labels[action];
             // Discord-like Row: Flex Row, Space Between, Border Bottom
             const container = this.vjs.dom.createEl("div", {}, { 
                 style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;" 
             });
             
             const label = this.vjs.dom.createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, labelText);
             
             // Use a closure variable to track the handler for removal
             let keydownHandler: ((kEvent: KeyboardEvent) => void) | null = null;

             const btn = this.vjs.dom.createEl("button", {}, { 
                 class: "settings-input keybind-btn", 
                 style: "text-align: center; cursor: pointer; width: 140px; padding: 6px 10px; background-color: #202225; border: 1px solid #202225; color: #dcddde; border-radius: 3px; font-size: 0.9em;" 
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
            // Match styles of createKeybindRow (Discord-like)
            const container = this.vjs.dom.createEl("div", {}, { 
                style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;" 
            });
            const labelEl = this.vjs.dom.createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, label);
            
            const btn = this.vjs.dom.createEl("button", {}, { 
                class: "settings-input keybind-btn",
                style: "text-align: center; cursor: pointer; width: 140px; padding: 6px 10px; background-color: #202225; border: 1px solid #202225; color: #dcddde; border-radius: 3px; font-size: 0.9em;"
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
        const inGameTitle = this.vjs.dom.createEl("h3", {}, { 
            style: "margin-top: 0; margin-bottom: 10px; color: #b9bbbe; font-size: 1em; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;" 
        }, getText(lang, "inGameHotkeys"));
        
        const inGameContainer = this.vjs.dom.createEl("div", {}, { 
            class: "hotkey-section-container",
            style: "background-color: #2a2a2a; border-radius: 8px; padding: 0 20px; margin-bottom: 20px;" 
        });
        inGameContainer.append(
            createBackendHotkeyRow(getText(lang, "highlight"), highlightHotkeyValue, (val) => { highlightHotkeyValue = val; }),
            createBackendHotkeyRow(getText(lang, "startRecord"), startRecHotkeyValue, (val) => { startRecHotkeyValue = val; }),
            createBackendHotkeyRow(getText(lang, "stopRecord"), stopRecHotkeyValue, (val) => { stopRecHotkeyValue = val; })
        );
        
        hotkeysGrid.append(inGameTitle, inGameContainer);

        // 2. Replay Shortcuts Section
        const replayTitle = this.vjs.dom.createEl("h3", {}, { 
            style: "margin-top: 15px; margin-bottom: 8px; color: #b9bbbe; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;" 
        }, getText(lang, "replayShortcuts"));
        
        const replayContainer = this.vjs.dom.createEl("div", {}, { 
            class: "hotkey-section-container",
            style: "background-color: #2a2a2a; border-radius: 8px; padding: 0 20px; margin-bottom: 20px;" 
        });
        
        bindOrder.forEach(action => {
            replayContainer.append(createKeybindRow(action));
        });
        
        hotkeysGrid.append(replayTitle, replayContainer);

        // 3. Mouse Controls Section
        const mouseTitle = this.vjs.dom.createEl("h3", {}, { 
            style: "margin-top: 15px; margin-bottom: 8px; color: #b9bbbe; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;" 
        }, getText(lang, "mouseControls"));
        
        const mouseContainer = this.vjs.dom.createEl("div", {}, { 
            class: "hotkey-section-container",
            style: "background-color: #2a2a2a; border-radius: 8px; padding: 0 20px; margin-bottom: 20px;" 
        });

        const createMouseSwitch = (label: string, checked: boolean, onClick: (checked: boolean) => void) => {
             const input = this.vjs.dom.createEl("input", {
                 onchange: (e: Event) => onClick((e.target as HTMLInputElement).checked)
             }, { type: "checkbox", ...(checked ? {checked: "true"} : {}) }) as HTMLInputElement;
             
             const switchEl = this.vjs.dom.createEl("label", {}, { class: "switch" }, [
                 input,
                 this.vjs.dom.createEl("span", {}, { class: "slider round" })
             ]);

             // Discord-like Row
             return this.vjs.dom.createEl("div", {}, { 
                 style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;" 
             }, [
                 this.vjs.dom.createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, label),
                 switchEl
             ]);
        };

        // Scroll Frame Step Modifier
        const scrollModLabel = this.vjs.dom.createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, getText(lang, "scrollModifier"));
        const scrollModSelect = this.vjs.dom.createEl("select", {}, { 
             class: "settings-input", 
             style: "width: 140px; padding: 6px; background-color: #202225; border: 1px solid #202225; color: #dcddde; border-radius: 3px;" 
        }, [
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

        const scrollModContainer = this.vjs.dom.createEl("div", {}, { 
             style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;" 
        }, [
             scrollModLabel,
             scrollModSelect
        ]);
        
        mouseContainer.append(
            createMouseSwitch(
                getText(lang, "wheelSpeed"), 
                pendingMouseConfig.wheelAction === "speed",
                (checked) => { pendingMouseConfig.wheelAction = checked ? "speed" : "none"; }
            ),
            createMouseSwitch(
                getText(lang, "middleReset"), 
                pendingMouseConfig.middleClickAction === "resetSpeed",
                (checked) => { pendingMouseConfig.middleClickAction = checked ? "resetSpeed" : "none"; }
            ),
            createMouseSwitch(
                getText(lang, "sideSeek"), 
                pendingMouseConfig.sideButtonSeek,
                (checked) => { pendingMouseConfig.sideButtonSeek = checked; }
            ),
            scrollModContainer
        );
        
        hotkeysGrid.append(mouseTitle, mouseContainer);

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
        const mfKill = createMarkerSwitch(getText(lang, "kill"), flags.kill);
        const mfDeath = createMarkerSwitch(getText(lang, "death"), flags.death);
        const mfAssist = createMarkerSwitch(getText(lang, "assist"), flags.assist);
        const mfStructure = createMarkerSwitch(getText(lang, "structure"), flags.structure);
        const mfDragon = createMarkerSwitch(getText(lang, "dragon"), flags.dragon);
        const mfVoidgrub = createMarkerSwitch(getText(lang, "voidgrub"), flags.voidgrub);
        const mfHerald = createMarkerSwitch(getText(lang, "herald"), flags.herald);

        const mfBaron = createMarkerSwitch(getText(lang, "baron"), flags.baron);

        // Marker Flags - Title outside, content with background
        const markerFlagsTitle = this.vjs.dom.createEl("h3", {}, { 
            class: "settings-section-title"
        }, getText(lang, "markerFlags"));
        
        const markerFlagsContent = this.vjs.dom.createEl("div", {}, { 
            class: "settings-group-styled",
            style: "grid-column: 1 / -1;"
        }, [
            this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(4, 1fr); gap: 10px;" }, [
                mfKill.container, mfDeath.container, mfAssist.container, mfStructure.container,
                mfDragon.container, mfVoidgrub.container, mfHerald.container, mfBaron.container
            ])
        ]) as HTMLDivElement;

        // Game Modes
        const allModeIds = ["RANKED", "NORMAL", "ARAM", "CHERRY", "URF", "PRACTICE_TOOL", "CUSTOM", "COOP_VS_AI", "TFT", "SWIFTPLAY", "OTHER"];
        const currentModes = settings.gameModes || allModeIds;
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

        const gmRanked = createModeSwitch(getText(lang, "ranked"), "RANKED");
        const gmNormal = createModeSwitch(getText(lang, "normal"), "NORMAL");
        const gmAram = createModeSwitch(getText(lang, "aram"), "ARAM");
        const gmArena = createModeSwitch(getText(lang, "arena"), "CHERRY");
        const gmUrf = createModeSwitch(getText(lang, "urf"), "URF");
        const gmPractice = createModeSwitch(getText(lang, "practice"), "PRACTICE_TOOL");
        const gmCustom = createModeSwitch(getText(lang, "custom"), "CUSTOM");
        const gmCoop = createModeSwitch(getText(lang, "coop"), "COOP_VS_AI");
        const gmTft = createModeSwitch(getText(lang, "tft"), "TFT");
        const gmSwiftplay = createModeSwitch(getText(lang, "swiftplay"), "SWIFTPLAY");
        const gmOther = createModeSwitch(getText(lang, "other"), "OTHER");

        // Game Modes - Title outside, content with background
        const gameModesTitle = this.vjs.dom.createEl("h3", {}, {
            class: "settings-section-title"
        }, getText(lang, "gameModes"));
        
        const gameModesContent = this.vjs.dom.createEl("div", {}, { 
            class: "settings-group-styled",
            style: "grid-column: 1 / -1;"
        }, [
            this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(2, 1fr); gap: 10px;" }, [
                gmRanked.container, gmNormal.container, gmAram.container, gmArena.container, gmUrf.container,
                gmPractice.container, gmCustom.container, gmCoop.container, gmTft.container, gmSwiftplay.container,
                gmOther.container
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


        const autostart = createSwitch(getText(lang, "autostart"), settings.autostart);
        const autoplayVideo = createSwitch(getText(lang, "autoplay"), settings.autoplayVideo);
        const autoStopPlayback = createSwitch(getText(lang, "autoStop"), settings.autoStopPlayback);
        const autoSelectRecording = createSwitch(getText(lang, "autoSelect"), settings.autoSelectRecording);
        const confirmDel = createSwitch(getText(lang, "confirmDel"), settings.confirmDelete);
        const devMode = createSwitch(getText(lang, "devMode"), settings.developerMode);
        const playSounds = createSwitch(getText(lang, "playSounds"), settings.playRecordingSounds ?? false);
        const keepVideoJsonOnAutoDelete = createSwitch(getText(lang, "keepVideoJsonOnAutoDelete"), settings.keepVideoJsonOnAutoDelete ?? false);
        const autoDeleteClips = createSwitch(getText(lang, "autoDeleteClips" as any), (settings as any).autoDeleteClips ?? false);

        const matchHistoryUrlInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            placeholder: "e.g. https://www.deeplol.gg/summoner/jp/{q}",
            value: settings.matchHistoryBaseUrl || "",
            style: "flex: 1;"
        }) as HTMLInputElement;

        // Other Options - Title outside, Switches Section (Auto Record, etc.)
        const switchesTitle = this.vjs.dom.createEl("h3", {}, { 
            class: "settings-section-title"
        }, getText(lang, "otherOptions"));
        
        const switchesContent = this.vjs.dom.createEl("div", {}, { 
            class: "settings-group-styled",
            style: "grid-column: 1 / -1;"
        }, [
            this.vjs.dom.createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: 1fr; gap: 10px;" }, [
                autostart.container, 
                autoplayVideo.container,
                autoStopPlayback.container,
                autoSelectRecording.container,
                confirmDel.container, 
                devMode.container,
                playSounds.container,
                keepVideoJsonOnAutoDelete.container,
                autoDeleteClips.container
            ])
        ]) as HTMLDivElement;
        
        // Scoreboard Links Section
        const scoreboardLinksTitle = this.vjs.dom.createEl("h3", {}, { 
            class: "settings-section-title"
        }, getText(lang, "scoreboardLinks"));

        const scoreboardLinksHint = this.vjs.dom.createEl("div", {}, { 
            class: "settings-group-styled",
            style: "grid-column: 1 / -1; font-size: 0.85em; color: #aaa; margin-bottom: 15px; padding: 10px; background: rgba(50,50,50,0.5); border: 1px dashed #666;"
        }, getText(lang, "scoreboardLinksHint" as any) || "Tags: {id}=LeeSin, {name}=Lee Sin, {name_}=Lee_Sin, {nameEsc}=Lee%20Sin");

        const trackingUrlContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none;" }, [
            this.vjs.dom.createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "trackingUrl")),
            this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #aaa; margin-bottom: 5px;" }, getText(lang, "trackingUrlExample")),
            this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "trackingUrlHint")),
            matchHistoryUrlInput
        ]) as HTMLDivElement;

        // Champion Wiki URL
        const championWikiUrlInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            placeholder: "e.g. https://wiki.leagueoflegends.com/en-us/{name_}",
            value: settings.championWikiBaseUrl || "https://wiki.leagueoflegends.com/en-us/{name_}",
            style: "flex: 1;"
        }) as HTMLInputElement;

        const championWikiUrlContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none; margin-top: 10px;" }, [
            this.vjs.dom.createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "championWikiUrl")),
            this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #aaa; margin-bottom: 5px;" }, getText(lang, "championWikiUrlExample")),
            this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "championWikiUrlHint")),
            championWikiUrlInput
        ]) as HTMLDivElement;

        // Champion Matchup URL
        const championMatchupUrlInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            placeholder: "e.g. https://dpm.lol/champions/{My}/matchups?opponent={Opponent}",
            value: settings.championMatchupUrl || "",
            style: "flex: 1;"
        }) as HTMLInputElement;

        const championMatchupUrlContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none; margin-top: 10px;" }, [
            this.vjs.dom.createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "championMatchupUrl")),
            this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "championMatchupUrlHint")),
            championMatchupUrlInput
        ]) as HTMLDivElement;

        // Champion Build URL
        const championBuildUrlInput = this.vjs.dom.createEl("input", {}, {
            class: "settings-input",
            type: "text",
            placeholder: "e.g. https://dpm.lol/champions/{q}/build",
            value: settings.championBuildUrl || "",
            style: "flex: 1;"
        }) as HTMLInputElement;

        const championBuildUrlContainer = this.vjs.dom.createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none; margin-top: 10px;" }, [
            this.vjs.dom.createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "championBuildUrl")),
            this.vjs.dom.createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "championBuildUrlHint")),
            championBuildUrlInput
        ]) as HTMLDivElement;

        const scoreboardLinksContent = this.vjs.dom.createEl("div", {}, { 
            class: "settings-group-styled",
            style: "grid-column: 1 / -1;"
        }, [
            scoreboardLinksHint,
            this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column; gap: 5px;" }, [
                trackingUrlContainer,
                championWikiUrlContainer,
                championMatchupUrlContainer,
                championBuildUrlContainer
            ])
        ]) as HTMLDivElement;
        
        // Hotkeys

        // --- About / Update Tab ---
        const aboutTabContent = this.vjs.dom.createEl("div", {}, { class: "settings-tab-content scrollable hidden" }) as HTMLDivElement;
        const aboutWrapper = this.vjs.dom.createEl("div", {}, { class: "settings-group-styled", style: "display: flex; flex-direction: column; gap: 10px; text-align: center; padding: 20px;" }) as HTMLDivElement;
        
        const appVersionLine = this.vjs.dom.createEl("div", {}, { style: "font-size: 1.1em; color: #eee; margin-bottom: 5px;" }) as HTMLDivElement;
        
        // Fetch and display real version
        getVersion().then(ver => {
            appVersionLine.innerText = `${getText(lang, "appVersion" as any)}: v${ver}`;
        }).catch(err => {
            console.error("getVersion failed:", err);
            appVersionLine.innerText = `${getText(lang, "appVersion" as any)}: Unknown`;
        });
        
        const repoLine = this.vjs.dom.createEl("div", {}, { style: "margin-bottom: 20px; display: flex; flex-direction: column; gap: 10px; align-items: center;" }) as HTMLDivElement;
        
        const repoLink = this.vjs.dom.createEl("a", {
            onclick: () => open("https://github.com/arasan95/League_Record_custom")
        }, { style: "color: #00d2ff; cursor: pointer; text-decoration: underline;" }, "GitHub Repository");
        
        const reportBugBtn = this.vjs.dom.createEl("button", {
            onclick: () => open("https://docs.google.com/forms/d/e/1FAIpQLScM3I0di-DeqQACBhGfrewibuos2xl-pTNv4XoYhK3R0p3ziA/viewform?usp=publish-editor") // TODO: Replace with actual Google Form URL
        }, { class: "btn-browse", style: "border: 1px solid #c8aa6e; color: #c8aa6e; background: #222; max-width: 300px;" }, getText(lang as any, "reportBug" as any) || "Report Bug / Feature Request");
        
        repoLine.append(repoLink, reportBugBtn);
        
        const updateStatusMsg = this.vjs.dom.createEl("div", {}, { style: "font-size: 0.9em; color: #aaa; margin: 10px 0; min-height: 20px;" }) as HTMLDivElement;
        const updateActionsContainer = this.vjs.dom.createEl("div", {}, { style: "display: flex; justify-content: center; gap: 10px;" }) as HTMLDivElement;
        
        const checkUpdateBtn = this.vjs.dom.createEl("button", {
            onclick: async () => {
                checkUpdateBtn.disabled = true;
                updateStatusMsg.innerText = "Checking...";
                updateStatusMsg.style.color = "#aaa";
                try {
                    const update = await check();
                    if (update) {
                        updateStatusMsg.innerText = "";
                        checkUpdateBtn.disabled = false;
                        this.showUpdateModal(update, lang);
                    } else {
                        updateStatusMsg.innerText = getText(lang as any, "updateLatest" as any) || "You are on the latest version.";
                        updateStatusMsg.style.color = "#4CAF50";
                        checkUpdateBtn.disabled = false;
                    }
                } catch (e) {
                    console.error("Update check failed", e);
                    updateStatusMsg.innerText = getText(lang as any, "updateError" as any) || "Failed to check for updates.";
                    updateStatusMsg.style.color = "#ff5555";
                    checkUpdateBtn.disabled = false;
                }
            }
        }, { class: "btn-browse" }, getText(lang as any, "checkForUpdates" as any) || "Check for updates") as HTMLButtonElement;
        
        updateActionsContainer.append(checkUpdateBtn);
        
        const updateOnStartupCheckbox = this.vjs.dom.createEl("input", {
            type: "checkbox",
            checked: settings.checkUpdatesOnStartup,
            onchange: (e: Event) => {
                settings.checkUpdatesOnStartup = (e.target as HTMLInputElement).checked;
            }
        }, { style: "margin-right: 5px; vertical-align: middle;" }) as HTMLInputElement;

        const updateOnStartupContainer = this.vjs.dom.createEl("label", {}, { style: "margin-top: 15px; font-size: 0.9em; color: #ccc; cursor: pointer; display: inline-flex; justify-content: center; align-items: center;" }, [
            updateOnStartupCheckbox,
            this.vjs.dom.createEl("span", {}, {}, getText(lang, "checkUpdatesOnStartup" as any))
        ]) as HTMLLabelElement;

        aboutWrapper.append(appVersionLine, repoLine, updateActionsContainer, updateStatusMsg, updateOnStartupContainer);
        aboutTabContent.appendChild(aboutWrapper);
        // --- End About / Update Tab ---


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

        // Troubleshooting Section
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
        }, { class: "btn-browse btn-danger" }, getText(lang, "clearCache"));

        // Populate General Grid
        generalGrid.append(
            createGroup(getText(lang, "language"), langSelect),
            createGroup(getText(lang, "filenameFormat"), filenameInput),
            createGroup(getText(lang, "recordingsFolder"), folderContainer as HTMLElement, true),
            createGroup(getText(lang, "clipsFolder"), clipsFolderContainer as HTMLElement, true),
            createGroup(getText(lang, "encodingQuality"), qualityContainer as HTMLElement),
            createGroup(getText(lang, "outputResolution"), resSelect),
            createGroup(getText(lang, "framerate"), frSelect),
            createGroup(getText(lang, "recordAudio"), audioSelect),
            createGroup(getText(lang, "maxAge"), maxAgeInput),
            createGroup(getText(lang, "maxSize"), maxSizeInput)
        );

        generalGrid.append(
            markerFlagsTitle,
            markerFlagsContent,
            gameModesTitle,
            gameModesContent,
            switchesTitle,
            switchesContent,
            scoreboardLinksTitle,
            scoreboardLinksContent,
            
            // Modernized Sections (Moved to bottom)
            createGroup("Local Assets", assetsWrapper as HTMLElement, true),
            createGroup("Troubleshooting", clearCacheBtn as HTMLElement, true)
        );

        if (settings.developerMode) {
            // Already added Troubleshooting section above
        }

        // Tab Buttons
        const createTabBtn = (label: string, active: boolean, onClick: () => void) => {
            const btn = this.vjs.dom.createEl("button", {
                onclick: onClick
            }, { class: `tab-btn ${active ? "active" : ""}` }, label);
            return btn;
        };

        const switchTab = (tabName: 'general' | 'hotkeys' | 'about') => {
             btnGeneral.classList.toggle("active", tabName === 'general');
             btnHotkeys.classList.toggle("active", tabName === 'hotkeys');
             btnAbout.classList.toggle("active", tabName === 'about');
             
             generalTabContent.classList.toggle("hidden", tabName !== 'general');
             hotkeysTabContent.classList.toggle("hidden", tabName !== 'hotkeys');
             aboutTabContent.classList.toggle("hidden", tabName !== 'about');
        };

        const btnGeneral = createTabBtn(getText(lang, "tabGeneral"), true, () => switchTab('general'));
        const btnHotkeys = createTabBtn(getText(lang, "tabHotkeys"), false, () => switchTab('hotkeys'));
        const btnAbout = createTabBtn(getText(lang, "tabAbout" as any) || "About", false, () => switchTab('about'));

        const tabsContainer = this.vjs.dom.createEl("div", {}, { class: "settings-tabs" }, [btnGeneral, btnHotkeys, btnAbout]);

        // Main Content Assembly
        const modalBody = this.vjs.dom.createEl("div", {}, { style: "display: flex; flex-direction: column; overflow: hidden; flex: 1;" }, [
            tabsContainer,
            generalTabContent,
            hotkeysTabContent,
            aboutTabContent
        ]);

        // Actions
        const saveBtn = this.vjs.dom.createEl("button", {
            onclick: () => {
                const newSettings: Settings = {
                    ...settings,
                    recordingsFolder: folderInput.value,
                    clipsFolder: clipsFolderInput.value,
                    filenameFormat: filenameInput.value,
                    matchHistoryBaseUrl: matchHistoryUrlInput.value.trim() || null,
                    championWikiBaseUrl: championWikiUrlInput.value.trim() || null,
                    championMatchupUrl: championMatchupUrlInput.value.trim() || null,
                    championBuildUrl: championBuildUrlInput.value.trim() || null,
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
                        if (gmUrf.input.checked) modes.push(gmUrf.modeId);
                        if (gmPractice.input.checked) modes.push(gmPractice.modeId);
                        if (gmCustom.input.checked) modes.push(gmCustom.modeId);
                        if (gmCoop.input.checked) modes.push(gmCoop.modeId);
                        if (gmTft.input.checked) modes.push(gmTft.modeId);
                        if (gmSwiftplay.input.checked) modes.push(gmSwiftplay.modeId);
                        if (gmOther.input.checked) modes.push(gmOther.modeId);
                        return modes;
                    })(),

                    autostart: autostart.input.checked,
                    autoplayVideo: autoplayVideo.input.checked,
                    autoStopPlayback: autoStopPlayback.input.checked,
                    autoSelectRecording: autoSelectRecording.input.checked,
                    confirmDelete: confirmDel.input.checked,
                    developerMode: devMode.input.checked,
                    playRecordingSounds: playSounds.input.checked,
                    keepVideoJsonOnAutoDelete: keepVideoJsonOnAutoDelete.input.checked,
                    autoDeleteClips: autoDeleteClips.input.checked
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
        }, { class: "btn-save" }, getText(lang, "save"));

        const cancelBtn = this.vjs.dom.createEl("button", {
            onclick: this.hideModal
        }, { class: "btn-cancel" }, getText(lang, "cancel"));

        const actions = this.vjs.dom.createEl("div", {}, { class: "settings-actions" }, [cancelBtn, saveBtn]);

        const content = this.vjs.dom.createEl("div", {}, { id: "settings-modal-content" }, [
            this.vjs.dom.createEl("h2", {}, { style: "text-align: center; margin-top: 5px; margin-bottom: 0px; font-size: 1.2em;" }, getText(lang, "settingsTitle")),
            this.vjs.dom.createEl("div", {}, { style: "text-align: center; margin-bottom: 10px; color: #888; font-size: 0.8em;" }, `Patch ${getCurrentPatchVersion()}`),
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
            
            const currentSeconds = i * stepSeconds;
            const percent = currentSeconds / duration;
            
            // Use percentage to allow responsive resizing when window size changes
            tick.style.left = `${percent * 100}%`;

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
             img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // 1x1 transparent
             img.style.opacity = "0"; // or just hide
         } else {
             const url = await getItemIconUrl(itemId);
             img.src = url;
             img.style.opacity = "1";
         }
    }
}
