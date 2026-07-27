import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("Electron development stability", () => {
    test("limits the Riot self-signed certificate exception to the LCU WebSocket", () => {
        const main = readFileSync(join(root, "electron", "main.cjs"), "utf8");
        expect(main).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
        expect(main).toContain('const LcuWebSocket = require("ws")');
        expect(main).toContain("127.0.0.1");
        expect(main).toContain("{ rejectUnauthorized: false }");
    });

    test("keeps main-process auto-restart opt-in", () => {
        const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        const runner = readFileSync(join(root, "scripts", "dev-electron.cjs"), "utf8");

        expect(packageJson.scripts["electron:dev"]).toBe("node scripts/dev-electron.cjs");
        expect(packageJson.scripts["electron:dev:watch"]).toContain("--watch-main");
        expect(runner).toContain('process.argv.includes("--watch-main")');
        expect(runner).toContain("if (watchElectronMainEnabled)");
    });

    test("does not block renderer startup on the patch-version network request", () => {
        const rendererMain = readFileSync(join(root, "src", "ts", "main.ts"), "utf8");
        expect(rendererMain).not.toContain("await initPatchVersion()");
        expect(rendererMain).toContain("startup:initPatchVersion(background)");
    });
});
