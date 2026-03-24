import type { Settings } from "../bindings";
import type { Language } from "../i18n";
import type { UiCreateEl } from "./settings_primitives";

type GetText = (lang: Language, key: any) => string;

type CreateSettingsGeneralControlsInput = {
    createEl: UiCreateEl;
    settings: Settings;
    lang: Language;
    getText: GetText;
    onLanguageChanged: (newLang: string) => void;
    onPickRecordingsFolder: () => Promise<string | null>;
    onPickClipsFolder: () => Promise<string | null>;
    onClearCache: () => Promise<void>;
};

export type SettingsGeneralControlsResult = {
    groups: {
        languageGroup: HTMLDivElement;
        filenameGroup: HTMLDivElement;
        recordingsFolderGroup: HTMLDivElement;
        clipsFolderGroup: HTMLDivElement;
        encodingQualityGroup: HTMLDivElement;
        outputResolutionGroup: HTMLDivElement;
        framerateGroup: HTMLDivElement;
        recordAudioGroup: HTMLDivElement;
        maxAgeGroup: HTMLDivElement;
        maxSizeGroup: HTMLDivElement;
        troubleshootingGroup: HTMLDivElement;
    };
    refs: {
        langSelect: HTMLSelectElement;
        folderInput: HTMLInputElement;
        clipsFolderInput: HTMLInputElement;
        filenameInput: HTMLInputElement;
        qualityInput: HTMLInputElement;
        resSelect: HTMLSelectElement;
        frSelect: HTMLSelectElement;
        audioSelect: HTMLSelectElement;
        maxAgeInput: HTMLInputElement;
        maxSizeInput: HTMLInputElement;
    };
};

function createGroup(createEl: UiCreateEl, label: string, element: HTMLElement, fullWidth = false): HTMLDivElement {
    const div = createEl("div", {}, { class: `settings-group ${fullWidth ? "full-width" : ""}` }) as HTMLDivElement;
    div.append(createEl("label", {}, {}, label));
    div.append(element);
    return div;
}

