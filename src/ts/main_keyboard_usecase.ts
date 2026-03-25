type PlayerLike = {
    paused(): boolean;
    play(): Promise<void> | void;
    pause(): void;
    playbackRate(rate?: number): number | undefined;
    currentTime(time?: number): number | undefined;
    volume(value?: number): number | undefined;
    isFullscreen(): boolean | undefined;
    exitFullscreen(): void;
    requestFullscreen(): void;
    muted(value?: boolean): boolean | undefined;
    markers(): {
        next(): void;
        getMarkers(): ReadonlyArray<{ time: number; class?: string; text?: string }>;
    };
};

type UiLike = {
    modalIsOpen(): boolean;
    hideModal(): void;
    getActiveVideoId(): string | null;
    playNextVideo(): void;
    playPrevVideo(): void;
};

type LoopState = {
    loopStart: number | null;
    loopEnd: number | null;
    isLooping: boolean;
};

export function createKeyboardHandlers(input: {
    player: PlayerLike;
    ui: UiLike;
    matchesAction: (event: KeyboardEvent, action: string) => boolean;
    getLoopState: () => LoopState;
    setLoopState: (patch: Partial<LoopState>) => void;
    loopStartInput: HTMLInputElement | null;
    loopEndInput: HTMLInputElement | null;
    loopEnabledCheckbox: HTMLInputElement | null;
    formatLoopTime: (seconds: number) => string;
    updateClipBtnState: () => void;
}) {
    const {
        player,
        ui,
        matchesAction,
        getLoopState,
        setLoopState,
        loopStartInput,
        loopEndInput,
        loopEnabledCheckbox,
        formatLoopTime,
        updateClipBtnState,
    } = input;

    let isSteppingForward = false;
    let isSteppingBackward = false;
    let activeStepBackwardInterval: number | null = null;
    let originalPlaybackRate = 1.0;

    const getSelfMarkersSorted = () => {
        const markers = [...player.markers().getMarkers()];
        return markers
            .filter((marker) => {
                const markerClass = marker.class ?? "";
                return markerClass.includes("lane-self") || markerClass.includes("self-marker");
            })
            .sort((a, b) => a.time - b.time);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
            return;
        }

        if (isSteppingForward && matchesAction(event, "stepForward")) {
            isSteppingForward = false;
            player.pause();
            player.playbackRate(originalPlaybackRate);
            event.preventDefault();
            event.stopPropagation();
        }

        if (isSteppingBackward && matchesAction(event, "stepBackward")) {
            isSteppingBackward = false;
            if (activeStepBackwardInterval) {
                clearInterval(activeStepBackwardInterval);
                activeStepBackwardInterval = null;
            }
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
            return;
        }

        if (ui.modalIsOpen()) {
            if (event.key === "Escape") {
                ui.hideModal();
            }
            return;
        }
        if (ui.getActiveVideoId() === null) return;

        let handled = false;

        if (matchesAction(event, "playPause")) {
            player.paused() ? player.play() : player.pause();
            handled = true;
        } else if (matchesAction(event, "nextEvent")) {
            const markers = getSelfMarkersSorted();
            const currentTime = player.currentTime() || 0;
            const target = markers.find((marker) => marker.time > currentTime + 0.05);
            if (target) {
                player.currentTime(target.time);
            }
            handled = true;
        } else if (matchesAction(event, "prevEvent")) {
            const markers = getSelfMarkersSorted();
            const currentTime = player.currentTime() || 0;
            const tolerance = 4;

            let targetMarkerIndex = -1;
            for (let i = markers.length - 1; i >= 0; i--) {
                if (markers[i].time < currentTime - 0.1) {
                    targetMarkerIndex = i;
                    break;
                }
            }

            if (targetMarkerIndex !== -1) {
                const currentPrevMarker = markers[targetMarkerIndex];
                if (currentTime - currentPrevMarker.time < tolerance) {
                    if (targetMarkerIndex > 0) player.currentTime(markers[targetMarkerIndex - 1].time);
                    else player.currentTime(currentPrevMarker.time);
                } else {
                    player.currentTime(currentPrevMarker.time);
                }
            } else {
                player.currentTime(0);
            }
            handled = true;
        } else if (matchesAction(event, "seekForward")) {
            player.currentTime((player.currentTime() ?? 0) + 5);
            handled = true;
        } else if (matchesAction(event, "seekBackward")) {
            player.currentTime((player.currentTime() ?? 0) - 5);
            handled = true;
        } else if (matchesAction(event, "volUp")) {
            player.volume((player.volume() ?? 0) + 0.1);
            handled = true;
        } else if (matchesAction(event, "volDown")) {
            player.volume((player.volume() ?? 0) - 0.1);
            handled = true;
        } else if (matchesAction(event, "fullscreen")) {
            player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
            handled = true;
        } else if (matchesAction(event, "mute")) {
            player.muted(!(player.muted() ?? false));
            handled = true;
        } else if (matchesAction(event, "speedUp")) {
            const currentRate = player.playbackRate() ?? 1.0;
            if (currentRate < 3) player.playbackRate(currentRate + 0.25);
            handled = true;
        } else if (matchesAction(event, "speedDown")) {
            const currentRate = player.playbackRate() ?? 1.0;
            if (currentRate > 0.25) player.playbackRate(currentRate - 0.25);
            handled = true;
        } else if (matchesAction(event, "exitFullscreen")) {
            if (player.isFullscreen()) player.exitFullscreen();
            handled = true;
        } else if (matchesAction(event, "setLoopA")) {
            const now = player.currentTime();
            if (now !== undefined) {
                setLoopState({ loopStart: now });
                if (loopStartInput) loopStartInput.value = formatLoopTime(now);
                updateClipBtnState();
            }
            handled = true;
        } else if (matchesAction(event, "setLoopB")) {
            const now = player.currentTime();
            if (now !== undefined) {
                setLoopState({ loopEnd: now });
                if (loopEndInput) loopEndInput.value = formatLoopTime(now);
                updateClipBtnState();

                const state = getLoopState();
                if (state.loopStart !== null && state.loopEnd !== null && state.loopEnd > state.loopStart) {
                    setLoopState({ isLooping: true });
                    if (loopEnabledCheckbox) loopEnabledCheckbox.checked = true;
                }
            }
            handled = true;
        } else if (matchesAction(event, "toggleLoop")) {
            if (loopEnabledCheckbox) {
                loopEnabledCheckbox.checked = !loopEnabledCheckbox.checked;
                setLoopState({ isLooping: loopEnabledCheckbox.checked });
            }
            handled = true;
        } else if (matchesAction(event, "stepForward")) {
            if (!event.repeat && !isSteppingForward) {
                isSteppingForward = true;
                originalPlaybackRate = player.playbackRate() || 1.0;
                player.playbackRate(0.25);
                player.play();
            }
            handled = true;
        } else if (matchesAction(event, "stepBackward")) {
            if (!event.repeat && !isSteppingBackward) {
                isSteppingBackward = true;
                player.pause();
                if (activeStepBackwardInterval) clearInterval(activeStepBackwardInterval);

                const stepAmount = 0.1;
                player.currentTime(Math.max(0, (player.currentTime() ?? 0) - stepAmount));
                activeStepBackwardInterval = setInterval(() => {
                    const t = player.currentTime() || 0;
                    player.currentTime(Math.max(0, t - stepAmount));
                }, 200) as unknown as number;
            }
            handled = true;
        } else if (matchesAction(event, "resetSpeed")) {
            player.playbackRate(1.0);
            handled = true;
        } else if (matchesAction(event, "nextVideo")) {
            ui.playNextVideo();
            handled = true;
        } else if (matchesAction(event, "prevVideo")) {
            ui.playPrevVideo();
            handled = true;
        }

        if (handled) {
            event.preventDefault();
        }
    };

    return { handleKeyUp, handleKeyDown };
}
