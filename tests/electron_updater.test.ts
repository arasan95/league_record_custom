import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const main = readFileSync(join(root, "electron", "main.cjs"), "utf8");
const preload = readFileSync(join(root, "electron", "preload.cjs"), "utf8");
const updateModal = readFileSync(join(root, "src", "ts", "ui", "update_modal_usecase.ts"), "utf8");

describe("Electron in-app updater", () => {
    test("uses the NSIS differential updater and installs only after download", () => {
        expect(main).toContain('require("electron-updater")');
        expect(main).toContain("autoUpdater.autoDownload = false");
        expect(main).toContain('autoUpdater.on("download-progress"');
        expect(main).toContain("await updater.downloadUpdate()");
        expect(main).toContain("updater.quitAndInstall(true, true)");
    });

    test("exposes progress without exposing Node APIs to the renderer", () => {
        expect(preload).toContain('onProgress: (cb) => onEvent("AppUpdateProgress"');
        expect(updateModal).toContain('role: "progressbar"');
        expect(updateModal).toContain("progress.bytesPerSecond");
        expect(updateModal).not.toContain('import("electron-updater")');
    });
});
