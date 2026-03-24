import type { Settings } from "../bindings";
import type { Language } from "../i18n";
import { createLabeledSwitch, type LabeledSwitch, type UiCreateEl } from "./settings_primitives";

type GetText = (lang: Language, key: any) => string;

type ModeSwitch = {
    container: HTMLDivElement;
    input: HTMLInputElement;
    modeId: string;
};

type MarkerSwitchMap = {
    kill: LabeledSwitch;
    death: LabeledSwitch;
    assist: LabeledSwitch;
    structure: LabeledSwitch;
    dragon: LabeledSwitch;
    voidgrub: LabeledSwitch;
    herald: LabeledSwitch;
    baron: LabeledSwitch;
};

type GameModeSwitchMap = {
    ranked: ModeSwitch;
    normal: ModeSwitch;
    aram: ModeSwitch;
    arena: ModeSwitch;
    urf: ModeSwitch;
    practice: ModeSwitch;
    custom: ModeSwitch;
    coop: ModeSwitch;
    tft: ModeSwitch;
    swiftplay: ModeSwitch;
    other: ModeSwitch;
};

type OtherSwitchMap = {
    autostart: LabeledSwitch;
    autoplayVideo: LabeledSwitch;
    autoStopPlayback: LabeledSwitch;
    autoSelectRecording: LabeledSwitch;
    confirmDelete: LabeledSwitch;
    developerMode: LabeledSwitch;
    playRecordingSounds: LabeledSwitch;
    keepVideoJsonOnAutoDelete: LabeledSwitch;
    autoDeleteClips: LabeledSwitch;
};

export type SettingsOptionsSections = {
    markerFlagsTitle: HTMLHeadingElement;
    markerFlagsContent: HTMLDivElement;
    gameModesTitle: HTMLHeadingElement;
    gameModesContent: HTMLDivElement;
    switchesTitle: HTMLHeadingElement;
    switchesContent: HTMLDivElement;
    scoreboardLinksTitle: HTMLHeadingElement;
    scoreboardLinksContent: HTMLDivElement;
    refs: {
        markerSwitches: MarkerSwitchMap;
        gameModeSwitches: GameModeSwitchMap;
        otherSwitches: OtherSwitchMap;
        matchHistoryUrlInput: HTMLInputElement;
        championWikiUrlInput: HTMLInputElement;
        championMatchupUrlInput: HTMLInputElement;
        championBuildUrlInput: HTMLInputElement;
    };
};

