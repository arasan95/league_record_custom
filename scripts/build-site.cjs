#!/usr/bin/env node
// Minimal site template builder for P1-4
// Reads PAGE_CACHE_VERSION from site/site.js and injects ?v= into HTML links
// Future: use site/templates/base.html + site/content/* for full DRY

const fs = require("node:fs");
const path = require("node:path");

const siteDir = path.join(__dirname, "..", "site");
const siteJsPath = path.join(siteDir, "site.js");

function getVersion() {
  try {
    const js = fs.readFileSync(siteJsPath, "utf8");
    const m = js.match(/PAGE_CACHE_VERSION\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
    const m2 = js.match(/v=([0-9]{8}-[0-9]+)/);
    if (m2) return m2[1];
  } catch {}
  return "dev";
}

function updateHtmlVersion(filePath, version) {
  let html = fs.readFileSync(filePath, "utf8");
  const before = html;
  // Replace ?v=xxxx in styles.css and site.js links
  html = html.replace(/\/styles\.css\?v=[^"']+/g, `/styles.css?v=${version}`);
  html = html.replace(/\/site\.js\?v=[^"']+/g, `/site.js?v=${version}`);
  if (html !== before) {
    fs.writeFileSync(filePath, html, "utf8");
    return true;
  }
  return false;
}

function main() {
  const version = getVersion();
  console.log(`[build-site] PAGE_CACHE_VERSION=${version}`);
  const pages = fs.readdirSync(siteDir).filter((f) => f.endsWith(".html"));
  const jaDir = path.join(siteDir, "ja");
  const jaPages = fs.existsSync(jaDir) ? fs.readdirSync(jaDir).filter((f) => f.endsWith(".html")) : [];
  let updated = 0;
  for (const page of pages) {
    const p = path.join(siteDir, page);
    if (updateHtmlVersion(p, version)) {
      console.log(`[build-site] updated ${page}`);
      updated++;
    }
  }
  for (const page of jaPages) {
    const p = path.join(jaDir, page);
    if (updateHtmlVersion(p, version)) {
      console.log(`[build-site] updated ja/${page}`);
      updated++;
    }
  }
  // Also handle replay
  const replayPath = path.join(siteDir, "replay", "index.html");
  if (fs.existsSync(replayPath)) updateHtmlVersion(replayPath, version);
  console.log(`[build-site] done, ${updated} files updated`);
}

if (require.main === module) main();
