const fs = require("node:fs");
const path = require("node:path");

function readAppVersion(appRoot, fallbackVersion = "") {
  try {
    const manifestPath = path.join(appRoot, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const version = typeof manifest?.version === "string" ? manifest.version.trim() : "";
    if (version) return version;
  } catch {}
  return String(fallbackVersion || "").trim();
}

module.exports = { readAppVersion };
