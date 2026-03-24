import type { Recording } from "./bindings";

function isMetadataUnknown(recording: Recording): boolean {
    let isUnknown = !recording.metadata || ("NoData" in recording.metadata);
    if (!isUnknown && recording.metadata && "Metadata" in recording.metadata) {
        const m = recording.metadata.Metadata;
        const qName = m.queue?.name?.toLowerCase() ?? "";
        if (!m.queue || !m.queue.name || qName.includes("unknown") || qName === "") {
            isUnknown = true;
        }
    }
    return isUnknown;
}

export function getLatestRetryVideoId(recordings: Recording[]): string | null {
    if (recordings.length === 0) {
        return null;
    }
    const latest = recordings[0];
    if (latest.videoId.includes("_clip_")) {
        return null;
    }
    return isMetadataUnknown(latest) ? latest.videoId : null;
}

export function getRetryState(recordings: Recording[], targetId: string): { shouldRetry: boolean; nextTargetId: string } {
    if (recordings.length === 0) {
        return { shouldRetry: false, nextTargetId: targetId };
    }
    const matched = recordings.find((r) => r.videoId === targetId);
    const target = matched ?? recordings[0];
    return {
        shouldRetry: isMetadataUnknown(target),
        nextTargetId: target.videoId,
    };
}
