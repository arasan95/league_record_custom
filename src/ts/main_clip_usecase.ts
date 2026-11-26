import { Channel } from "@tauri-apps/api/core";
import { commands, type ClipAudioTrack } from "./bindings";
import { prepareClipCompletionSound } from "./util";

export function bindClipCreation({
    button,
    status: clipStatus,
    progressBar: clipProgress,
    getRange,
    getVideoId,
    pickAudioMode,
    showError,
    onSaved,
}: {
    button: HTMLButtonElement | null;
    status: HTMLSpanElement;
    progressBar: HTMLProgressElement;
    getRange: () => { start: number | null; end: number | null };
    getVideoId: () => string | null;
    pickAudioMode: (tracks: ReadonlyArray<ClipAudioTrack>, lang: string) => Promise<"vc-in" | "game-only" | null>;
    showError: (message: string) => void;
    onSaved: () => void;
}): () => void {
    let creatingClip = false;
    let clipConfirmationTimer: ReturnType<typeof setTimeout> | undefined;

    function updateClipBtnState() {
        const { start, end } = getRange();
        if (button) button.disabled = creatingClip || start === null || end === null || end <= start;
    }

    if (!button) return updateClipBtnState;
    button.onclick = async () => {
        const videoId = getVideoId();
        const { start, end } = getRange();
        if (creatingClip || !videoId || start === null || end === null || end <= start) return;

        clearTimeout(clipConfirmationTimer);
        clipConfirmationTimer = undefined;
        const completionSound = prepareClipCompletionSound();
        let playCompletionSound = false;
        creatingClip = true;
        updateClipBtnState();
        clipStatus.removeAttribute("aria-label");
        clipStatus.textContent = "…";
        clipProgress.removeAttribute("value");
        clipProgress.hidden = false;

        try {
            const settings = await commands.getSettings();
            const lang = settings.language || "en";
            const tracksResult = await commands.getClipAudioTracks(videoId);
            if (tracksResult.status === "error") {
                throw tracksResult.error;
            }

            let selectedAudioTrackIndex: number | null = null;
            if (tracksResult.data.length > 1) {
                clipProgress.hidden = true;
                const mode = await pickAudioMode(tracksResult.data, lang);
                if (mode === null) {
                    return;
                }
                selectedAudioTrackIndex = mode === "game-only" ? 1 : 0;
            } else if (tracksResult.data.length === 1) {
                selectedAudioTrackIndex = tracksResult.data[0].index;
            }

            clipProgress.hidden = false;
            const progress = new Channel<number>(percent => {
                if (!creatingClip) return;
                clipProgress.value = percent;
                clipStatus.textContent = `${percent}%`;
            });
            const clipResult = await commands.createClip(
                videoId,
                start,
                end,
                selectedAudioTrackIndex === null ? null : false,
                selectedAudioTrackIndex,
                progress,
            );
            if (clipResult.status === "error") {
                throw clipResult.error;
            }
            clipStatus.textContent = "✓";
            clipStatus.setAttribute("aria-label", "Clip saved");
            playCompletionSound = settings.playRecordingSounds;
            if (playCompletionSound) completionSound?.play();
            onSaved();
            clipConfirmationTimer = setTimeout(() => {
                clipStatus.textContent = "Clip";
                clipStatus.removeAttribute("aria-label");
                clipConfirmationTimer = undefined;
            }, 2500);
        } catch (e) {
            showError(`Failed to create clip: ${e}`);
        } finally {
            creatingClip = false;
            clipProgress.hidden = true;
            if (!playCompletionSound) completionSound?.close();
            if (clipConfirmationTimer === undefined) clipStatus.textContent = "Clip";
            updateClipBtnState();
        }
    };
    updateClipBtnState();
    return updateClipBtnState;
}
