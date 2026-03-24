export function clearVideoMetadataView(params: {
    emptyEl: (el: HTMLElement) => void;
}): void {
    const { emptyEl } = params;
    const playerEl = document.getElementById("video_player");
    if (playerEl) {
        const oldScoreboard = playerEl.querySelector(".scoreboard");
        if (oldScoreboard) oldScoreboard.remove();

        const spectatorHeader = document.getElementById("video-header");
        if (spectatorHeader) emptyEl(spectatorHeader as HTMLElement);
    }
}
