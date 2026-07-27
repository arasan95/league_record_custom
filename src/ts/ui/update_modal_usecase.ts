import { getBridge } from "../platform/bridge";

function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0 MB";
    return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function showUpdateModalView(input: {
    update: any;
    lang: string;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    getText: (lang: any, key: any) => string;
    hideModal: () => void;
    showModal: (content: any) => void;
    modalContent: HTMLElement;
}): void {
    const { update, lang, createEl, getText, hideModal, showModal, modalContent } = input;
    modalContent.classList.remove("settings-mode");

    const title = createEl(
        "h2",
        {},
        { style: "color: #e8d154; margin-top: 0; margin-bottom: 15px;" },
        `${getText(lang as any, "updateAvailable" as any)} (v${update.version})`,
    );
    const contentBox = createEl(
        "div",
        {},
        {
            style:
                "background: rgba(0,0,0,0.3); border: 1px solid #444; border-radius: 4px; padding: 15px; max-height: 400px; overflow-y: auto; text-align: left; font-size: 0.9em; white-space: pre-wrap; line-height: 1.5; color: #ddd; margin-bottom: 20px;",
        },
        update.body || "No release notes provided.",
    );
    const statusMsg = createEl("div", {}, { style: "color: #aaa; margin-bottom: 15px; min-height: 20px;" }, "") as HTMLElement;
    const progressTrack = createEl(
        "div",
        {},
        {
            role: "progressbar",
            "aria-label": "Update download progress",
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": "0",
            style: "height: 8px; overflow: hidden; border-radius: 999px; background: #30343b; margin: 0 0 10px;",
        },
    ) as HTMLElement;
    const progressBar = createEl(
        "div",
        {},
        { style: "width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #c8aa6e, #f0d98a); transition: width 160ms ease;" },
    ) as HTMLElement;
    progressTrack.append(progressBar);
    progressTrack.hidden = true;
    const laterBtn = createEl("button", { onclick: hideModal }, { class: "btn", style: "margin-right: 15px;" }, getText(lang as any, "updateLater" as any) || "Later") as HTMLButtonElement;
    const updateBtn = createEl("button", {
        onclick: async () => {
            updateBtn.disabled = true;
            laterBtn.disabled = true;
            statusMsg.innerText = getText(lang as any, "updateDownloading" as any) || "Downloading update...";
            statusMsg.style.color = "#00d2ff";
            progressTrack.hidden = false;
            const bridge = getBridge();
            const stopProgress = await bridge?.updater.onProgress((progress) => {
                const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
                progressBar.style.width = `${percent.toFixed(1)}%`;
                progressTrack.setAttribute("aria-valuenow", percent.toFixed(0));
                statusMsg.innerText = `${getText(lang as any, "updateDownloading" as any) || "Downloading update..."} ${percent.toFixed(0)}% · ${formatBytes(progress.transferred)} / ${formatBytes(progress.total)} · ${formatBytes(progress.bytesPerSecond)}/s`;
            });
            try {
                await update.downloadAndInstall();
                progressBar.style.width = "100%";
                statusMsg.innerText = getText(lang as any, "updateRestart" as any) || "Installing and restarting...";
                statusMsg.style.color = "#4CAF50";
            } catch (e) {
                console.error("Install update failed", e);
                const detail = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
                statusMsg.innerText = `${getText(lang as any, "updateError" as any) || "Update failed."} ${detail ?? ""}`.trim();
                statusMsg.style.color = "#ff5555";
                progressTrack.hidden = true;
                updateBtn.disabled = false;
                laterBtn.disabled = false;
            } finally {
                stopProgress?.();
            }
        },
    }, { class: "btn-browse", style: "border: 1px solid #c8aa6e; padding: 8px 16px; font-weight: bold; background: #222; color: #c8aa6e; cursor: pointer;" }, getText(lang as any, "updateRestart" as any) || "Update & Restart") as HTMLButtonElement;
    const btnContainer = createEl("div", {}, { style: "display: flex; justify-content: flex-end; align-items: center;" }, [laterBtn, updateBtn]);
    const wrapper = createEl("div", {}, { style: "width: 100%; max-width: 600px; margin: 0 auto; padding: 10px;" }, [title, contentBox, progressTrack, statusMsg, btnContainer]);
    showModal([wrapper]);
}
