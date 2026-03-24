import type { Settings } from "../bindings";
import { formatKeyCombo, keyComboToBackendString, loadMouseConfig, type ActionName, type KeyCombo, type MouseConfig } from "../keybinds";
import type { Language } from "../i18n";
import type { UiCreateEl } from "./settings_primitives";

type GetText = (lang: Language, key: any) => string;

type CreateSettingsHotkeysTabInput = {
    createEl: UiCreateEl;
    lang: Language;
    settings: Settings;
    currentBinds: Record<ActionName, KeyCombo | null>;
    getText: GetText;
    onScrollModifierChange: (modifier: string) => void;
};

type BackendHotkeyValues = {
    highlightHotkeyValue: string | null;
    startRecHotkeyValue: string | null;
    stopRecHotkeyValue: string | null;
};

export type SettingsHotkeysTabBuildResult = {
    hotkeysTabContent: HTMLDivElement;
    pendingBinds: Record<ActionName, KeyCombo | null>;
    pendingMouseConfig: MouseConfig;
    getBackendHotkeyValues: () => BackendHotkeyValues;
};

export function createSettingsHotkeysTabContent({
    createEl,
    lang,
    settings,
    currentBinds,
    getText,
    onScrollModifierChange,
}: CreateSettingsHotkeysTabInput): SettingsHotkeysTabBuildResult {
    const hotkeysTabContent = createEl("div", {}, { class: "settings-tab-content settings-scroll-container hidden" }) as HTMLDivElement;
    const hotkeysWrapper = createEl("div", {}, { class: "settings-content-wrapper" }) as HTMLDivElement;
    const hotkeysGrid = createEl("div", {}, { class: "settings-grid", style: "grid-template-columns: 1fr; gap: 8px;" }) as HTMLDivElement;
    hotkeysWrapper.append(hotkeysGrid);
    hotkeysTabContent.append(hotkeysWrapper);

    const pendingBinds = { ...currentBinds };
    const pendingMouseConfig: MouseConfig = loadMouseConfig();

    const labels: Record<ActionName, string> = {
        playPause: getText(lang, "playPause"),
        seekForward: getText(lang, "seekForward"),
        seekBackward: getText(lang, "seekBackward"),
        nextEvent: getText(lang, "nextEvent"),
        prevEvent: getText(lang, "prevEvent"),
        volUp: getText(lang, "volUp"),
        volDown: getText(lang, "volDown"),
        fullscreen: getText(lang, "fullscreen"),
        mute: getText(lang, "mute"),
        speedUp: getText(lang, "speedUp"),
        speedDown: getText(lang, "speedDown"),
        setLoopA: getText(lang, "setLoopA"),
        setLoopB: getText(lang, "setLoopB"),
        toggleLoop: getText(lang, "toggleLoop"),
        exitFullscreen: getText(lang, "exitFullscreen"),
        stepForward: getText(lang, "stepForward"),
        stepBackward: getText(lang, "stepBackward"),
        resetSpeed: getText(lang, "resetSpeed"),
        nextVideo: getText(lang, "nextVideo"),
        prevVideo: getText(lang, "prevVideo"),
    };

    const createKeybindRow = (action: ActionName): HTMLDivElement => {
        const labelText = labels[action];
        const container = createEl("div", {}, {
            style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;",
        }) as HTMLDivElement;
        const label = createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, labelText);

        let keydownHandler: ((kEvent: KeyboardEvent) => void) | null = null;
        const btn = createEl("button", {}, {
            class: "settings-input keybind-btn",
            style: "text-align: center; cursor: pointer; width: 140px; padding: 6px 10px; background-color: #202225; border: 1px solid #202225; color: #dcddde; border-radius: 3px; font-size: 0.9em;",
        }, formatKeyCombo(pendingBinds[action])) as HTMLButtonElement;

        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (btn.classList.contains("binding")) {
                if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                keydownHandler = null;
                pendingBinds[action] = null;
                btn.textContent = "None";
                btn.classList.remove("binding");
                return;
            }

            btn.textContent = "Press any key...";
            btn.classList.add("binding");
            keydownHandler = (kEvent: KeyboardEvent) => {
                kEvent.preventDefault();
                kEvent.stopPropagation();
                if (["Shift", "Control", "Alt", "Meta"].includes(kEvent.key)) return;

                const newCombo: KeyCombo = {
                    key: kEvent.key,
                    shift: kEvent.shiftKey,
                    ctrl: kEvent.ctrlKey,
                    alt: kEvent.altKey,
                    meta: kEvent.metaKey,
                };
                pendingBinds[action] = newCombo;
                btn.textContent = formatKeyCombo(newCombo);
                btn.classList.remove("binding");
                if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                keydownHandler = null;
            };
            window.addEventListener("keydown", keydownHandler, { capture: true });
        };

        container.append(label, btn);
        return container;
    };

    const bindOrder: ActionName[] = [
        "playPause", "fullscreen",
        "seekForward", "seekBackward",
        "stepForward", "stepBackward",
        "nextEvent", "prevEvent",
        "volUp", "volDown",
        "speedUp", "speedDown",
        "resetSpeed",
        "setLoopA", "setLoopB", "toggleLoop",
        "mute", "exitFullscreen",
        "nextVideo", "prevVideo",
    ];

    const createBackendHotkeyRow = (label: string, initialValue: string | null, onUpdate: (val: string | null) => void): HTMLDivElement => {
        const container = createEl("div", {}, {
            style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;",
        }) as HTMLDivElement;
        const labelEl = createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, label);
        const btn = createEl("button", {}, {
            class: "settings-input keybind-btn",
            style: "text-align: center; cursor: pointer; width: 140px; padding: 6px 10px; background-color: #202225; border: 1px solid #202225; color: #dcddde; border-radius: 3px; font-size: 0.9em;",
        }, initialValue || "None") as HTMLButtonElement;

        let keydownHandler: ((kEvent: KeyboardEvent) => void) | null = null;
        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (btn.classList.contains("binding")) {
                if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                keydownHandler = null;
                onUpdate(null);
                btn.textContent = "None";
                btn.classList.remove("binding");
                return;
            }

            btn.textContent = "Press any key...";
            btn.classList.add("binding");
            keydownHandler = (kEvent: KeyboardEvent) => {
                kEvent.preventDefault();
                kEvent.stopPropagation();
                if (["Shift", "Control", "Alt", "Meta"].includes(kEvent.key)) return;

                const newCombo: KeyCombo = {
                    key: kEvent.key,
                    shift: kEvent.shiftKey,
                    ctrl: kEvent.ctrlKey,
                    alt: kEvent.altKey,
                    meta: kEvent.metaKey,
                };
                const backendStr = keyComboToBackendString(newCombo);
                const displayStr = formatKeyCombo(newCombo);
                btn.textContent = displayStr;
                btn.classList.remove("binding");
                onUpdate(backendStr);
                if (keydownHandler) window.removeEventListener("keydown", keydownHandler, true);
                keydownHandler = null;
            };
            window.addEventListener("keydown", keydownHandler, { capture: true });
        };

        container.append(labelEl, btn);
        return container;
    };

    let highlightHotkeyValue = settings.hightlightHotkey;
    let startRecHotkeyValue = settings.startRecordingHotkey;
    let stopRecHotkeyValue = settings.stopRecordingHotkey;

    const inGameTitle = createEl("h3", {}, {
        style: "margin-top: 0; margin-bottom: 10px; color: #b9bbbe; font-size: 1em; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;",
    }, getText(lang, "inGameHotkeys"));
    const inGameContainer = createEl("div", {}, {
        class: "hotkey-section-container",
        style: "background-color: #2a2a2a; border-radius: 8px; padding: 0 20px; margin-bottom: 20px;",
    }) as HTMLDivElement;
    inGameContainer.append(
        createBackendHotkeyRow(getText(lang, "highlight"), highlightHotkeyValue, (val) => { highlightHotkeyValue = val; }),
        createBackendHotkeyRow(getText(lang, "startRecord"), startRecHotkeyValue, (val) => { startRecHotkeyValue = val; }),
        createBackendHotkeyRow(getText(lang, "stopRecord"), stopRecHotkeyValue, (val) => { stopRecHotkeyValue = val; }),
    );
    hotkeysGrid.append(inGameTitle, inGameContainer);

    const replayTitle = createEl("h3", {}, {
        style: "margin-top: 15px; margin-bottom: 8px; color: #b9bbbe; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;",
    }, getText(lang, "replayShortcuts"));
    const replayContainer = createEl("div", {}, {
        class: "hotkey-section-container",
        style: "background-color: #2a2a2a; border-radius: 8px; padding: 0 20px; margin-bottom: 20px;",
    }) as HTMLDivElement;
    bindOrder.forEach((action) => replayContainer.append(createKeybindRow(action)));
    hotkeysGrid.append(replayTitle, replayContainer);

    const mouseTitle = createEl("h3", {}, {
        style: "margin-top: 15px; margin-bottom: 8px; color: #b9bbbe; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;",
    }, getText(lang, "mouseControls"));
    const mouseContainer = createEl("div", {}, {
        class: "hotkey-section-container",
        style: "background-color: #2a2a2a; border-radius: 8px; padding: 0 20px; margin-bottom: 20px;",
    }) as HTMLDivElement;

    const createMouseSwitch = (label: string, checked: boolean, onClick: (checked: boolean) => void): HTMLDivElement => {
        const input = createEl("input", {
            onchange: (e: Event) => onClick((e.target as HTMLInputElement).checked),
        }, { type: "checkbox", ...(checked ? { checked: "true" } : {}) }) as HTMLInputElement;
        const switchEl = createEl("label", {}, { class: "switch" }, [
            input,
            createEl("span", {}, { class: "slider round" }),
        ]);
        return createEl("div", {}, {
            style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;",
        }, [
            createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, label),
            switchEl,
        ]) as HTMLDivElement;
    };

    const scrollModLabel = createEl("span", {}, { style: "font-size: 0.95em; color: #dcddde; font-weight: 500;" }, getText(lang, "scrollModifier"));
    const scrollModSelect = createEl("select", {}, {
        class: "settings-input",
        style: "width: 140px; padding: 6px; background-color: #202225; border: 1px solid #202225; color: #dcddde; border-radius: 3px;",
    }, [
        createEl("option", { value: "Shift" }, {}, "Shift"),
        createEl("option", { value: "Ctrl" }, {}, "Ctrl"),
        createEl("option", { value: "Alt" }, {}, "Alt"),
        createEl("option", { value: "None" }, {}, "None"),
    ]) as HTMLSelectElement;
    scrollModSelect.value = (settings as any).scrollFrameStepModifier || "Shift";
    scrollModSelect.onchange = () => {
        (settings as any).scrollFrameStepModifier = scrollModSelect.value;
        onScrollModifierChange(scrollModSelect.value);
    };
    const scrollModContainer = createEl("div", {}, {
        style: "display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #40444b;",
    }, [scrollModLabel, scrollModSelect]);

    mouseContainer.append(
        createMouseSwitch(getText(lang, "wheelSpeed"), pendingMouseConfig.wheelAction === "speed", (checked) => {
            pendingMouseConfig.wheelAction = checked ? "speed" : "none";
        }),
        createMouseSwitch(getText(lang, "middleReset"), pendingMouseConfig.middleClickAction === "resetSpeed", (checked) => {
            pendingMouseConfig.middleClickAction = checked ? "resetSpeed" : "none";
        }),
        createMouseSwitch(getText(lang, "sideSeek"), pendingMouseConfig.sideButtonSeek, (checked) => {
            pendingMouseConfig.sideButtonSeek = checked;
        }),
        scrollModContainer,
    );
    hotkeysGrid.append(mouseTitle, mouseContainer);

    return {
        hotkeysTabContent,
        pendingBinds,
        pendingMouseConfig,
        getBackendHotkeyValues: () => ({
            highlightHotkeyValue,
            startRecHotkeyValue,
            stopRecHotkeyValue,
        }),
    };
}
