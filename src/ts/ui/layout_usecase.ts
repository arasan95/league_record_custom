import type { WebviewWindow } from "../platform/webviewWindow";

export function applySidebarWidthLayout(sidebarContainer: HTMLDivElement | null, newWidth: number): void {
    if (!sidebarContainer) return;
    const container = document.getElementById("container");

    const maxWidth = 325;
    if (newWidth > maxWidth) newWidth = maxWidth;

    const dateLimit = 220;
    const collapseLimit = 80;

    const isCompact = newWidth < dateLimit;
    if (isCompact) {
        sidebarContainer.classList.add("sidebar-compact");
    } else {
        sidebarContainer.classList.remove("sidebar-compact");
    }

    if (newWidth < collapseLimit) {
        sidebarContainer.classList.add("sidebar-collapsed");
        if (container) container.style.setProperty("--sidebar-width", "15px");

        const info = sidebarContainer.querySelector("#sidebar-info");
        const content = sidebarContainer.querySelector("#sidebar-content");
        const replayHistory = sidebarContainer.querySelector("#youtube-replay-history");
        if (info) (info as HTMLElement).style.zoom = "1";
        if (content) {
            (content as HTMLElement).style.zoom = "1";
            (content as HTMLElement).style.removeProperty("width");
        }
        if (replayHistory) {
            (replayHistory as HTMLElement).style.zoom = "1";
            (replayHistory as HTMLElement).style.removeProperty("width");
        }
        return;
    }

    sidebarContainer.classList.remove("sidebar-collapsed");

    if (container) container.style.setProperty("--sidebar-width", `${newWidth}px`);

    // Compact mode first consumes the evenly distributed horizontal spacing.
    // Once the row reaches its practical content width, scale it uniformly so
    // the right side remains visible without changing the aspect ratio.
    const compactScaleStartWidth = 160;
    const compactMinScale = collapseLimit / compactScaleStartWidth;
    const scale = isCompact
        ? Math.max(compactMinScale, Math.min(1, newWidth / compactScaleStartWidth))
        : Math.max(0.4, Math.min(1.2, newWidth / maxWidth));

    const info = sidebarContainer.querySelector("#sidebar-info");
    const sbcontent = sidebarContainer.querySelector("#sidebar-content");
    const replayHistory = sidebarContainer.querySelector("#youtube-replay-history");
    if (info) (info as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
    if (sbcontent) {
        const content = sbcontent as HTMLElement;
        content.style.setProperty("zoom", scale.toFixed(3));
        // Let the grid determine the list width. Counter-scaling this element
        // pushes compact entries beyond the sidebar's visible right edge.
        content.style.removeProperty("width");
    }
    if (replayHistory) {
        const history = replayHistory as HTMLElement;
        history.style.setProperty("zoom", scale.toFixed(3));
        history.style.removeProperty("width");
    }
}

export function applyWindowSizeLayout(params: {
    windowWidth: number;
    windowHeight: number;
    scoreboardScale: number | null;
    setSidebarWidth: (newWidth: number) => void;
    setScoreboardHeight: (targetHeight: number, baseHeight: number) => void;
}): void {
    const { windowWidth, windowHeight, scoreboardScale, setSidebarWidth, setScoreboardHeight } = params;

    const compactWindowMin = 800;
    const compactWindowMax = 1200;
    const compactSidebarMin = 80;
    const compactSidebarMax = 219;

    if (windowWidth < compactWindowMin) {
        setSidebarWidth(79);
    } else if (windowWidth < compactWindowMax) {
        const progress = (windowWidth - compactWindowMin) / (compactWindowMax - compactWindowMin);
        setSidebarWidth(compactSidebarMin + (compactSidebarMax - compactSidebarMin) * progress);
    } else {
        setSidebarWidth(325);
    }

    const sbBase = 220;
    const scaleStartH = 850;
    const scaleEndH = 600;

    if (scoreboardScale !== null && scoreboardScale > 0) {
        setScoreboardHeight(scoreboardScale * sbBase, sbBase);
        return;
    }

    if (windowHeight <= scaleEndH) {
        setScoreboardHeight(90, sbBase);
    } else if (windowHeight >= scaleStartH) {
        setScoreboardHeight(sbBase, sbBase);
    } else {
        const minVisible = 90;
        const maxVisible = sbBase;

        const ratio = (windowHeight - scaleEndH) / (scaleStartH - scaleEndH);
        const targetH = minVisible + (maxVisible - minVisible) * ratio;

        setScoreboardHeight(targetH, sbBase);
    }
}

export async function updateStorageInfoDisplay(params: {
    storageInfoEl: HTMLElement | null;
    appWindow: WebviewWindow | null;
    currentHeight: number;
    maxHeight: number;
}): Promise<void> {
    const { storageInfoEl, appWindow, currentHeight, maxHeight } = params;
    if (!storageInfoEl) return;

    if (appWindow) {
        try {
            const isMaximized = await appWindow.isMaximized();
            if (isMaximized) {
                storageInfoEl.style.display = "";
                return;
            }
        } catch {
        }
    }

    const hideThreshold = maxHeight * 0.7;
    const shouldHide = currentHeight <= hideThreshold;

    storageInfoEl.style.display = shouldHide ? "none" : "";
}
