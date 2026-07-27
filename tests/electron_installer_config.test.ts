import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const installerScript = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");

describe("Electron installer update modes", () => {
    test("uses the custom assisted-installer page", () => {
        expect(packageJson.build.nsis.oneClick).toBe(false);
        expect(packageJson.build.nsis.include).toBe("build/installer.nsh");
        expect(installerScript).toContain('StrCpy $lrTextUpdateTitle "アップデート（推奨）"');
        expect(installerScript).toContain('StrCpy $lrTextUpdateTitle "Update (recommended)"');
        expect(installerScript).toContain('StrCpy $lrTextReinstallTitle "再インストール"');
        expect(installerScript).toContain('StrCpy $lrTextReinstallTitle "Reinstall"');
        expect(packageJson.build.nsis.perMachine).toBe(false);
        expect(packageJson.build.nsis.installerLanguages).toEqual(["en_US", "ja_JP"]);
        expect(packageJson.build.nsis.displayLanguageSelector).toBe(false);
        expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(false);
        expect(installerScript).toContain('StrCpy $isForceCurrentInstall "1"');
        expect(installerScript).toContain('ReadRegStr $lrExistingUserInstallDir HKCU');
        expect(installerScript).toContain('ReadRegStr $lrLegacyMachineInstallDir HKLM');
        expect(installerScript).toContain('${NSD_CreateLabel} 0 -16u 100% 12u');
        expect(installerScript).not.toContain('${If} ${isUpdated}\n    StrCpy $lrHasExistingInstall "1"');
    });

    test("keeps heavy runtime assets outside the always-extracted app package", () => {
        const extraResources = packageJson.build.extraResources as Array<{ from: string }>;
        expect(extraResources.some((entry) => entry.from.includes("target/libobs"))).toBe(false);
        expect(extraResources.some((entry) => entry.from.includes("tooltip_data.db"))).toBe(false);
        expect(installerScript).toContain('$INSTDIR\\resources\\libobs\\*.*');
        expect(installerScript).toContain("Keeping the existing recording runtime.");
        expect(installerScript).toContain("Keeping the existing tooltip database.");
        expect(installerScript).toContain("File /r \"${PROJECT_DIR}\\src-tauri\\target\\libobs\\*.*\"");
    });

    test("checks only the real app executable before installation", () => {
        expect(installerScript).toContain("!macro customCheckAppRunning");
        expect(installerScript).toContain('${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}"');
        expect(installerScript).not.toContain("Get-CimInstance");
        expect(installerScript).not.toContain("StartsWith('$INSTDIR'");
    });

    test("does not invoke the broken legacy uninstaller during an upgrade", () => {
        expect(installerScript).toContain("Call lrPrepareExistingInstall");
        expect(installerScript).toContain('DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"');
        expect(installerScript).toContain('RMDir /r "$lrExistingUserInstallDir"');
    });

    test("shows branded installation progress and supports differential app updates", () => {
        expect(installerScript).toContain("SetDetailsView show");
        expect(installerScript).toContain('DetailPrint "$lrTextInstallApp"');
        expect(installerScript).toContain("Function lrInstFilesShow");
        expect(installerScript).toContain("LR_PBM_SETMARQUEE");
        expect(installerScript).toContain('FindWindow $lrProgressBar "msctls_progress32"');
        expect(installerScript).toContain('DetailPrint "$lrTextFinalize"');
        expect(installerScript).not.toContain("CreateWindowExW");
        expect(installerScript).toContain("MUI_HEADERIMAGE_BITMAP_STRETCH AspectFitHeight");
        expect(installerScript).toContain("MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight");
        expect(packageJson.build.nsis.installerSidebar).toBe("build/installerSidebar.bmp");
        expect(packageJson.build.nsis.installerHeader).toBe("build/installerHeader.bmp");
        expect(packageJson.build.nsis.differentialPackage).toBe(true);
        expect(packageJson.dependencies["electron-updater"]).toBeTruthy();
        expect(packageJson.build.publish[0]).toMatchObject({
            provider: "github",
            owner: "arasan95",
            repo: "League_Record_custom",
        });
    });

    test("packs application JavaScript into asar for faster startup", () => {
        expect(packageJson.build.asar).toBe(true);
    });

    test("packages the generated OAuth client module without legacy plaintext credential files", () => {
        const extraResources = packageJson.build.extraResources as Array<{ from: string; to: string }>;
        expect(packageJson.build.files).toContain("electron/**/*");
        expect(extraResources.some((entry) => entry.to.includes("youtube/client-id.txt"))).toBe(false);
        expect(extraResources.some((entry) => entry.to.includes("youtube/client-secret.txt"))).toBe(false);
    });

    test("packages every local asset required by the YouTube thumbnail generator", () => {
        expect(packageJson.build.files).toContain("src/assets/ranked-emblem/**/*");
        expect(packageJson.build.files).toContain("src/assets/icon/LoL.png");
        expect(packageJson.build.files).toContain("src/css/BeaufortW01-Bold.ttf");
        expect(packageJson.build.files).toContain("node_modules/ws/**/*");
    });
});
