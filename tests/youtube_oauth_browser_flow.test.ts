import { afterEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dir, "..");
const {
    callbackLanguage,
    createYouTubeService,
    oauthCallbackHtml,
} = require(join(root, "electron", "youtube", "service.cjs"));
const originalClientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const originalClientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;

afterEach(() => {
    if (originalClientId === undefined) delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
    else process.env.YOUTUBE_OAUTH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
    else process.env.YOUTUBE_OAUTH_CLIENT_SECRET = originalClientSecret;
});

function serviceWithOpenedUrls(openedUrls: string[]) {
    return createYouTubeService({
        app: {
            getPath: () => root,
            getAppPath: () => root,
        },
        shell: {
            openExternal: async (url: string) => {
                openedUrls.push(url);
            },
        },
        safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (value: string) => Buffer.from(value),
            decryptString: (value: Buffer) => value.toString(),
        },
        fs: {},
        fsNode: {},
        getSettings: async () => ({}),
        getImageCacheRoots: () => [],
        isRecording: () => false,
        emit: () => {},
        log: async () => {},
    });
}

async function waitForOpenedUrl(openedUrls: string[]): Promise<void> {
    for (let attempt = 0; attempt < 100 && openedUrls.length === 0; attempt += 1) {
        await Bun.sleep(5);
    }
    expect(openedUrls).toHaveLength(1);
}

describe("YouTube OAuth browser flow", () => {
    test("uses English for the Google authorization screens by default", async () => {
        process.env.YOUTUBE_OAUTH_CLIENT_ID = "123-example.apps.googleusercontent.com";
        process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "desktop-client-credential";
        const openedUrls: string[] = [];
        const service = serviceWithOpenedUrls(openedUrls);
        const signInResult = service.signIn().catch((error: Error & { code?: string }) => error);

        await waitForOpenedUrl(openedUrls);
        const authorizationUrl = new URL(openedUrls[0]);
        expect(authorizationUrl.searchParams.get("hl")).toBe("en");

        const redirectUrl = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
        redirectUrl.searchParams.set("error", "access_denied");
        redirectUrl.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
        await fetch(redirectUrl, { headers: { "accept-language": "en-US,en;q=0.9" } });
        expect((await signInResult).code).toBe("auth_cancelled");
    });

    test("reuses the same active authorization request when sign-in is invoked again", async () => {
        process.env.YOUTUBE_OAUTH_CLIENT_ID = "123-example.apps.googleusercontent.com";
        process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "desktop-client-credential";
        const openedUrls: string[] = [];
        const service = serviceWithOpenedUrls(openedUrls);
        const signInResult = service.signIn().catch((error: Error & { code?: string }) => error);

        await waitForOpenedUrl(openedUrls);
        const repeatedSignInResult = service.signIn().catch((error: Error & { code?: string }) => error);
        expect(openedUrls).toHaveLength(2);
        expect(openedUrls[1]).toBe(openedUrls[0]);

        const authorizationUrl = new URL(openedUrls[0]);
        const redirectUrl = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
        redirectUrl.searchParams.set("error", "access_denied");
        redirectUrl.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
        await fetch(redirectUrl);
        expect((await signInResult).code).toBe("auth_cancelled");
        expect((await repeatedSignInResult).code).toBe("auth_cancelled");
    });

    test("localizes and automatically closes the callback page", () => {
        expect(callbackLanguage("en-US,en;q=0.9,ja;q=0.8")).toBe("en");
        expect(callbackLanguage("en-US;q=0.7,ja-JP;q=1")).toBe("ja");

        const japanese = oauthCallbackHtml({
            success: true,
            acceptLanguage: "ja-JP,ja;q=0.9",
        });
        expect(japanese).toContain('<html lang="ja">');
        expect(japanese).toContain("Googleアカウントを接続しました");
        expect(japanese).toContain("setTimeout(closeTab, 1200)");
        expect(japanese).toContain("ブラウザの制限により");

        const english = oauthCallbackHtml({
            success: true,
            acceptLanguage: "fr-FR,fr;q=0.9",
        });
        expect(english).toContain('<html lang="en">');
        expect(english).toContain("Google Account Connected");
        expect(english).toContain("Your browser prevented this tab");
    });
});
