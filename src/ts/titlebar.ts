import { getCurrentWindow } from "./platform/window";

export class TitleBar {
    private appWindow = getCurrentWindow();
    private readonly autoHideKey = "lr.titlebar.autohide";
    private autoHidePreferred = false;
    private autoHideActive = false;
    private hideTimer: number | null = null;
    private resizeRefreshTimer: number | null = null;
    private readonly revealThresholdPx = 1;
    private readonly hideThresholdPx = 48;

    constructor() {
        this.init();
    }

    private init() {
        document.addEventListener("mousemove", this.handleMouseMove, true);
        window.addEventListener("blur", () => this.cancelHideTimer());
        window.addEventListener("resize", () => this.scheduleAutoHideRefresh());
        void this.applyAutoHideMode(this.readAutoHideMode());

        document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
            this.appWindow.minimize();
        });

        document.getElementById('titlebar-maximize')?.addEventListener('click', async () => {
             const isMaximized = await this.appWindow.isMaximized();
             if (isMaximized) {
                 await this.appWindow.unmaximize();
             } else {
                 await this.appWindow.maximize();
             }
             this.scheduleAutoHideRefresh();
             window.setTimeout(() => void this.refreshAutoHideState(), 250);
        });

        document.getElementById('titlebar-close')?.addEventListener('click', () => {
            this.appWindow.close();
        });

        document.getElementById('titlebar-toggle-autohide')?.addEventListener('click', () => {
            const next = !this.autoHidePreferred;
            this.writeAutoHideMode(next);
            void this.applyAutoHideMode(next);
        });
    }

    private readAutoHideMode(): boolean {
        try {
            const value = window.localStorage.getItem(this.autoHideKey);
            return value === null ? false : value === "1";
        } catch {
            return false;
        }
    }

    private writeAutoHideMode(value: boolean): void {
        try {
            window.localStorage.setItem(this.autoHideKey, value ? "1" : "0");
        } catch {}
    }

    private cancelHideTimer(): void {
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    private scheduleAutoHideRefresh(): void {
        if (this.resizeRefreshTimer !== null) {
            window.clearTimeout(this.resizeRefreshTimer);
        }
        this.resizeRefreshTimer = window.setTimeout(() => {
            this.resizeRefreshTimer = null;
            void this.refreshAutoHideState();
        }, 80);
    }

    private setTitlebarRevealed(revealed: boolean): void {
        document.body.classList.toggle("titlebar-revealed", revealed);
    }

    private scheduleHide(): void {
        this.cancelHideTimer();
        this.hideTimer = window.setTimeout(() => {
            this.setTitlebarRevealed(false);
            this.hideTimer = null;
        }, 120);
    }

    private handleMouseMove = (event: MouseEvent): void => {
        if (!this.autoHideActive) return;

        const titlebar = document.getElementById("titlebar");
        const target = event.target as Node | null;
        const isInsideTitlebar = !!titlebar && !!target && titlebar.contains(target);

        if (event.clientY <= this.revealThresholdPx || isInsideTitlebar) {
            this.cancelHideTimer();
            this.setTitlebarRevealed(true);
            return;
        }

        if (event.clientY >= this.hideThresholdPx) {
            this.scheduleHide();
        }
    };

    private async refreshAutoHideState(): Promise<void> {
        let isMaximized = false;
        try {
            isMaximized = await this.appWindow.isMaximized();
        } catch {
            isMaximized = false;
        }
        const shouldAutoHide = this.autoHidePreferred && isMaximized;
        this.autoHideActive = shouldAutoHide;
        document.body.classList.toggle("titlebar-autohide", shouldAutoHide);
        this.cancelHideTimer();
        this.setTitlebarRevealed(shouldAutoHide);
    }

    private async applyAutoHideMode(enabled: boolean): Promise<void> {
        this.autoHidePreferred = enabled;
        const toggleButton = document.getElementById("titlebar-toggle-autohide");
        if (toggleButton) {
            toggleButton.textContent = enabled ? "Auto:On" : "Auto:Off";
            toggleButton.setAttribute("title", enabled ? "Disable titlebar auto-hide" : "Enable titlebar auto-hide");
        }
        await this.refreshAutoHideState();
    }
}
