const fs = require("node:fs");
const path = require("node:path");

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

function prepareYouTubeClientId(root, env = process.env) {
  const localPath = path.join(root, "electron", "youtube", "local-client-id.txt");
  const localSecretPath = path.join(root, "electron", "youtube", "local-client-secret.txt");
  const buildInputDir = path.join(root, ".build-input");
  const buildInputPath = path.join(buildInputDir, "youtube-client-id.txt");
  const buildSecretPath = path.join(buildInputDir, "youtube-client-secret.txt");
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
  if (!isValidYouTubeClientId(clientId)) {
    throw new Error(
      "A valid desktop OAuth client ID is required for packaging. "
      + "Set YOUTUBE_OAUTH_CLIENT_ID or create electron/youtube/local-client-id.txt. "
      + "Use the Desktop app client from the same Google Cloud project.",
    );
  }
  if (!isValidYouTubeClientSecret(clientSecret)) {
    throw new Error(
      "The Google Desktop OAuth client secret is required for packaging. "
      + "Set YOUTUBE_OAUTH_CLIENT_SECRET or create electron/youtube/local-client-secret.txt. "
      + "Never commit the value to source control.",
    );
  }

  fs.mkdirSync(buildInputDir, { recursive: true });
  fs.writeFileSync(buildInputPath, `${clientId}\n`, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(buildSecretPath, `${clientSecret}\n`, { encoding: "utf8", mode: 0o600 });
  return { clientIdPath: buildInputPath, clientSecretPath: buildSecretPath };
}

module.exports = { isValidYouTubeClientId, isValidYouTubeClientSecret, prepareYouTubeClientId };
