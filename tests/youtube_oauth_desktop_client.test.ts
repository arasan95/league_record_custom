import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dir, "..");
const config = require(join(root, "electron", "youtube", "config.cjs"));
const buildConfig = require(join(root, "scripts", "youtube-client-id.cjs"));
const originalClientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const originalClientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;

afterEach(() => {
  if (originalClientId === undefined) delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
  else process.env.YOUTUBE_OAUTH_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  else process.env.YOUTUBE_OAUTH_CLIENT_SECRET = originalClientSecret;
});

describe("YouTube desktop OAuth client", () => {
  test("validates the Google desktop OAuth credential fields", () => {
    expect(config.isValidYouTubeClientId("123-example.apps.googleusercontent.com")).toBe(true);
    expect(config.isValidYouTubeClientId("not-a-google-client-id")).toBe(false);
    expect(config.isValidYouTubeClientSecret("desktop-client-credential")).toBe(true);
    expect(config.isValidYouTubeClientSecret("secret with spaces")).toBe(false);
  });

  test("loads source-build credentials from the environment", () => {
    process.env.YOUTUBE_OAUTH_CLIENT_ID = "123-example.apps.googleusercontent.com";
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "desktop-client-credential";
    expect(config.getYouTubeOAuthConfig()).toEqual({
      clientId: "123-example.apps.googleusercontent.com",
      clientSecret: "desktop-client-credential",
    });
  });

  test("keeps local and generated credential inputs out of Git", () => {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain("electron/youtube/local-client-id.txt");
    expect(gitignore).toContain("electron/youtube/local-client-secret.txt");
    expect(gitignore).toContain(".build-input/");
  });

  test("generates both package inputs without committing their values", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "league-record-youtube-oauth-"));
    try {
      const clientId = "123-official.apps.googleusercontent.com";
      const clientSecret = "desktop-client-credential";
      const output = buildConfig.prepareYouTubeClientId(temporaryRoot, {
        YOUTUBE_OAUTH_CLIENT_ID: clientId,
        YOUTUBE_OAUTH_CLIENT_SECRET: clientSecret,
      });
      expect(readFileSync(output.clientIdPath, "utf8")).toBe(`${clientId}\n`);
      expect(readFileSync(output.clientSecretPath, "utf8")).toBe(`${clientSecret}\n`);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("rejects packaging without the desktop client credential", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "league-record-youtube-oauth-"));
    try {
      expect(() => buildConfig.prepareYouTubeClientId(temporaryRoot, {
        YOUTUBE_OAUTH_CLIENT_ID: "123-official.apps.googleusercontent.com",
      })).toThrow("client secret is required");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("contains no committed Google client secret value", () => {
    const checkedFiles = [
      "electron/youtube/config.cjs",
      "electron/youtube/service.cjs",
      "scripts/youtube-client-id.cjs",
      "package.json",
    ];
    for (const relativePath of checkedFiles) {
      expect(readFileSync(join(root, relativePath), "utf8")).not.toMatch(/GOCSPX-[A-Za-z0-9_-]+/);
    }
  });
});
