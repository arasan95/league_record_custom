import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("generates an obfuscated public-client module without plaintext credential files", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "league-record-youtube-oauth-"));
    try {
      const clientId = "123-official.apps.googleusercontent.com";
      const clientSecret = "desktop-client-credential";
      const output = buildConfig.prepareYouTubeClientId(temporaryRoot, {
        YOUTUBE_OAUTH_CLIENT_ID: clientId,
        YOUTUBE_OAUTH_CLIENT_SECRET: clientSecret,
      });
      const generated = readFileSync(output.generatedModulePath, "utf8");
      expect(generated).not.toContain(clientId);
      expect(generated).not.toContain(clientSecret);
      expect(generated).toContain("publicClient: true");
      const decoded = require(output.generatedModulePath);
      expect(decoded).toEqual({
        clientId,
        clientSecret,
        publicClient: true,
      });
      expect(existsSync(join(temporaryRoot, ".build-input", "youtube-client-id.txt"))).toBe(false);
      expect(existsSync(join(temporaryRoot, ".build-input", "youtube-client-secret.txt"))).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("removes legacy plaintext build inputs during packaging preparation", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "league-record-youtube-oauth-"));
    try {
      const buildInput = join(temporaryRoot, ".build-input");
      mkdirSync(buildInput, { recursive: true });
      writeFileSync(join(buildInput, "youtube-client-id.txt"), "legacy-id");
      writeFileSync(join(buildInput, "youtube-client-secret.txt"), "legacy-secret");
      buildConfig.prepareYouTubeClientId(temporaryRoot, {
        YOUTUBE_OAUTH_CLIENT_ID: "123-official.apps.googleusercontent.com",
        YOUTUBE_OAUTH_CLIENT_SECRET: "desktop-client-credential",
      });
      expect(existsSync(join(buildInput, "youtube-client-id.txt"))).toBe(false);
      expect(existsSync(join(buildInput, "youtube-client-secret.txt"))).toBe(false);
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

  test("keeps the generated official module out of source control", () => {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain("electron/youtube/official-client.generated.cjs");
  });
});
