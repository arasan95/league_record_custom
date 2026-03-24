import type { Recording } from "./bindings";

type UiSidebarLike = {
    getActiveVideoId(): string | null;
    setActiveVideoId(videoId: string | null): boolean;
    updateSideBar(
        recordingsSizeGb: number,
        recordings: ReadonlyArray<Recording>,
        onClick: (videoId: string | null) => void | Promise<void>,
        onStar: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void | Promise<void>,
        onDelete: (videoId: string, isFavorite?: boolean) => void,
        onDeleteVideoOnly: ((videoId: string, isFavorite?: boolean) => void) | undefined,
        forceUpdateIds?: string[],
    ): void;
};

export async function refreshSidebar(input: {
    ui: UiSidebarLike;
    forceUpdateIds?: string[];
    getRecordingsList: () => Promise<Recording[]>;
    getRecordingsSize: () => Promise<number>;
    setVideo: (videoId: string | null) => void | Promise<void>;
    toggleFavorite: (videoId: string) => Promise<boolean | null>;
    showRenameModal: (videoId: string) => void | Promise<void>;
    showDeleteModal: (videoId: string, isFavorite?: boolean) => void;
    handleDeleteVideoOnly: (videoId: string, isFavorite?: boolean) => void;
}): Promise<Recording[]> {
    const {
        ui,
        forceUpdateIds = [],
        getRecordingsList,
        getRecordingsSize,
        setVideo,
        toggleFavorite,
        showRenameModal,
        showDeleteModal,
        handleDeleteVideoOnly,
    } = input;

    const activeVideoId = ui.getActiveVideoId();
    const [recordings, recordingsSize] = await Promise.all([getRecordingsList(), getRecordingsSize()]);
    ui.updateSideBar(
        recordingsSize,
        recordings,
        setVideo,
        toggleFavorite,
        showRenameModal,
        showDeleteModal,
        handleDeleteVideoOnly,
        forceUpdateIds,
    );

    if (!ui.setActiveVideoId(activeVideoId)) {
        void setVideo(null);
    }

    return recordings;
}

export function retrySidebarUpdateLoop(input: {
    attemptsLeft: number;
    targetId: string;
    updateSidebar: (forceUpdateIds?: string[]) => Promise<Recording[]>;
    resolveRetryState: (recordings: Recording[], targetId: string) => { shouldRetry: boolean; nextTargetId: string };
    delayMs?: number;
}): void {
    const { attemptsLeft, targetId, updateSidebar, resolveRetryState, delayMs = 1000 } = input;
    if (attemptsLeft <= 0) return;

    setTimeout(async () => {
        try {
            console.log(`Retrying Sidebar Update for ${targetId}... Attempts left: ${attemptsLeft}`);
            const recordings = await updateSidebar([targetId]);
            if (recordings.length > 0) {
                const retryState = resolveRetryState(recordings, targetId);
                if (retryState.nextTargetId !== targetId) {
                    console.log(`Target ID ${targetId} lost. Switching focus to latest recording.`);
                }
                if (retryState.shouldRetry) {
                    retrySidebarUpdateLoop({
                        attemptsLeft: attemptsLeft - 1,
                        targetId: retryState.nextTargetId,
                        updateSidebar,
                        resolveRetryState,
                        delayMs,
                    });
                } else {
                    console.log("Retry successful: Data is valid.");
                }
            }
        } catch (error) {
            console.error("Error in retry loop:", error);
            retrySidebarUpdateLoop({
                attemptsLeft: attemptsLeft - 1,
                targetId,
                updateSidebar,
                resolveRetryState,
                delayMs,
            });
        }
    }, delayMs);
}
