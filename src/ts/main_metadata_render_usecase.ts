import { buildMetadataCandidates, normalizeVideoId, videoIdsMatch } from "./main_video_id_usecase";
import { getMetadataFromRecordingsList, getMetadataWithFallback } from "./main_metadata_usecase";
import type { Deferred, GameMetadata, MetadataFile, Recording } from "./bindings";
import type { HighlightEvents, RecordingEvents, TftRoundEvents } from "./main_markers_usecase";

export class LatestRequest {
    private serial = 0;

    begin(): () => boolean {
        const request = ++this.serial;
        return () => request === this.serial;
    }
}

type MetadataUiLike = {
    showMarkerFlags(show: boolean): void;
    setRecordingOffset(offset: number): void;
    setTftMode(enabled: boolean): void;
    setVideoDescriptionMetadata(data: GameMetadata, isCurrent: () => boolean): Promise<void>;
    clearVideoMetadata(): void;
};

export type MetadataRenderResult = {
    completed: boolean;
    clearRetry: boolean;
    currentEvents: RecordingEvents | null;
    highlightEvents: HighlightEvents | null;
    tftRoundEvents: TftRoundEvents | null;
};

function buildDeferredSyntheticMetadata(def: Deferred): GameMetadata | null {
    if (!def.participants || def.participants.length === 0) {
        return null;
    }
    return {
        favorite: def.favorite,
        matchId: def.matchId,
        ingameTimeRecStartOffset: def.ingameTimeRecStartOffset,
        highlights: def.highlights ?? [],
        tftRoundMarkers: def.tftRoundMarkers ?? [],
        queue: { id: 0, name: "Deferred", isRanked: false },
        player: { gameName: "Unknown", tagLine: "LOC", summonerId: 0 },
        championName: "Unknown",
        stats: {
            kills: 0, deaths: 0, assists: 0,
            largestMultiKill: 0, neutralMinionsKilled: 0,
            neutralMinionsKilledEnemyJungle: 0, neutralMinionsKilledTeamJungle: 0,
            totalMinionsKilled: 0, visionScore: 0,
            visionWardsBoughtInGame: 0, wardsPlaced: 0, wardsKilled: 0,
            gameEndedInEarlySurrender: false, gameEndedInSurrender: false, win: false,
            item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0,
            perk0: 0, perk1: 0, perk2: 0, perk3: 0, perk4: 0, perk5: 0,
            perkPrimaryStyle: 0, perkSubStyle: 0, goldEarned: 0,
        },
        participantId: 0,
        participants: def.participants,
        teams: [
            { teamId: 100, win: "Fail", towerKills: 0, inhibitorKills: 0, baronKills: 0, dragonKills: 0, vilemawKills: 0, riftHeraldKills: 0, dominionVictoryScore: 0, bans: [] },
            { teamId: 200, win: "Fail", towerKills: 0, inhibitorKills: 0, baronKills: 0, dragonKills: 0, vilemawKills: 0, riftHeraldKills: 0, dominionVictoryScore: 0, bans: [] },
        ],
        events: def.events ?? [],
        goldTimeline: [],
        gameVersion: undefined,
    };
}

async function applyMetadataBranch(ui: MetadataUiLike, metadata: GameMetadata, isCurrent: () => boolean): Promise<MetadataRenderResult> {
    console.log(
        `[diagnose] metadata-summary participantId=${metadata.participantId} events=${metadata.events?.length ?? 0} highlights=${metadata.highlights?.length ?? 0} participants=${metadata.participants?.length ?? 0} teams=${metadata.teams?.length ?? 0}`,
    );
    ui.showMarkerFlags(true);
    ui.setRecordingOffset(metadata.ingameTimeRecStartOffset);
    try {
        await ui.setVideoDescriptionMetadata(metadata, isCurrent);
    } catch (error) {
        console.error("setVideoDescriptionMetadata failed (Metadata):", error);
    }
    return {
        completed: true,
        clearRetry: true,
        currentEvents: {
            participantId: metadata.participantId,
            recordingOffset: metadata.ingameTimeRecStartOffset,
            events: metadata.events,
            participants: metadata.participants,
        },
        highlightEvents: {
            recordingOffset: metadata.ingameTimeRecStartOffset,
            events: metadata.highlights ?? [],
        },
        tftRoundEvents: {
            recordingOffset: metadata.ingameTimeRecStartOffset,
            events: metadata.tftRoundMarkers ?? [],
        },
    };
}

