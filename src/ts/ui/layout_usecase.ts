import type { WebviewWindow } from "../platform/webviewWindow";

export function applySidebarWidthLayout(sidebarContainer: HTMLDivElement | null, newWidth: number): void {
    if (!sidebarContainer) return;
    const container = document.getElementById("container");

    const maxWidth = 325;
    if (newWidth > maxWidth) newWidth = maxWidth;

    const dateLimit = 220;
    const collapseLimit = 80;

    if (newWidth < dateLimit) {
        sidebarContainer.classList.add("sidebar-compact");
    } else {
        sidebarContainer.classList.remove("sidebar-compact");
    }

    if (newWidth < collapseLimit) {
        sidebarContainer.classList.add("sidebar-collapsed");
        if (container) container.style.setProperty("--sidebar-width", "15px");

        const info = sidebarContainer.querySelector("#sidebar-info");
        const content = sidebarContainer.querySelector("#sidebar-content");
        if (info) (info as HTMLElement).style.zoom = "1";
        if (content) (content as HTMLElement).style.zoom = "1";
        return;
    }

    sidebarContainer.classList.remove("sidebar-collapsed");

    if (container) container.style.setProperty("--sidebar-width", `${newWidth}px`);

    let targetBase = maxWidth;
    if (newWidth < dateLimit) targetBase = 220;

    let scale = newWidth / targetBase;
    scale = Math.max(scale, 0.4);
    scale = Math.min(scale, 1.2);

    const info = sidebarContainer.querySelector("#sidebar-info");
    const sbcontent = sidebarContainer.querySelector("#sidebar-content");
    if (info) (info as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
    if (sbcontent) (sbcontent as HTMLElement).style.setProperty("zoom", scale.toFixed(3));
}

export function applyWindowSizeLayout(params: {
    windowWidth: number;
    windowHeight: number;
    scoreboardScale: number | null;
    setSidebarWidth: (newWidth: number) => void;
    setScoreboardHeight: (targetHeight: number, baseHeight: number) => void;
}): void {
    const { windowWidth, windowHeight, scoreboardScale, setSidebarWidth, setScoreboardHeight } = params;

    if (windowWidth < 800) {
        setSidebarWidth(79);
    } else if (windowWidth < 1200) {
        setSidebarWidth(219);
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
