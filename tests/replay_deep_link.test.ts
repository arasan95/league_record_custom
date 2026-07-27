import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReplayDeepLink, buildReplayShareLink, parseReplayDeepLink } from "../src/ts/replay_deep_link";

const VIDEO_ID = "GaT-zOXjjzw";
const INVITE = "0123456789abcdef".repeat(3);
const root = join(import.meta.dir, "..");

describe("replay app links", () => {
    test("builds and parses a one-use replay invitation link", () => {
        const url = buildReplayDeepLink(VIDEO_ID, INVITE.toUpperCase());
        expect(url).toBe(`leaguerecord://replay?v=${VIDEO_ID}&invite=${INVITE}`);
        expect(parseReplayDeepLink(url)).toEqual({ youtubeVideoId: VIDEO_ID, inviteCode: INVITE });
    });

    test("builds an HTTPS link that Discord can recognize", () => {
        expect(buildReplayShareLink(VIDEO_ID, INVITE)).toBe(
            `https://leaguerecord.web.app/replay/?v=${VIDEO_ID}&invite=${INVITE}`,
        );
    });

    test("rejects malformed, incomplete, and parameter-injected links", () => {
        expect(() => parseReplayDeepLink(`https://replay?v=${VIDEO_ID}&invite=${INVITE}`)).toThrow();
        expect(() => parseReplayDeepLink(`leaguerecord://replay?v=${VIDEO_ID}`)).toThrow();
        expect(() => parseReplayDeepLink(`leaguerecord://replay?v=${VIDEO_ID}&invite=${INVITE}&next=https://evil.example`)).toThrow();
        expect(() => parseReplayDeepLink(`leaguerecord://other?v=${VIDEO_ID}&invite=${INVITE}`)).toThrow();
    });

    test("does not let local playback overwrite a shared replay transition", () => {
        const main = readFileSync(join(root, "src", "ts", "main.ts"), "utf8");
        expect(main).toContain("replayDeepLinkTransitionActive = true");
        expect(main).toContain("if (replayDeepLinkTransitionActive)");
        expect(main).toContain("!replayDeepLinkTransitionActive && !remotePlaybackActive");
    });

    test("keeps the browser page visible when the app protocol is unavailable", () => {
        const page = readFileSync(join(root, "site", "replay", "index.html"), "utf8");
        expect(page).not.toContain("location.href = appUrl");
        expect(page).toContain("launcher.src = appUrl.toString()");
        expect(page).toContain('id="homepage-fallback"');
        expect(page).toContain('href="/">ホームページを表示');
    });

    test("uses the built app when a development protocol link cold-starts Electron", () => {
        const electronMain = readFileSync(join(root, "electron", "main.cjs"), "utf8");
        expect(electronMain).toContain('const useDevServer = process.env.LR_ELECTRON_DEV === "1"');
        expect(electronMain).toContain('path.basename(process.execPath).toLowerCase() === "leaguerecorddev.exe"');
        expect(electronMain).toContain("isDev ? sourceRoot : app.getAppPath()");
        expect(electronMain).toContain("if (useDevServer)");
        expect(electronMain).toContain('appFile("dist", "index.html")');
        expect(electronMain).toContain('preload: appFile("electron", "preload.cjs")');
    });

    test("keeps accepting protocol links after embedded YouTube navigation", () => {
        const electronMain = readFileSync(join(root, "electron", "main.cjs"), "utf8");
        const rendererMain = readFileSync(join(root, "src", "ts", "main.ts"), "utf8");
        expect(electronMain).toContain("const pendingReplayDeepLinks = []");
        expect(electronMain).toContain("if (isMainFrame) deepLinkRendererReady = false");
        expect(electronMain).not.toContain('win.webContents.on("did-start-loading"');
        expect(rendererMain).toContain("for (const value of pending) enqueueReplayDeepLink(value)");
    });
});