async function applyDeferredBranch(ui: MetadataUiLike, deferred: Deferred, isCurrent: () => boolean): Promise<MetadataRenderResult> {
    console.log(
        `[diagnose] deferred-summary events=${deferred.events?.length ?? 0} highlights=${deferred.highlights?.length ?? 0} participants=${deferred.participants?.length ?? 0}`,
    );
    ui.setRecordingOffset(deferred.ingameTimeRecStartOffset);
    ui.setTftMode((deferred.tftRoundMarkers?.length ?? 0) > 0);

    const synthesized = buildDeferredSyntheticMetadata(deferred);
    if (synthesized) {
        try {
            await ui.setVideoDescriptionMetadata(synthesized, isCurrent);
        } catch (error) {
            console.error("setVideoDescriptionMetadata failed (Deferred):", error);
        }
    }

    const hasEvents = !!deferred.events && deferred.events.length > 0;
    if (isCurrent()) ui.showMarkerFlags(hasEvents);

    return {
        completed: false,
        clearRetry: false,
        currentEvents: hasEvents
            ? {
                participantId: 0,
                recordingOffset: deferred.ingameTimeRecStartOffset,
                events: deferred.events ?? [],
                participants: deferred.participants,
            }
            : null,
        highlightEvents: {
            recordingOffset: deferred.ingameTimeRecStartOffset,
            events: deferred.highlights ?? [],
        },
        tftRoundEvents: {
            recordingOffset: deferred.ingameTimeRecStartOffset,
            events: deferred.tftRoundMarkers ?? [],
        },
    };
}

export async function renderMetadataState(input: {
    data: MetadataFile | null;
    requestedVideoId: string;
    resolvedVideoId: string;
    ui: MetadataUiLike;
    isCurrent: () => boolean;
}): Promise<MetadataRenderResult> {
    const { data, requestedVideoId, resolvedVideoId, ui, isCurrent } = input;
    if (data && "Metadata" in data) {
        return applyMetadataBranch(ui, data.Metadata, isCurrent);
    }
    if (data && "Deferred" in data) {
        return applyDeferredBranch(ui, data.Deferred, isCurrent);
    }

    console.log(`[diagnose] setMetadata-fallback-empty requested=${requestedVideoId} resolved=${resolvedVideoId}`);
    ui.clearVideoMetadata();
    ui.showMarkerFlags(false);
    ui.setRecordingOffset(0);
    return {
        completed: false,
        clearRetry: false,
        currentEvents: null,
        highlightEvents: null,
        tftRoundEvents: null,
    };
}

function metadataDataSignature(data: MetadataFile | null): string {
    if (!data) return "null";
    if ("NoData" in data) return "NoData";
    if ("Metadata" in data) {
        const m = data.Metadata;
        const eventCount = Array.isArray(m.events) ? m.events.length : 0;
        const lastEventTs = eventCount > 0 ? Number(m.events[eventCount - 1]?.timestamp ?? -1) : -1;
        const participantKey = Array.isArray(m.participants)
            ? m.participants.map((p) => `${p.participantId}:${p.championId}:${p.honorReceived ? 1 : 0}`).join("|")
            : "";
        const highlightsCount = Array.isArray(m.highlights) ? m.highlights.length : 0;
        const tftRoundCount = Array.isArray(m.tftRoundMarkers) ? m.tftRoundMarkers.length : 0;
        const lastTftRound = tftRoundCount > 0 ? `${m.tftRoundMarkers?.[tftRoundCount - 1]?.round}:${m.tftRoundMarkers?.[tftRoundCount - 1]?.timestamp}` : "";
        return `Metadata|pid=${m.participantId}|pc=${m.participants?.length ?? 0}|p=${participantKey}|ev=${eventCount}|last=${lastEventTs}|hi=${highlightsCount}|tft=${tftRoundCount}:${lastTftRound}|q=${m.queue?.id ?? 0}|gv=${m.gameVersion ?? ""}`;
    }
    if ("Deferred" in data) {
        const d = data.Deferred;
        const eventCount = Array.isArray(d.events) ? d.events.length : 0;
        const lastEventTs = eventCount > 0 ? Number(d.events?.[eventCount - 1]?.timestamp ?? -1) : -1;
        const participantKey = Array.isArray(d.participants)
            ? d.participants.map((p) => `${p.participantId}:${p.championId}:${p.honorReceived ? 1 : 0}`).join("|")
            : "";
        const highlightsCount = Array.isArray(d.highlights) ? d.highlights.length : 0;
        const tftRoundCount = Array.isArray(d.tftRoundMarkers) ? d.tftRoundMarkers.length : 0;
        const lastTftRound = tftRoundCount > 0 ? `${d.tftRoundMarkers?.[tftRoundCount - 1]?.round}:${d.tftRoundMarkers?.[tftRoundCount - 1]?.timestamp}` : "";
        return `Deferred|pc=${d.participants?.length ?? 0}|p=${participantKey}|ev=${eventCount}|last=${lastEventTs}|hi=${highlightsCount}|tft=${tftRoundCount}:${lastTftRound}|off=${d.ingameTimeRecStartOffset ?? 0}`;
    }
    return "unknown";
}

