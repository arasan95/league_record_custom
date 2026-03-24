import type { Recording } from "./bindings";

export async function openRenameModal(input: {
    videoId: string;
    getRecordingsList: () => Promise<Recording[]>;
    showRenameModal: (videoId: string, existingVideoIds: string[], onSubmit: (videoId: string, newVideoId: string) => Promise<void>) => void;
    onRename: (videoId: string, newVideoId: string) => Promise<void>;
}): Promise<void> {
    const { videoId, getRecordingsList, showRenameModal, onRename } = input;
    const existingVideoIds = (await getRecordingsList()).map((recording) => recording.videoId);
    showRenameModal(videoId, existingVideoIds, onRename);
}

export async function renameVideoFlow(input: {
    videoId: string;
    newVideoId: string;
    getActiveVideoId: () => string | null;
    renameVideo: (videoId: string, newVideoId: string) => Promise<boolean>;
    getCurrentTime: () => number;
    setCurrentTime: (seconds: number) => void;
    updateSidebar: () => void | Promise<unknown>;
    setVideo: (videoId: string) => Promise<void>;
    showErrorModal: (message: string) => void;
}): Promise<void> {
    const {
        videoId,
        newVideoId,
        getActiveVideoId,
        renameVideo,
        getCurrentTime,
        setCurrentTime,
        updateSidebar,
        setVideo,
        showErrorModal,
    } = input;

    const activeVideoId = getActiveVideoId();
    const ok = await renameVideo(videoId, newVideoId);
    if (!ok) {
        showErrorModal("Error renaming video!");
        return;
    }

    if (videoId === activeVideoId) {
        const currentTime = getCurrentTime();
        void updateSidebar();
        void setVideo(newVideoId).then(() => setCurrentTime(currentTime));
    }
}

export function showDeleteWithConfirm(input: {
    videoId: string;
    isFavorite: boolean;
    confirmDelete: () => Promise<boolean>;
    showDeleteModal: (videoId: string, onDelete: (videoId: string) => Promise<void>, isFavorite: boolean) => void;
    deleteVideo: (videoId: string) => Promise<void>;
}): void {
    const { videoId, isFavorite, confirmDelete, showDeleteModal, deleteVideo } = input;
    void confirmDelete().then((shouldConfirm) => {
        if (shouldConfirm || isFavorite) {
            showDeleteModal(videoId, deleteVideo, isFavorite);
        } else {
            void deleteVideo(videoId);
        }
    });
}

export async function deleteVideoFlow(input: {
    videoId: string;
    getActiveVideoId: () => string | null;
    clearPlayerSource: () => void;
    removeRecordingItem: (videoId: string) => void;
    deleteVideo: (videoId: string) => Promise<boolean>;
    updateSidebar: () => void | Promise<unknown>;
    showErrorModal: (message: string) => void;
}): Promise<void> {
    const {
        videoId,
        getActiveVideoId,
        clearPlayerSource,
        removeRecordingItem,
        deleteVideo,
        updateSidebar,
        showErrorModal,
    } = input;

    if (videoId === getActiveVideoId()) {
        clearPlayerSource();
    }
    removeRecordingItem(videoId);

    const ok = await deleteVideo(videoId);
    if (!ok) {
        showErrorModal("Error deleting video!");
        void updateSidebar();
    }
}

function executeDeleteVideoOnly(input: {
    videoId: string;
    markRecordingAsVideoDeleted: (videoId: string) => void;
    deleteVideoOnly: (videoId: string) => Promise<boolean>;
    showErrorModal: (message: string) => void;
    updateSidebar: () => void | Promise<unknown>;
}): void {
    const { videoId, markRecordingAsVideoDeleted, deleteVideoOnly, showErrorModal, updateSidebar } = input;
    markRecordingAsVideoDeleted(videoId);
    void deleteVideoOnly(videoId).then((ok) => {
        if (!ok) {
            showErrorModal("Error deleting video file!");
            void updateSidebar();
        }
    });
}

export function deleteVideoOnlyWithConfirm(input: {
    videoId: string;
    isFavorite: boolean;
    confirmDelete: () => Promise<boolean>;
    showDeleteVideoOnlyModal: (videoId: string, onDelete: (videoId: string) => void, isFavorite: boolean) => void;
    markRecordingAsVideoDeleted: (videoId: string) => void;
    deleteVideoOnly: (videoId: string) => Promise<boolean>;
    showErrorModal: (message: string) => void;
    updateSidebar: () => void | Promise<unknown>;
}): void {
    const {
        videoId,
        isFavorite,
        confirmDelete,
        showDeleteVideoOnlyModal,
        markRecordingAsVideoDeleted,
        deleteVideoOnly,
        showErrorModal,
        updateSidebar,
    } = input;

    void confirmDelete().then((shouldConfirm) => {
        if (shouldConfirm || isFavorite) {
            showDeleteVideoOnlyModal(
                videoId,
                (id) => executeDeleteVideoOnly({
                    videoId: id,
                    markRecordingAsVideoDeleted,
                    deleteVideoOnly,
                    showErrorModal,
                    updateSidebar,
                }),
                isFavorite,
            );
            return;
        }
        executeDeleteVideoOnly({
            videoId,
            markRecordingAsVideoDeleted,
            deleteVideoOnly,
            showErrorModal,
            updateSidebar,
        });
    });
}
