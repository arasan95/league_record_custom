const fs = require("node:fs");
const path = require("node:path");

// Desktop OAuth clients are public clients: the client ID identifies the app,
// but no client secret can be kept confidential in an installed application.
// Official builds bundle only a client ID; source builds can override it locally.
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

function getYouTubeOAuthConfig() {
  // A packaged official client ID takes precedence so an inherited environment
  // variable cannot silently change the OAuth identity shown to end users.
  const bundledClientId = readValue(
    process.resourcesPath ? path.join(process.resourcesPath, "youtube", "client-id.txt") : "",
    isValidYouTubeClientId,
  );
  if (bundledClientId) {
    return {
      clientId: bundledClientId,
      clientSecret: readValue(
        path.join(process.resourcesPath, "youtube", "client-secret.txt"),
        isValidYouTubeClientSecret,
      ),
    };
  }

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
