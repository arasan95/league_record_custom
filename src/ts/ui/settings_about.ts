import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { check } from "@tauri-apps/plugin-updater";

import type { Settings } from "../bindings";
import type { Language } from "../i18n";
import type { UiCreateEl } from "./settings_primitives";

type GetText = (lang: Language, key: any) => string;

type CreateSettingsAboutTabInput = {
    createEl: UiCreateEl;
    lang: Language;
    settings: Settings;
    getText: GetText;
    onShowUpdateModal: (update: any, lang: string) => void;
};

export function createSettingsAboutTabContent({
    createEl,
    lang,
    settings,
    getText,
    onShowUpdateModal,
}: CreateSettingsAboutTabInput): HTMLDivElement {
    const aboutTabContent = createEl("div", {}, { class: "settings-tab-content scrollable hidden" }) as HTMLDivElement;
    const aboutWrapper = createEl(
        "div",
        {},
        { class: "settings-group-styled", style: "display: flex; flex-direction: column; gap: 10px; text-align: center; padding: 20px;" },
    ) as HTMLDivElement;

    const appVersionLine = createEl("div", {}, { style: "font-size: 1.1em; color: #eee; margin-bottom: 5px;" }) as HTMLDivElement;
    getVersion()
        .then((ver) => {
            appVersionLine.innerText = `${getText(lang, "appVersion" as any)}: v${ver}`;
        })
        .catch((err) => {
            console.error("getVersion failed:", err);
            appVersionLine.innerText = `${getText(lang, "appVersion" as any)}: Unknown`;
        });

    const repoLine = createEl(
        "div",
        {},
        { style: "margin-bottom: 20px; display: flex; flex-direction: column; gap: 10px; align-items: center;" },
    ) as HTMLDivElement;
    const repoLink = createEl(
        "a",
        { onclick: () => open("https://github.com/arasan95/League_Record_custom") },
        { style: "color: #00d2ff; cursor: pointer; text-decoration: underline;" },
        "GitHub Repository",
    );
    const reportBugBtn = createEl(
        "button",
        { onclick: () => open("https://docs.google.com/forms/d/e/1FAIpQLScM3I0di-DeqQACBhGfrewibuos2xl-pTNv4XoYhK3R0p3ziA/viewform") },
        { class: "btn-browse", style: "border: 1px solid #c8aa6e; color: #c8aa6e; background: #222; max-width: 300px;" },
        getText(lang as any, "reportBug" as any) || "Report Bug / Feature Request",
    );
    repoLine.append(repoLink, reportBugBtn);

    const updateStatusMsg = createEl(
        "div",
        {},
        { style: "font-size: 0.9em; color: #aaa; margin: 10px 0; min-height: 20px;" },
    ) as HTMLDivElement;
    const updateActionsContainer = createEl(
        "div",
        {},
        { style: "display: flex; justify-content: center; gap: 10px;" },
    ) as HTMLDivElement;

    const checkUpdateBtn = createEl(
        "button",
        {
            onclick: async () => {
                checkUpdateBtn.disabled = true;
                updateStatusMsg.innerText = "Checking...";
                updateStatusMsg.style.color = "#aaa";
                try {
                    const update = await check();
                    if (update) {
                        updateStatusMsg.innerText = "";
                        checkUpdateBtn.disabled = false;
                        onShowUpdateModal(update, lang);
                    } else {
                        updateStatusMsg.innerText = getText(lang as any, "updateLatest" as any) || "You are on the latest version.";
                        updateStatusMsg.style.color = "#4CAF50";
                        checkUpdateBtn.disabled = false;
                    }
                } catch (e) {
                    console.error("Update check failed", e);
                    updateStatusMsg.innerText = getText(lang as any, "updateError" as any) || "Failed to check for updates.";
                    updateStatusMsg.style.color = "#ff5555";
                    checkUpdateBtn.disabled = false;
                }
            },
        },
        { class: "btn-browse" },
        getText(lang as any, "checkForUpdates" as any) || "Check for updates",
    ) as HTMLButtonElement;
    updateActionsContainer.append(checkUpdateBtn);

    const updateOnStartupCheckbox = createEl(
        "input",
        {
            type: "checkbox",
            checked: settings.checkUpdatesOnStartup,
            onchange: (e: Event) => {
                settings.checkUpdatesOnStartup = (e.target as HTMLInputElement).checked;
            },
        },
        { style: "margin-right: 5px; vertical-align: middle;" },
    ) as HTMLInputElement;
    const updateOnStartupContainer = createEl(
        "label",
        {},
        { style: "margin-top: 15px; font-size: 0.9em; color: #ccc; cursor: pointer; display: inline-flex; justify-content: center; align-items: center;" },
        [
            updateOnStartupCheckbox,
            createEl("span", {}, {}, getText(lang, "checkUpdatesOnStartup" as any)),
        ],
    ) as HTMLLabelElement;

    aboutWrapper.append(appVersionLine, repoLine, updateActionsContainer, updateStatusMsg, updateOnStartupContainer);
    aboutTabContent.appendChild(aboutWrapper);
    return aboutTabContent;
}