export function createSettingsOptionsSections(
    createEl: UiCreateEl,
    settings: Settings,
    lang: Language,
    getText: GetText,
): SettingsOptionsSections {
    const createMarkerSwitch = (label: string, checked: boolean): LabeledSwitch =>
        createLabeledSwitch(createEl, label, checked);

    const flags = settings.markerFlags;
    const markerSwitches: MarkerSwitchMap = {
        kill: createMarkerSwitch(getText(lang, "kill"), flags.kill),
        death: createMarkerSwitch(getText(lang, "death"), flags.death),
        assist: createMarkerSwitch(getText(lang, "assist"), flags.assist),
        structure: createMarkerSwitch(getText(lang, "structure"), flags.structure),
        dragon: createMarkerSwitch(getText(lang, "dragon"), flags.dragon),
        voidgrub: createMarkerSwitch(getText(lang, "voidgrub"), flags.voidgrub),
        herald: createMarkerSwitch(getText(lang, "herald"), flags.herald),
        baron: createMarkerSwitch(getText(lang, "baron"), flags.baron),
    };

    const markerFlagsTitle = createEl("h3", {}, { class: "settings-section-title" }, getText(lang, "markerFlags")) as HTMLHeadingElement;
    const markerFlagsContent = createEl("div", {}, {
        class: "settings-group-styled",
        style: "grid-column: 1 / -1;",
    }, [
        createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(4, 1fr); gap: 10px;" }, [
            markerSwitches.kill.container,
            markerSwitches.death.container,
            markerSwitches.assist.container,
            markerSwitches.structure.container,
            markerSwitches.dragon.container,
            markerSwitches.voidgrub.container,
            markerSwitches.herald.container,
            markerSwitches.baron.container,
        ]),
    ]) as HTMLDivElement;

    const allModeIds = ["RANKED", "NORMAL", "ARAM", "CHERRY", "URF", "PRACTICE_TOOL", "CUSTOM", "COOP_VS_AI", "TFT", "SWIFTPLAY", "OTHER"];
    const currentModes = settings.gameModes || allModeIds;
    const createModeSwitch = (label: string, modeId: string): ModeSwitch => {
        const checked = currentModes.includes(modeId);
        const input = createEl("input", {}, { type: "checkbox", ...(checked ? { checked: "true" } : {}) }) as HTMLInputElement;
        const labelEl = createEl("label", {}, { class: "switch" }, [
            input,
            createEl("span", {}, { class: "slider round" }),
        ]);
        return {
            container: createEl("div", {}, { class: "settings-checkbox-group" }, [
                labelEl,
                createEl("span", {}, {}, label),
            ]) as HTMLDivElement,
            input,
            modeId,
        };
    };

    const gameModeSwitches: GameModeSwitchMap = {
        ranked: createModeSwitch(getText(lang, "ranked"), "RANKED"),
        normal: createModeSwitch(getText(lang, "normal"), "NORMAL"),
        aram: createModeSwitch(getText(lang, "aram"), "ARAM"),
        arena: createModeSwitch(getText(lang, "arena"), "CHERRY"),
        urf: createModeSwitch(getText(lang, "urf"), "URF"),
        practice: createModeSwitch(getText(lang, "practice"), "PRACTICE_TOOL"),
        custom: createModeSwitch(getText(lang, "custom"), "CUSTOM"),
        coop: createModeSwitch(getText(lang, "coop"), "COOP_VS_AI"),
        tft: createModeSwitch(getText(lang, "tft"), "TFT"),
        swiftplay: createModeSwitch(getText(lang, "swiftplay"), "SWIFTPLAY"),
        other: createModeSwitch(getText(lang, "other"), "OTHER"),
    };

    const gameModesTitle = createEl("h3", {}, { class: "settings-section-title" }, getText(lang, "gameModes")) as HTMLHeadingElement;
    const gameModesContent = createEl("div", {}, {
        class: "settings-group-styled",
        style: "grid-column: 1 / -1;",
    }, [
        createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: repeat(2, 1fr); gap: 10px;" }, [
            gameModeSwitches.ranked.container,
            gameModeSwitches.normal.container,
            gameModeSwitches.aram.container,
            gameModeSwitches.arena.container,
            gameModeSwitches.urf.container,
            gameModeSwitches.practice.container,
            gameModeSwitches.custom.container,
            gameModeSwitches.coop.container,
            gameModeSwitches.tft.container,
            gameModeSwitches.swiftplay.container,
            gameModeSwitches.other.container,
        ]),
    ]) as HTMLDivElement;

    const otherSwitches: OtherSwitchMap = {
        autostart: createLabeledSwitch(createEl, getText(lang, "autostart"), settings.autostart),
        autoplayVideo: createLabeledSwitch(createEl, getText(lang, "autoplay"), settings.autoplayVideo),
        autoStopPlayback: createLabeledSwitch(createEl, getText(lang, "autoStop"), settings.autoStopPlayback),
        autoSelectRecording: createLabeledSwitch(createEl, getText(lang, "autoSelect"), settings.autoSelectRecording),
        confirmDelete: createLabeledSwitch(createEl, getText(lang, "confirmDel"), settings.confirmDelete),
        developerMode: createLabeledSwitch(createEl, getText(lang, "devMode"), settings.developerMode),
        playRecordingSounds: createLabeledSwitch(createEl, getText(lang, "playSounds"), settings.playRecordingSounds ?? false),
        keepVideoJsonOnAutoDelete: createLabeledSwitch(createEl, getText(lang, "keepVideoJsonOnAutoDelete"), settings.keepVideoJsonOnAutoDelete ?? false),
        autoDeleteClips: createLabeledSwitch(createEl, getText(lang, "autoDeleteClips" as any), (settings as any).autoDeleteClips ?? false),
    };

    const matchHistoryUrlInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        placeholder: "e.g. https://www.deeplol.gg/summoner/jp/{q}",
        value: settings.matchHistoryBaseUrl || "",
        style: "flex: 1;",
    }) as HTMLInputElement;

    const switchesTitle = createEl("h3", {}, { class: "settings-section-title" }, getText(lang, "otherOptions")) as HTMLHeadingElement;
    const switchesContent = createEl("div", {}, {
        class: "settings-group-styled",
        style: "grid-column: 1 / -1;",
    }, [
        createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: 1fr; gap: 10px;" }, [
            otherSwitches.autostart.container,
            otherSwitches.autoplayVideo.container,
            otherSwitches.autoStopPlayback.container,
            otherSwitches.autoSelectRecording.container,
            otherSwitches.confirmDelete.container,
            otherSwitches.developerMode.container,
            otherSwitches.playRecordingSounds.container,
            otherSwitches.keepVideoJsonOnAutoDelete.container,
            otherSwitches.autoDeleteClips.container,
        ]),
    ]) as HTMLDivElement;

    const scoreboardLinksTitle = createEl("h3", {}, { class: "settings-section-title" }, getText(lang, "scoreboardLinks")) as HTMLHeadingElement;
    const scoreboardLinksHint = createEl("div", {}, {
        class: "settings-group-styled",
        style: "grid-column: 1 / -1; font-size: 0.85em; color: #aaa; margin-bottom: 15px; padding: 10px; background: rgba(50,50,50,0.5); border: 1px dashed #666;",
    }, getText(lang, "scoreboardLinksHint" as any) || "Tags: {id}=LeeSin, {name}=Lee Sin, {name_}=Lee_Sin, {nameEsc}=Lee%20Sin");

    const trackingUrlContainer = createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none;" }, [
        createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "trackingUrl")),
        createEl("div", {}, { style: "font-size: 0.8em; color: #aaa; margin-bottom: 5px;" }, getText(lang, "trackingUrlExample")),
        createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "trackingUrlHint")),
        matchHistoryUrlInput,
    ]) as HTMLDivElement;

    const championWikiUrlInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        placeholder: "e.g. https://wiki.leagueoflegends.com/en-us/{name_}",
        value: settings.championWikiBaseUrl || "https://wiki.leagueoflegends.com/en-us/{name_}",
        style: "flex: 1;",
    }) as HTMLInputElement;
    const championWikiUrlContainer = createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none; margin-top: 10px;" }, [
        createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "championWikiUrl")),
        createEl("div", {}, { style: "font-size: 0.8em; color: #aaa; margin-bottom: 5px;" }, getText(lang, "championWikiUrlExample")),
        createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "championWikiUrlHint")),
        championWikiUrlInput,
    ]) as HTMLDivElement;

    const championMatchupUrlInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        placeholder: "e.g. https://dpm.lol/champions/{My}/matchups?opponent={Opponent}",
        value: settings.championMatchupUrl || "",
        style: "flex: 1;",
    }) as HTMLInputElement;
    const championMatchupUrlContainer = createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none; margin-top: 10px;" }, [
        createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "championMatchupUrl")),
        createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "championMatchupUrlHint")),
        championMatchupUrlInput,
    ]) as HTMLDivElement;

    const championBuildUrlInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        placeholder: "e.g. https://dpm.lol/champions/{q}/build",
        value: settings.championBuildUrl || "",
        style: "flex: 1;",
    }) as HTMLInputElement;
    const championBuildUrlContainer = createEl("div", {}, { class: "settings-group full-width", style: "border: none; padding: 0; background: none; margin-top: 10px;" }, [
        createEl("label", {}, { style: "display:block; margin-bottom: 5px; color: #ddd; font-weight: bold;" }, getText(lang, "championBuildUrl")),
        createEl("div", {}, { style: "font-size: 0.8em; color: #00d2ff; margin-bottom: 5px;" }, getText(lang, "championBuildUrlHint")),
        championBuildUrlInput,
    ]) as HTMLDivElement;

    const scoreboardLinksContent = createEl("div", {}, {
        class: "settings-group-styled",
        style: "grid-column: 1 / -1;",
    }, [
        scoreboardLinksHint,
        createEl("div", {}, { style: "display: flex; flex-direction: column; gap: 5px;" }, [
            trackingUrlContainer,
            championWikiUrlContainer,
            championMatchupUrlContainer,
            championBuildUrlContainer,
        ]),
    ]) as HTMLDivElement;

    return {
        markerFlagsTitle,
        markerFlagsContent,
        gameModesTitle,
        gameModesContent,
        switchesTitle,
        switchesContent,
        scoreboardLinksTitle,
        scoreboardLinksContent,
        refs: {
            markerSwitches,
            gameModeSwitches,
            otherSwitches,
            matchHistoryUrlInput,
            championWikiUrlInput,
            championMatchupUrlInput,
            championBuildUrlInput,
        },
    };
}
