import type { Deferred, GameMetadata, MetadataFile } from "./bindings";
import type { HighlightEvents, RecordingEvents, TftRoundEvents } from "./main_markers_usecase";

type MetadataUiLike = {
    showMarkerFlags(show: boolean): void;
    setRecordingOffset(offset: number): void;
    setVideoDescriptionMetadata(data: GameMetadata): Promise<void>;
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

async function applyMetadataBranch(ui: MetadataUiLike, metadata: GameMetadata): Promise<MetadataRenderResult> {
    console.log(
        `[diagnose] metadata-summary participantId=${metadata.participantId} events=${metadata.events?.length ?? 0} highlights=${metadata.highlights?.length ?? 0} participants=${metadata.participants?.length ?? 0} teams=${metadata.teams?.length ?? 0}`,
    );
    ui.showMarkerFlags(true);
    ui.setRecordingOffset(metadata.ingameTimeRecStartOffset);
    try {
        await ui.setVideoDescriptionMetadata(metadata);
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

async function applyDeferredBranch(ui: MetadataUiLike, deferred: Deferred): Promise<MetadataRenderResult> {
    console.log(
        `[diagnose] deferred-summary events=${deferred.events?.length ?? 0} highlights=${deferred.highlights?.length ?? 0} participants=${deferred.participants?.length ?? 0}`,
    );
    ui.setRecordingOffset(deferred.ingameTimeRecStartOffset);

    const synthesized = buildDeferredSyntheticMetadata(deferred);
    if (synthesized) {
        try {
            await ui.setVideoDescriptionMetadata(synthesized);
        } catch (error) {
            console.error("setVideoDescriptionMetadata failed (Deferred):", error);
        }
    }

    const hasEvents = !!deferred.events && deferred.events.length > 0;
    ui.showMarkerFlags(hasEvents);

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
}): Promise<MetadataRenderResult> {
    const { data, requestedVideoId, resolvedVideoId, ui } = input;
    if (data && "Metadata" in data) {
        return applyMetadataBranch(ui, data.Metadata);
    }
    if (data && "Deferred" in data) {
        return applyDeferredBranch(ui, data.Deferred);
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
