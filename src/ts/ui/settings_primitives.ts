export type UiCreateEl = (
    tagName: string,
    properties?: Record<string, unknown>,
    attributes?: Record<string, string>,
    content?: unknown,
) => HTMLElement;

export type SettingsTabName = "general" | "display" | "hotkeys" | "account" | "about";

export type LabeledSwitch = {
    container: HTMLDivElement;
    input: HTMLInputElement;
};

export function createSettingsGroup(
    createEl: UiCreateEl,
    label: string,
    element: HTMLElement,
    fullWidth = false,
): HTMLDivElement {
    const div = createEl("div", {}, { class: `settings-group ${fullWidth ? "full-width" : ""}` }) as HTMLDivElement;
    div.append(createEl("label", {}, {}, label));
    div.append(element);
    return div;
}

export function createLabeledSwitch(
    createEl: UiCreateEl,
    label: string,
    checked: boolean,
): LabeledSwitch {
    const input = createEl("input", {}, { type: "checkbox", ...(checked ? { checked: "true" } : {}) }) as HTMLInputElement;
    const labelEl = createEl("label", {}, { class: "switch" }, [
        input,
        createEl("span", {}, { class: "slider round" }),
    ]);
    const container = createEl("div", {}, { class: "settings-checkbox-group" }, [
        labelEl,
        createEl("span", {}, {}, label),
    ]) as HTMLDivElement;

    return { container, input };
}

export function createSettingsTabButton(
    createEl: UiCreateEl,
    label: string,
    active: boolean,
    onClick: () => void,
): HTMLButtonElement {
    return createEl(
        "button",
        {
            onclick: onClick,
        },
        { class: `tab-btn ${active ? "active" : ""}` },
        label,
    ) as HTMLButtonElement;
}

export function switchSettingsTab(
    tabName: SettingsTabName,
    tabs: Record<SettingsTabName, HTMLButtonElement>,
    contents: Record<SettingsTabName, HTMLElement>,
): void {
    tabs.general.classList.toggle("active", tabName === "general");
    tabs.display.classList.toggle("active", tabName === "display");
    tabs.hotkeys.classList.toggle("active", tabName === "hotkeys");
    tabs.account.classList.toggle("active", tabName === "account");
    tabs.about.classList.toggle("active", tabName === "about");

    contents.general.classList.toggle("hidden", tabName !== "general");
    contents.display.classList.toggle("hidden", tabName !== "display");
    contents.hotkeys.classList.toggle("hidden", tabName !== "hotkeys");
    contents.account.classList.toggle("hidden", tabName !== "account");
    contents.about.classList.toggle("hidden", tabName !== "about");
}