export function createMetadataController({
    ui, getActiveVideoId, getMetadata, getVisibleRecordings, onRender,
}: {
    ui: MetadataUiLike;
    getActiveVideoId: () => string | null;
    getMetadata: (videoId: string) => Promise<MetadataFile | null>;
    getVisibleRecordings: () => Promise<Recording[]>;
    onRender: (result: MetadataRenderResult) => void;
}) {
    const metadataRetryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    const metadataRenderSignatures = new Map<string, string>();
    const metadataRequest = new LatestRequest();
    let lastRenderedMetadataVideoKey: string | null = null;

    function clearMetadataRetry(videoId: string) {
        const key = normalizeVideoId(videoId);
        const timeout = metadataRetryTimeouts.get(key);
        if (timeout) {
            clearTimeout(timeout);
            metadataRetryTimeouts.delete(key);
        }
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
            const activeVideoId = getActiveVideoId();
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

    async function setMetadata(videoId: string): Promise<boolean> {
        const activeId = getActiveVideoId();
        if (!activeId || !videoIdsMatch(activeId, videoId)) return false;
        const isLatestRequest = metadataRequest.begin();
        const isCurrent = () => {
            const activeId = getActiveVideoId();
            return isLatestRequest() && !!activeId && videoIdsMatch(activeId, videoId);
        };
        const requestedVideoKey = normalizeVideoId(videoId);

        let { data, resolvedVideoId } = await getMetadataWithFallback(
            videoId,
            getMetadata,
            buildMetadataCandidates,
        );
        let kind = !data ? "null" : "Metadata" in data ? "Metadata" : "Deferred" in data ? "Deferred" : "NoData";
        console.log(`[diagnose] setMetadata kind=${kind} requested=${videoId} resolved=${resolvedVideoId}`);

        if (!data || "NoData" in data) {
            const listFallback = await getMetadataFromRecordingsList(
                videoId,
                getVisibleRecordings,
                videoIdsMatch,
            );
            if (listFallback?.data && ("Metadata" in listFallback.data || "Deferred" in listFallback.data)) {
                data = listFallback.data;
                resolvedVideoId = listFallback.resolvedVideoId;
                kind = "Metadata" in data ? "Metadata" : "Deferred";
                console.log(`[diagnose] setMetadata upgraded-by-list kind=${kind} requested=${videoId} resolved=${resolvedVideoId}`);
            }
        }

        if (!isCurrent()) return false;

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
            isCurrent,
        });
        if (!isCurrent()) return false;
        metadataRenderSignatures.set(cacheKey, signature);
        lastRenderedMetadataVideoKey = cacheKey;
        if (rendered.clearRetry) {
            clearMetadataRetry(videoId);
        }
        onRender(rendered);
        return rendered.completed;
    }

    return {
        load: setMetadata,
        clearRetry: clearMetadataRetry,
        scheduleRetry: scheduleMetadataRetry,
        invalidate: (videoId: string) => metadataRenderSignatures.delete(normalizeVideoId(videoId)),
        selectionChanged() {
            metadataRequest.begin();
            lastRenderedMetadataVideoKey = null;
        },
    };
}
