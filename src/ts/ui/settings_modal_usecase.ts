import { commands, type Settings } from "../bindings";
import { invoke } from "@tauri-apps/api/core";
import { saveKeybinds, saveMouseConfig } from "../keybinds";
import type { Language } from "../i18n";
import { createSettingsTabButton, switchSettingsTab } from "./settings_primitives";
import { createSettingsAboutTabContent } from "./settings_about";
import { createSettingsHotkeysTabContent } from "./settings_hotkeys";
import { createSettingsOptionsSections } from "./settings_options";
import { createSettingsGeneralControls } from "./settings_general_controls";
import { buildSettingsPayload } from "./settings_save_payload";

export function showSettingsModalView(input: {
    settings: Settings;
    saveCallback: (s: Settings) => Promise<void>;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    modalContent: HTMLElement;
    showModal: (content: any) => void;
    hideModal: () => void;
    getText: (lang: any, key: any) => string;
    currentPatchVersion: string;
    currentBinds: any;
    reopenWithLanguage: (newLang: Language) => void;
    onShowUpdateModal: (update: any, langCode: string) => void;
    onScrollModifierChange: (modifier: string | null) => void;
    onReloadKeybinds: () => void;
    updateAutoButtons: (s: Settings) => void;
}): void {
    const {
        settings,
        saveCallback,
        createEl,
        modalContent,
        showModal,
        hideModal,
        getText,
        currentPatchVersion,
        currentBinds,
        reopenWithLanguage,
        onShowUpdateModal,
        onScrollModifierChange,
        onReloadKeybinds,
        updateAutoButtons,
    } = input;

    const lang = ((settings as any).language || "en") as Language;
    const closeSettingsModal = () => hideModal();
    const generalControls = createSettingsGeneralControls({
        createEl,
        settings,
        lang,
        getText,
        onLanguageChanged: (newLang) => {
            (settings as any).language = newLang;
            modalContent.innerHTML = "";
            reopenWithLanguage(newLang as Language);
        },
        onPickRecordingsFolder: () => invoke<string | null>("pick_recordings_folder"),
        onPickClipsFolder: () => invoke<string | null>("pick_clips_folder"),
        onClearCache: () => commands.clearCache().then(() => {}),
    });

    const generalTabContent = createEl("div", {}, { class: "settings-tab-content settings-scroll-container" });
    const generalWrapper = createEl("div", {}, { class: "settings-content-wrapper" });
    const generalGrid = createEl("div", {}, { class: "settings-grid" });
    generalWrapper.append(generalGrid);
    generalTabContent.append(generalWrapper);

    const {
        hotkeysTabContent,
        pendingBinds,
        pendingMouseConfig,
        getBackendHotkeyValues,
    } = createSettingsHotkeysTabContent({
        createEl,
        lang,
        settings,
        currentBinds,
        getText,
        onScrollModifierChange,
    });

    const settingsOptions = createSettingsOptionsSections(
        createEl,
        settings,
        lang,
        getText,
    );

    const aboutTabContent = createSettingsAboutTabContent({
        createEl,
        lang,
        settings,
        getText,
        onShowUpdateModal,
    });

    generalGrid.append(
        generalControls.groups.languageGroup,
        generalControls.groups.filenameGroup,
        generalControls.groups.recordingsFolderGroup,
        generalControls.groups.clipsFolderGroup,
        generalControls.groups.encodingQualityGroup,
        generalControls.groups.outputResolutionGroup,
        generalControls.groups.framerateGroup,
        generalControls.groups.recordAudioGroup,
        generalControls.groups.maxAgeGroup,
        generalControls.groups.maxSizeGroup,
    );
    generalGrid.append(
        settingsOptions.markerFlagsTitle,
        settingsOptions.markerFlagsContent,
        settingsOptions.gameModesTitle,
        settingsOptions.gameModesContent,
        settingsOptions.switchesTitle,
        settingsOptions.switchesContent,
        settingsOptions.scoreboardLinksTitle,
        settingsOptions.scoreboardLinksContent,
        generalControls.groups.troubleshootingGroup,
    );

    const btnGeneral = createSettingsTabButton(createEl, getText(lang, "tabGeneral"), true, () => {
        switchSettingsTab("general", { general: btnGeneral, hotkeys: btnHotkeys, about: btnAbout }, {
            general: generalTabContent,
            hotkeys: hotkeysTabContent,
            about: aboutTabContent,
        });
    });
    const btnHotkeys = createSettingsTabButton(createEl, getText(lang, "tabHotkeys"), false, () => {
        switchSettingsTab("hotkeys", { general: btnGeneral, hotkeys: btnHotkeys, about: btnAbout }, {
            general: generalTabContent,
            hotkeys: hotkeysTabContent,
            about: aboutTabContent,
        });
    });
    const btnAbout = createSettingsTabButton(createEl, getText(lang, "tabAbout" as any) || "About", false, () => {
        switchSettingsTab("about", { general: btnGeneral, hotkeys: btnHotkeys, about: btnAbout }, {
            general: generalTabContent,
            hotkeys: hotkeysTabContent,
            about: aboutTabContent,
        });
    });

    const tabsContainer = createEl("div", {}, { class: "settings-tabs" }, [btnGeneral, btnHotkeys, btnAbout]);
    const modalBody = createEl("div", {}, { style: "display: flex; flex-direction: column; overflow: hidden; flex: 1;" }, [
        tabsContainer,
        generalTabContent,
        hotkeysTabContent,
        aboutTabContent,
    ]);

    const saveBtn = createEl("button", {
        onclick: () => {
            const { highlightHotkeyValue, startRecHotkeyValue, stopRecHotkeyValue } = getBackendHotkeyValues();
            const newSettings: Settings = buildSettingsPayload({
                base: settings,
                recordingsFolder: generalControls.refs.folderInput.value,
                clipsFolder: generalControls.refs.clipsFolderInput.value,
                filenameFormat: generalControls.refs.filenameInput.value,
                matchHistoryBaseUrl: settingsOptions.refs.matchHistoryUrlInput.value,
                championWikiBaseUrl: settingsOptions.refs.championWikiUrlInput.value,
                championMatchupUrl: settingsOptions.refs.championMatchupUrlInput.value,
                championBuildUrl: settingsOptions.refs.championBuildUrlInput.value,
                encodingQuality: generalControls.refs.qualityInput.value,
                outputResolution: generalControls.refs.resSelect.value,
                framerate: generalControls.refs.frSelect.value,
                recordAudio: generalControls.refs.audioSelect.value,
                maxRecordingAgeDays: generalControls.refs.maxAgeInput.value,
                maxRecordingsSizeGb: generalControls.refs.maxSizeInput.value,
                highlightHotkeyValue,
                startRecHotkeyValue,
                stopRecHotkeyValue,
                markerSwitches: {
                    kill: settingsOptions.refs.markerSwitches.kill.input.checked,
                    death: settingsOptions.refs.markerSwitches.death.input.checked,
                    assist: settingsOptions.refs.markerSwitches.assist.input.checked,
                    structure: settingsOptions.refs.markerSwitches.structure.input.checked,
                    dragon: settingsOptions.refs.markerSwitches.dragon.input.checked,
                    voidgrub: settingsOptions.refs.markerSwitches.voidgrub.input.checked,
                    herald: settingsOptions.refs.markerSwitches.herald.input.checked,
                    baron: settingsOptions.refs.markerSwitches.baron.input.checked,
                },
                gameModeSwitches: {
                    ranked: { checked: settingsOptions.refs.gameModeSwitches.ranked.input.checked, modeId: settingsOptions.refs.gameModeSwitches.ranked.modeId },
                    normal: { checked: settingsOptions.refs.gameModeSwitches.normal.input.checked, modeId: settingsOptions.refs.gameModeSwitches.normal.modeId },
                    aram: { checked: settingsOptions.refs.gameModeSwitches.aram.input.checked, modeId: settingsOptions.refs.gameModeSwitches.aram.modeId },
                    arena: { checked: settingsOptions.refs.gameModeSwitches.arena.input.checked, modeId: settingsOptions.refs.gameModeSwitches.arena.modeId },
                    urf: { checked: settingsOptions.refs.gameModeSwitches.urf.input.checked, modeId: settingsOptions.refs.gameModeSwitches.urf.modeId },
                    practice: { checked: settingsOptions.refs.gameModeSwitches.practice.input.checked, modeId: settingsOptions.refs.gameModeSwitches.practice.modeId },
                    custom: { checked: settingsOptions.refs.gameModeSwitches.custom.input.checked, modeId: settingsOptions.refs.gameModeSwitches.custom.modeId },
                    coop: { checked: settingsOptions.refs.gameModeSwitches.coop.input.checked, modeId: settingsOptions.refs.gameModeSwitches.coop.modeId },
                    tft: { checked: settingsOptions.refs.gameModeSwitches.tft.input.checked, modeId: settingsOptions.refs.gameModeSwitches.tft.modeId },
                    swiftplay: { checked: settingsOptions.refs.gameModeSwitches.swiftplay.input.checked, modeId: settingsOptions.refs.gameModeSwitches.swiftplay.modeId },
                    other: { checked: settingsOptions.refs.gameModeSwitches.other.input.checked, modeId: settingsOptions.refs.gameModeSwitches.other.modeId },
                },
                otherSwitches: {
                    autostart: settingsOptions.refs.otherSwitches.autostart.input.checked,
                    autoplayVideo: settingsOptions.refs.otherSwitches.autoplayVideo.input.checked,
                    autoStopPlayback: settingsOptions.refs.otherSwitches.autoStopPlayback.input.checked,
                    autoSelectRecording: settingsOptions.refs.otherSwitches.autoSelectRecording.input.checked,
                    confirmDelete: settingsOptions.refs.otherSwitches.confirmDelete.input.checked,
                    developerMode: settingsOptions.refs.otherSwitches.developerMode.input.checked,
                    playRecordingSounds: settingsOptions.refs.otherSwitches.playRecordingSounds.input.checked,
                    keepVideoJsonOnAutoDelete: settingsOptions.refs.otherSwitches.keepVideoJsonOnAutoDelete.input.checked,
                    autoDeleteClips: settingsOptions.refs.otherSwitches.autoDeleteClips.input.checked,
                },
            });

            saveKeybinds(pendingBinds);
            saveMouseConfig(pendingMouseConfig);
            onReloadKeybinds();
            updateAutoButtons(newSettings);
            void saveCallback(newSettings).then(() => {
                closeSettingsModal();
                (window as any)._developerModeEnabled = newSettings.developerMode;
            });
        },
    }, { class: "btn-save" }, getText(lang, "save"));

    const cancelBtn = createEl("button", { onclick: closeSettingsModal }, { class: "btn-cancel" }, getText(lang, "cancel"));
    const actions = createEl("div", {}, { class: "settings-actions" }, [cancelBtn, saveBtn]);
    const content = createEl("div", {}, { id: "settings-modal-content" }, [
        createEl("h2", {}, { style: "text-align: center; margin-top: 5px; margin-bottom: 0px; font-size: 1.2em;" }, getText(lang, "settingsTitle")),
        createEl("div", {}, { style: "text-align: center; margin-bottom: 10px; color: #888; font-size: 0.8em;" }, `Patch ${currentPatchVersion}`),
        modalBody,
        actions,
    ]);

    modalContent.classList.add("settings-mode");
    showModal(content);
}
