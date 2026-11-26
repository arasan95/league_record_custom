import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { APP_TEXT, getText } from "./i18n";

const settingsDirectory = join(import.meta.dir, "ui");
const files = readdirSync(settingsDirectory).filter(
    name => /^settings_.*\.ts$/.test(name) || name === "update_modal_usecase.ts",
);
const keys = new Set<string>();
for (const file of files) {
    const source = readFileSync(join(settingsDirectory, file), "utf8");
    for (const [, key] of source.matchAll(/\bgetText\(lang, "(\w+)"/g)) {
        keys.add(key);
    }
}

test("every settings label is available without falling back to English", () => {
    for (const key of ["settingOn", "settingOff"]) keys.add(key);
    expect(keys.has("closeToTray")).toBe(true);
    const missing: string[] = [];
    for (const [lang, strings] of Object.entries(APP_TEXT)) {
        for (const key of keys) {
            if (!(strings as Record<string, string>)[key]?.trim()) missing.push(`${lang}:${key}`);
        }
    }
    expect(missing).toEqual([]);
});

test("audio translations keep the track number and application name placeholders", () => {
    for (const lang of Object.keys(APP_TEXT) as (keyof typeof APP_TEXT)[]) {
        expect(getText(lang, "audioTrack")).toContain("{number}");
        expect(getText(lang, "audioNotRunning")).toContain("{app}");
    }
});
