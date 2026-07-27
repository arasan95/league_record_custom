import { commands, type Settings } from "../bindings";
import { invoke } from "../platform/core";
import { saveKeybinds, saveMouseConfig } from "../keybinds";
import type { Language } from "../i18n";
import { createSettingsTabButton, switchSettingsTab } from "./settings_primitives";
import { createSettingsAboutTabContent } from "./settings_about";
import { createSettingsHotkeysTabContent } from "./settings_hotkeys";
import { createSettingsDisplayTabContent } from "./settings_display";
import { createSettingsOptionsSections } from "./settings_options";
import { createSettingsGeneralControls } from "./settings_general_controls";
import { buildSettingsPayload } from "./settings_save_payload";
import { createSettingsAccountTabContent } from "./settings_account";

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
    applyDisplayPreferences: (s: Settings) => void;
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
        applyDisplayPreferences,
    } = input;

    const selectedLanguage = ((settings as any).language || "en") as Language;
    const lang = (selectedLanguage === "ja" ? "ja" : "en") as Language;
    const localizedGetText = (_language: any, key: any): string => getText(lang, key);
    const closeSettingsModal = () => hideModal();
    const generalControls = createSettingsGeneralControls({
        createEl,
        settings,
        lang: selectedLanguage,
        getText: localizedGetText,
        onLanguageChanged: (newLang) => {
            (settings as any).language = newLang;
            modalContent.innerHTML = "";
            reopenWithLanguage(newLang as Language);
        },
        onPickRecordingsFolder: () => invoke<string | null>("pick_recordings_folder"),
        onPickClipsFolder: () => invoke<string | null>("pick_clips_folder"),
        onClearCache: () => commands.clearCache().then(() => {}),
        onLoadRunningApplications: () => commands.getRunningApplications(),
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
        getText: localizedGetText,
        onScrollModifierChange,
    });

    const { displayTabContent, getDisplayPreferences } = createSettingsDisplayTabContent({
        createEl,
        settings,
        lang,
        getText: localizedGetText,
    });

    const settingsOptions = createSettingsOptionsSections(
        createEl,
        settings,
        lang,
        localizedGetText,
    );
    displayTabContent.querySelector<HTMLElement>(".settings-content-wrapper")?.prepend(
        settingsOptions.markerFlagsTitle,
        settingsOptions.markerFlagsContent,
    );
    const scoreboardLinksTabContent = createEl("div", {}, { class: "settings-tab-content settings-scroll-container hidden" });
    const scoreboardLinksWrapper = createEl("div", {}, { class: "settings-content-wrapper" });
    const scoreboardLinksGrid = createEl("div", {}, { class: "settings-grid" });
    scoreboardLinksGrid.append(
        settingsOptions.scoreboardLinksTitle,
        settingsOptions.scoreboardLinksContent,
    );
    scoreboardLinksWrapper.append(scoreboardLinksGrid);
    scoreboardLinksTabContent.append(scoreboardLinksWrapper);

    const aboutTabContent = createSettingsAboutTabContent({
        createEl,
        lang,
        settings,
        getText: localizedGetText,
        onShowUpdateModal,
    });
    const accountTabContent = createSettingsAccountTabContent({ createEl, lang });

    generalGrid.append(
        generalControls.groups.languageGroup,
        generalControls.groups.filenameGroup,
        generalControls.groups.recordingsFolderGroup,
        generalControls.groups.clipsFolderGroup,
        generalControls.groups.encodingQualityGroup,
        generalControls.groups.outputResolutionGroup,
        generalControls.groups.framerateGroup,
        generalControls.groups.recordAudioGroup,
        generalControls.groups.applicationAudioTracksGroup,
        generalControls.groups.maxAgeGroup,
        generalControls.groups.maxSizeGroup,
    );
    generalGrid.append(
        settingsOptions.gameModesTitle,
        settingsOptions.gameModesContent,
        settingsOptions.switchesTitle,
        settingsOptions.switchesContent,
        generalControls.groups.troubleshootingGroup,
    );

    const tabContents = {
        general: generalTabContent,
        display: displayTabContent,
        scoreboardLinks: scoreboardLinksTabContent,
        hotkeys: hotkeysTabContent,
        account: accountTabContent,
        about: aboutTabContent,
    };
    let tabButtons: Parameters<typeof switchSettingsTab>[1];
    const activateTab = (tabName: Parameters<typeof switchSettingsTab>[0]) => {
        switchSettingsTab(tabName, tabButtons, tabContents);
    };
    const btnGeneral = createSettingsTabButton(createEl, getText(lang, "tabGeneral"), true, () => activateTab("general"));
    const btnDisplay = createSettingsTabButton(createEl, getText(lang, "tabDisplay"), false, () => activateTab("display"));
    const btnScoreboardLinks = createSettingsTabButton(createEl, getText(lang, "scoreboardLinks"), false, () => activateTab("scoreboardLinks"));
    const btnHotkeys = createSettingsTabButton(createEl, getText(lang, "tabHotkeys"), false, () => activateTab("hotkeys"));
    const btnAccount = createSettingsTabButton(createEl, lang === "ja" ? "アカウント" : "Account", false, () => activateTab("account"));
    const btnAbout = createSettingsTabButton(createEl, getText(lang, "tabAbout" as any) || "About", false, () => activateTab("about"));
    tabButtons = {
        general: btnGeneral,
        display: btnDisplay,
        scoreboardLinks: btnScoreboardLinks,
        hotkeys: btnHotkeys,
        account: btnAccount,
        about: btnAbout,
    };

    const tabsHeading = createEl("div", {}, { class: "settings-tabs-heading" }, getText(lang, "settingsTitle"));
    const tabsContainer = createEl("div", {}, { class: "settings-tabs" }, [tabsHeading, btnGeneral, btnDisplay, btnScoreboardLinks, btnHotkeys, btnAccount, btnAbout]);
    const panelsContainer = createEl("div", {}, { class: "settings-panels" }, [
        generalTabContent,
        displayTabContent,
        scoreboardLinksTabContent,
        hotkeysTabContent,
        accountTabContent,
        aboutTabContent,
    ]);
    const modalBody = createEl("div", {}, { class: "settings-modal-body" }, [
        panelsContainer,
    ]);

    const saveBtn = createEl("button", {
        onclick: () => {
            const { highlightHotkeyValue, startRecHotkeyValue, stopRecHotkeyValue } = getBackendHotkeyValues();
            const newSettings: Settings = buildSettingsPayload({
                base: settings,
                language: generalControls.refs.langSelect.value,
                recordingsFolder: generalControls.refs.folderInput.value,
                clipsFolder: generalControls.refs.clipsFolderInput.value,
                filenameFormat: generalControls.refs.filenameInput.value,
                matchHistoryBaseUrl: settingsOptions.refs.matchHistoryUrlInput.value,
                matchHistorySubUrl: settingsOptions.refs.matchHistorySubUrlInput.value,
                championWikiBaseUrl: settingsOptions.refs.championWikiUrlInput.value,
                championWikiSubUrl: settingsOptions.refs.championWikiSubUrlInput.value,
                championMatchupUrl: settingsOptions.refs.championMatchupUrlInput.value,
                championMatchupSubUrl: settingsOptions.refs.championMatchupSubUrlInput.value,
                championBuildUrl: settingsOptions.refs.championBuildUrlInput.value,
                championBuildSubUrl: settingsOptions.refs.championBuildSubUrlInput.value,
                encodingQuality: generalControls.refs.qualityInput.value,
                outputResolution: generalControls.refs.resSelect.value,
                framerate: generalControls.refs.frSelect.value,
                recordAudio: generalControls.refs.audioSelect.value,
                applicationAudioTracks: generalControls.refs.appAudioTrackControls.map((control) => ({
                    application: control.appSelect.value.trim() || null,
                    enabled: control.enabledToggle.dataset.enabled === "1",
                    volumePercent: Math.max(0, Math.min(100, parseInt(control.volumeInput.value || "100", 10) || 0)),
                })),
                tftRoundOcrEnabled: false,
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
                displayPreferences: getDisplayPreferences(),
            });

            saveKeybinds(pendingBinds);
            saveMouseConfig(pendingMouseConfig);
            onReloadKeybinds();
            updateAutoButtons(newSettings);
            applyDisplayPreferences(newSettings);
            closeSettingsModal();
            void saveCallback(newSettings)
                .then(() => {
                    (window as any)._developerModeEnabled = newSettings.developerMode;
                })
                .catch((error) => {
                    console.error("Failed to save settings:", error);
                });
        },
    }, { class: "btn-save" }, getText(lang, "save"));

    const cancelBtn = createEl("button", { onclick: closeSettingsModal }, { class: "btn-cancel" }, getText(lang, "cancel"));
    const actions = createEl("div", {}, { class: "settings-actions" }, [cancelBtn, saveBtn]);
    const header = createEl("div", {}, { class: "settings-header" }, [
        createEl("h2", {}, { style: "text-align: center; margin-top: 5px; margin-bottom: 0px; font-size: 1.2em;" }, getText(lang, "settingsTitle")),
        createEl("div", {}, { style: "text-align: center; margin-bottom: 10px; color: #888; font-size: 0.8em;" }, `Patch ${currentPatchVersion}`),
    ]);
    const content = createEl("div", {}, { id: "settings-modal-content" }, [
        header,
        modalBody,
        actions,
    ]);
    const layout = createEl("div", {}, { class: "settings-modal-layout" }, [
        tabsContainer,
        content,
    ]);

    modalContent.classList.add("settings-mode");
    showModal(layout);
}
