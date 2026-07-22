import { describe, expect, test } from "bun:test";
import { normalizeUiLanguage } from "../src/ts/ui_locale";

describe("UI language fallback", () => {
    test("keeps Japanese only for the Japanese app language", () => {
        expect(normalizeUiLanguage("ja")).toBe("ja");
    });

    test("uses English for every non-Japanese app language", () => {
        for (const language of ["en", "zh", "ko", "fr", "de", "unknown", ""]) {
            expect(normalizeUiLanguage(language)).toBe("en");
        }
    });
});
