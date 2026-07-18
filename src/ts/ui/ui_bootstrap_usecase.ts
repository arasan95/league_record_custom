import { commands } from "../bindings";
import type { Settings } from "../bindings";

export function bindSidebarResizeHandle(params: {
    sidebarContainer: HTMLDivElement | null;
    setSidebarWidth: (newWidth: number) => void;
}): void {
    const { sidebarContainer, setSidebarWidth } = params;
    if (!sidebarContainer) return;

    const handle = document.createElement("div");
    handle.className = "sidebar-resize-handle";
    sidebarContainer.appendChild(handle);

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
        const dx = e.clientX - startX;
        const newWidth = startWidth + dx;
        setSidebarWidth(newWidth);
    };

    const stopDrag = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", stopDrag);
        document.body.style.cursor = "";
    };

    handle.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        startX = e.clientX;
        const rect = sidebarContainer.getBoundingClientRect();
        startWidth = rect.width;
        document.body.style.cursor = "col-resize";
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", stopDrag);
    });
}

export async function loadInitialUiSettings(params: {
    setScrollFrameStepModifier: (modifier: string) => void;
    setFrameDuration: (duration: number) => void;
    setMaxStorageGb: (maxStorageGb: number) => void;
    setScoreboardScale: (scoreboardScale: number | null) => void;
    setCurrentLanguage: (language: string) => void;
    applyDisplayPreferences: (settings: Settings) => void;
}): Promise<void> {
    const {
        setScrollFrameStepModifier,
        setFrameDuration,
        setMaxStorageGb,
        setScoreboardScale,
        setCurrentLanguage,
        applyDisplayPreferences,
    } = params;

    try {
        const s = await commands.getSettings();
        if ((s as any).scrollFrameStepModifier) {
            setScrollFrameStepModifier((s as any).scrollFrameStepModifier);
        }
        if (s.framerate && Array.isArray(s.framerate) && s.framerate.length === 2 && s.framerate[0] > 0) {
            setFrameDuration(s.framerate[1] / s.framerate[0]);
        }
        if (s.maxRecordingsSizeGb) {
            setMaxStorageGb(s.maxRecordingsSizeGb);
        } else {
            setMaxStorageGb(0);
        }
        if (s.scoreboardScale) {
            setScoreboardScale(s.scoreboardScale);
        }
        if (s.language) {
            setCurrentLanguage(s.language);
        }
        applyDisplayPreferences(s);
    } catch (err) {
        console.error("Failed to load settings:", err);
    }
}
