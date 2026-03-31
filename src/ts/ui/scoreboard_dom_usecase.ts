export function createScoreboardShell(
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => HTMLElement,
    scoreboardScale: number | null,
): { scoreboardEl: HTMLElement; resizeHandle: HTMLElement } {
    const scoreboardEl = createEl("div", {}, { class: "scoreboard" }) as HTMLElement;
    if (scoreboardScale) {
        (scoreboardEl.style as any).zoom = scoreboardScale.toFixed(3);
    }
    const resizeHandle = createEl("div", {}, { class: "scoreboard-resize-handle" }) as HTMLElement;
    scoreboardEl.append(resizeHandle);
    return { scoreboardEl, resizeHandle };
}

export function setupScoreboardResize(input: {
    scoreboardEl: HTMLElement;
    resizeHandle: HTMLElement;
    baseHeight: number;
    setScoreboardHeight: (targetHeight: number, baseHeight: number) => void;
    saveScale: (scale: number) => void;
}): void {
    const { scoreboardEl, resizeHandle, baseHeight, setScoreboardHeight, saveScale } = input;
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e: MouseEvent) => {
        const dy = startY - e.clientY;
        const targetHeight = startHeight + dy;
        setScoreboardHeight(targetHeight, baseHeight);
    };

    const stopDrag = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", stopDrag);
        document.body.style.cursor = "";
        const finalZoom = (scoreboardEl.style as any).zoom;
        if (finalZoom) {
            saveScale(parseFloat(finalZoom));
        }
    };

    resizeHandle.addEventListener("mousedown", (e: Event) => {
        const evt = e as MouseEvent;
        evt.preventDefault();
        startY = evt.clientY;
        startHeight = scoreboardEl.getBoundingClientRect().height;
        document.body.style.cursor = "ns-resize";
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", stopDrag);
    });
}

export function mountScoreboardInPlayer(input: {
    playerEl: HTMLElement;
    scoreboardEl: HTMLElement;
    controlBarEl: HTMLElement | null;
}): void {
    const { playerEl, scoreboardEl, controlBarEl } = input;
    const oldScoreboards = playerEl.querySelectorAll(".scoreboard");
    oldScoreboards.forEach((el) => el.remove());
    if (controlBarEl) {
        playerEl.insertBefore(scoreboardEl, controlBarEl);
    } else {
        playerEl.appendChild(scoreboardEl);
    }
}

export function ensureSpectatorHeader(input: {
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => HTMLElement;
    emptyEl: (el: HTMLElement) => void;
    mainContainer: HTMLElement | null;
    playerElement: HTMLElement | null;
    existingHeader: HTMLElement | null;
}): HTMLElement | null {
    const { createEl, emptyEl, mainContainer, playerElement, existingHeader } = input;
    if (!existingHeader) {
        if (!mainContainer) return null;
        const header = createEl("div", {}, { class: "spectator-header", id: "video-header" }) as HTMLElement;
        if (playerElement) {
            mainContainer.insertBefore(header, playerElement);
        } else {
            mainContainer.appendChild(header);
        }
        return header;
    }
    emptyEl(existingHeader);
    existingHeader.className = "spectator-header";
    return existingHeader;
}

export function cleanupDuplicateScoreboardElements(playerEl: HTMLElement, spectatorHeader: HTMLElement): void {
    const oldInternalHeader = playerEl.querySelector(".spectator-header");
    if (oldInternalHeader && oldInternalHeader.id !== "video-header") oldInternalHeader.remove();
    const nestedHeader = playerEl.querySelector("#video-header");
    if (nestedHeader && nestedHeader !== spectatorHeader) nestedHeader.remove();
    // Keep current scoreboard mounted until a new one is fully built and mounted.
    // mountScoreboardInPlayer() performs the atomic swap and removes old instances.
}
