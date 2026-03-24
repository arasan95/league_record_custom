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
    const laterBtn = createEl("button", { onclick: hideModal }, { class: "btn", style: "margin-right: 15px;" }, getText(lang as any, "updateLater" as any) || "Later") as HTMLButtonElement;
    const updateBtn = createEl("button", {
        onclick: async () => {
            updateBtn.disabled = true;
            laterBtn.disabled = true;
            statusMsg.innerText = getText(lang as any, "updateDownloading" as any) || "Downloading update...";
            statusMsg.style.color = "#00d2ff";
            try {
                await update.downloadAndInstall();
                statusMsg.innerText = getText(lang as any, "updateRestart" as any) || "Restarting...";
                statusMsg.style.color = "#4CAF50";
                const { relaunch } = await import("@tauri-apps/plugin-process");
                await relaunch();
            } catch (e) {
                console.error("Install update failed", e);
                const detail = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
                statusMsg.innerText = `${getText(lang as any, "updateError" as any) || "Update failed."} ${detail ?? ""}`.trim();
                statusMsg.style.color = "#ff5555";
                updateBtn.disabled = false;
                laterBtn.disabled = false;
            }
        },
    }, { class: "btn-browse", style: "border: 1px solid #c8aa6e; padding: 8px 16px; font-weight: bold; background: #222; color: #c8aa6e; cursor: pointer;" }, getText(lang as any, "updateRestart" as any) || "Update & Restart") as HTMLButtonElement;
    const btnContainer = createEl("div", {}, { style: "display: flex; justify-content: flex-end; align-items: center;" }, [laterBtn, updateBtn]);
    const wrapper = createEl("div", {}, { style: "width: 100%; max-width: 600px; margin: 0 auto; padding: 10px;" }, [title, contentBox, statusMsg, btnContainer]);
    showModal([wrapper]);
}

