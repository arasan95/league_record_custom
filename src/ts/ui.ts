import type videojs from "video.js";
import type { ContentDescriptor } from "video.js/dist/types/utils/dom";
import type { WebviewWindow } from "./platform/webviewWindow";
import { getCurrentWebviewWindow } from "./platform/webviewWindow";
import { commands, type GameMetadata, type GoldFrame, type MarkerFlags, type Recording, type Settings, type Participant, type GameEvent } from "./bindings";
import { ensureItemDataLoaded, ensureTftDataLoaded, getChampionEnglishNameByIdSync, getChampionLocalizedNameByIdSync, getGameModeByQueueId } from "./datadragon";
import { getCurrentPatchVersion } from "./version";
import { InventoryTimeline } from "./timeline";
import { currentKeybinds, reloadKeybinds } from "./main";
import { isFavorite } from "./util";
import { getText } from "./i18n";
import { showSettingsModalView } from "./ui/settings_modal_usecase";
import { updateRecordingSidebarView } from "./ui/recording_sidebar_view_usecase";
import { assignScoreboardHeaderRefs } from "./ui/scoreboard_header_usecase";
import { resetScoreboardRuntimeState } from "./ui/scoreboard_runtime_usecase";
import { renderTimeRuler } from "./ui/time_ruler_usecase";
import { showUpdateModalView } from "./ui/update_modal_usecase";
import { showDeleteRecordingModal, showDeleteVideoOnlyRecordingModal, showRenameRecordingModal } from "./ui/recording_modals_usecase";
import { createRecordingSidebarItem } from "./ui/recording_sidebar_item_usecase";
import { getActiveVideoIdFromSidebar, playAdjacentVisibleVideo, setActiveVideoIdInSidebar } from "./ui/navigation_usecase";
import { showTimelineModalView } from "./ui/timeline_modal_usecase";
import { applyCompactLabelsClass } from "./ui/responsive_usecase";
import { applySidebarWidthLayout, applyWindowSizeLayout, updateStorageInfoDisplay } from "./ui/layout_usecase";
import { bindRecordingFilterControls } from "./ui/recording_filter_controls_usecase";
import { bindFrameStepWheelHandler } from "./ui/frame_step_wheel_usecase";
import { buildErrorModalContent, hideModalView, isModalOpen, showModalView } from "./ui/modal_primitives_usecase";
import { applyMarkerFlags, bindChangeHandler, readMarkerFlags, setBigPlayButtonVisibility, setToggleChecked } from "./ui/ui_controls_usecase";
import { bindSidebarResizeHandle, loadInitialUiSettings } from "./ui/ui_bootstrap_usecase";
import { prepareScoreboardView, renderScoreboardMainRows } from "./ui/scoreboard_render_flow_usecase";
import { applyScoreboardTickFlow } from "./ui/scoreboard_tick_flow_usecase";
import { clearVideoMetadataView } from "./ui/video_metadata_view_usecase";
import type { ClipFilterMode } from "./ui/recording_filters_usecase";
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

const CLIP_FILTER_MODE_STORAGE_KEY = "sidebarClipFilterMode";

function loadClipFilterModeFromStorage(): ClipFilterMode {
    try {
        const raw = localStorage.getItem(CLIP_FILTER_MODE_STORAGE_KEY);
        if (raw === "only" || raw === "exclude" || raw === "all") {
            return raw;
        }
    } catch {}
    return "all";
}

function saveClipFilterModeToStorage(mode: ClipFilterMode): void {
    try {
        localStorage.setItem(CLIP_FILTER_MODE_STORAGE_KEY, mode);
    } catch {}
}

export default class UI {
    private readonly modal;
    private readonly modalContent;
    private readonly sidebar;
    private readonly refreshBtn;
    private readonly videoFolderBtn;
    private readonly settingsBtn;
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

    private readonly segClip;
    private readonly segStar;
    private readonly segNorm;
    private readonly sizeTotalText;
    private readonly sizeMaxText;
    private readonly storagePctText;
    private readonly storageInfoEl;

    private maxStorageGb: number = 0; // Loaded from settings

    private filterStar = false;
    private clipFilterMode: ClipFilterMode = loadClipFilterModeFromStorage();
    private filterRanked = false;
    private filterSearch = false;
    private searchQuery: string = "";
    private searchAllyQuery: string = "";
    private searchEnemyQuery: string = "";
    private searchUserQuery: string = "";
    private searchQueueQuery: string = "";

