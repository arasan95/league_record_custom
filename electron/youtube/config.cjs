const fs = require("node:fs");
const path = require("node:path");

// Desktop OAuth clients are public clients. The registered client credential
// identifies the app to Google's token endpoint, but it cannot be kept
// confidential in an installed application. Official builds inject it into a
// generated module; source builds can supply their own values locally.
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

function readValue(filePath, validator) {
  if (!filePath) return "";
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return validator(value) ? value : "";
  } catch {
    return "";
  }
}

function readOfficialBuildConfig() {
  try {
    // This file exists only in packaged official builds. It is generated from
    // release inputs and excluded from source control.
    const official = require("./official-client.generated.cjs");
    const clientId = String(official?.clientId || "").trim();
    const clientSecret = String(official?.clientSecret || "").trim();
    if (!isValidYouTubeClientId(clientId) || !isValidYouTubeClientSecret(clientSecret)) return null;
    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

function getYouTubeOAuthConfig() {
  // Packaged official credentials take precedence so an inherited environment
  // variable cannot silently change the OAuth identity shown to end users.
  const official = readOfficialBuildConfig();
  if (official) return official;

  const clientIdFromEnv = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || "").trim();
  if (isValidYouTubeClientId(clientIdFromEnv)) {
    const clientSecretFromEnv = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "").trim();
    return {
      clientId: clientIdFromEnv,
      clientSecret: isValidYouTubeClientSecret(clientSecretFromEnv) ? clientSecretFromEnv : "",
    };
  }

  return {
    clientId: readValue(path.join(__dirname, "local-client-id.txt"), isValidYouTubeClientId),
    clientSecret: readValue(path.join(__dirname, "local-client-secret.txt"), isValidYouTubeClientSecret),
  };
}

function getYouTubeClientId() {
  return getYouTubeOAuthConfig().clientId;
}

module.exports = {
  getYouTubeClientId,
  getYouTubeOAuthConfig,
  isValidYouTubeClientId,
  isValidYouTubeClientSecret,
};
