import { convertFileSrc } from "@tauri-apps/api/core";
import type Player from "video.js/dist/types/player";
import type { Recording } from "./bindings";
import type UI from "./ui";
import { LatestRequest, type createMetadataController } from "./main_metadata_render_usecase";
import { toAssetPath, videoIdsMatch } from "./main_video_id_usecase";

export function createVideoSelection({
    ui, metadata, getAutoplay, resetMarkers, changeMarkers, logPerf, perfNowMs,
}: {
    ui: Pick<UI, "setActiveVideoId" | "clearVideoMetadata" | "showMarkerFlags" | "setRecordingOffset">;
    metadata: ReturnType<typeof createMetadataController>;
    getAutoplay: () => Promise<boolean>;
    resetMarkers: () => void;
    changeMarkers: () => void;
    logPerf: (label: string, startedAt: number) => void;
    perfNowMs: () => number;
}) {
    const request = new LatestRequest();
    let preferredActiveVideoId: string | null = null;
    let player: Player;

    async function setVideo(videoId: string | null, allowAutoplay: boolean = true) {
        const startedAt = perfNowMs();
        const cleanVideoId = videoId?.replace(/\.(mp4|json|webm)$/i, "") ?? null;
        if (cleanVideoId && preferredActiveVideoId && videoIdsMatch(preferredActiveVideoId, cleanVideoId)) return;

        const isCurrent = request.begin();
        metadata.selectionChanged();
        preferredActiveVideoId = cleanVideoId;
        ui.setActiveVideoId(cleanVideoId);
        ui.clearVideoMetadata();
        ui.showMarkerFlags(false);
        ui.setRecordingOffset(0);
        resetMarkers();
        if (cleanVideoId === null) {
            player.src("");
            logPerf("setVideo(null)", startedAt);
        } else {
            metadata.clearRetry(cleanVideoId);
            const setMetadataStartedAt = perfNowMs();
            const completed = await metadata.load(cleanVideoId);
            logPerf("setVideo:setMetadata", setMetadataStartedAt);
            if (!isCurrent()) return;
            if (!completed) {
                metadata.scheduleRetry(cleanVideoId);
            }
            const normalizedVideoPath = toAssetPath(cleanVideoId + ".mp4");
            const videoSrc = convertFileSrc(normalizedVideoPath, "recording");
            console.log(`[diagnose] setVideo clean=${cleanVideoId} normalized=${normalizedVideoPath} src=${videoSrc}`);
            player.src({ type: "video/mp4", src: videoSrc });
            // Re-apply markers after source swap to avoid plugin/source timing clears.
            player.one("loadedmetadata", () => {
                if (isCurrent()) changeMarkers();
            });
            if (allowAutoplay && await getAutoplay() && isCurrent()) {
                void player.play()?.catch(() => {});
            }
            logPerf("setVideo(total)", startedAt);
        }
    }

    return {
        setPlayer(value: Player) { player = value; },
        setVideo,
        getActiveId: () => preferredActiveVideoId,
        reconcile(recordings: Recording[]) {
            const activeId = preferredActiveVideoId;
            if (!activeId) return;
            const match = recordings.find(recording => videoIdsMatch(recording.videoId, activeId));
            if (match) {
                preferredActiveVideoId = match.videoId;
                ui.setActiveVideoId(match.videoId);
            }
        },
    };
}
