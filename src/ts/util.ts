import type { MetadataFile } from "./bindings";

export function toVideoName(videoId: string): string {
    const nameWithExt = videoId.split(/[/\\]/).pop() || videoId;
    // ensure we don't return an empty string if there is no extension
    if (nameWithExt.lastIndexOf(".") === -1) return nameWithExt;
    return nameWithExt.slice(0, nameWithExt.lastIndexOf("."));
}

export function toVideoId(videoName: string): string {
    return videoName + ".mp4";
}

export function splitRight(string: string, separator: string): string {
    return string.slice(string.lastIndexOf(separator) + 1);
}

export function isFavorite(metadataFile: MetadataFile | null): boolean {
    if (!metadataFile) return false;
    if ("Metadata" in metadataFile) return metadataFile.Metadata.favorite;
    if ("Deferred" in metadataFile) return metadataFile.Deferred.favorite;
    return false;
}

// return this error in 'default' switch branches to make the switch statement exhaustive
export class UnreachableError extends Error {
    constructor(val: never) {
        super(`unreachable case: ${JSON.stringify(val)}`);
    }
}

export function playNotificationSound(type: 'start' | 'stop') {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        
        if (type === 'start') {
            // High pitch, short "ding"
            osc.frequency.setValueAtTime(880, now); // A5
            gain.gain.setValueAtTime(0.05, now); // Low volume (Subtle)
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else {
            // Lower pitch, short "bloop"
            osc.frequency.setValueAtTime(440, now); // A4
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        }
    } catch (e) {
        console.warn("Failed to play notification sound:", e);
    }
}