    private filterServer: 'ALL' | 'LOL' | 'TFT' | 'SR' | 'ARAM' | 'OTHER' = 'ALL';
    private readonly navFilterAllBtn;
    private readonly navFilterLolBtn;
    private readonly navFilterSrBtn;
    private readonly navFilterAramBtn;
    private readonly navFilterOtherBtn;
    private readonly navFilterTftBtn;

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
    private pendingScoreboardHeight: { targetHeight: number; baseHeight: number } | null = null;

    public setSidebarWidth(newWidth: number) {
        applySidebarWidthLayout(this.sidebarContainer, newWidth);
    }

    public setScoreboardHeight(targetHeight: number, baseHeight: number) {
        if (!this.scoreboardEl) {
            this.pendingScoreboardHeight = { targetHeight, baseHeight };
            return;
        }
        if (targetHeight < 80) targetHeight = 80;
        this.scoreboardEl.classList.remove("collapsed");
        this.scoreboardEl.style.removeProperty("height");

        let newZoom = targetHeight / baseHeight;
        newZoom = Math.max(newZoom, 0.2); 
        newZoom = Math.min(newZoom, 1.5);

        (this.scoreboardEl.style as any).zoom = newZoom.toFixed(3);
    }

    private flushPendingScoreboardHeight() {
        if (!this.pendingScoreboardHeight || !this.scoreboardEl) return;
        const pending = this.pendingScoreboardHeight;
        this.pendingScoreboardHeight = null;
        this.setScoreboardHeight(pending.targetHeight, pending.baseHeight);
    }

    private stabilizeVideoLayout() {
        const main = document.getElementById("main");
        const playerEl = this.player?.el?.() as HTMLElement | undefined;
        if (!main || !playerEl) return;

        playerEl.style.minHeight = "0";
        playerEl.style.height = "";

        requestAnimationFrame(() => {
            this.player?.trigger?.("componentresize");
            this.player?.trigger?.("resize");
        });
    }

    public checkWindowSize() {
        void this.updateStorageInfoVisibility();
        applyWindowSizeLayout({
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            scoreboardScale: this.scoreboardScale,
            setSidebarWidth: (value) => this.setSidebarWidth(value),
            setScoreboardHeight: (target, base) => this.setScoreboardHeight(target, base),
        });
    }

