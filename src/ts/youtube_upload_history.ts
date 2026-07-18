const STORAGE_KEY = "league-record.youtube-upload-history.v1";
const HISTORY_LIMIT = 500;
export const YOUTUBE_UPLOAD_HISTORY_CHANGED_EVENT = "league-record-youtube-upload-history-changed";

export type YouTubeUploadHistoryItem = {
    sourceVideoId: string | null;
    youtubeVideoId: string;
    uploadedAt: number;
};

function isVideoId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function readYouTubeUploadHistory(): YouTubeUploadHistoryItem[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is YouTubeUploadHistoryItem => (
            typeof item === "object" && item !== null
            && (typeof (item as YouTubeUploadHistoryItem).sourceVideoId === "string" || (item as YouTubeUploadHistoryItem).sourceVideoId === null)
            && isVideoId((item as YouTubeUploadHistoryItem).youtubeVideoId)
            && Number.isFinite((item as YouTubeUploadHistoryItem).uploadedAt)
        )).slice(0, HISTORY_LIMIT);
    } catch {
        return [];
    }
}

function writeHistory(items: YouTubeUploadHistoryItem[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
    window.dispatchEvent(new CustomEvent(YOUTUBE_UPLOAD_HISTORY_CHANGED_EVENT));
}

export function rememberYouTubeUpload(sourceVideoId: string | null, youtubeVideoId: string): void {
    if (!isVideoId(youtubeVideoId)) return;
    const normalizedSource = typeof sourceVideoId === "string" && sourceVideoId.trim() ? sourceVideoId : null;
    const current = readYouTubeUploadHistory();
    const existing = current.find((item) => item.youtubeVideoId === youtubeVideoId) ?? null;
    const effectiveSource = normalizedSource ?? existing?.sourceVideoId ?? null;
    const remaining = current.filter((item) => (
        item.youtubeVideoId !== youtubeVideoId
        && (!effectiveSource || item.sourceVideoId !== effectiveSource)
    ));
    writeHistory([{ sourceVideoId: effectiveSource, youtubeVideoId, uploadedAt: existing?.uploadedAt ?? Date.now() }, ...remaining]);
}

export function removeYouTubeUploadsByVideoIds(videoIds: Iterable<string>): void {
    const removed = new Set(videoIds);
    if (!removed.size) return;
    writeHistory(readYouTubeUploadHistory().filter((item) => !removed.has(item.youtubeVideoId)));
}

export function hasYouTubeUploadHistory(): boolean {
    return readYouTubeUploadHistory().length > 0;
}

export function findYouTubeUploadForSource(sourceVideoId: string): YouTubeUploadHistoryItem | null {
    return readYouTubeUploadHistory().find((item) => item.sourceVideoId === sourceVideoId) ?? null;
}
