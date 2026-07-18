import type { MarkerColors, MarkerOpacities, Settings } from "../bindings";
import type { Language } from "../i18n";
import { defaultMarkerColors, defaultMarkerOpacities, getMarkerColors, getMarkerOpacities } from "./display_preferences";
import { createLabeledSwitch, type UiCreateEl } from "./settings_primitives";

type GetText = (lang: Language, key: any) => string;

export type SettingsDisplayTabBuildResult = {
    displayTabContent: HTMLDivElement;
    getDisplayPreferences: () => { markerColors: MarkerColors; markerOpacities: MarkerOpacities; showHonorVotes: boolean };
};

export function createSettingsDisplayTabContent(input: {
    createEl: UiCreateEl;
    settings: Settings;
    lang: Language;
    getText: GetText;
}): SettingsDisplayTabBuildResult {
    const { createEl, settings, lang, getText } = input;
    const tab = createEl("div", {}, { class: "settings-tab-content settings-scroll-container hidden" }) as HTMLDivElement;
    const wrapper = createEl("div", {}, { class: "settings-content-wrapper" }) as HTMLDivElement;
    const colors = getMarkerColors(settings);
    const opacities = getMarkerOpacities(settings);
    const colorInputs = {} as Record<keyof MarkerColors, HTMLInputElement>;
    const opacityInputs = {} as Record<keyof MarkerOpacities, HTMLInputElement>;
    const labels: Array<[keyof MarkerColors, string]> = [
        ["kill", getText(lang, "kill")],
        ["death", getText(lang, "death")],
        ["assist", getText(lang, "assist")],
        ["structure", getText(lang, "structure")],
        ["dragon", getText(lang, "dragon")],
        ["voidgrub", getText(lang, "voidgrub")],
        ["herald", getText(lang, "herald")],
        ["baron", getText(lang, "baron")],
    ];

    const markerList = createEl("div", {}, { class: "settings-display-marker-list" }) as HTMLDivElement;
    const opacityValues = {} as Record<keyof MarkerOpacities, HTMLElement>;
    const updateOpacityLabel = (key: keyof MarkerOpacities) => {
        opacityValues[key].textContent = `${Math.round(Number(opacityInputs[key].value) * 100)}%`;
    };
    for (const [key, label] of labels) {
        const input = createEl("input", {}, { type: "color", value: colors[key], class: "settings-color-input" }) as HTMLInputElement;
        const opacityInput = createEl("input", {}, {
            type: "range", min: "0", max: "1", step: "0.05", value: String(opacities[key]), class: "settings-marker-opacity", title: getText(lang, "opacity"),
        }) as HTMLInputElement;
        const opacityValue = createEl("span", {}, { class: "settings-marker-opacity-value" }, `${Math.round(opacities[key] * 100)}%`);
        opacityInput.addEventListener("input", () => {
            updateOpacityLabel(key);
        });
        colorInputs[key] = input;
        opacityInputs[key] = opacityInput;
        opacityValues[key] = opacityValue;
        markerList.append(createEl("div", {}, { class: "settings-display-marker-row" }, [
            createEl("span", {}, { class: "settings-display-marker-label", title: label }, label),
            input,
            opacityInput,
            opacityValue,
        ]));
    }

    const honorSwitch = createLabeledSwitch(createEl, getText(lang, "showHonorVotes"), settings.showHonorVotes !== false);
    const resetButton = createEl("button", {
        onclick: () => {
            for (const [key] of labels) {
                colorInputs[key].value = defaultMarkerColors[key];
                opacityInputs[key].value = String(defaultMarkerOpacities[key]);
                updateOpacityLabel(key);
            }
            honorSwitch.input.checked = true;
        },
    }, { type: "button", class: "settings-display-reset" }, getText(lang, "resetDisplaySettings")) as HTMLButtonElement;
    const markerGroup = createEl("div", {}, { class: "settings-group-styled" }, [markerList]) as HTMLDivElement;
    const honorGroup = createEl("div", {}, { class: "settings-group-styled" }, [honorSwitch.container]) as HTMLDivElement;
    wrapper.classList.add("settings-display-content");
    wrapper.append(
        createEl("h3", {}, { class: "settings-section-title" }, getText(lang, "markerColors")),
        markerGroup,
        resetButton,
        createEl("h3", {}, { class: "settings-section-title" }, getText(lang, "scoreboardDisplay")),
        honorGroup,
    );
    tab.append(wrapper);

    return {
        displayTabContent: tab,
        getDisplayPreferences: () => ({
            markerColors: Object.fromEntries(labels.map(([key]) => [key, colorInputs[key].value])) as MarkerColors,
            markerOpacities: Object.fromEntries(labels.map(([key]) => [key, Number(opacityInputs[key].value)])) as MarkerOpacities,
            showHonorVotes: honorSwitch.input.checked,
        }),
    };
}
