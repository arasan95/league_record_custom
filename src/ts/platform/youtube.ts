import { invoke } from "./core";

export const YOUTUBE_AUTH_CONNECTED_EVENT = "league-record-youtube-auth-connected";

export type YouTubeAuthStatus = {
    configured: boolean;
    connected: boolean;
    identityEnabled: boolean;
    cleanupEnabled?: boolean;
    uploading: boolean;
    firebaseIdToken?: string;
};
export type YouTubeUploadJob = {
    state: "idle" | "preparing" | "uploading" | "completed" | "cancelled" | "failed";
    sourceVideoId?: string;
    fileName?: string;
    totalBytes?: number;
    sentBytes?: number;
    youtubeVideoId?: string | null;
    youtubeUrl?: string | null;
    error?: string | null;
};

export function getYouTubeAuthStatus(): Promise<YouTubeAuthStatus> {
    return invoke("youtube_get_auth_status");
}

export function signInToYouTube(): Promise<YouTubeAuthStatus> {
    return invoke("youtube_sign_in");
}

export function signOutFromYouTube(): Promise<YouTubeAuthStatus> {
    return invoke("youtube_sign_out");
}

export function getYouTubeFirebaseIdToken(): Promise<string> {
    return invoke("youtube_get_firebase_id_token");
}

export function startYouTubeUpload(videoId: string, metadata: { title: string; description: string; madeForKids: boolean; privacyStatus: "private" | "unlisted" | "public"; policyAccepted: boolean; communityGuidelinesConfirmed: boolean }): Promise<YouTubeUploadJob> {
    return invoke("youtube_start_upload", { videoId, metadata });
}

export function getYouTubeUploadJob(): Promise<YouTubeUploadJob> {
    return invoke("youtube_get_upload_job");
}

export function cancelYouTubeUpload(): Promise<YouTubeUploadJob> {
    return invoke("youtube_cancel_upload");
}

export function findMissingYouTubeVideos(videoIds: string[]): Promise<string[]> {
    return invoke("youtube_find_missing_videos", { videoIds });
}

export function isPublicYouTubeVideoAvailable(videoId: string): Promise<boolean> {
    return invoke("youtube_is_public_video_available", { videoId });
}
