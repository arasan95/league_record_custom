import type { Recording } from "../bindings";

export type ServerFilter = "ALL" | "LOL" | "TFT" | "SR" | "ARAM" | "OTHER";
export type ClipFilterMode = "all" | "only" | "exclude";

export type RecordingVisibilityFilterInput = {
    recording: Recording;
    filterStar: boolean;
    clipFilterMode: ClipFilterMode;
    filterRanked: boolean;
    filterServer: ServerFilter;
    filterRole: string;
    isFavorite: (metadata: Recording["metadata"]) => boolean;
    getGameModeByQueueId: (queueId: number, queueName: string) => string;
};

function resolveQueueFilterMode(
    recording: Recording,
    getGameModeByQueueId: (queueId: number, queueName: string) => string,
): string {
    if (recording.metadata && "Metadata" in recording.metadata) {
        const m = recording.metadata.Metadata;
        if (m.queue) {
            return getGameModeByQueueId(m.queue.id || 0, m.queue.name || "");
        }
    }
    return "UNKNOWN";
}

function deriveRoleFromMetadata(metadata: any): string | null {
    if (!metadata?.participants || metadata.participantId === undefined) {
        return null;
    }
    const myPar = metadata.participants.find((p: any) => p.participantId === metadata.participantId);
    if (!myPar) return null;

    let derivedRole = (myPar as any).teamPosition || "";
    if (!derivedRole || derivedRole === "INVALID") {
        const hasSmite = myPar.spell1Id === 11 || myPar.spell2Id === 11;
        const supportItems = [3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877];
        const hasSupportItem = [
            myPar.stats?.item0,
            myPar.stats?.item1,
            myPar.stats?.item2,
            myPar.stats?.item3,
            myPar.stats?.item4,
            myPar.stats?.item5,
        ].some((id) => id && supportItems.includes(id));

        if (hasSmite) derivedRole = "JUNGLE";
        else if (hasSupportItem) derivedRole = "UTILITY";
        else {
            const nativeSlot = ((myPar.participantId - 1) % 5) + 1;
            if (nativeSlot === 1) derivedRole = "TOP";
            else if (nativeSlot === 3) derivedRole = "MIDDLE";
            else if (nativeSlot === 4) derivedRole = "BOTTOM";
            else derivedRole = "MIDDLE";
        }
    }

    return String(derivedRole).toUpperCase();
}

export function isRecordingVisibleByUiFilters(input: RecordingVisibilityFilterInput): boolean {
    const { recording } = input;
    const isClip = recording.videoId.includes("_clip");

    if (input.filterStar && !input.isFavorite(recording.metadata)) {
        return false;
    }
    if (input.clipFilterMode === "only" && !isClip) {
        return false;
    }
    if (input.clipFilterMode === "exclude" && isClip) {
        return false;
    }
    if (input.filterRanked) {
        if (!(recording.metadata && "Metadata" in recording.metadata && recording.metadata.Metadata.queue?.isRanked)) {
            return false;
        }
    }

    if (input.filterServer !== "ALL") {
        const queueFilterMode = resolveQueueFilterMode(recording, input.getGameModeByQueueId);
        if (input.filterServer === "TFT") {
            if (queueFilterMode !== "TFT") return false;
        } else if (input.filterServer === "LOL" || input.filterServer === "SR" || input.filterServer === "ARAM" || input.filterServer === "OTHER") {
            if (queueFilterMode === "TFT") return false;
            if (input.filterServer === "SR" && queueFilterMode !== "SR") return false;
            if (input.filterServer === "ARAM" && queueFilterMode !== "ARAM") return false;
            if (input.filterServer === "OTHER" && queueFilterMode !== "OTHER") return false;
        }
    }

    if (input.filterRole) {
        if (!(recording.metadata && "Metadata" in recording.metadata)) {
            return false;
        }
        const derivedRole = deriveRoleFromMetadata(recording.metadata.Metadata);
        if (!derivedRole || derivedRole !== input.filterRole) {
            return false;
        }
    }

    return true;
}
