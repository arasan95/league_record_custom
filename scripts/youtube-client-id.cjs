const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function isValidYouTubeClientId(value) {
  const clientId = String(value || "").trim();
  return clientId.length <= 512
    && !/[\s\0]/.test(clientId)
    && clientId.endsWith(".apps.googleusercontent.com");
}

function isValidYouTubeClientSecret(value) {
  const secret = String(value || "").trim();
  return secret.length > 0 && secret.length <= 1024 && !/[\s\0]/.test(secret);
}

function encodeForGeneratedModule(value, key) {
  return Array.from(Buffer.from(value, "utf8"), (byte, index) => byte ^ key[index % key.length]);
}

function renderGeneratedModule(clientId, clientSecret) {
  // This is deliberate obfuscation, not encryption. A desktop public-client
  // credential remains extractable by a determined user. Avoiding plaintext
  // files only makes casual bulk harvesting less convenient.
  const key = randomBytes(32);
  const encodedClientId = encodeForGeneratedModule(clientId, key);
  const encodedClientSecret = encodeForGeneratedModule(clientSecret, key);
  return [
    "\"use strict\";",
    "// Generated during official packaging. Do not commit this file.",
    "// The embedded Desktop OAuth credential is a public-client identifier, not a confidential security boundary.",
    `const key = Uint8Array.from(${JSON.stringify(Array.from(key))});`,
    "function reveal(encoded) {",
    "  const bytes = Uint8Array.from(encoded, (byte, index) => byte ^ key[index % key.length]);",
    "  return Buffer.from(bytes).toString(\"utf8\");",
    "}",
    "module.exports = Object.freeze({",
    `  clientId: reveal(${JSON.stringify(encodedClientId)}),`,
    `  clientSecret: reveal(${JSON.stringify(encodedClientSecret)}),`,
    "  publicClient: true,",
    "});",
    "",
  ].join("\n");
}

function renderDisabledModule() {
  return [
    "\"use strict\";",
    "// Generated for a local build without YouTube OAuth credentials.",
    "module.exports = Object.freeze({",
    "  clientId: \"\",",
    "  clientSecret: \"\",",
    "  publicClient: false,",
    "  disabled: true,",
    "});",
    "",
  ].join("\n");
}

function prepareYouTubeClientId(root, env = process.env) {
  const localPath = path.join(root, "electron", "youtube", "local-client-id.txt");
  const localSecretPath = path.join(root, "electron", "youtube", "local-client-secret.txt");
  const buildInputDir = path.join(root, ".build-input");
  const generatedModulePath = path.join(root, "electron", "youtube", "official-client.generated.cjs");
  const fromEnv = String(env.YOUTUBE_OAUTH_CLIENT_ID || "").trim();
  let clientId = fromEnv;
  const secretFromEnv = String(env.YOUTUBE_OAUTH_CLIENT_SECRET || "").trim();
  let clientSecret = secretFromEnv;

  if (!clientId && fs.existsSync(localPath)) {
    clientId = fs.readFileSync(localPath, "utf8").trim();
  }
  if (!clientSecret && fs.existsSync(localSecretPath)) {
    clientSecret = fs.readFileSync(localSecretPath, "utf8").trim();
  }
  const hasClientId = isValidYouTubeClientId(clientId);
  const hasClientSecret = isValidYouTubeClientSecret(clientSecret);
  if (hasClientId !== hasClientSecret) {
    throw new Error(
      "Both YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET are required when enabling YouTube uploads.",
    );
  }

  fs.mkdirSync(buildInputDir, { recursive: true });
  fs.mkdirSync(path.dirname(generatedModulePath), { recursive: true });
  // Remove legacy plaintext build inputs so they cannot be picked up by a
  // future packaging configuration or left behind in CI artifacts.
  fs.rmSync(path.join(buildInputDir, "youtube-client-id.txt"), { force: true });
  fs.rmSync(path.join(buildInputDir, "youtube-client-secret.txt"), { force: true });
  fs.rmSync(path.join(buildInputDir, "youtube-official-client.cjs"), { force: true });
  fs.rmSync(path.join(buildInputDir, "official-client.generated.cjs"), { force: true });
  fs.writeFileSync(
    generatedModulePath,
    hasClientId ? renderGeneratedModule(clientId, clientSecret) : renderDisabledModule(),
    { encoding: "utf8", mode: 0o600 },
  );
  return { generatedModulePath, youtubeEnabled: hasClientId };
}

module.exports = {
  isValidYouTubeClientId,
  isValidYouTubeClientSecret,
  prepareYouTubeClientId,
  renderGeneratedModule,
  renderDisabledModule,
};
