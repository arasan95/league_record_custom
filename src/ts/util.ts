import type { MetadataFile } from "./bindings";

export function toVideoName(videoId: string): string {
    const nameWithExt = videoId.split(/[/\\]/).pop() || videoId;
    return nameWithExt.replace(/\.(mp4|json|webm)$/i, "");
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

export function prepareClipCompletionSound() {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    try {
        const ctx: AudioContext = new AudioContext();
        // Resume during the click so WebView can play the tone after the export finishes.
        const ready = ctx.resume().catch(error => {
            console.warn("Failed to prepare clip completion sound:", error);
        });
        const close = () => { void ctx.close().catch(() => {}); };
        return {
            play: () => {
                void ready.then(() => {
                    if (ctx.state !== "running") {
                        close();
                        return;
                    }
                    playNotificationSound('clip-complete', ctx);
                });
            },
            close,
        };
    } catch (error) {
        console.warn("Failed to prepare clip completion sound:", error);
    }
}

export function playNotificationSound(type: 'start' | 'stop' | 'clip-complete', preparedContext?: AudioContext) {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = preparedContext ?? new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => { void ctx.close().catch(() => {}); };

        const now = ctx.currentTime;
        
        if (type === 'start') {
            // High pitch, short "ding"
            osc.frequency.setValueAtTime(880, now); // A5
            gain.gain.setValueAtTime(0.05, now); // Low volume (Subtle)
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'clip-complete') {
            osc.frequency.setValueAtTime(523.25, now);
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.045, now + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.start(now);
            osc.stop(now + 0.22);
        } else {
            // Lower pitch, short "bloop"
            osc.frequency.setValueAtTime(440, now); // A4
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        }
    } catch (e) {
        if (preparedContext) void preparedContext.close().catch(() => {});
        console.warn("Failed to play notification sound:", e);
    }
}
