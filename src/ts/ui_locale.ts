import { getText, type Language } from "./i18n";

export const UI_LANGUAGE_CHANGED_EVENT = "league-record-ui-language-changed";

type UiLanguage = "ja" | "en";

let currentUiLanguage: UiLanguage = typeof document !== "undefined" && document.documentElement.lang === "ja" ? "ja" : "en";

export function isJapaneseUi(): boolean {
    return currentUiLanguage === "ja";
}

export function normalizeUiLanguage(language: string): UiLanguage {
    return language === "ja" ? "ja" : "en";
}

/** @deprecated Use getText(currentUiLanguage, key) directly. Kept for gradual migration. */
export function uiText(japanese: string, english: string): string {
    return isJapaneseUi() ? japanese : english;
}

function getUiText(key: string): string {
    return getText(currentUiLanguage as Language, key as any) || key;
}

export function applyStaticUiLanguage(): void {
    document.querySelectorAll<HTMLElement>("[data-ui-text]").forEach((element) => {
        const key = element.dataset.uiText ?? "";
        if (key) element.textContent = getUiText(key);
    });
    document.querySelectorAll<HTMLElement>("[data-ui-title]").forEach((element) => {
        const key = element.dataset.uiTitle ?? "";
        if (key) element.title = getUiText(key);
    });
    document.querySelectorAll<HTMLElement>("[data-ui-aria-label]").forEach((element) => {
        const key = element.dataset.uiAriaLabel ?? "";
        if (key) element.setAttribute("aria-label", getUiText(key));
    });
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-ui-placeholder]").forEach((element) => {
        const key = element.dataset.uiPlaceholder ?? "";
        if (key) element.placeholder = getUiText(key);
    });
}

export function setUiLanguage(language: string): void {
    currentUiLanguage = normalizeUiLanguage(language);
    document.documentElement.lang = currentUiLanguage;
    applyStaticUiLanguage();
    window.dispatchEvent(new CustomEvent(UI_LANGUAGE_CHANGED_EVENT, { detail: { language: currentUiLanguage } }));
}