export function createSettingsGeneralControls({
    createEl,
    settings,
    lang,
    getText,
    onLanguageChanged,
    onPickRecordingsFolder,
    onPickClipsFolder,
    onClearCache,
}: CreateSettingsGeneralControlsInput): SettingsGeneralControlsResult {
    const langSelect = createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
    const languages = [
        { value: "en", label: "English" },
        { value: "ja", label: "Japanese" },
        { value: "zh", label: "Chinese" },
        { value: "ko", label: "Korean" },
        { value: "vi", label: "Vietnamese" },
        { value: "pt", label: "Portuguese" },
        { value: "es", label: "Spanish" },
        { value: "fr", label: "French" },
        { value: "de", label: "Deutsch" },
        { value: "ru", label: "Russian" },
        { value: "tr", label: "Turkish" },
        { value: "pl", label: "Polski" },
        { value: "it", label: "Italiano" },
    ];
    languages.forEach((l) => {
        const opt = createEl("option", {}, { value: l.value }, l.label) as HTMLOptionElement;
        if (l.value === lang) opt.selected = true;
        langSelect.append(opt);
    });
    langSelect.onchange = () => onLanguageChanged(langSelect.value);

    const folderInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        value: settings.recordingsFolder,
        style: "flex: 1;",
    }) as HTMLInputElement;
    const browseBtn = createEl("button", {
        onclick: () => {
            onPickRecordingsFolder()
                .then((path) => {
                    if (path) folderInput.value = path;
                })
                .catch((err) => console.error("Failed to pick folder:", err));
        },
    }, { class: "btn-browse" }, getText(lang, "browse"));
    const folderContainer = createEl("div", {}, { style: "display: flex; align-items: center; width: 100%;" }, [
        folderInput,
        browseBtn,
    ]) as HTMLDivElement;

    const clipsFolderInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        value: settings.clipsFolder || "",
        style: "flex: 1;",
    }) as HTMLInputElement;
    const clipsBrowseBtn = createEl("button", {
        onclick: () => {
            onPickClipsFolder()
                .then((path) => {
                    if (path) clipsFolderInput.value = path;
                })
                .catch((err) => console.error("Failed to pick clips folder:", err));
        },
    }, { class: "btn-browse" }, getText(lang, "browse"));
    const clipsFolderContainer = createEl("div", {}, { style: "display: flex; align-items: center; width: 100%;" }, [
        clipsFolderInput,
        clipsBrowseBtn,
    ]) as HTMLDivElement;

    const filenameInput = createEl("input", {}, {
        class: "settings-input",
        type: "text",
        value: settings.filenameFormat,
        style: "width: 100%; box-sizing: border-box;",
    }) as HTMLInputElement;

    const qualityInput = createEl("input", {}, {
        class: "slider-input",
        type: "range",
        min: "0",
        max: "50",
        value: settings.encodingQuality.toString(),
        width: "100%",
    }) as HTMLInputElement;
    const qualityLabel = createEl("span", {}, { style: "margin-left: 10px;" }, settings.encodingQuality.toString()) as HTMLSpanElement;
    qualityInput.oninput = () => {
        qualityLabel.textContent = qualityInput.value;
    };
    const qualityContainer = createEl("div", {}, { style: "display: flex; align-items: center;" }, [
        qualityInput,
        qualityLabel,
    ]) as HTMLDivElement;

    const resolutions = [
        { label: "Auto (Window)", value: "" },
        { label: "720p", value: "1280x720p" },
        { label: "1080p", value: "1920x1080p" },
        { label: "1440p", value: "2560x1440p" },
        { label: "2160p (4K)", value: "3840x2160p" },
        { label: "2560x1080 (21:9)", value: "2560x1080p" },
        { label: "3440x1440 (21:9)", value: "3440x1440p" },
        { label: "2880p (5K)", value: "5120x2880p" },
    ];
    const resSelect = createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
    resolutions.forEach((res) => {
        const opt = createEl("option", {}, { value: res.value }, res.label) as HTMLOptionElement;
        if (settings.outputResolution === res.value || (settings.outputResolution === null && res.value === "")) {
            opt.selected = true;
        }
        resSelect.append(opt);
    });

    const frSelect = createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
    const framerates = [[30, 1], [60, 1], [120, 1], [144, 1], [240, 1]];
    let frFound = false;
    framerates.forEach((fr) => {
        const val = `${fr[0]}/${fr[1]}`;
        const opt = createEl("option", {}, { value: val }, `${fr[0]} fps`) as HTMLOptionElement;
        if (settings.framerate[0] === fr[0] && settings.framerate[1] === fr[1]) {
            opt.selected = true;
            frFound = true;
        }
        frSelect.append(opt);
    });
    if (!frFound) {
        const val = `${settings.framerate[0]}/${settings.framerate[1]}`;
        const opt = createEl("option", {}, { value: val, selected: "true" }, `${settings.framerate[0]}/${settings.framerate[1]} fps`);
        frSelect.append(opt);
    }

    const audioSelect = createEl("select", {}, { class: "settings-select" }) as HTMLSelectElement;
    ["NONE", "APPLICATION", "SYSTEM", "ALL"].forEach((a) => {
        const opt = createEl("option", {}, { value: a }, a) as HTMLOptionElement;
        if (a === settings.recordAudio) opt.selected = true;
        audioSelect.append(opt);
    });

    const maxAgeInput = createEl("input", {}, {
        class: "settings-input",
        type: "number",
        min: "0",
        placeholder: "Unlimited",
        value: settings.maxRecordingAgeDays === null ? "" : settings.maxRecordingAgeDays.toString(),
    }) as HTMLInputElement;
    const maxSizeInput = createEl("input", {}, {
        class: "settings-input",
        type: "number",
        min: "0",
        placeholder: "Unlimited",
        value: settings.maxRecordingsSizeGb === null ? "" : settings.maxRecordingsSizeGb.toString(),
    }) as HTMLInputElement;

    const clearCacheBtn = createEl("button", {
        onclick: async () => {
            if (confirm("Clear image and item cache? This will re-download assets on next use.")) {
                try {
                    await onClearCache();
                    alert("Cache cleared successfully.");
                } catch (e) {
                    alert("Failed to clear cache: " + e);
                }
            }
        },
    }, { class: "btn-browse btn-danger" }, getText(lang, "clearCache"));

    return {
        groups: {
            languageGroup: createGroup(createEl, getText(lang, "language"), langSelect),
            filenameGroup: createGroup(createEl, getText(lang, "filenameFormat"), filenameInput),
            recordingsFolderGroup: createGroup(createEl, getText(lang, "recordingsFolder"), folderContainer, true),
            clipsFolderGroup: createGroup(createEl, getText(lang, "clipsFolder"), clipsFolderContainer, true),
            encodingQualityGroup: createGroup(createEl, getText(lang, "encodingQuality"), qualityContainer),
            outputResolutionGroup: createGroup(createEl, getText(lang, "outputResolution"), resSelect),
            framerateGroup: createGroup(createEl, getText(lang, "framerate"), frSelect),
            recordAudioGroup: createGroup(createEl, getText(lang, "recordAudio"), audioSelect),
            maxAgeGroup: createGroup(createEl, getText(lang, "maxAge"), maxAgeInput),
            maxSizeGroup: createGroup(createEl, getText(lang, "maxSize"), maxSizeInput),
            troubleshootingGroup: createGroup(createEl, "Troubleshooting", clearCacheBtn as HTMLElement, true),
        },
        refs: {
            langSelect,
            folderInput,
            clipsFolderInput,
            filenameInput,
            qualityInput,
            resSelect,
            frSelect,
            audioSelect,
            maxAgeInput,
            maxSizeInput,
        },
    };
}
