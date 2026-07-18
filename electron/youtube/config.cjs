// This module deliberately has no default client ID.  A client ID is an
// identifier rather than a credential, but keeping the development and
// production values out of source control prevents accidental mix-ups.
function getYouTubeOAuthConfig() {
  const fromEnv = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || "").trim();
  const secretFromEnv = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "").trim();
  if (fromEnv) return { clientId: fromEnv, clientSecret: secretFromEnv };

  // Packaged builds receive this local-only file through extraResources.
  // During development it is loaded next to this module instead.
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "youtube", "local-config.cjs") : "",
    path.join(__dirname, "local-config.cjs"),
  ].filter(Boolean);
  for (const configPath of candidates) {
    try {
      const localConfig = require(configPath);
      const clientId = String(localConfig?.clientId || "").trim();
      if (clientId) return { clientId, clientSecret: String(localConfig?.clientSecret || "").trim() };
    } catch {}
  }

  return { clientId: "", clientSecret: "" };
}

function getYouTubeClientId() {
  return getYouTubeOAuthConfig().clientId;
}

module.exports = { getYouTubeClientId, getYouTubeOAuthConfig };
const path = require("node:path");
