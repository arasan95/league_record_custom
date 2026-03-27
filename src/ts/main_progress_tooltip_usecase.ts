type VideoPlayerLike = {
    currentTime(): number | undefined;
    duration(): number | undefined;
};

export function initializeProgressTooltips(input: {
    player: VideoPlayerLike;
    playerElement: HTMLElement | null;
    getRecordingOffset: () => number;
}): void {
    const { player, playerElement, getRecordingOffset } = input;
    const progressControl = document.querySelector(".vjs-progress-control") as HTMLElement | null;
    let customTooltip = document.getElementById("custom-tooltip");
    let customPlayTooltip = document.getElementById("custom-play-tooltip");

    if (playerElement) {
        if (!customTooltip && progressControl) {
            customTooltip = document.createElement("div");
            customTooltip.id = "custom-tooltip";
            playerElement.appendChild(customTooltip);
        }
        if (!customPlayTooltip) {
            customPlayTooltip = document.createElement("div");
            customPlayTooltip.id = "custom-play-tooltip";
            playerElement.appendChild(customPlayTooltip);
        }
    }

    let isProgressHovered = false;
    if (progressControl) {
        progressControl.addEventListener("mouseenter", () => {
            isProgressHovered = true;
        });
        progressControl.addEventListener("mouseleave", () => {
            isProgressHovered = false;
        });
    }

    const positionTooltipAboveSeekbar = (tooltipEl: HTMLElement, anchorClientX: number) => {
        if (!playerElement || !progressControl) return;
        const playerRect = playerElement.getBoundingClientRect();
        const progressRect = progressControl.getBoundingClientRect();
        const tooltipRect = tooltipEl.getBoundingClientRect();
        const pointerHeight = 10;
        const tooltipGap = 8;
        const relX = anchorClientX - playerRect.left;
        const top = progressRect.top - playerRect.top - tooltipRect.height - pointerHeight - tooltipGap;
        tooltipEl.style.left = `${relX}px`;
        tooltipEl.style.top = `${Math.max(0, top)}px`;
    };

    const ensurePlayheadIndicator = (playProgressBar: Element) => {
        if (!(playProgressBar instanceof HTMLElement)) return;
        const existing = playProgressBar.querySelector(".lr-playhead-indicator");
        if (existing) return;
        const indicator = document.createElement("div");
        indicator.className = "lr-playhead-indicator";
        playProgressBar.appendChild(indicator);
    };

    const updatePlayTooltipLoop = () => {
        const playProgressBar = document.querySelector(".vjs-play-progress");
        if (playProgressBar) {
            ensurePlayheadIndicator(playProgressBar);
        }

        if (customPlayTooltip) {
            const isDragging = playerElement?.classList.contains("vjs-scrubbing") ||
                progressControl?.classList.contains("vjs-sliding");

            if (isProgressHovered || isDragging) {
                const offset = getRecordingOffset();
                const current = player.currentTime() || 0;
                const gameTime = current + offset;

                const mins = Math.floor(gameTime / 60);
                const secs = Math.floor(gameTime % 60);
                const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

                if (customPlayTooltip.textContent !== timeStr) {
                    customPlayTooltip.textContent = timeStr;
                }
                customPlayTooltip.style.display = "block";

                if (playProgressBar && playerElement) {
                    const barRect = playProgressBar.getBoundingClientRect();
                    positionTooltipAboveSeekbar(customPlayTooltip, barRect.right);
                }
            } else {
                customPlayTooltip.style.display = "none";
            }
        }
        requestAnimationFrame(updatePlayTooltipLoop);
    };

    requestAnimationFrame(updatePlayTooltipLoop);

    if (progressControl && customTooltip) {
        progressControl.addEventListener("mousemove", (e) => {
            const offset = getRecordingOffset();
            const rect = progressControl.getBoundingClientRect();
            const mouseX = (e as MouseEvent).clientX;

            const x = mouseX - rect.left;
            const width = rect.width;
            const percent = Math.max(0, Math.min(1, x / width));
            const duration = player.duration() || 0;
            const videoTime = percent * duration;
            const gameTime = videoTime + offset;

            const mins = Math.floor(gameTime / 60);
            const secs = Math.floor(gameTime % 60);
            const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

            customTooltip.textContent = timeStr;
            customTooltip.style.display = "block";
            positionTooltipAboveSeekbar(customTooltip, mouseX);
        });

        progressControl.addEventListener("mouseleave", () => {
            customTooltip.style.display = "none";
        });
    }
}