    private async updateStorageInfoVisibility() {
        await updateStorageInfoDisplay({
            storageInfoEl: this.storageInfoEl,
            appWindow,
            currentHeight: window.innerHeight || window.outerHeight,
            maxHeight: window.screen?.availHeight || window.innerHeight,
        });
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

        this.navFilterAllBtn = document.querySelector<HTMLButtonElement>("#nav-filter-all")!;
        this.navFilterLolBtn = document.querySelector<HTMLButtonElement>("#nav-filter-lol")!;
        this.navFilterSrBtn = document.querySelector<HTMLButtonElement>("#nav-filter-sr")!;
        this.navFilterAramBtn = document.querySelector<HTMLButtonElement>("#nav-filter-aram")!;
        this.navFilterOtherBtn = document.querySelector<HTMLButtonElement>("#nav-filter-other")!;
        this.navFilterTftBtn = document.querySelector<HTMLButtonElement>("#nav-filter-tft")!;

        this.roleFiltersContainer = document.querySelector<HTMLDivElement>("#role-filters")!;
        this.roleFilterBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".role-icon"));

        this.segClip = document.querySelector<HTMLDivElement>(".seg-clip")!;
        this.segStar = document.querySelector<HTMLDivElement>(".seg-star")!;
        this.segNorm = document.querySelector<HTMLDivElement>(".seg-norm")!;
        this.sizeTotalText = document.querySelector<HTMLSpanElement>("#size-total")!;
        this.sizeMaxText = document.querySelector<HTMLSpanElement>("#size-max")!;
        this.storagePctText = document.querySelector<HTMLDivElement>("#storage-pct")!;
        this.storageInfoEl = document.querySelector<HTMLDivElement>(".storage-info")!;

        this.handleResize(); // Initial check
        window.addEventListener("resize", this.handleResize);

        bindRecordingFilterControls({
            navFilterAllBtn: this.navFilterAllBtn,
            navFilterLolBtn: this.navFilterLolBtn,
            navFilterSrBtn: this.navFilterSrBtn,
            navFilterAramBtn: this.navFilterAramBtn,
            navFilterOtherBtn: this.navFilterOtherBtn,
            navFilterTftBtn: this.navFilterTftBtn,
            roleFiltersContainer: this.roleFiltersContainer,
            roleFilterBtns: this.roleFilterBtns,
            filterStarBtn: this.filterStarBtn,
            filterClipBtn: this.filterClipBtn,
            filterRankedBtn: this.filterRankedBtn,
            filterSearchBtn: this.filterSearchBtn,
            searchBarContainer: this.searchBarContainer,
            searchInput: this.searchInput,
            searchAllyInput: this.searchAllyInput,
            searchEnemyInput: this.searchEnemyInput,
            searchUserInput: this.searchUserInput,
            searchQueueInput: this.searchQueueInput,
            state: {
                getFilterServer: () => this.filterServer,
                setFilterServer: (value) => {
                    this.filterServer = value;
                },
                getFilterRole: () => this.filterRole,
                setFilterRole: (value) => {
                    this.filterRole = value;
                },
                getFilterStar: () => this.filterStar,
                setFilterStar: (value) => {
                    this.filterStar = value;
                },
                getClipFilterMode: () => this.clipFilterMode,
                setClipFilterMode: (value) => {
                    this.clipFilterMode = value;
                    saveClipFilterModeToStorage(value);
                },
                getFilterRanked: () => this.filterRanked,
                setFilterRanked: (value) => {
                    this.filterRanked = value;
                },
                getFilterSearch: () => this.filterSearch,
                setFilterSearch: (value) => {
                    this.filterSearch = value;
                },
                setSearchQuery: (value) => {
                    this.searchQuery = value;
                },
                setSearchAllyQuery: (value) => {
                    this.searchAllyQuery = value;
                },
                setSearchEnemyQuery: (value) => {
                    this.searchEnemyQuery = value;
                },
                setSearchUserQuery: (value) => {
                    this.searchUserQuery = value;
                },
                setSearchQueueQuery: (value) => {
                    this.searchQueueQuery = value;
                },
            },
            onFiltersChanged: () => {
                if (this.lastOnVideo) {
                    this.updateSideBar(
                        this.lastRecordingsSizeGb,
                        this.lastRecordings,
                        this.lastOnVideo,
                        this.lastOnFavorite,
                        this.lastOnRename,
                        this.lastOnDelete,
                        this.lastOnDeleteVideoOnly,
                    );
                }
            },
        });

        this.checkboxKill = document.querySelector<HTMLInputElement>("#kill")!;
        this.checkboxDeath = document.querySelector<HTMLInputElement>("#death")!;
        this.checkboxAssist = document.querySelector<HTMLInputElement>("#assist")!;
        this.checkboxStructure = document.querySelector<HTMLInputElement>("#structure")!;
        this.checkboxDragon = document.querySelector<HTMLInputElement>("#dragon")!;
        this.checkboxVoidgrub = document.querySelector<HTMLInputElement>("#voidgrub")!;
        this.checkboxHerald = document.querySelector<HTMLInputElement>("#herald")!;

        this.checkboxBaron = document.querySelector<HTMLInputElement>("#baron")!;

        this.sidebarContainer = document.querySelector<HTMLDivElement>("#sidebar")!;
        bindSidebarResizeHandle({
            sidebarContainer: this.sidebarContainer,
            setSidebarWidth: (newWidth) => this.setSidebarWidth(newWidth),
        });

        window.addEventListener("resize", () => this.checkWindowSize());
        setTimeout(() => this.checkWindowSize(), 500); // Delay slightly for init

        void loadInitialUiSettings({
            setScrollFrameStepModifier: (modifier) => {
                this.scrollFrameStepModifier = modifier;
            },
            setFrameDuration: (duration) => {
                this.frameDuration = duration;
            },
            setMaxStorageGb: (maxStorageGb) => {
                this.maxStorageGb = maxStorageGb;
            },
            setScoreboardScale: (scoreboardScale) => {
                this.scoreboardScale = scoreboardScale;
            },
            setCurrentLanguage: (language) => {
                this.currentLanguage = language;
            },
        });
    }

    public setPlayer = (player: any) => {
        this.player = player;
        bindFrameStepWheelHandler({
            player: this.player,
            getScrollFrameStepModifier: () => this.scrollFrameStepModifier,
            getFrameDuration: () => this.frameDuration,
            getSeekTarget: () => this.seekTarget,
            setSeekTarget: (value) => {
                this.seekTarget = value;
            },
            getSeekDebounce: () => this.seekDebounce,
            setSeekDebounce: (value) => {
                this.seekDebounce = value;
            },
            getSeekRaf: () => this.seekRaf,
            setSeekRaf: (value) => {
                this.seekRaf = value;
            },
        });
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

    private lastOnVideo: any;
    private lastOnFavorite: any;
    private lastOnRename: any;
    private lastOnDelete: any;
    private lastOnDeleteVideoOnly: any;
    private lastRecordingsSizeGb: number = 0;
    private currentLanguage: string = "ja";

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
        const activeVideoId = this.getActiveVideoId();
        // Metadata writes (such as toggling a favorite) are observed by the
        // recording watcher and cause this list to be reinserted. Preserve the
        // reader's position instead of allowing scroll anchoring to nudge it.
        const sidebarScrollTop = this.sidebar.scrollTop;
        this.lastRecordingsSizeGb = recordingsSizeGb;
        this.lastRecordings = recordings;
        this.lastOnVideo = onVideo;
        this.lastOnFavorite = onFavorite;
        this.lastOnRename = onRename;
        this.lastOnDelete = onDelete;
        if (onDeleteVideoOnly) this.lastOnDeleteVideoOnly = onDeleteVideoOnly;
        const callbacks = {
            onVideo,
            onFavorite,
            onRename,
            onDelete,
            onDeleteVideoOnly,
        };
        updateRecordingSidebarView({
            recordingsSizeGb,
            recordings,
            callbacks,
            forceUpdateIds,
            search: {
                filterStar: this.filterStar,
                clipFilterMode: this.clipFilterMode,
                filterRanked: this.filterRanked,
                filterSearch: this.filterSearch,
                filterServer: this.filterServer,
                filterRole: this.filterRole,
                searchQuery: this.searchQuery,
                searchAllyQuery: this.searchAllyQuery,
                searchEnemyQuery: this.searchEnemyQuery,
                searchUserQuery: this.searchUserQuery,
                searchQueueQuery: this.searchQueueQuery,
            },
            maxStorageGb: this.maxStorageGb,
            recordingElementMap: this.recordingElementMap,
            createRecordingItem: (recording, handlerSet) =>
                this.createRecordingItem(
                    recording,
                    handlerSet.onVideo,
                    handlerSet.onFavorite,
                    handlerSet.onRename,
                    handlerSet.onDelete,
                    handlerSet.onDeleteVideoOnly,
                ),
            sidebarEl: this.sidebar,
            insertContent: (parent, contents) => this.vjs.dom.insertContent(parent, contents),
            isFavorite,
            getGameModeByQueueId,
            getChampionEnglishNameByIdSync,
            getChampionLocalizedNameByIdSync,
            storageRefs: {
                segClip: this.segClip,
                segStar: this.segStar,
                segNorm: this.segNorm,
                storagePctText: this.storagePctText,
                sizeTotalText: this.sizeTotalText,
                sizeMaxText: this.sizeMaxText,
            },
        });
        if (activeVideoId) {
            this.setActiveVideoId(activeVideoId);
        }
        this.sidebar.scrollTop = sidebarScrollTop;
        requestAnimationFrame(() => {
            this.sidebar.scrollTop = sidebarScrollTop;
        });
    };

    public createRecordingItem = (
        recording: Recording,
        onVideo: (videoId: string) => void,
        onFavorite: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void,
        onDelete: (videoId: string, isFavorite: boolean) => void,
        onDeleteVideoOnly?: (videoId: string, isFavorite: boolean) => void,
    ) => {
        return createRecordingSidebarItem({
            recording,
            createEl: this.vjs.dom.createEl,
            currentLanguage: this.currentLanguage,
            onVideo,
            onFavorite,
            onRename,
            onDelete,
            onDeleteVideoOnly,
            filterStar: this.filterStar,
            onRefreshForStarUnfavorite: () => {
                if (this.lastOnVideo) {
                    this.updateSideBar(
                        this.lastRecordingsSizeGb,
                        this.lastRecordings,
                        this.lastOnVideo,
                        this.lastOnFavorite,
                        this.lastOnRename,
                        this.lastOnDelete,
                        this.lastOnDeleteVideoOnly,
                    );
                }
            },
        });
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
        showModalView({
            modal: this.modal,
            modalContent: this.modalContent,
            insertContent: this.vjs.dom.insertContent,
            content,
        });
    };

    public hideModal = () => {
        hideModalView({
            modal: this.modal,
            modalContent: this.modalContent,
            emptyEl: this.vjs.dom.emptyEl,
        });
    };

    public modalIsOpen = () => {
        return isModalOpen(this.modal);
    };

    public showErrorModal = (text: string) => {
        this.showModal(
            buildErrorModalContent({
                createEl: this.vjs.dom.createEl,
                text,
                onClose: this.hideModal,
            }),
        );
    };

    /**
     * Shows a rich update modal with release notes and a direct update button.
     */
    public showUpdateModal = (update: any, lang: string) => {
        showUpdateModalView({
            update,
            lang,
            createEl: this.vjs.dom.createEl,
            getText,
            hideModal: this.hideModal,
            showModal: this.showModal,
            modalContent: this.modalContent,
        });
    };
    public showRenameModal = (
        videoId: string,
        videoIds: ReadonlyArray<string>,
        rename: (videoId: string, newVideoId: string) => void,
    ) => {
        showRenameRecordingModal({
            videoId,
            videoIds,
            rename,
            createEl: this.vjs.dom.createEl,
            showModal: this.showModal,
            hideModal: this.hideModal,
        });
    };

    private handleResize = () => {
        applyCompactLabelsClass(1200);
    };

    public showDeleteVideoOnlyModal = (videoId: string, deleteVideoOnly: (videoId: string) => void, isFavorite: boolean = false) => {
        showDeleteVideoOnlyRecordingModal({
            videoId,
            deleteVideoOnly,
            isFavorite,
            createEl: this.vjs.dom.createEl,
            showModal: this.showModal,
            hideModal: this.hideModal,
        });
    };

    public showDeleteModal = (videoId: string, deleteVideo: (videoId: string) => void, isFavorite: boolean = false) => {
        showDeleteRecordingModal({
            videoId,
            deleteVideo,
            isFavorite,
            createEl: this.vjs.dom.createEl,
            showModal: this.showModal,
            hideModal: this.hideModal,
        });
    };

    public showTimelineModal = (
        timelineEvents: Array<{ timestamp: number; text: string }>,
        setTime: (secs: number) => void,
    ) => {
        showTimelineModalView({
            timelineEvents,
            setTime,
            createEl: this.vjs.dom.createEl,
            hideModal: this.hideModal,
            showModal: this.showModal,
        });
    };

    public getActiveVideoId = (): string | null => {
        return getActiveVideoIdFromSidebar(this.sidebar);
    };

    public setActiveVideoId = (videoId: string | null) => {
        return setActiveVideoIdInSidebar(this.sidebar, videoId);
    };

    public playNextVideo = () => {
        playAdjacentVisibleVideo({ sidebar: this.sidebar, direction: "next" });
    };

    public playPrevVideo = () => {
        playAdjacentVisibleVideo({ sidebar: this.sidebar, direction: "prev" });
    };

    public clearVideoMetadata() {
        this.setTftMode(false);
        clearVideoMetadataView({
            emptyEl: this.vjs.dom.emptyEl,
        });
    }

    public setTftMode(enabled: boolean) {
        if (!this.player) return;
        (this.player.el() as HTMLElement).classList.toggle("lr-tft-mode", enabled);
    }

    public async setVideoDescriptionMetadata(data: GameMetadata) {
        this.metadataRenderId++;
        this.currentQueueId = data.queue?.id ?? 0;

        console.log("Setting Video Description Metadata", data);

        const currentRenderId = this.metadataRenderId;
        const isTftByQueue = getGameModeByQueueId(data.queue?.id ?? 0, data.queue?.name ?? "") === "TFT";
        const hasTftParticipantData = data.participants.some((p) =>
            p.placement != null
            || p.playersEliminated != null
            || p.level != null
            || (p.traits?.length ?? 0) > 0
            || (p.units?.length ?? 0) > 0
            || p.companion != null
        );
        const isTftMatch = isTftByQueue || hasTftParticipantData;

        this.currentGameVersion = data.gameVersion || (await getCurrentPatchVersion());
        await ensureItemDataLoaded(this.currentGameVersion);
        if (isTftMatch) {
            await ensureTftDataLoaded();
        }

        resetScoreboardRuntimeState(this, data);

        this.setTftMode(isTftMatch);
        const playerEl = this.player.el() as HTMLElement;
        playerEl.classList.toggle("lr-tft-mode", isTftMatch);
        this.timeline = new InventoryTimeline(this.events, data.participants, undefined);

        const prepared = prepareScoreboardView({
            data,
            events: this.events,
            participants: this.participants,
            gameVersion: this.currentGameVersion,
            scoreboardScale: this.scoreboardScale,
            createEl: this.vjs.dom.createEl,
            emptyEl: this.vjs.dom.emptyEl,
            playerEl,
            setScoreboardHeight: (targetHeight, baseHeight) => this.setScoreboardHeight(targetHeight, baseHeight),
            saveScale: (scale) => {
                this.scoreboardScale = scale;
                commands.getSettings().then((s) => {
                    s.scoreboardScale = this.scoreboardScale;
                    commands.saveSettings(s);
                });
            },
            monoTower,
            monoVoidgrub,
            monoDrake,
            setParticipants: (participants) => {
                this.participants = participants;
            },
            assignHeaderRefs: (refs) => {
                assignScoreboardHeaderRefs(this as any, refs as any);
            },
        });
        if (!prepared) return;

        if (prepared.isTFT) {
            const oldScoreboards = prepared.playerEl.querySelectorAll(".scoreboard");
            oldScoreboards.forEach((el) => el.remove());
            this.scoreboardEl = null;
            this.player.off("timeupdate", this.updateTimelineItems);
            return;
        }
        this.scoreboardEl = prepared.scoreboardEl;
        this.flushPendingScoreboardHeight();

        const rendered = await renderScoreboardMainRows({
            data,
            sorted100: prepared.sorted100,
            sorted200: prepared.sorted200,
            currentGameVersion: this.currentGameVersion,
            currentRenderId,
            isRenderValid: () => this.metadataRenderId === currentRenderId,
            createEl: this.vjs.dom.createEl,
            csRefs: this.csRefs,
            kdaRefs: this.kdaRefs,
            scoreboardRefs: this.scoreboardRefs,
            goldDiffRefs: this.goldDiffRefs,
            scoreboardEl: prepared.scoreboardEl,
            playerEl: prepared.playerEl,
            controlBarEl: this.player.controlBar.el() as HTMLElement,
        });
        if (!rendered) return;

        this.stabilizeVideoLayout();
        this.player.off("timeupdate", this.updateTimelineItems);
        this.player.on("timeupdate", this.updateTimelineItems);
    }

    private updateTimelineItems = () => {
          if (!this.timeline || !this.player) return;

          const diagnose = (() => {
              try {
                  return window.localStorage.getItem("lr.seekDiagnostics") === "1";
              } catch {
                  return false;
              }
          })();
          const startedAt = diagnose ? performance.now() : 0;
          const currentTime = this.player.currentTime?.() ?? 0;
          const duration = this.player.duration?.();
         const hasStarted =
             typeof this.player.hasStarted === "function" ? Boolean(this.player.hasStarted()) : false;
         const keepFinalSnapshotWhileIdle =
             this.player.paused?.() &&
             !hasStarted &&
             currentTime <= 0.05 &&
             Number.isFinite(duration) &&
             (duration as number) > 0;

         // Keep metadata-final snapshot until first playback starts when autoplay is off.
         if (keepFinalSnapshotWhileIdle) {
             return;
         }

         applyScoreboardTickFlow({
             playerCurrentTimeSec: currentTime,
             currentGameVersion: this.currentGameVersion,
             timeline: this.timeline,
             scoreboardRefs: this.scoreboardRefs,
             goldTimeline: this.goldTimeline,
             goldDiffRefs: this.goldDiffRefs,
             participants: this.participants,
             csRefs: this.csRefs,
             kdaRefs: this.kdaRefs,
             recordingOffset: this.recordingOffset,
             currentQueueId: this.currentQueueId,
             events: this.events,
             team100GoldText: this.team100GoldText,
             team200GoldText: this.team200GoldText,
             team100LeadText: this.team100LeadText,
             team200LeadText: this.team200LeadText,
             team100KillsText: this.team100KillsText,
             team200KillsText: this.team200KillsText,
             team100TowerText: this.team100TowerText,
             team200TowerText: this.team200TowerText,
             team100DragonText: this.team100DragonText,
             team200DragonText: this.team200DragonText,
             team100BaronText: this.team100BaronText,
             team200BaronText: this.team200BaronText,
             team100VoidgrubText: this.team100VoidgrubText,
             team200VoidgrubText: this.team200VoidgrubText,
             team100HeraldText: this.team100HeraldText,
             team200HeraldText: this.team200HeraldText,
             headerTimeText: this.headerTimeText,
             baronTimerText: this.baronTimerText,
             baronTimerIcon: this.baronTimerIcon,
             baronTimerGroup2: this.baronTimerGroup2,
             baronTimerText2: this.baronTimerText2,
             baronTimerIcon2: this.baronTimerIcon2,
             dragonTimerText: this.dragonTimerText,
             dragonTimerIcon: this.dragonTimerIcon,
             monoVoidgrub,
             monoHerald,
              monoBaron,
              monoDrake,
          });
          if (startedAt) {
              const elapsed = performance.now() - startedAt;
              if (elapsed > 8) {
                  console.log(`[seek-diagnostics] scoreboard timeupdate ${elapsed.toFixed(1)}ms current=${currentTime.toFixed(3)}`);
              }
          }
    };

    public showBigPlayButton = (show: boolean) => {
        setBigPlayButtonVisibility(show);
    };

    public setMarkerFlags = (settings: MarkerFlags) => {
        applyMarkerFlags(settings, {
            kill: this.checkboxKill,
            death: this.checkboxDeath,
            assist: this.checkboxAssist,
            structure: this.checkboxStructure,
            dragon: this.checkboxDragon,
            voidgrub: this.checkboxVoidgrub,
            herald: this.checkboxHerald,
            baron: this.checkboxBaron,
        });
    };

    public getMarkerFlags = (): MarkerFlags => {
        return readMarkerFlags({
            kill: this.checkboxKill,
            death: this.checkboxDeath,
            assist: this.checkboxAssist,
            structure: this.checkboxStructure,
            dragon: this.checkboxDragon,
            voidgrub: this.checkboxVoidgrub,
            herald: this.checkboxHerald,
            baron: this.checkboxBaron,
        });
    };

    public showMarkerFlags = (show: boolean) => {
    };

    public updateAutoStopBtn = (enabled: boolean) => {
        setToggleChecked(this.autoStopCb, enabled);
    };

    public updateAutoPlayBtn = (enabled: boolean) => {
        setToggleChecked(this.autoPlayCb, enabled);
    };

    public updateAutoSelectBtn = (enabled: boolean) => {
        setToggleChecked(this.autoSelectCb, enabled);
    };

    public setAutoStopBtnOnClickHandler = (handler: (e: Event) => void) => {
        bindChangeHandler(this.autoStopCb, handler);
    };

    public setAutoPlayBtnOnClickHandler = (handler: (e: Event) => void) => {
        bindChangeHandler(this.autoPlayCb, handler);
    };

    public setAutoSelectBtnOnClickHandler = (handler: (e: Event) => void) => {
        bindChangeHandler(this.autoSelectCb, handler);
    };

    public setCurrentLanguage = (language: string) => {
        this.currentLanguage = language;
    };

    public showSettingsModal = (
        settings: Settings,
        saveCallback: (s: Settings) => Promise<void>,
    ) => {
        showSettingsModalView({
            settings,
            saveCallback,
            createEl: this.vjs.dom.createEl,
            modalContent: this.modalContent,
            showModal: this.showModal,
            hideModal: this.hideModal,
            getText,
            currentPatchVersion: getCurrentPatchVersion(),
            currentBinds: currentKeybinds,
            reopenWithLanguage: () => this.showSettingsModal(settings, saveCallback),
            onShowUpdateModal: (update, langCode) => this.showUpdateModal(update, langCode),
            onScrollModifierChange: (modifier) => {
                this.scrollFrameStepModifier = modifier ?? "Shift";
            },
            onReloadKeybinds: reloadKeybinds,
            updateAutoButtons: (newSettings) => {
                this.updateAutoStopBtn(newSettings.autoStopPlayback);
                this.updateAutoPlayBtn(newSettings.autoplayVideo);
                this.updateAutoSelectBtn(newSettings.autoSelectRecording);
            },
        });
    };

    public createTimeRuler = (duration: number) => {
        renderTimeRuler(duration);
    };
}

if (import.meta.hot) {
    import.meta.hot.accept();
}
