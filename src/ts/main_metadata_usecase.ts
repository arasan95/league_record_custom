import type { MetadataFile, Recording } from "./bindings";

type ResolveResult = { data: MetadataFile | null; resolvedVideoId: string };

export async function getMetadataWithFallback(
    videoId: string,
    getMetadata: (id: string) => Promise<MetadataFile | null>,
    buildMetadataCandidates: (videoId: string) => string[],
): Promise<ResolveResult> {
    const candidates = buildMetadataCandidates(videoId);
    let best: MetadataFile | null = null;
    let bestId = videoId;

    for (const candidate of candidates) {
        const data = await getMetadata(candidate);
        if (!data) continue;

        const kind = "Metadata" in data ? "Metadata" : "Deferred" in data ? "Deferred" : "NoData";
        console.log(`[diagnose] getMetadata candidate=${candidate} kind=${kind}`);

        if ("Metadata" in data) {
            return { data, resolvedVideoId: candidate };
        }
        if ("Deferred" in data && (!best || ("NoData" in best))) {
            best = data;
            bestId = candidate;
            continue;
        }
        if (!best) {
            best = data;
            bestId = candidate;
        }
    }

    return { data: best, resolvedVideoId: bestId };
}

export async function getMetadataFromRecordingsList(
    videoId: string,
    getRecordingsList: () => Promise<Recording[]>,
    videoIdsMatch: (a: string, b: string) => boolean,
): Promise<ResolveResult | null> {
    try {
        const recordings = await getRecordingsList();
        const match = recordings.find((r) => videoIdsMatch(r.videoId, videoId));
        if (!match?.metadata) return null;
        const kind =
            "Metadata" in match.metadata ? "Metadata" : "Deferred" in match.metadata ? "Deferred" : "NoData";
        console.log(`[diagnose] recordingsList fallback matched=${match.videoId} kind=${kind}`);
        return { data: match.metadata, resolvedVideoId: match.videoId };
    } catch (e) {
        console.warn("[diagnose] recordingsList fallback failed", e);
        return null;
    }
}
