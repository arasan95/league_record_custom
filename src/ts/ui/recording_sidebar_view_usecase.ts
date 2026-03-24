import type { Recording } from "../bindings";
import type { ServerFilter } from "./recording_filters_usecase";
import { shouldHideBySearchFilters } from "./search_filters";
import { buildSidebarStatsSummary, buildStorageUsageState } from "./recordings_usecase";
import { isRecordingVisibleByUiFilters } from "./recording_filters_usecase";

export type SidebarSearchState = {
    filterStar: boolean;
    filterClip: boolean;
    filterRanked: boolean;
    filterSearch: boolean;
    filterServer: ServerFilter;
    filterRole: string | null;
    searchQuery: string;
    searchAllyQuery: string;
    searchEnemyQuery: string;
    searchUserQuery: string;
    searchQueueQuery: string;
};

export type SidebarUpdateCallbacks = {
    onVideo: (videoId: string) => void;
    onFavorite: (videoId: string) => Promise<boolean | null>;
    onRename: (videoId: string) => void;
    onDelete: (videoId: string, isFavorite: boolean) => void;
    onDeleteVideoOnly?: (videoId: string, isFavorite: boolean) => void;
};

export function updateRecordingSidebarView(params: {
    recordingsSizeGb: number;
    recordings: ReadonlyArray<Recording>;
    callbacks: SidebarUpdateCallbacks;
    forceUpdateIds: string[];
    search: SidebarSearchState;
    maxStorageGb: number;
    recordingElementMap: Map<string, HTMLElement>;
    createRecordingItem: (recording: Recording, callbacks: SidebarUpdateCallbacks) => HTMLElement;
    sidebarEl: HTMLElement;
    insertContent: (parent: Element, contents: HTMLElement[]) => void;
    isFavorite: (metadata: Recording["metadata"]) => boolean;
    getGameModeByQueueId: (queueId: number, queueName: string) => string;
    getChampionEnglishNameByIdSync: (championId: number) => string | null | undefined;
    getChampionLocalizedNameByIdSync: (championId: number) => string | null | undefined;
    storageRefs: {
        segClip: HTMLElement | null;
        segStar: HTMLElement | null;
        segNorm: HTMLElement | null;
        storagePctText: HTMLElement | null;
        sizeTotalText: HTMLElement | null;
        sizeMaxText: HTMLElement | null;
    };
}): void {
    const {
        recordingsSizeGb,
        recordings,
        callbacks,
        forceUpdateIds,
        search,
        maxStorageGb,
        recordingElementMap,
        createRecordingItem,
        sidebarEl,
        insertContent,
        isFavorite,
        getGameModeByQueueId,
        getChampionEnglishNameByIdSync,
        getChampionLocalizedNameByIdSync,
        storageRefs,
    } = params;

    const storageUsage = buildStorageUsageState(recordings, recordingsSizeGb, maxStorageGb, isFavorite);
    if (storageRefs.segClip) storageRefs.segClip.style.height = `${storageUsage.clipPct}%`;
    if (storageRefs.segStar) storageRefs.segStar.style.height = `${storageUsage.starPct}%`;
    if (storageRefs.segNorm) storageRefs.segNorm.style.height = `${storageUsage.normPct}%`;
    if (storageRefs.storagePctText) storageRefs.storagePctText.textContent = `${Math.round(storageUsage.totalPct)}%`;
    if (storageRefs.sizeTotalText) storageRefs.sizeTotalText.textContent = storageUsage.totalText;
    if (storageRefs.sizeMaxText) storageRefs.sizeMaxText.textContent = storageUsage.maxText;

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

    const videoLiElements = recordings
        .map((recording, index) => {
            let shouldHide = false;
            let isWin = false;
            let isBlueSide = false;
            let isRedSide = false;
            let kills = 0;
            let deaths = 0;
            let assists = 0;
            let isFinishedGame = false;

            if (recording.metadata && "Metadata" in recording.metadata) {
                const m = recording.metadata.Metadata;

                if (!shouldHide) {
                    shouldHide = shouldHideBySearchFilters(
                        m,
                        {
                            selfQuery: search.searchQuery,
                            allyQuery: search.searchAllyQuery,
                            enemyQuery: search.searchEnemyQuery,
                            userQuery: search.searchUserQuery,
                            queueQuery: search.searchQueueQuery,
                        },
                        {
                            getChampionEnglishNameByIdSync: (championId) =>
                                getChampionEnglishNameByIdSync(championId) ?? undefined,
                            getChampionLocalizedNameByIdSync: (championId) =>
                                getChampionLocalizedNameByIdSync(championId) ?? undefined,
                        },
                    );
                }

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
                            isFinishedGame = true;
                        }
                    }
                }
            }

            if (recording.videoId.includes("_clip")) {
                shouldHide = false;
            }

            if (shouldHide) {
                return undefined;
            }

            let li = recordingElementMap.get(recording.videoId);

            if (forceUpdateIds.includes(recording.videoId) || index === 0) {
                li = undefined;
            } else if (li) {
                const cachedHasMeta = li.dataset.hasMetadata === "true";
                const isNowValid =
                    recording.metadata &&
                    "Metadata" in recording.metadata &&
                    (recording.metadata.Metadata.stats ||
                        (recording.metadata.Metadata.queue.name &&
                            !recording.metadata.Metadata.queue.name.toLowerCase().includes("unknown")));

                if (Boolean(isNowValid) !== cachedHasMeta) {
                    li = undefined;
                }
            }

            if (!li) {
                li = createRecordingItem(recording, callbacks);
                recordingElementMap.set(recording.videoId, li);
            }

            const isVisible = isRecordingVisibleByUiFilters({
                recording,
                filterStar: search.filterStar,
                filterClip: search.filterClip,
                filterRanked: search.filterRanked,
                filterServer: search.filterServer,
                filterRole: search.filterRole ?? "",
                isFavorite,
                getGameModeByQueueId,
            });

            if (li) {
                if (isVisible) {
                    li.style.display = "";

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
        })
        .filter((li): li is HTMLElement => li !== undefined);

    if (recordings.length !== recordingElementMap.size) {
        const currentIds = new Set(recordings.map((r) => r.videoId));
        for (const id of recordingElementMap.keys()) {
            if (!currentIds.has(id)) {
                recordingElementMap.delete(id);
            }
        }
    }

    insertContent(sidebarEl, videoLiElements);

    const statsContainer = document.getElementById("filtered-stats-container");
    if (statsContainer) {
        statsContainer.style.display = search.filterSearch ? "flex" : "none";

        const setStat = (id: string, value: string) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        const summary = buildSidebarStatsSummary(
            totalGames,
            totalWins,
            recent20Wins,
            blueGames,
            blueWins,
            redGames,
            redWins,
            totalKills,
            totalDeaths,
            totalAssists,
        );
        setStat("stat-winrate", summary.winRateText);
        setStat("stat-recent20", summary.recent20Text);
        setStat("stat-blue-winrate", summary.blueWinRateText);
        setStat("stat-red-winrate", summary.redWinRateText);
        setStat("stat-kda", summary.kdaText);
        setStat("stat-kda-ratio", summary.kdaRatioText);
    }
}
