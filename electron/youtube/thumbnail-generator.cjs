/**
 * YouTube Thumbnail Generator
 *
 * Renders the thumbnail preview HTML with actual game data and captures it
 * as a PNG image using Electron's BrowserWindow. The resulting image is
 * uploaded to YouTube as the video thumbnail.
 */
const path = require("node:path");
const fs = require("node:fs");
const { BrowserWindow } = require("electron");

// YouTube thumbnail dimensions (16:9)
const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;

const MAX_YOUTUBE_THUMBNAIL_BYTES = 2 * 1024 * 1024;

function localFileUrl(filePath) {
  return `lr-file:///${path.resolve(filePath).replace(/\\/g, "/")}`;
}

function localPngDataUrl(filePath) {
  try {
    return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
}

function bundledAssetPath(appPath, ...relativeParts) {
  return firstExistingFile([
    path.join(appPath, "src", "assets", ...relativeParts),
    path.join(__dirname, "..", "..", "src", "assets", ...relativeParts),
    path.join(process.resourcesPath || "", "src", "assets", ...relativeParts),
    path.join(process.resourcesPath || "", "app", "src", "assets", ...relativeParts),
  ]);
}

function firstExistingFile(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function cachedImageUrl(cacheRoots, category, filename) {
  const roots = Array.isArray(cacheRoots) ? cacheRoots : [cacheRoots];
  const filePath = firstExistingFile(roots.flatMap((cacheRoot) => cacheRoot ? [
    path.join(cacheRoot, category, filename),
    path.join(cacheRoot, "img_cache", category, filename),
  ] : []));
  return filePath ? localFileUrl(filePath) : "";
}

/**
 * Map rank string to emblem filename.
 */
function rankToEmblem(rank) {
  if (!rank || rank === "Unranked") return "emblem-iron.png";
  const lower = rank.toLowerCase();
  if (lower.includes("iron")) return "emblem-iron.png";
  if (lower.includes("bronze")) return "emblem-bronze.png";
  if (lower.includes("silver")) return "emblem-silver.png";
  if (lower.includes("gold")) return "emblem-gold.png";
  if (lower.includes("platinum") || lower.includes("plat")) return "emblem-platinum.png";
  if (lower.includes("emerald")) return "emblem-emerald.png";
  if (lower.includes("diamond")) return "emblem-diamond.png";
  if (lower.includes("grandmaster")) return "emblem-grandmaster.png";
  if (lower.includes("master")) return "emblem-master.png";
  if (lower.includes("challenger")) return "emblem-challenger.png";
  return "emblem-iron.png";
}

/**
 * Get champion image URL from champion ID.
 * Uses the champion name from the participant data.
 */
function championImageUrl(participant, cacheRoot, fallbackUrl) {
  const championId = Number(participant?.championId || 0);
  if (!championId) return fallbackUrl;
  return cachedImageUrl(cacheRoot, "champion", `${championId}.png`) || fallbackUrl;
}

/**
 * Get item image URL from item ID.
 */
function itemImageUrl(itemId, cacheRoot) {
  if (!itemId || itemId <= 0) return "";
  return cachedImageUrl(cacheRoot, "item", `${itemId}.png`);
}

/**
 * Get rune/perk image URL from perk ID.
 */
function runeImageUrl(perkId, cacheRoot) {
  if (!perkId || perkId <= 0) return "";
  return cachedImageUrl(cacheRoot, "rune", `${perkId}.png`);
}

/**
 * Format game duration from seconds to "M:SS" string.
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0:00";
  const totalSec = Math.round(seconds);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Find the self participant from metadata.
 */
function findSelfParticipant(metadata) {
  if (!metadata) return null;
  const participants = metadata.participants || [];
  const selfId = metadata.participantId || 0;
  if (selfId > 0) {
    return participants.find((p) => p.participantId === selfId) || participants[0] || null;
  }
  return participants[0] || null;
}

/**
 * Get the team ID for the self participant.
 */
function getSelfTeamId(metadata) {
  const self = findSelfParticipant(metadata);
  return self ? self.teamId : 100;
}

/**
 * Get champion name for the self participant.
 */
function getSelfChampionName(metadata) {
  if (metadata.championName && metadata.championName !== "Unknown") return metadata.championName;
  const self = findSelfParticipant(metadata);
  if (!self) return "Unknown";
  // We don't have champion name from ID directly, use the metadata field
  return metadata.championName || "Unknown";
}

/**
 * Get the self participant's stats.
 */
function getSelfStats(metadata) {
  const self = findSelfParticipant(metadata);
  return self ? self.stats : null;
}

/**
 * Get build items (non-zero items from the self participant).
 */
function getBuildItems(metadata) {
  const stats = getSelfStats(metadata);
  if (!stats) return [];
  const items = [];
  // item6 is the trinket slot; thumbnails show only the six regular items.
  for (let i = 0; i < 6; i++) {
    const itemId = stats[`item${i}`];
    if (itemId && itemId > 0) items.push(itemId);
  }
  return items;
}

/**
 * Get the keystone rune ID.
 */
function getKeystoneRuneId(metadata) {
  const stats = getSelfStats(metadata);
  if (!stats) return 0;
  // perk0 is the keystone rune
  return stats.perk0 || 0;
}

/**
 * Get the ranked emblem URL.
 */
function getRankedEmblemUrl(metadata) {
  const self = findSelfParticipant(metadata);
  const rank = self ? self.rank : null;
  const emblem = rankToEmblem(rank);
  // Emblems are in the app's assets
  return emblem;
}

/**
 * Get team champions grouped by team.
 */
function getTeamChampions(metadata) {
  const participants = metadata.participants || [];
  const blueTeam = [];
  const redTeam = [];
  for (const p of participants) {
    if (p.teamId === 100) {
      blueTeam.push(p);
    } else if (p.teamId === 200) {
      redTeam.push(p);
    }
  }
  return { blueTeam, redTeam };
}

/**
 * Determine if the self player won.
 */
function isWin(metadata) {
  const stats = getSelfStats(metadata);
  if (stats) return Boolean(stats.win);
  // Fallback: check teams
  const teams = metadata.teams || [];
  const selfTeamId = getSelfTeamId(metadata);
  const selfTeam = teams.find((t) => t.teamId === selfTeamId);
  if (selfTeam) return selfTeam.win === "Win";
  return false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isTftMetadata(metadata) {
  const queueName = String(metadata?.queue?.name || "").toUpperCase();
  if (queueName.includes("TFT") || queueName.includes("TEAMFIGHT TACTICS")) return true;
  return (metadata?.participants || []).some((participant) => (
    Number.isFinite(participant?.placement)
    || Array.isArray(participant?.traits)
    || Array.isArray(participant?.units)
  ));
}

function normalizeAssetHint(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cachedImageUrlByHints(cacheRoots, category, hints) {
  const normalizedHints = hints.map(normalizeAssetHint).filter(Boolean);
  if (normalizedHints.length === 0) return "";
  const roots = Array.isArray(cacheRoots) ? cacheRoots : [cacheRoots];
  for (const cacheRoot of roots) {
    if (!cacheRoot) continue;
    for (const directory of [
      path.join(cacheRoot, category),
      path.join(cacheRoot, "img_cache", category),
    ]) {
      try {
        const filenames = fs.readdirSync(directory);
        const filename = filenames.find((candidate) => {
          const normalizedCandidate = normalizeAssetHint(candidate);
          return normalizedHints.some((hint) => (
            normalizedCandidate.includes(hint) || hint.includes(normalizedCandidate.replace(/png$/, ""))
          ));
        });
        if (filename) return localFileUrl(path.join(directory, filename));
      } catch {}
    }
  }
  return "";
}

function resolveTftTraitStyle(tierCurrent, tierTotal) {
  if (tierCurrent <= 0) return "inactive";
  if (tierTotal === 1 && tierCurrent === 1) return "unique";
  if (tierTotal === 2) return tierCurrent >= 2 ? "gold" : "bronze";
  if (tierTotal === 3) return tierCurrent >= 3 ? "gold" : tierCurrent === 2 ? "silver" : "bronze";
  if (tierTotal === 4) return tierCurrent >= 4 ? "prismatic" : tierCurrent === 3 ? "gold" : tierCurrent === 2 ? "silver" : "bronze";
  if (tierTotal >= 5) return tierCurrent >= 5 ? "prismatic" : tierCurrent === 4 ? "gold" : tierCurrent >= 2 ? "silver" : "bronze";
  return "bronze";
}

function resolveTftUnitCost(rarity) {
  if (rarity === 0) return 1;
  if (rarity === 1) return 2;
  if (rarity === 2) return 3;
  if (rarity === 3 || rarity === 4) return 4;
  if (rarity >= 5) return 5;
  return 1;
}

function tftAssetUrl(cacheRoot, category, primaryName, extraHints = []) {
  const exactCandidates = [
    `${String(primaryName || "").toLowerCase()}.png`,
    String(primaryName || ""),
  ];
  for (const candidate of exactCandidates) {
    const exact = cachedImageUrl(cacheRoot, category, candidate);
    if (exact) return exact;
  }
  return cachedImageUrlByHints(cacheRoot, category, [primaryName, ...extraHints]);
}

function generateTftThumbnailHtml(metadata, appPath, cacheRoot, options = {}) {
  const self = findSelfParticipant(metadata) || {};
  const placement = Math.max(1, Math.min(8, Number(self.placement) || 8));
  const placementClass = placement === 1 ? "first" : placement <= 4 ? "top-four" : "bottom-four";
  const traits = (Array.isArray(self.traits) ? [...self.traits] : [])
    .filter((trait) => Number(trait?.tierCurrent) > 0)
    .sort((a, b) => Number(b.tierCurrent) - Number(a.tierCurrent) || Number(b.numUnits) - Number(a.numUnits))
    .slice(0, 7);
  const units = (Array.isArray(self.units) ? self.units : []).slice(0, 10);

  const traitsHtml = traits.length > 0
    ? traits.map((trait) => {
        const name = String(trait.name || "").replace(/^TFT\d+_/, "");
        const iconUrl = tftAssetUrl(cacheRoot, "tft_trait", trait.name, [name]);
        const style = resolveTftTraitStyle(Number(trait.tierCurrent), Number(trait.tierTotal));
        return `<div class="tft-trait ${style}">
          <div class="tft-trait-icon">${iconUrl ? `<img src="${iconUrl}" alt="">` : escapeHtml(name.slice(0, 2))}</div>
          <div><strong>${Number(trait.numUnits) || 0}</strong><span>${escapeHtml(name)}</span></div>
        </div>`;
      }).join("")
    : '<div class="empty-state">No active traits</div>';

  const unitsHtml = units.length > 0
    ? units.map((unit) => {
        const characterId = String(unit.characterId || "");
        const name = String(unit.name || characterId).replace(/^TFT\d+_/, "");
        const iconUrl = tftAssetUrl(cacheRoot, "tft_unit", characterId, [name, `${characterId}_square`]);
        const tier = Math.max(1, Math.min(3, Number(unit.tier) || 1));
        const cost = resolveTftUnitCost(Number(unit.rarity));
        const items = (Array.isArray(unit.itemNames) ? unit.itemNames : []).slice(0, 3);
        const itemsHtml = items.map((itemName) => {
          const cleanName = String(itemName).replace(/^TFT\d+_Item_/, "").replace(/^TFT_Item_/, "");
          const itemUrl = tftAssetUrl(cacheRoot, "tft_item", itemName, [cleanName]);
          return itemUrl
            ? `<img src="${itemUrl}" alt="${escapeHtml(cleanName)}">`
            : `<span title="${escapeHtml(cleanName)}"></span>`;
        }).join("");
        return `<div class="tft-unit cost-${cost}">
          <div class="unit-portrait">
            ${iconUrl ? `<img src="${iconUrl}" alt="${escapeHtml(name)}">` : `<div class="unit-fallback">${escapeHtml(name.slice(0, 2))}</div>`}
            <div class="unit-stars tier-${tier}">${"★".repeat(tier)}</div>
            <div class="unit-items">${itemsHtml}</div>
          </div>
          <div class="unit-name">${escapeHtml(name)}</div>
        </div>`;
      }).join("")
    : '<div class="empty-state units-empty">No unit data</div>';

  const eliminated = Number(self.playersEliminated) || 0;
  const fontPath = path.join(appPath, "src", "css", "BeaufortW01-Bold.ttf").replace(/\\/g, "/");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @font-face { font-family: 'Beaufort'; src: url('lr-file:///${fontPath}') format('truetype'); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 1280px; height: 720px; overflow: hidden; color: #f8fafc; background: #090a12; font-family: 'Beaufort', Inter, sans-serif; }
    .tft-thumbnail {
      width: 100%; height: 100%; padding: 36px 42px 32px; position: relative; overflow: hidden;
      background:
        radial-gradient(circle at 18% 6%, rgba(124, 58, 237, .38), transparent 34%),
        radial-gradient(circle at 88% 85%, rgba(8, 145, 178, .25), transparent 32%),
        linear-gradient(145deg, #171329 0%, #0b1020 52%, #070911 100%);
    }
    .tft-thumbnail::before { content: ""; position: absolute; inset: 18px; border: 2px solid rgba(216, 180, 254, .25); border-radius: 24px; pointer-events: none; }
    .header { display: flex; align-items: stretch; gap: 24px; height: 144px; position: relative; z-index: 1; }
    .placement { width: 232px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 100px; font-weight: 900; line-height: 1; background: rgba(15, 23, 42, .86); border: 3px solid currentColor; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
    .placement.first { color: #fbbf24; }.placement.top-four { color: #60a5fa; }.placement.bottom-four { color: #fb7185; }
    .match-meta { flex: 1; padding: 22px 28px; border-radius: 18px; background: rgba(15, 23, 42, .74); border: 1px solid rgba(255,255,255,.13); }
    .eyebrow { color: #c4b5fd; font-size: 25px; letter-spacing: .18em; }
    h1 { margin-top: 5px; font-size: 52px; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta-row { display: flex; gap: 28px; margin-top: 8px; color: #a5b4fc; font: 700 22px Inter, sans-serif; }
    .traits { min-height: 96px; margin-top: 20px; display: flex; align-items: stretch; gap: 11px; position: relative; z-index: 1; }
    .tft-trait { min-width: 145px; flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(15,23,42,.8); border: 2px solid #64748b; }
    .tft-trait-icon { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: #111827; font: 800 16px Inter, sans-serif; }
    .tft-trait-icon img { width: 100%; height: 100%; object-fit: contain; filter: brightness(1.35); }
    .tft-trait strong { display: block; font: 900 25px Inter, sans-serif; }.tft-trait span { display: block; max-width: 83px; overflow: hidden; color: #cbd5e1; font: 700 13px Inter, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
    .tft-trait.bronze { border-color: #b77952; color: #d6a074; }.tft-trait.silver { border-color: #cbd5e1; color: #e2e8f0; }.tft-trait.gold { border-color: #fbbf24; color: #fde68a; }
    .tft-trait.prismatic { border-color: #e879f9; color: #f0abfc; box-shadow: 0 0 18px rgba(232,121,249,.3); }.tft-trait.unique { border-color: #22d3ee; color: #67e8f9; }
    .units { height: 374px; margin-top: 18px; display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(2, 1fr); gap: 12px; position: relative; z-index: 1; }
    .tft-unit { min-width: 0; padding: 7px; border-radius: 14px; background: rgba(15,23,42,.9); border: 3px solid #64748b; box-shadow: 0 8px 20px rgba(0,0,0,.42); }
    .tft-unit.cost-1 { border-color: #94a3b8; }.tft-unit.cost-2 { border-color: #22c55e; }.tft-unit.cost-3 { border-color: #3b82f6; }.tft-unit.cost-4 { border-color: #a855f7; }.tft-unit.cost-5 { border-color: #f59e0b; }
    .unit-portrait { height: 132px; position: relative; overflow: hidden; border-radius: 9px; background: #111827; }
    .unit-portrait > img,.unit-fallback { width: 100%; height: 100%; object-fit: cover; }.unit-fallback { display: grid; place-items: center; color: #94a3b8; font-size: 38px; }
    .unit-stars { position: absolute; top: 4px; left: 7px; color: #e2e8f0; font: 900 21px/1 Inter, sans-serif; text-shadow: 0 2px 4px #000; }.unit-stars.tier-3 { color: #facc15; }
    .unit-items { position: absolute; right: 5px; bottom: 5px; display: flex; gap: 3px; }.unit-items img,.unit-items span { width: 31px; height: 31px; border: 2px solid #e2e8f0; border-radius: 5px; background: #1e293b; object-fit: cover; }
    .unit-name { padding: 7px 4px 1px; overflow: hidden; color: #e2e8f0; font: 800 17px/1 Inter, sans-serif; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .empty-state { display: grid; place-items: center; width: 100%; color: #64748b; font: 700 22px Inter, sans-serif; }.units-empty { grid-column: 1 / -1; grid-row: 1 / -1; }
  </style>
</head>
<body>
  <main class="tft-thumbnail" data-thumbnail-mode="tft">
    <header class="header">
      <div class="placement ${placementClass}">#${placement}</div>
      <div class="match-meta">
        <div class="eyebrow">TEAMFIGHT TACTICS</div>
        <h1>FINAL COMPOSITION</h1>
        ${eliminated > 0 ? `<div class="meta-row"><span>${eliminated} ELIMINATED</span></div>` : ""}
      </div>
    </header>
    <section class="traits">${traitsHtml}</section>
    <section class="units">${unitsHtml}</section>
  </main>
</body>
</html>`;
}

/**
 * Generate the thumbnail HTML with actual game data.
 */
function generateThumbnailHtml(metadata, appPath, cacheRoot, options = {}) {
  if (isTftMetadata(metadata)) {
    return generateTftThumbnailHtml(metadata, appPath, cacheRoot, options);
  }
  const selfStats = getSelfStats(metadata);
  const kills = selfStats?.kills ?? 0;
  const deaths = selfStats?.deaths ?? 0;
  const assists = selfStats?.assists ?? 0;
  const win = isWin(metadata);
  const selfParticipant = findSelfParticipant(metadata);
  const championName = getSelfChampionName(metadata);
  const selfTeamId = getSelfTeamId(metadata);
  const isBlueSide = selfTeamId === 100;
  const sideClass = isBlueSide ? "blue-side" : "red-side";
  const resultText = win ? "VICTORY" : "DEFEAT";
  const resultClass = win ? "win-text" : "loss-text";
  const duration = options.isClip ? "CLIP" : formatDuration(metadata.gameDuration);
  const kdaText = `${kills} / ${deaths} / ${assists}`;
  const buildItems = getBuildItems(metadata);
  const keystoneRuneId = getKeystoneRuneId(metadata);
  const runeUrl = runeImageUrl(keystoneRuneId, cacheRoot);
  const emblemFile = getRankedEmblemUrl(metadata);
  const { blueTeam, redTeam } = getTeamChampions(metadata);

  // Build items HTML
  const itemsHtml = buildItems.length > 0
    ? buildItems.map((id) => {
        const url = itemImageUrl(id, cacheRoot);
        return url
          ? `<img class="item-icon" src="${url}" alt="item">`
          : '<div class="item-icon missing-local-image"></div>';
      }).join("")
    : '<div style="color:#64748b;font-size:24px;grid-column:span 4;text-align:center;">No items</div>';

  // Team champion icons
  const fallbackChampionPath = bundledAssetPath(appPath, "icon", "LoL.png");
  const fallbackChampionUrl = fallbackChampionPath ? localFileUrl(fallbackChampionPath) : "";
  const selfChampionUrl = championImageUrl(selfParticipant, cacheRoot, fallbackChampionUrl);
  const blueChampsHtml = blueTeam.map((p) =>
    `<img class="champ-icon-huge" src="${championImageUrl(p, cacheRoot, fallbackChampionUrl)}" alt="champ">`
  ).join("");
  const redChampsHtml = redTeam.map((p) =>
    `<img class="champ-icon-huge" src="${championImageUrl(p, cacheRoot, fallbackChampionUrl)}" alt="champ">`
  ).join("");

  // Emblem path (relative to app)
  // Embed the rank image so custom-protocol and packaged-path differences can
  // never make the most important local asset disappear from the thumbnail.
  const emblemAssetPath = bundledAssetPath(appPath, "ranked-emblem", emblemFile);
  const emblemPath = localPngDataUrl(emblemAssetPath);
  if (!emblemPath) {
    const error = new Error(`Bundled rank emblem was not found: ${emblemFile}`);
    error.code = "thumbnail_rank_asset_unavailable";
    throw error;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    @font-face {
      font-family: 'Beaufort';
      src: url('lr-file:///${path.join(appPath, "src", "css", "BeaufortW01-Bold.ttf").replace(/\\/g, "/")}') format('truetype');
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background-color: #0b0e14;
      color: #fff;
      font-family: 'Beaufort', 'Cinzel', Inter, sans-serif;
      width: 1280px;
      height: 720px;
      overflow: hidden;
    }
    .yt-thumbnail {
      width: 1280px;
      height: 720px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 10px 14px;
      box-sizing: border-box;
      background-size: cover;
      background-position: center;
    }
    .yt-thumbnail.blue-side {
      background: linear-gradient(135deg, #1a1d23 0%, #2a2d33 50%, #14171d 100%);
    }
    .yt-thumbnail.blue-side::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 25% 35%, rgba(10, 203, 230, 0.15) 0%, transparent 60%),
                  radial-gradient(circle at 85% 65%, rgba(0, 150, 255, 0.1) 0%, transparent 55%);
      pointer-events: none;
    }
    .yt-thumbnail.red-side {
      background: linear-gradient(135deg, #1a1d23 0%, #2a2d33 50%, #14171d 100%);
    }
    .yt-thumbnail.red-side::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 25% 35%, rgba(230, 59, 59, 0.15) 0%, transparent 60%),
                  radial-gradient(circle at 85% 65%, rgba(255, 50, 50, 0.1) 0%, transparent 55%);
      pointer-events: none;
    }
    .thumbnail-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, transparent 40%, rgba(0,0,0,0.7) 100%);
      pointer-events: none;
    }
    .thumb-upper-spacer, .thumb-lower-spacer { display: none; }
    .thumb-body {
      position: relative;
      z-index: 2;
      flex: 1;
      display: grid;
      grid-template-rows: 104px 380px;
      align-content: center;
      gap: 6px;
    }
    .thumb-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .result-kda-group {
      display: flex;
      flex-direction: row;
      align-items: baseline;
      gap: 18px;
    }
    .thumb-bottom-row {
      display: grid;
      grid-template-columns: 330px 1fr 400px;
      align-items: center;
      gap: 12px;
    }
    .main-champ-wrapper {
      position: relative;
      flex: 0 0 330px;
      width: 330px;
      height: 330px;
    }
    .main-champ-avatar {
      width: 100%;
      height: 100%;
      border-radius: 30px;
      object-fit: cover;
      border: 4px solid #fff;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.7);
    }
    .blue-side .main-champ-avatar {
      border-color: #0acbe6;
      box-shadow: 0 0 26px rgba(10, 203, 230, 0.7), 0 8px 25px rgba(0, 0, 0, 0.8);
    }
    .red-side .main-champ-avatar {
      border-color: #ff4d4d;
      box-shadow: 0 0 26px rgba(255, 77, 77, 0.7), 0 8px 25px rgba(0, 0, 0, 0.8);
    }
    .rune-badge {
      position: absolute;
      bottom: -8px;
      right: -8px;
      width: 88px;
      height: 88px;
      border-radius: 50%;
      background: #091428;
      border: 3px solid #c8aa6e;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.8), 0 0 14px rgba(200, 170, 110, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .rune-badge img {
      width: 82%;
      height: 82%;
      object-fit: contain;
    }
    .rune-badge:empty { display: none; }
    .missing-local-image { opacity: 0.35; }
    .thumb-center-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .result-badge {
      font-size: 84px;
      font-weight: 900;
      font-family: 'Cinzel', 'Beaufort', serif;
      letter-spacing: 0.05em;
      line-height: 1;
      text-transform: uppercase;
    }
    .win-text {
      color: #ffe600;
      text-shadow: 0 0 24px rgba(255, 230, 0, 0.7), 0 4px 8px rgba(0, 0, 0, 0.9);
    }
    .loss-text {
      color: #ff3b3b;
      text-shadow: 0 0 24px rgba(255, 59, 59, 0.7), 0 4px 8px rgba(0, 0, 0, 0.9);
    }
    .kda-value {
      font-size: 74px;
      font-weight: 900;
      color: #ffffff;
      text-shadow: 0 0 18px rgba(0,0,0,0.9), 0 3px 6px rgba(0, 0, 0, 0.9);
      letter-spacing: 0.03em;
      line-height: 1;
    }
    .build-items-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .build-items-grid {
      display: grid;
      grid-template-columns: repeat(3, 116px);
      gap: 7px;
    }
    .item-icon {
      width: 116px;
      height: 116px;
      border-radius: 16px;
      object-fit: cover;
      border: 2px solid #64748b;
      background-color: #0f172a;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.7);
    }
    .ranked-emblem-wrapper {
      flex: 0 0 292px;
      width: 330px;
      height: 292px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .ranked-emblem {
      display: block;
      width: 330px;
      height: 330px;
      object-fit: contain;
      transform: scale(3.35);
      filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.75));
    }
    .thumb-right-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }
    .meta-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .meta-main-text {
      font-size: 78px;
      font-weight: 900;
      color: #ffffff;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
      line-height: 1;
      white-space: nowrap;
    }
    .rank-meta-column {
      height: 370px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
    }
    .thumb-teams-footer {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(11, 15, 25, 0.82);
      padding: 7px 10px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(8px);
    }
    .team-group {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .champ-icon-huge {
      flex: 0 0 108px;
      width: 108px;
      height: 108px;
      border-radius: 14px;
      object-fit: cover;
      border: 3px solid #334155;
      background-color: #0f172a;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7);
    }
    .team-blue .champ-icon-huge {
      border-color: #0acbe6;
      box-shadow: 0 0 10px rgba(10, 203, 230, 0.4), 0 4px 10px rgba(0,0,0,0.6);
    }
    .team-red .champ-icon-huge {
      border-color: #ff4d4d;
      box-shadow: 0 0 10px rgba(255, 77, 77, 0.4), 0 4px 10px rgba(0,0,0,0.6);
    }
    .vs-divider {
      font-size: 34px;
      font-weight: 900;
      color: #64748b;
      font-style: italic;
      padding: 0 3px;
    }
  </style>
</head>
<body>
  <div class="yt-thumbnail ${sideClass}">
    <div class="thumbnail-overlay"></div>
    <div class="thumb-upper-spacer"></div>
    <div class="thumb-body">
      <div class="thumb-top-row">
        <div class="result-kda-group">
          <div class="result-badge ${resultClass}">${resultText}</div>
          <div class="kda-value">${kdaText}</div>
        </div>
      </div>
      <div class="thumb-bottom-row">
        <div class="main-champ-wrapper">
          <img class="main-champ-avatar" src="${selfChampionUrl}" alt="${championName}">
          <div class="rune-badge" title="Keystone">${runeUrl ? `<img src="${runeUrl}" alt="Rune">` : ""}</div>
        </div>
        <div class="build-items-wrapper">
          <div class="build-items-grid">
            ${itemsHtml}
          </div>
        </div>
        <div class="rank-meta-column">
          <div class="thumb-right-meta">
            <div class="meta-box">
              <span class="meta-main-text">${duration}</span>
            </div>
          </div>
          <div class="ranked-emblem-wrapper">
            <img class="ranked-emblem" src="${emblemPath}" alt="Rank">
          </div>
        </div>
      </div>
    </div>
    <div class="thumb-lower-spacer"></div>
    <div class="thumb-teams-footer">
      <div class="team-group team-blue">
        ${blueChampsHtml}
      </div>
      <div class="vs-divider">VS</div>
      <div class="team-group team-red">
        ${redChampsHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render the thumbnail HTML to a PNG buffer using a hidden BrowserWindow.
 *
 * @param {string} html - The thumbnail HTML content
 * @param {object} options
 * @param {number} [options.width=1280] - Viewport width
 * @param {number} [options.height=720] - Viewport height
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} YouTube-compatible image
 */
async function renderThumbnailToPng(html, options = {}) {
  const width = options.width || THUMBNAIL_WIDTH;
  const height = options.height || THUMBNAIL_HEIGHT;

  const thumbWin = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  try {
    // Load the HTML content
    await thumbWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Wait for all images and fonts to load
    await thumbWin.webContents.executeJavaScript(`
      Promise.race([
        Promise.all([
          document.fonts.ready,
          ...Array.from(document.querySelectorAll('img')).map((img) => new Promise((resolve) => {
            const finish = () => img.decode().catch(() => {}).finally(resolve);
            if (img.complete) finish();
            else { img.onload = finish; img.onerror = resolve; }
          })),
        ]),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ])
    `);

    // Give a small extra time for rendering
    await new Promise((r) => setTimeout(r, 500));

    // Capture the page as an image
    const image = await thumbWin.webContents.capturePage();
    const pngBuffer = Buffer.from(image.toPNG());
    if (pngBuffer.length <= MAX_YOUTUBE_THUMBNAIL_BYTES) {
      return { buffer: pngBuffer, mimeType: "image/png" };
    }
    for (const quality of [90, 82, 74, 66]) {
      const jpegBuffer = Buffer.from(image.toJPEG(quality));
      if (jpegBuffer.length <= MAX_YOUTUBE_THUMBNAIL_BYTES) {
        return { buffer: jpegBuffer, mimeType: "image/jpeg" };
      }
    }
    throw new Error("Generated YouTube thumbnail exceeds the 2 MB limit.");
  } finally {
    if (!thumbWin.isDestroyed()) thumbWin.destroy();
  }
}

/**
 * Generate a thumbnail from game metadata and return the PNG buffer.
 *
 * @param {object} metadata - Game metadata (Metadata or Deferred format)
 * @param {string} appPath - The app's root path (for asset resolution)
 * @param {string} cacheRoot - Local image cache root
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} image data
 */
async function generateThumbnail(metadata, appPath, cacheRoot, options = {}) {
  const gameData = metadata?.Metadata || metadata?.Deferred || metadata;
  if (!gameData || metadata?.NoData || !Array.isArray(gameData.participants) || gameData.participants.length === 0) {
    const error = new Error("Thumbnail metadata does not contain participants.");
    error.code = "thumbnail_metadata_unavailable";
    throw error;
  }
  const html = generateThumbnailHtml(gameData, appPath, cacheRoot, options);
  return await renderThumbnailToPng(html);
}

module.exports = { generateThumbnail, generateThumbnailHtml, renderThumbnailToPng };
