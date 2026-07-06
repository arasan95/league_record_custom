function loadElectronMain() {
  if (globalThis.__leagueRecordElectronMain) return globalThis.__leagueRecordElectronMain;
  return require("electron");
}

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  protocol,
  shell,
} = loadElectronMain();
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const fsNode = require("node:fs");
const { promises: fs, watch: fsWatch } = fsNode;
const https = require("node:https");
const path = require("node:path");
const zlib = require("node:zlib");
const isDev = process.env.LR_ELECTRON_DEV === "1" || !app.isPackaged;
const APP_NAME = isDev ? "LeagueRecord Electron Dev" : "LeagueRecord Electron";
const APP_ID = isDev ? "com.leaguerecord.custom.dev" : "com.leaguerecord.custom.electron";
const APP_LOCAL_DATA_DIR_NAME = isDev ? "com.leaguerecord.custom.dev" : "com.leaguerecord.custom.electron";
const ELECTRON_RELEASE_TAG_PREFIX = "electron-v";
const TOOLTIP_DB_REMOTE_URL = "https://raw.githubusercontent.com/arasan95/league_record_custom/main/src-tauri/resources/tooltip_data.db";
const APP_RELEASES_API_URL = "https://api.github.com/repos/arasan95/League_Record_custom/releases?per_page=20";
const appFile = (...segments) => path.join(app.getAppPath(), ...segments);
let activeLogFile = "";
let tooltipSqlPromise = null;
const tooltipLocaleJsonCache = new Map();
let championLookupPromise = null;
let appTray = null;
let recorderController = null;
let gameMonitor = null;
let currentMainWindow = null;
let externalInstallerPending = false;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

function appendBootLog(message) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fsNode.mkdirSync(dir, { recursive: true });
    fsNode.appendFileSync(path.join(dir, "boot.log"), `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {}
}

try {
  const stat = fsNode.statSync(__filename);
  appendBootLog(`electron main loaded file=${__filename} mtime=${stat.mtime.toISOString()}`);
} catch (error) {
  appendBootLog(`electron main loaded file=${__filename} mtime=unknown error=${String(error?.message || error)}`);
}

function nowIso() {
  return new Date().toISOString();
}

async function initLogging() {
  const logsDir = path.join(app.getPath("userData"), "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  activeLogFile = path.join(logsDir, `session-${stamp}.log`);
  await fs.writeFile(activeLogFile, `[${nowIso()}] [main] logging initialized\n`, "utf8");
  await fs.writeFile(path.join(logsDir, "latest.log"), activeLogFile, "utf8");
}

async function writeLog(scope, message) {
  if (!activeLogFile) return;
  const line = `[${nowIso()}] [${scope}] ${message}\n`;
  try {
    await fs.appendFile(activeLogFile, line, "utf8");
  } catch {}
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "lr-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const defaultMarkerFlags = {
  kill: true,
  death: true,
  assist: true,
  structure: true,
  dragon: true,
  voidgrub: true,
  herald: true,
  baron: true,
};

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getAppLocalDataPath() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath("userData");
  return path.join(localAppData, APP_LOCAL_DATA_DIR_NAME);
}

function defaultSettings() {
  const videosDir = app.getPath("videos");
  return {
    markerFlags: defaultMarkerFlags,
    debugLog: false,
    recordingsFolder: path.join(videosDir, "LeagueRecord"),
    clipsFolder: path.join(videosDir, "LeagueRecord", "clips"),
    filenameFormat: "%Y-%m-%d_%H-%M.mp4",
    encodingQuality: 25,
    outputResolution: null,
    framerate: [30, 1],
    recordAudio: "APPLICATION",
    autostart: false,
    maxRecordingAgeDays: null,
    maxRecordingsSizeGb: null,
    confirmDelete: true,
    hightlightHotkey: null,
    startRecordingHotkey: "F9",
    stopRecordingHotkey: "F10",
    gameModes: null,
    autoplayVideo: false,
    autoStopPlayback: true,
    autoSelectRecording: true,
    autoPopupOnEnd: false,
    ffmpegPath: null,
    developerMode: false,
    matchHistoryBaseUrl: "https://www.deeplol.gg/summoner/jp/{q}",
    matchHistorySubUrl: "https://www.deeplol.gg/summoner/jp/{q}",
    scrollFrameStepModifier: "Shift",
    scoreboardLinkModifier: "Shift",
    scoreboardScale: null,
    playRecordingSounds: true,
    language: "ja",
    championWikiBaseUrl: "https://www.loljp-wiki.jp/wiki/?Champion%2F{nameEsc}",
    championWikiSubUrl: "https://wiki.leagueoflegends.com/en-us/{nameEsc}",
    championMatchupUrl: "https://dpm.lol/champions/{My}/matchups?opponent={Opponent}",
    championMatchupSubUrl: "https://www.onetricks.gg/ja/champions/builds/{My}?matchup={Opponent}",
    championBuildUrl: "https://lolalytics.com/lol/{q}/build/",
    championBuildSubUrl: "https://www.onetricks.gg/ja/champions/builds/{nameEsc}",
    checkUpdatesOnStartup: true,
    keepVideoJsonOnAutoDelete: true,
    autoDeleteClips: false,
  };
}

function sanitizeSettings(settings) {
  const defaults = defaultSettings();
  const next = { ...defaults, ...settings };
  const quality = Number(next.encodingQuality);
  next.encodingQuality = Number.isFinite(quality) && quality >= 1 && quality <= 51 ? Math.round(quality) : 25;
  if (!Array.isArray(next.framerate) || next.framerate.length !== 2) next.framerate = [60, 1];
  if (!Array.isArray(next.applicationAudioTracks)) next.applicationAudioTracks = [];
  if (!next.clipsFolder) next.clipsFolder = path.join(next.recordingsFolder, "clips");
  for (const key of [
    "matchHistoryBaseUrl",
    "matchHistorySubUrl",
    "scoreboardLinkModifier",
    "championWikiBaseUrl",
    "championWikiSubUrl",
    "championMatchupUrl",
    "championMatchupSubUrl",
    "championBuildUrl",
    "championBuildSubUrl",
  ]) {
    if (next[key] == null || next[key] === "") next[key] = defaults[key];
  }
  return next;
}

async function readSettings() {
  const file = getSettingsPath();
  try {
    const raw = await fs.readFile(file, "utf8");
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    const fallback = defaultSettings();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeSettings(settings) {
  const file = getSettingsPath();
  const normalized = sanitizeSettings(settings);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(normalized, null, 2), "utf8");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function stripKnownExt(filePath) {
  return filePath.replace(/\.(mp4|webm)$/i, "");
}

function sanitizeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function toAbsoluteRecordingId(settings, videoId) {
  if (!videoId) return videoId;
  if (path.isAbsolute(videoId)) return stripKnownExt(videoId);
  return stripKnownExt(path.join(settings.recordingsFolder, videoId));
}

async function readMetadataFor(baseVideoId) {
  const jsonPath = `${baseVideoId}.json`;
  try {
    const raw = await fs.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.Metadata || parsed?.Deferred || parsed?.NoData) return parsed;
    if (typeof parsed === "object" && parsed) return { Metadata: parsed };
    return null;
  } catch {
    return null;
  }
}

async function getFirstExistingStat(paths) {
  for (const filePath of paths) {
    try {
      return await fs.stat(filePath);
    } catch {}
  }
  return null;
}

async function getRecordingSortTime(baseVideoId) {
  const stat = await getFirstExistingStat([
    `${baseVideoId}.mp4`,
    `${baseVideoId}.webm`,
    `${baseVideoId}.json`,
  ]);
  if (!stat) return 0;
  const birthtime = Number(stat.birthtimeMs || 0);
  if (Number.isFinite(birthtime) && birthtime > 0) return birthtime;
  const mtime = Number(stat.mtimeMs || 0);
  return Number.isFinite(mtime) ? mtime : 0;
}

async function collectVideoFiles(rootDir) {
  const result = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && /\.(mp4|webm)$/i.test(entry.name)) {
        result.push(full);
      }
    }
  }
  return result;
}

async function getRecordingsList(settings) {
  await ensureDir(settings.recordingsFolder);
  const videoFiles = await collectVideoFiles(settings.recordingsFolder);
  const recordings = await Promise.all(
    videoFiles.map(async (absoluteVideoPath) => {
      const abs = stripKnownExt(absoluteVideoPath);
      const sortTime = await getRecordingSortTime(abs);
      return {
        videoId: abs,
        metadata: await readMetadataFor(abs),
        videoExists: true,
        sortTime,
      };
    }),
  );
  recordings.sort((a, b) => {
    if (b.sortTime !== a.sortTime) return b.sortTime - a.sortTime;
    return b.videoId.localeCompare(a.videoId);
  });
  return recordings.map(({ sortTime: _sortTime, ...recording }) => recording);
}

async function getRecordingsSize(settings) {
  await ensureDir(settings.recordingsFolder);
  const videoFiles = await collectVideoFiles(settings.recordingsFolder);
  let total = 0;
  for (const p of videoFiles) {
    try {
      total += (await fs.stat(p)).size;
    } catch {}
  }
  return total / (1024 ** 3);
}

async function downloadToPath(url, absPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status}`);
  }
  const arr = new Uint8Array(await response.arrayBuffer());
  await ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, arr);
}

function parseAppVersion(input) {
  const trimmed = String(input ?? "").trim().replace(/^v/i, "");
  const [withoutBuild] = trimmed.split("+", 1);
  const [core, prerelease = ""] = withoutBuild.split("-", 2);
  const parts = core.split(".");
  if (parts.length < 1 || parts.length > 3) return null;
  const numbers = [0, 0, 0];
  for (let i = 0; i < parts.length; i += 1) {
    const value = Number(parts[i]);
    if (!Number.isInteger(value) || value < 0) return null;
    numbers[i] = value;
  }
  return {
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    prerelease: prerelease ? prerelease.split(".").filter(Boolean) : [],
    normalized: `${numbers[0]}.${numbers[1]}.${numbers[2]}${prerelease ? `-${prerelease}` : ""}`,
  };
}

function parseElectronReleaseVersion(tagName) {
  const tag = String(tagName ?? "").trim();
  if (!tag.toLowerCase().startsWith(ELECTRON_RELEASE_TAG_PREFIX)) return null;
  return parseAppVersion(tag.slice(ELECTRON_RELEASE_TAG_PREFIX.length));
}

function comparePrereleasePart(left, right) {
  const leftNum = Number(left);
  const rightNum = Number(right);
  const leftIsNum = Number.isInteger(leftNum) && String(leftNum) === left;
  const rightIsNum = Number.isInteger(rightNum) && String(rightNum) === right;
  if (leftIsNum && rightIsNum) return leftNum - rightNum;
  if (leftIsNum) return -1;
  if (rightIsNum) return 1;
  return String(left).localeCompare(String(right));
}

function compareAppVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    if (left.prerelease[i] === undefined) return -1;
    if (right.prerelease[i] === undefined) return 1;
    const diff = comparePrereleasePart(left.prerelease[i], right.prerelease[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

function selectWindowsInstallerAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => /LeagueRecordElectron Setup .*\.exe$/i.test(asset?.name ?? ""))
    ?? assets.find((asset) => /^LeagueRecordElectron[_-].*x64-setup\.exe$/i.test(asset?.name ?? ""))
    ?? assets.find((asset) => /\.exe$/i.test(asset?.name ?? "") && /^LeagueRecordElectron/i.test(asset?.name ?? "") && !/updater|uninstaller|blockmap|\.sig$/i.test(asset?.name ?? ""));
}

async function checkAppUpdate() {
  const current = parseAppVersion(app.getVersion());
  const includePrerelease = String(app.getVersion()).includes("-");
  const response = await fetch(APP_RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "LeagueRecord electron-updater",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) throw new Error(`Update API request failed (${response.status})`);
  const releases = await response.json();
  for (const release of releases) {
    if (release?.draft) continue;
    if (!includePrerelease && release?.prerelease) continue;
    const next = parseElectronReleaseVersion(release?.tag_name);
    if (!next) continue;
    const newer = current ? compareAppVersions(next, current) > 0 : next.normalized !== app.getVersion();
    if (!newer) continue;
    const installer = selectWindowsInstallerAsset(release);
    if (!installer?.browser_download_url) continue;
    return {
      version: next.normalized,
      body: release.body ?? "No release notes provided.",
      url: release.html_url ?? installer.browser_download_url,
      prerelease: Boolean(release.prerelease),
      publishedAt: release.published_at ?? null,
      installerUrl: installer.browser_download_url,
      installerName: installer.name ?? `LeagueRecordElectron Setup ${next.normalized}.exe`,
    };
  }
  return null;
}

async function downloadAndInstallAppUpdate(update) {
  const installerUrl = String(update?.installerUrl ?? "");
  if (!/^https:\/\//i.test(installerUrl)) {
    throw new Error("Update installer URL is missing.");
  }
  const installerName = sanitizeFileName(update?.installerName || `LeagueRecordElectron Setup ${update?.version ?? "update"}.exe`);
  const installerPath = path.join(app.getPath("temp"), "LeagueRecordElectron", "updates", installerName);
  await downloadToPath(installerUrl, installerPath);
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  externalInstallerPending = true;
  return null;
}

async function clearDirectory(targetDir) {
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
  } catch {}
}

async function rmFileWithRetry(filePath, options = {}) {
  const retryCodes = new Set(["EBUSY", "EPERM", "EACCES"]);
  const delays = [80, 160, 320, 640, 1000, 1500];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await fs.rm(filePath, { force: true, ...options });
      return true;
    } catch (error) {
      if (!retryCodes.has(error?.code) || attempt === delays.length) {
        throw error;
      }
      await writeLog("delete", `retry ${attempt + 1}/${delays.length} ${error.code} ${filePath}`);
      await sleepMs(delays[attempt]);
    }
  }
  return false;
}

async function clearCache() {
  await clearDirectory(path.join(app.getPath("userData"), "img_cache"));
  await clearDirectory(path.join(app.getPath("userData"), "items_cache"));
  await clearDirectory(path.join(app.getPath("userData"), "tooltip_cache"));
  return null;
}

async function clearCacheForPatchUpdate() {
  await clearDirectory(path.join(app.getPath("userData"), "img_cache"));
  await clearDirectory(path.join(app.getPath("userData"), "items_cache"));
  return null;
}

function getTooltipDbCandidates() {
  return [
    path.join(app.getPath("userData"), "tooltip_db", "tooltip_data.db"),
    path.join(process.resourcesPath || "", "tooltip_data.db"),
    path.join(process.resourcesPath || "", "resources", "tooltip_data.db"),
    path.join(process.cwd(), "src-tauri", "target", "debug", "tooltip_data.db"),
    path.join(process.cwd(), "src-tauri", "resources", "tooltip_data.db"),
  ].filter(Boolean);
}

function getUserTooltipDbPath() {
  return path.join(app.getPath("userData"), "tooltip_db", "tooltip_data.db");
}

async function findBundledTooltipDbPath() {
  const candidates = getTooltipDbCandidates().filter((candidate) => candidate !== getUserTooltipDbPath());
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {}
  }
  throw new Error("Bundled tooltip_data.db not found");
}

async function findTooltipDbPath() {
  for (const candidate of getTooltipDbCandidates()) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {}
  }
  throw new Error("Bundled tooltip_data.db not found");
}

async function getTooltipSql() {
  if (!tooltipSqlPromise) {
    tooltipSqlPromise = require("sql.js")({
      locateFile: (filename) => require.resolve(`sql.js/dist/${filename}`),
    });
  }
  return tooltipSqlPromise;
}

async function queryTooltipDbLocale(dbPath, locale) {
  const SQL = await getTooltipSql();
  const data = await fs.readFile(dbPath);
  const db = new SQL.Database(new Uint8Array(data));
  try {
    const rows = db.exec("SELECT data_json FROM champion_tooltips WHERE locale = ? LIMIT 1", [locale]);
    return rows?.[0]?.values?.[0]?.[0] ?? null;
  } finally {
    db.close();
  }
}

async function validateTooltipDbFile(dbPath) {
  const stat = await fs.stat(dbPath);
  if (!stat.isFile() || stat.size < 1_000_000) {
    throw new Error(`Tooltip DB is unexpectedly small: ${stat.size} bytes`);
  }
  const SQL = await getTooltipSql();
  const data = await fs.readFile(dbPath);
  const db = new SQL.Database(new Uint8Array(data));
  try {
    const countRows = db.exec("SELECT COUNT(*) FROM champion_tooltips");
    const count = Number(countRows?.[0]?.values?.[0]?.[0] ?? 0);
    if (count < 10) throw new Error(`Tooltip DB has too few locales: ${count}`);
    const jaRows = db.exec("SELECT data_json FROM champion_tooltips WHERE locale = 'ja_JP' LIMIT 1");
    const jaPayload = jaRows?.[0]?.values?.[0]?.[0];
    if (!jaPayload || typeof jaPayload !== "string" || jaPayload.length < 500_000) {
      throw new Error("Tooltip DB missing valid ja_JP payload");
    }
  } finally {
    db.close();
  }
}

async function ensureTooltipDbInstalled() {
  const target = getUserTooltipDbPath();
  try {
    await validateTooltipDbFile(target);
    return target;
  } catch {}

  const source = await findBundledTooltipDbPath();
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  await validateTooltipDbFile(target);
  return target;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function getTooltipDbUpdateDir() {
  return path.join(app.getPath("userData"), "tooltip_db", "updates");
}

async function downloadRemoteTooltipDb() {
  const response = await fetch(TOOLTIP_DB_REMOTE_URL, {
    headers: { "Cache-Control": "no-cache", "User-Agent": "LeagueRecord tooltip-db-updater" },
  });
  if (!response.ok) {
    throw new Error(`Tooltip DB download failed: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) {
    throw new Error(`Downloaded tooltip DB is unexpectedly small: ${bytes.length} bytes`);
  }
  const updateDir = getTooltipDbUpdateDir();
  await ensureDir(updateDir);
  const tmpPath = path.join(updateDir, "tooltip_data.remote.tmp");
  const dbPath = path.join(updateDir, "tooltip_data.remote.db");
  await fs.rm(tmpPath, { force: true });
  await fs.rm(dbPath, { force: true });
  await fs.writeFile(tmpPath, bytes);
  await fs.rename(tmpPath, dbPath);
  await validateTooltipDbFile(dbPath);
  return { dbPath, sha256: await sha256File(dbPath), size: bytes.length };
}

async function checkTooltipDbUpdate() {
  const currentDb = await ensureTooltipDbInstalled();
  const currentSha256 = await sha256File(currentDb);
  const remote = await downloadRemoteTooltipDb();
  return {
    updateAvailable: currentSha256 !== remote.sha256,
    currentSha256,
    remoteSha256: remote.sha256,
    remoteSize: remote.size,
    checkedUrl: TOOLTIP_DB_REMOTE_URL,
  };
}

async function applyTooltipDbUpdate(expectedSha256) {
  const currentDb = await ensureTooltipDbInstalled();
  const stagedDb = path.join(getTooltipDbUpdateDir(), "tooltip_data.remote.db");
  await validateTooltipDbFile(stagedDb);
  const remoteSha256 = await sha256File(stagedDb);
  if (remoteSha256 !== expectedSha256) {
    throw new Error("Downloaded tooltip DB changed after the update check. Please check again.");
  }
  const currentSha256 = await sha256File(currentDb);
  if (currentSha256 === remoteSha256) {
    return {
      updateAvailable: false,
      currentSha256,
      remoteSha256,
      remoteSize: (await fs.stat(stagedDb)).size,
      checkedUrl: TOOLTIP_DB_REMOTE_URL,
    };
  }

  const backupDb = `${currentDb}.bak`;
  const replacementDb = `${currentDb}.new`;
  await fs.copyFile(stagedDb, replacementDb);
  await validateTooltipDbFile(replacementDb);
  await fs.rm(backupDb, { force: true });
  await fs.rename(currentDb, backupDb);
  try {
    await fs.rename(replacementDb, currentDb);
  } catch (error) {
    await fs.rename(backupDb, currentDb).catch(() => {});
    throw error;
  }
  tooltipLocaleJsonCache.clear();
  return {
    updateAvailable: false,
    currentSha256: await sha256File(currentDb),
    remoteSha256,
    remoteSize: (await fs.stat(currentDb)).size,
    checkedUrl: TOOLTIP_DB_REMOTE_URL,
  };
}

async function loadTooltipLocaleDb(locale) {
  const normalizedLocale = String(locale || "").trim() || "ja_JP";
  if (tooltipLocaleJsonCache.has(normalizedLocale)) {
    return tooltipLocaleJsonCache.get(normalizedLocale);
  }

  const dbPath = await ensureTooltipDbInstalled();
  const payload = await queryTooltipDbLocale(dbPath, normalizedLocale);
  if (payload && typeof payload === "string") {
    tooltipLocaleJsonCache.set(normalizedLocale, payload);
    await writeLog("tooltip-db", `loaded locale=${normalizedLocale} bytes=${payload.length} db=${dbPath}`);
    return payload;
  }
  tooltipLocaleJsonCache.set(normalizedLocale, null);
  await writeLog("tooltip-db", `missing locale=${normalizedLocale} db=${dbPath}`);
  return null;
}

function emitAppEvent(win, type, payload) {
  if (win.isDestroyed()) return;
  const channel = `lr:event:${type}`;
  win.webContents.send(channel, payload ?? null);
}

function broadcastAppEvent(type, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    emitAppEvent(win, type, payload);
  }
}

function resolveAppAsset(...segments) {
  const candidates = [
    appFile(...segments),
    path.join(process.cwd(), ...segments),
    path.join(process.resourcesPath || "", ...segments),
    path.join(process.resourcesPath || "", "app", ...segments),
  ];
  return candidates.find((candidate) => {
    try {
      return fsNode.existsSync(candidate);
    } catch {
      return false;
    }
  }) ?? candidates[0];
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function rgbaToPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createRecordingTrayImage(kind) {
  const width = 32;
  const height = 32;
  const rgba = new Uint8Array(width * height * 4);
  const center = 15.5;
  const outer = 15 * 15;
  const inner = kind === "preparing" ? 10.5 * 10.5 : -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const d = dx * dx + dy * dy;
      const painted = d <= outer && d >= inner;
      const idx = (y * width + x) * 4;
      if (painted) {
        rgba[idx] = 255;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(rgbaToPng(width, height, rgba)).resize({ width: 16, height: 16 });
}

function createTrayIcon(kind = "default") {
  if (kind === "recording" || kind === "preparing" || kind === "stopping") {
    return createRecordingTrayImage(kind);
  }

  const iconPath = resolveAppAsset("app-icon.png");
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
}

function updateTrayMenu(status = "idle") {
  if (!appTray) return;
  const isBusy = status === "recording" || status === "preparing" || status === "stopping";
  const template = [
    { label: "Recording", type: "checkbox", checked: isBusy, enabled: false },
    { type: "separator" },
    { label: "Start Recording", enabled: !isBusy, click: () => recorderController?.manualStart() },
    { label: "Stop Recording", enabled: isBusy, click: () => recorderController?.manualStop(true) },
    { type: "separator" },
    { label: "Settings", click: () => currentMainWindow?.show() },
    { label: "Open", click: () => currentMainWindow?.show() },
    {
      label: "Quit",
      click: async () => {
        await recorderController?.shutdown();
        app.quit();
      },
    },
  ];
  appTray.setContextMenu(Menu.buildFromTemplate(template));
  appTray.setToolTip(APP_NAME);
  appTray.setImage(createTrayIcon(status === "recording" ? "recording" : status === "preparing" || status === "stopping" ? "preparing" : "default"));
}

function initTray() {
  if (appTray) return;
  appTray = new Tray(createTrayIcon("default"));
  appTray.on("double-click", () => {
    currentMainWindow?.show();
    currentMainWindow?.focus();
  });
  updateTrayMenu("idle");
}

function toFfmpegInfo(pathValue) {
  return {
    mode: "custom_path",
    selectedPath: pathValue ?? "",
    selectedExists: Boolean(pathValue),
    versionLine: null,
    provenance: null,
  };
}

function getFfmpegCandidates(settings = {}) {
  const custom = settings.ffmpegPath && String(settings.ffmpegPath).trim();
  return [
    custom,
    path.join(getAppLocalDataPath(), "ffmpeg", "ffmpeg.exe"),
    resolveAppAsset("tools", "ffmpeg", "ffmpeg.exe"),
    resolveAppAsset("ffmpeg.exe"),
    path.join(process.resourcesPath || "", "tools", "ffmpeg", "ffmpeg.exe"),
    path.join(process.resourcesPath || "", "ffmpeg.exe"),
    path.join(process.cwd(), "src-tauri", "resources", "tools", "ffmpeg", "ffmpeg.exe"),
    "ffmpeg",
  ].filter(Boolean);
}

async function resolveFfmpegCommand(settings = {}) {
  for (const candidate of getFfmpegCandidates(settings)) {
    if (candidate === "ffmpeg") return candidate;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return "ffmpeg";
}

async function runCommand(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`command failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

async function runCommandCollect(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseFfmpegOutTimeSeconds(line) {
  const usMatch = line.match(/^out_time_us=(\d+)/);
  if (usMatch) return Number(usMatch[1]) / 1_000_000;

  const msMatch = line.match(/^out_time_ms=(\d+)/);
  if (msMatch) return Number(msMatch[1]) / 1_000_000;

  const timeMatch = line.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!timeMatch) return null;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

async function runFfmpegClipCommand(command, args, options = {}) {
  const { duration = 0, onProgress } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let progressBuffer = "";
    let lastPercent = -1;

    const reportProgress = (percent) => {
      const normalized = Math.max(0, Math.min(100, Math.floor(percent)));
      if (normalized === lastPercent) return;
      lastPercent = normalized;
      try {
        onProgress?.(normalized);
      } catch {}
    };

    reportProgress(0);

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      const text = String(d);
      stderr += text;
      progressBuffer += text;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const outTime = parseFfmpegOutTimeSeconds(line.trim());
        if (outTime !== null && duration > 0) {
          reportProgress((outTime / duration) * 100);
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        reportProgress(100);
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`command failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

function getTooltipCacheDir() {
  return path.join(getAppLocalDataPath(), "tooltip_cache");
}

function getTooltipCacheRequiredFiles() {
  const cacheDir = getTooltipCacheDir();
  return [
    path.join(cacheDir, "tooltip_variable_fallback.json"),
    path.join(cacheDir, "all_calc_formulas.json"),
  ];
}

async function hasTooltipExtractionCache() {
  for (const file of getTooltipCacheRequiredFiles()) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function getTooltipRebuildToolCandidates() {
  const exe = process.platform === "win32" ? "rebuild_tooltip_cache.exe" : "rebuild_tooltip_cache";
  return [
    path.join(process.resourcesPath || "", "devtools", exe),
    path.join(process.resourcesPath || "", exe),
    path.join(process.cwd(), "src-tauri", "devtools", "target", "release", exe),
    path.join(process.cwd(), "src-tauri", "devtools", "target", "debug", exe),
  ];
}

async function findTooltipRebuildTool() {
  for (const candidate of getTooltipRebuildToolCandidates()) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function updateChampionData() {
  const toolPath = await findTooltipRebuildTool();
  if (!toolPath) {
    const beforeMessage = (await hasTooltipExtractionCache())
      ? "Tooltip extraction helper is missing; using existing tooltip cache."
      : "Tooltip extraction helper is missing and no existing tooltip cache was found.";
    await writeLog("tooltip-cache", beforeMessage);
    if (await hasTooltipExtractionCache()) return getTooltipCacheDir();
    throw new Error(beforeMessage);
  }

  await ensureDir(getTooltipCacheDir());
  await writeLog("tooltip-cache", `running helper ${toolPath}`);
  const result = await runCommandCollect(toolPath, [], {
    env: {
      LR_TOOLTIP_CACHE_DIR: getTooltipCacheDir(),
    },
  });
  if (result.code !== 0) {
    const detail = `${result.stderr || result.stdout || ""}`.trim();
    const message = `Tooltip extraction failed (${result.code}): ${detail}`;
    await writeLog("tooltip-cache", message);
    if (await hasTooltipExtractionCache()) {
      await writeLog("tooltip-cache", "continuing with existing tooltip cache");
      return getTooltipCacheDir();
    }
    throw new Error(message);
  }

  if (!(await hasTooltipExtractionCache())) {
    throw new Error("Tooltip extraction completed but required cache files were not created.");
  }
  await writeLog("tooltip-cache", `updated ${getTooltipCacheDir()}`);
  return getTooltipCacheDir();
}

async function getRunningApplications() {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await runCommand("tasklist", ["/fo", "csv", "/nh"]);
    const apps = new Set();
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const imageName = trimmed.startsWith("\"")
        ? trimmed.replace(/^"/, "").split("\",\"")[0]
        : trimmed.split(",")[0].replace(/^"|"$/g, "");
      const lower = imageName.toLowerCase();
      if (!lower.endsWith(".exe")) continue;
      if (lower === "system idle process" || lower === "system") continue;
      apps.add(imageName);
    }
    return Array.from(apps).sort();
  } catch {
    return [];
  }
}

async function getClipAudioTracks(settings, videoId) {
  const ffmpegCmd = await resolveFfmpegCommand(settings);
  const baseId = toAbsoluteRecordingId(settings, videoId);
  const source = await resolveSourceVideoPath(baseId);
  const result = await runCommandCollect(ffmpegCmd, ["-hide_banner", "-i", source]);
  const text = `${result.stdout}\n${result.stderr}`;
  const tracks = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/Stream #0:(\d+).*Audio:\s*([^,]+)(.*)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    const codec = match[2].trim();
    const details = match[3].replace(/^\s*,\s*/, "").trim();
    tracks.push({
      index,
      description: details ? `Track ${index}: ${codec}, ${details}` : `Track ${index}: ${codec}`,
    });
  }
  return tracks;
}

async function findLeagueLockfile() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Riot Games", "League of Legends", "lockfile"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Riot Games", "LeagueClient", "lockfile"),
    "C:\\Riot Games\\League of Legends\\lockfile",
    "D:\\Riot Games\\League of Legends\\lockfile",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      if (raw.trim()) return raw.trim();
    } catch {}
  }
  throw "League Client is not running or the LCU API is not ready.";
}

async function getLcuAuth() {
  const parts = (await findLeagueLockfile()).split(":");
  if (parts.length < 5) throw "League Client lockfile is invalid.";
  const [, , port, password, protocolName] = parts;
  return {
    port,
    password,
    protocol: protocolName || "https",
    authorization: `Basic ${Buffer.from(`riot:${password}`).toString("base64")}`,
  };
}

async function lcuRequest(method, endpoint, body) {
  const auth = await getLcuAuth();
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: "127.0.0.1",
      port: Number(auth.port),
      path: endpoint,
      rejectUnauthorized: false,
      headers: {
        Authorization: auth.authorization,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += String(chunk);
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (!data) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(`${method} ${endpoint} failed (${res.statusCode}): ${data}`);
        }
      });
    });
    req.on("error", (error) => reject(String(error)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function ingameRequest(endpoint) {
  return await new Promise((resolve, reject) => {
    const req = https.request({
      method: "GET",
      hostname: "127.0.0.1",
      port: 2999,
      path: endpoint,
      rejectUnauthorized: false,
      headers: { Accept: "application/json" },
      timeout: 1000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += String(chunk);
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`in-game API failed (${res.statusCode})`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("in-game API timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function normalizeQueueMode(queueId, gameMode) {
  switch (Number(queueId)) {
    case 420:
    case 440:
      return "RANKED";
    case 400:
    case 430:
      return "NORMAL";
    case 480:
    case 490:
      return "SWIFTPLAY";
    case 450:
    case 100:
      return "ARAM";
    case 3140:
      return "PRACTICE_TOOL";
    case 1700:
      return "CHERRY";
    case 318:
    case 900:
    case 1010:
    case 1900:
      return "URF";
    case 830:
    case 840:
    case 850:
    case 890:
      return "COOP_VS_AI";
    case 1090:
    case 1100:
    case 1130:
    case 1160:
      return "TFT";
    case 0:
      return "CUSTOM";
    default:
      return String(gameMode || "UNKNOWN").toUpperCase();
  }
}

function isGameModeAllowed(settings, queueId, gameMode) {
  const modes = settings.gameModes;
  if (!Array.isArray(modes)) return true;
  if (modes.length === 0) return false;
  const mode = normalizeQueueMode(queueId, gameMode);
  if (modes.some((m) => String(m).toUpperCase() === mode)) return true;
  const standard = new Set(["RANKED", "NORMAL", "ARAM", "URF", "PRACTICE_TOOL", "CHERRY", "COOP_VS_AI", "TFT", "CUSTOM", "SWIFTPLAY"]);
  return !standard.has(mode) && modes.some((m) => String(m).toUpperCase() === "OTHER");
}

function getSessionGameInfo(session) {
  const gameData = session?.gameData ?? {};
  return {
    phase: session?.phase ?? "",
    gameId: Number(gameData.gameId ?? session?.gameId ?? 0),
    queueId: Number(gameData.queue?.id ?? gameData.queueId ?? 0),
    queueName: String(gameData.queue?.name ?? ""),
    gameMode: gameData.gameMode ?? null,
  };
}

async function getGameflowPhaseSafe() {
  try {
    const phase = await lcuRequest("GET", "/lol-gameflow/v1/gameflow-phase");
    return typeof phase === "string" ? phase : null;
  } catch {
    return null;
  }
}

function resolveExtRecorderPath() {
  const candidates = [
    resolveAppAsset("libobs", "extprocess_recorder.exe"),
    path.join(process.cwd(), "src-tauri", "target", "debug", "libobs", "extprocess_recorder.exe"),
    path.join(process.cwd(), "src-tauri", "target", "libobs", "extprocess_recorder.exe"),
  ];
  return candidates.find((candidate) => {
    try {
      return fsNode.existsSync(candidate);
    } catch {
      return false;
    }
  }) ?? candidates[0];
}

function resolutionFromStd(value) {
  const table = {
    "1024x768p": [1024, 768],
    "1600x1200p": [1600, 1200],
    "1280x1024p": [1280, 1024],
    "1280x720p": [1280, 720],
    "1366x768p": [1366, 768],
    "1600x900p": [1600, 900],
    "1920x1080p": [1920, 1080],
    "2560x1440p": [2560, 1440],
    "3840x2160p": [3840, 2160],
    "5120x2880p": [5120, 2880],
    "1280x800p": [1280, 800],
    "1440x900p": [1440, 900],
    "1680x1050p": [1680, 1050],
    "1920x1200p": [1920, 1200],
    "2240x1400p": [2240, 1400],
    "2560x1600p": [2560, 1600],
    "2560x1080p": [2560, 1080],
    "5120x2160p": [5120, 2160],
    "2580x1080p": [2580, 1080],
    "3440x1440p": [3440, 1440],
    "3840x1600p": [3840, 1600],
    "3840x1080p": [3840, 1080],
    "5120x1440p": [5120, 1440],
    "3840x1200p": [3840, 1200],
  };
  const [width, height] = table[value] ?? [1920, 1080];
  return { width, height };
}

function evenDimension(value, minimum = 2) {
  const rounded = Math.max(minimum, Math.round(Number(value) || minimum));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function outputResolutionForWindow(inputResolution, settings) {
  if (settings.outputResolution) {
    return resolutionFromStd(settings.outputResolution);
  }
  return {
    width: evenDimension(inputResolution.width),
    height: evenDimension(inputResolution.height),
  };
}

async function getLeagueWindowInfo() {
  if (process.platform !== "win32") return null;
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LRWinApi {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetDpiForWindow(IntPtr hWnd);
}
"@
function Get-WindowTextValue([IntPtr]$hwnd) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][LRWinApi]::GetWindowText($hwnd, $sb, $sb.Capacity)
  $sb.ToString()
}
function Get-WindowClassValue([IntPtr]$hwnd) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][LRWinApi]::GetClassName($hwnd, $sb, $sb.Capacity)
  $sb.ToString()
}
$title = "League of Legends (TM) Client"
$class = "RiotWindowClass"
$h = [LRWinApi]::FindWindow($class, $title)
if ($h -eq [IntPtr]::Zero) {
  $script:foundHwnd = [IntPtr]::Zero
  $script:foundTitle = ""
  $script:foundClass = ""
  $callback = [LRWinApi+EnumWindowsProc]{
    param([IntPtr]$hwnd, [IntPtr]$lparam)
    if (-not [LRWinApi]::IsWindowVisible($hwnd)) { return $true }
    $candidateTitle = Get-WindowTextValue $hwnd
    $candidateClass = Get-WindowClassValue $hwnd
    if ($candidateClass -eq "RiotWindowClass" -and $candidateTitle.Contains("League of Legends")) {
      $script:foundHwnd = $hwnd
      $script:foundTitle = $candidateTitle
      $script:foundClass = $candidateClass
      return $false
    }
    return $true
  }
  [void][LRWinApi]::EnumWindows($callback, [IntPtr]::Zero)
  $h = $script:foundHwnd
  if ($h -ne [IntPtr]::Zero) {
    $title = $script:foundTitle
    $class = $script:foundClass
  }
}
if ($h -eq [IntPtr]::Zero) { exit 2 }
$r = New-Object LRWinApi+RECT
if (-not [LRWinApi]::GetClientRect($h, [ref]$r)) { exit 3 }
$w = [Math]::Max(1, $r.Right - $r.Left)
$hgt = [Math]::Max(1, $r.Bottom - $r.Top)
if ($w -le 1 -or $hgt -le 1) { exit 4 }
$dpi = [LRWinApi]::GetDpiForWindow($h)
if ($dpi -le 0) { $dpi = 96 }
$scale = $dpi / 96.0
$physW = [Math]::Round($w * $scale)
$physH = [Math]::Round($hgt * $scale)
[pscustomobject]@{
  title = $title
  class = $class
  process = "League of Legends.exe"
  width = $physW
  height = $physH
  logicalWidth = $w
  logicalHeight = $hgt
  dpi = $dpi
} | ConvertTo-Json -Compress
`;
  const result = await runCommandCollect("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  if (result.code !== 0) return null;
  let info;
  try {
    info = JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
  return {
    title: String(info.title || "League of Legends (TM) Client"),
    class: String(info.class || "RiotWindowClass"),
    process: String(info.process || "League of Legends.exe"),
    width: Number(info.width),
    height: Number(info.height),
    logicalWidth: Number(info.logicalWidth),
    logicalHeight: Number(info.logicalHeight),
    dpi: Number(info.dpi),
  };
}

async function detectLeagueWindowResolution() {
  const info = await getLeagueWindowInfo();
  if (!info) return null;
  return {
    width: info.width,
    height: info.height,
    logicalWidth: info.logicalWidth,
    logicalHeight: info.logicalHeight,
    dpi: info.dpi,
  };
}

async function isLeagueWindowAvailable() {
  if (process.platform !== "win32") return true;
  return Boolean(await getLeagueWindowInfo());
}

async function waitForLeagueWindowResolution(maxAttempts, intervalMs) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const resolution = await detectLeagueWindowResolution().catch(() => null);
    if (resolution) return resolution;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("unable to get League window size");
}

async function waitForIngameActive(maxAttempts, intervalMs, minGameTimeSec = 0) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const data = await ingameRequest("/liveclientdata/allgamedata");
      const gameTime = Number(data?.gameData?.gameTime ?? 0);
      const players = Array.isArray(data?.allPlayers) ? data.allPlayers : [];
      if (gameTime >= minGameTimeSec && players.length > 0) {
        return { data, gameTime, players: players.length };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function waitForGameStats(maxAttempts, intervalMs) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const stats = await ingameRequest("/liveclientdata/gamestats");
      return { stats, elapsedMs: i * intervalMs };
    } catch {}
    await sleepMs(intervalMs);
  }
  return { stats: null, elapsedMs: maxAttempts * intervalMs };
}

async function buildRecorderSettings(settings, gameInfo) {
  await ensureDir(settings.recordingsFolder);
  let filenameFormat = settings.filenameFormat || "%Y-%m-%d_%H-%M-%S";
  if (!filenameFormat.toLowerCase().endsWith(".mp4")) filenameFormat += ".mp4";
  const filename = formatRecordingFilename(filenameFormat);
  const outputPath = path.join(settings.recordingsFolder, filename);
  const windowInfo = await getLeagueWindowInfo();
  const inputResolution = windowInfo
    ? {
        width: windowInfo.width,
        height: windowInfo.height,
        logicalWidth: windowInfo.logicalWidth,
        logicalHeight: windowInfo.logicalHeight,
        dpi: windowInfo.dpi,
      }
    : await waitForLeagueWindowResolution(gameInfo?.manual ? 20 : 60, gameInfo?.manual ? 200 : 500);
  const captureWindow = windowInfo ?? await getLeagueWindowInfo();
  if (!captureWindow) throw new Error("unable to resolve League capture window");
  const outputResolution = outputResolutionForWindow(inputResolution, settings);
  const logicalPart = inputResolution.logicalWidth && inputResolution.logicalHeight
    ? ` logical=${inputResolution.logicalWidth}x${inputResolution.logicalHeight} dpi=${inputResolution.dpi ?? 96}`
    : "";
  await writeLog("recording", `resolution input=${inputResolution.width}x${inputResolution.height}${logicalPart} ratio=${(inputResolution.width / inputResolution.height).toFixed(4)} output=${outputResolution.width}x${outputResolution.height} setting=${settings.outputResolution ?? "auto"}`);
  await writeLog("recording", `capture window title='${captureWindow.title}' class='${captureWindow.class}' process='${captureWindow.process}'`);
  return {
    outputPath,
    ipcSettings: {
      window: {
        name: captureWindow.title,
        class: captureWindow.class,
        process: captureWindow.process,
      },
      input_resolution: inputResolution,
      output_resolution: outputResolution,
      output_path: outputPath,
      framerate: settings.framerate ?? [60, 1],
      rate_control: { CQP: Number(settings.encodingQuality ?? 80) },
      audio_source: settings.recordAudio ?? "SYSTEM",
      application_audio_tracks: (settings.applicationAudioTracks ?? []).map((track) => ({
        application: track.application ?? null,
        enabled: Boolean(track.enabled),
        volume_percent: Number(track.volumePercent ?? 100),
      })),
      encoder: null,
    },
    metadata: {
      Deferred: {
        favorite: false,
        matchId: {
          gameId: Number(gameInfo?.gameId ?? 0),
          platformId: String(gameInfo?.platformId ?? "UNKNOWN"),
        },
        ingameTimeRecStartOffset: Number(gameInfo?.gameTime ?? 0),
        highlights: [],
        events: [],
        participants: [],
      },
    },
  };
}

function formatRecordingFilename(format) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return format
    .replace(/%Y/g, String(now.getFullYear()))
    .replace(/%m/g, pad(now.getMonth() + 1))
    .replace(/%d/g, pad(now.getDate()))
    .replace(/%H/g, pad(now.getHours()))
    .replace(/%M/g, pad(now.getMinutes()))
    .replace(/%S/g, pad(now.getSeconds()))
    .replace(/[:/\\]/g, "-");
}

class ExtRecorder {
  constructor(executable) {
    this.executable = executable;
    this.child = null;
    this.buffer = "";
    this.waiters = [];
  }

  async start() {
    if (this.child) return;
    await fs.access(this.executable);
    this.child = spawn(this.executable, [], {
      cwd: path.dirname(this.executable),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      void writeLog("recorder", String(chunk).trimEnd());
    });
    this.child.on("exit", (code) => {
      void writeLog("recorder", `process exited code=${code}`);
      this.child = null;
      while (this.waiters.length) this.waiters.shift().reject(new Error("recorder process exited"));
    });
    await this.send({ Init: { libobs_data_path: null, plugin_bin_path: null, plugin_data_path: null } });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) break;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        const response = JSON.parse(line);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(response);
      } catch {
        void writeLog("recorder", line);
      }
    }
  }

  async send(command) {
    await this.startIfNeededForCommand(command);
    return await new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.child.stdin.write(`${JSON.stringify(command)}\n`, "utf8");
    }).then((response) => {
      if (response && Object.prototype.hasOwnProperty.call(response, "Err")) {
        throw new Error(String(response.Err));
      }
      return response;
    });
  }

  async startIfNeededForCommand(command) {
    if (!this.child && !Object.prototype.hasOwnProperty.call(command, "Exit")) {
      await this.start();
    }
  }

  async configure(settings) {
    return this.send({ Configure: settings });
  }

  async startRecording() {
    return this.send("StartRecording");
  }

  async stopRecording() {
    return this.send("StopRecording");
  }

  async shutdown() {
    if (!this.child) return;
    try {
      await this.send("StopRecording");
    } catch {}
    try {
      await this.send("Shutdown");
    } catch {}
    try {
      await this.send("Exit");
    } catch {}
    this.child?.kill();
    this.child = null;
  }
}

class RecorderController {
  constructor(win) {
    this.win = win;
    this.recorder = null;
    this.current = null;
    this.stopping = false;
    this.status = "idle";
    this.captureTimer = null;
    this.playerNameToPid = new Map();
    this.pidToChampionId = new Map();
    this.playerInventory = new Map();
    this.syntheticItemEvents = [];
    this.lastLiveGameData = null;
    this.lastLiveEventId = 0;
    this.captureTickCount = 0;
    this.liveGameStartedFired = false;
    this.liveGameEndStopRequested = false;
    this.liveClientFailureTicks = 0;
    this.lastLiveClientSuccessAt = 0;
  }

  setStatus(status) {
    this.status = status;
    updateTrayMenu(status);
  }

  async startRecording({ manual = false, gameInfo = {} } = {}) {
    if (this.current) {
      await writeLog("recording", `start ignored; already recording ${this.current.outputPath}`);
      return false;
    }
    const settings = await readSettings();
    const info = {
      platformId: await getPlatformIdSafe(),
      gameTime: await getGameTimeSafe(),
      manual,
      ...gameInfo,
    };
    this.setStatus("preparing");
    await writeLog("recording", `prepare manual=${manual} gameId=${Number(info.gameId ?? 0)} phase=${info.phase ?? ""} gameTime=${Number(info.gameTime ?? 0)}`);
    const built = await buildRecorderSettings(settings, info);
    await writeLog("recording", `starting manual=${manual} output=${built.outputPath}`);

    const recorder = new ExtRecorder(resolveExtRecorderPath());
    await recorder.configure(built.ipcSettings);
    if (!manual) {
      const startDelaySec = Number(settings.electronStartDelaySec ?? 1.0);
      await writeLog("recording", `waiting for in-game allgamedata before recorder.startRecording minGameTime=${startDelaySec.toFixed(2)}`);
      const active = await waitForIngameActive(120, 500, startDelaySec);
      if (!active) {
        await recorder.shutdown().catch(() => {});
        this.setStatus("idle");
        throw new Error("timed out waiting for in-game API");
      }
      await writeLog("recording", `in-game allgamedata ready gameTime=${active.gameTime.toFixed(3)} players=${active.players}`);
    }
    this.recorder = recorder;
    this.stopping = false;
    this.current = {
      outputPath: built.outputPath,
      manual,
      gameId: Number(info.gameId ?? 0),
      platformId: String(info.platformId ?? "UNKNOWN"),
      ingameTimeRecStartOffset: Number(info.gameTime ?? 0),
      startedAt: Date.now(),
    };
    this.playerNameToPid = new Map();
    this.pidToChampionId = new Map();
    this.playerInventory = new Map();
    this.syntheticItemEvents = [];
    this.lastLiveGameData = null;
    this.lastLiveEventId = 0;
    this.captureTickCount = 0;
    this.liveGameStartedFired = false;
    this.liveGameEndStopRequested = false;
    this.liveClientFailureTicks = 0;
    this.lastLiveClientSuccessAt = 0;
    await this.refreshParticipantMap();
    this.startLiveCapture();

    const preStart = await waitForGameStats(1, 0);
    const preStartAt = Date.now();
    await recorder.startRecording().catch(async (error) => {
      this.stopLiveCapture();
      await recorder.shutdown().catch(() => {});
      this.recorder = null;
      this.current = null;
      this.setStatus("idle");
      throw error;
    });
    const finalStats = await ingameRequest("/liveclientdata/gamestats").catch(() => null);
    const fallbackElapsed = (Date.now() - preStartAt) / 1000;
    const offset = Number(finalStats?.gameTime ?? (preStart.stats ? Number(preStart.stats.gameTime ?? 0) + fallbackElapsed : info.gameTime ?? 0));
    built.metadata.Deferred.ingameTimeRecStartOffset = offset;
    await fs.writeFile(`${stripKnownExt(built.outputPath)}.json`, JSON.stringify(built.metadata, null, 2), "utf8");
    this.current.ingameTimeRecStartOffset = offset;
    this.setStatus("recording");
    broadcastAppEvent(manual ? "ManualRecordingStarted" : "RecordingStarted", null);
    broadcastAppEvent("RecordingsChanged", null);
    return true;
  }

  async stopRecording(isManualStop = false) {
    if (!this.current || !this.recorder) return false;
    if (this.stopping) {
      await writeLog("recording", `stop ignored; already stopping ${this.current.outputPath}`);
      return false;
    }
    this.stopping = true;
    this.setStatus("stopping");
    const current = this.current;
    this.stopLiveCapture();
    await writeLog("recording", `stopping output=${current.outputPath} manualStop=${isManualStop}`);
    let stopError = null;
    let shutdownError = null;
    try {
      await this.recorder.stopRecording();
    } catch (error) {
      stopError = error;
    }
    try {
      await this.recorder.shutdown();
    } catch (error) {
      shutdownError = error;
    } finally {
      this.recorder = null;
      this.current = null;
      this.stopping = false;
      this.setStatus("idle");
    }
    if (stopError || shutdownError) {
      await writeLog("recording", `recorder stop completed with errors stop=${String(stopError?.message || stopError || "ok")} shutdown=${String(shutdownError?.message || shutdownError || "ok")}`);
    }
    const metadata = await processRecordingMetadataWithRetry(current, this.syntheticItemEvents);
    if (metadata) {
      await fs.writeFile(`${stripKnownExt(current.outputPath)}.json`, JSON.stringify(metadata, null, 2), "utf8");
      broadcastAppEvent("MetadataChanged", [stripKnownExt(current.outputPath)]);
    } else {
      const fallback = await buildDeferredFallbackMetadata(current, this.syntheticItemEvents, this.lastLiveGameData, this.playerNameToPid, this.pidToChampionId);
      await fs.writeFile(`${stripKnownExt(current.outputPath)}.json`, JSON.stringify(fallback, null, 2), "utf8");
      broadcastAppEvent("MetadataChanged", [stripKnownExt(current.outputPath)]);
    }
    if (isManualStop) broadcastAppEvent("ManualRecordingStopped", null);
    broadcastAppEvent("RecordingsChanged", null);
    broadcastAppEvent("RecordingFinished", [stripKnownExt(current.outputPath), Boolean(isManualStop)]);
    return true;
  }

  async refreshParticipantMap() {
    try {
      const session = await lcuRequest("GET", "/lol-gameflow/v1/session");
      const gameData = session?.gameData ?? {};
      const next = new Map();
      const pidToChampionId = new Map();
      for (const [teamKey, teamId] of [["teamOne", 100], ["teamTwo", 200]]) {
        const roster = Array.isArray(gameData?.[teamKey]) ? gameData[teamKey] : [];
        for (const p of roster) {
          const pid = Number(p?.participantId ?? 0);
          if (!pid) continue;
          const championId = Number(p?.championId ?? 0);
          if (championId) pidToChampionId.set(pid, championId);
          const summoner = normalizeIdentityKey(p?.summonerName ?? p?.gameName);
          if (summoner) next.set(`team:${teamId}|summoner:${summoner}`, pid);
          const riot1 = normalizeIdentityKey(p?.riotId);
          if (riot1) next.set(`team:${teamId}|riot:${riot1}`, pid);
          const riotName = normalizeIdentityKey(p?.riotIdGameName);
          const riotTag = normalizeIdentityKey(p?.riotIdTagLine);
          if (riotName && riotTag) next.set(`team:${teamId}|riot:${riotName}#${riotTag}`, pid);
        }
      }
      this.playerNameToPid = next;
      this.pidToChampionId = pidToChampionId;
      await writeLog("recording", `participant map size=${next.size}`);
    } catch (error) {
      await writeLog("recording", `participant map load failed: ${String(error?.message || error)}`);
    }
  }

  startLiveCapture() {
    if (this.captureTimer) return;
    const tick = () => {
      this.captureTick().catch((error) => {
        this.liveClientFailureTicks += 1;
        if (this.liveClientFailureTicks === 8 && this.current && this.status === "recording" && this.liveGameStartedFired) {
          void writeLog("recording", "live client unavailable during recording; keeping recording until LCU/live end signal");
        }
        void writeLog("recording", `live capture tick failed: ${String(error?.message || error)}`);
      });
    };
    this.captureTimer = setInterval(tick, 1000);
    tick();
  }

  stopLiveCapture() {
    if (!this.captureTimer) return;
    clearInterval(this.captureTimer);
    this.captureTimer = null;
  }

  async captureTick() {
    if (!this.current) return;
    const data = await ingameRequest("/liveclientdata/allgamedata");
    this.liveClientFailureTicks = 0;
    this.lastLiveClientSuccessAt = Date.now();
    this.lastLiveGameData = data;
    if (!this.liveGameStartedFired) {
      this.liveGameStartedFired = true;
      await writeLog("recording", "in-game API first success; emitting GameStarted");
      broadcastAppEvent("GameStarted", null);
    }
    const players = Array.isArray(data?.allPlayers) ? data.allPlayers : [];
    const gameTimeMs = Math.round(Number(data?.gameData?.gameTime ?? 0) * 1000);
    this.captureTickCount += 1;
    this.updateParticipantMapFromLiveData(players);
    const beforeEventCount = this.syntheticItemEvents.length;
    const liveEvents = normalizeLiveEvents(data);
    let standardItemEvents = 0;

    for (const event of liveEvents) {
      const eventId = normalizeLiveEventId(event);
      if (eventId > 0 && eventId <= this.lastLiveEventId) continue;
      if (eventId > this.lastLiveEventId) this.lastLiveEventId = eventId;

      if (!this.liveGameEndStopRequested && isTerminalLiveEvent(event)) {
        this.liveGameEndStopRequested = true;
        await writeLog("recording", `live terminal event detected name=${normalizeLiveEventName(event)} gameTimeMs=${gameTimeMs}`);
        setTimeout(() => {
          void gameMonitor?.stopFromEvent("LiveClientGameEnd");
        }, 0);
      }

      const itemEvent = buildSyntheticItemEventFromLiveEvent(event, players, gameTimeMs);
      if (!itemEvent) continue;
      this.syntheticItemEvents.push(itemEvent);
      standardItemEvents += 1;
    }

    for (const [playerIndex, player] of players.entries()) {
      const key = `idx:${playerIndex}|${buildLivePlayerFallbackKey(player)}`;
      const previous = this.playerInventory.get(key) ?? [];
      const current = Array.isArray(player?.items)
        ? player.items.map(normalizeLiveItem).filter((item) => item.itemId > 0)
        : [];

      const prevCounts = new Map();
      const currCounts = new Map();
      for (const item of previous) prevCounts.set(item.itemId, (prevCounts.get(item.itemId) ?? 0) + 1);
      for (const item of current) currCounts.set(item.itemId, (currCounts.get(item.itemId) ?? 0) + 1);

      for (const [id, count] of currCounts.entries()) {
        const before = prevCounts.get(id) ?? 0;
        for (let i = 0; i < count - before; i += 1) {
          const item = current.find((candidate) => candidate.itemId === id) ?? { itemId: id, slot: null };
          this.syntheticItemEvents.push({
            ItemPurchased: {
              participant_id: 0,
              item_id: id,
              slot: item.slot,
              shopper_name: buildTaggedShopperName(player),
              shopper_team: teamIdFromLivePlayer(player?.team),
              shopper_champion: String(player?.championName ?? ""),
            },
            timestamp: gameTimeMs,
          });
        }
      }
      for (const [id, count] of prevCounts.entries()) {
        const after = currCounts.get(id) ?? 0;
        for (let i = 0; i < count - after; i += 1) {
          const item = previous.find((candidate) => candidate.itemId === id) ?? { itemId: id, slot: null };
          this.syntheticItemEvents.push({
            ItemSold: {
              participant_id: 0,
              item_id: id,
              slot: item.slot,
              shopper_name: buildTaggedShopperName(player),
              shopper_team: teamIdFromLivePlayer(player?.team),
              shopper_champion: String(player?.championName ?? ""),
            },
            timestamp: gameTimeMs,
          });
        }
      }
      this.playerInventory.set(key, current);
    }
    const added = this.syntheticItemEvents.length - beforeEventCount;
    if (added > 0 || liveEvents.length > 0 || this.captureTickCount === 1 || this.captureTickCount % 10 === 0) {
      const itemCount = players.reduce((total, player) => total + (Array.isArray(player?.items) ? player.items.length : 0), 0);
      await writeLog("recording", `live capture players=${players.length} items=${itemCount} rawEvents=${liveEvents.length} standardItemEvents=${standardItemEvents} added=${added} total=${this.syntheticItemEvents.length} gameTimeMs=${gameTimeMs}`);
    }
  }

  updateParticipantMapFromLiveData(players) {
    for (const player of players) {
      const teamId = teamIdFromLivePlayer(player?.team);
      const summoner = normalizeIdentityKey(player?.summonerName);
      const riotId = normalizeIdentityKey(player?.riotId?.riotId ?? player?.riotId ?? "");
      const pid = this.playerNameToPid.get(`team:${teamId}|summoner:${summoner}`)
        ?? this.playerNameToPid.get(`summoner:${summoner}`)
        ?? this.playerNameToPid.get(`team:${teamId}|riot:${riotId}`)
        ?? this.playerNameToPid.get(`riot:${riotId}`);
      if (!pid) continue;
      if (summoner) {
        this.playerNameToPid.set(String(player?.summonerName ?? ""), pid);
        this.playerNameToPid.set(`summoner:${summoner}`, pid);
        this.playerNameToPid.set(`team:${teamId}|summoner:${summoner}`, pid);
      }
      if (riotId) {
        this.playerNameToPid.set(`riot:${riotId}`, pid);
        this.playerNameToPid.set(`team:${teamId}|riot:${riotId}`, pid);
      }
    }
  }

  async manualStart() {
    try {
      return await this.startRecording({ manual: true, gameInfo: gameMonitor?.latestGameInfo ?? {} });
    } catch (error) {
      await writeLog("recording", `manual start failed: ${String(error?.stack || error)}`);
      this.setStatus("idle");
      dialog.showErrorBox("LeagueRecord", `Manual recording failed:\n${String(error?.message || error)}`);
      return false;
    }
  }

  async manualStop(isManualStop = true) {
    try {
      return await this.stopRecording(isManualStop);
    } catch (error) {
      await writeLog("recording", `manual stop failed: ${String(error?.stack || error)}`);
      return false;
    }
  }

  async shutdown() {
    await this.stopRecording(true).catch(() => {});
  }
}

async function getPlatformIdSafe() {
  try {
    return await lcuRequest("GET", "/lol-platform-config/v1/namespaces/LoginDataPacket/platformId");
  } catch {
    return "UNKNOWN";
  }
}

async function getGameTimeSafe() {
  try {
    const data = await ingameRequest("/liveclientdata/gamestats");
    return Number(data?.gameTime ?? 0);
  } catch {
    return 0;
  }
}

function defaultStats() {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    largestMultiKill: 0,
    neutralMinionsKilled: 0,
    neutralMinionsKilledEnemyJungle: 0,
    neutralMinionsKilledTeamJungle: 0,
    totalMinionsKilled: 0,
    visionScore: 0,
    visionWardsBoughtInGame: 0,
    wardsPlaced: 0,
    wardsKilled: 0,
    gameEndedInEarlySurrender: false,
    gameEndedInSurrender: false,
    win: false,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    perk0: 0,
    perk1: 0,
    perk2: 0,
    perk3: 0,
    perk4: 0,
    perk5: 0,
    perkPrimaryStyle: 0,
    perkSubStyle: 0,
    goldEarned: 0,
  };
}

function normalizePlayer(player) {
  return {
    gameName: String(player?.gameName ?? player?.game_name ?? "Unknown"),
    tagLine: String(player?.tagLine ?? player?.tag_line ?? ""),
    summonerId: player?.summonerId ?? player?.summoner_id ?? null,
  };
}

function normalizeIdentityKey(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function normalizeChampionKey(raw) {
  return String(raw ?? "")
    .replace(/\uFFFD/g, "")
    .replace(/[（(]\s*AI\s*[）)]/gi, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadChampionLookup() {
  if (championLookupPromise) return championLookupPromise;
  championLookupPromise = (async () => {
    const nameToId = new Map();
    const addChampion = (entry) => {
      const championId = Number(entry?.key ?? 0);
      if (!championId) return;
      for (const value of [entry?.id, entry?.name]) {
        const key = normalizeChampionKey(value);
        if (key) nameToId.set(key, championId);
      }
    };
    try {
      const versions = await fetchJsonWithTimeout("https://ddragon.leagueoflegends.com/api/versions.json", 5000);
      const version = Array.isArray(versions) ? versions[0] : "latest";
      const [ja, en] = await Promise.all([
        fetchJsonWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ja_JP/champion.json`, 5000),
        fetchJsonWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`, 5000),
      ]);
      for (const entry of Object.values(ja?.data ?? {})) addChampion(entry);
      for (const entry of Object.values(en?.data ?? {})) addChampion(entry);
      await writeLog("metadata", `champion lookup loaded names=${nameToId.size}`);
    } catch (error) {
      await writeLog("metadata", `champion lookup load failed: ${String(error?.message || error)}`);
    }
    return { nameToId };
  })();
  return championLookupPromise;
}

function teamIdFromLivePlayer(team) {
  const value = String(team ?? "").toUpperCase();
  if (value === "ORDER" || value === "100") return 100;
  if (value === "CHAOS" || value === "200") return 200;
  return 100;
}

function normalizeLiveItem(item) {
  return {
    itemId: Number(item?.itemID ?? item?.itemId ?? item?.item_id ?? 0),
    slot: item?.slot === undefined || item?.slot === null ? null : Number(item.slot),
  };
}

function normalizeLiveEvents(data) {
  const events = data?.events;
  if (Array.isArray(events)) return events;
  if (Array.isArray(events?.Events)) return events.Events;
  if (Array.isArray(events?.events)) return events.events;
  return [];
}

function normalizeLiveEventItemId(event) {
  return Number(
    event?.ItemID
    ?? event?.ItemId
    ?? event?.itemID
    ?? event?.itemId
    ?? event?.item_id
    ?? event?.item?.itemID
    ?? event?.item?.itemId
    ?? event?.item?.item_id
    ?? 0,
  );
}

function normalizeLiveEventSlot(event) {
  const slot = event?.Slot ?? event?.slot ?? event?.ItemSlot ?? event?.itemSlot ?? event?.item?.slot;
  return slot === undefined || slot === null ? null : Number(slot);
}

function normalizeLiveEventId(event) {
  return Number(event?.EventID ?? event?.eventID ?? event?.eventId ?? event?.event_id ?? 0);
}

function normalizeLiveEventName(event) {
  return String(event?.EventName ?? event?.eventName ?? event?.event_name ?? "");
}

function compactLiveEventName(event) {
  return normalizeLiveEventName(event).replace(/[\s_-]/g, "").toLowerCase();
}

function normalizeLiveEventBuildingType(event) {
  return String(
    event?.BuildingType
    ?? event?.buildingType
    ?? event?.building_type
    ?? event?.Building
    ?? event?.building
    ?? "",
  ).replace(/[\s_-]/g, "").toLowerCase();
}

function isTerminalLiveEvent(event) {
  const name = compactLiveEventName(event);
  if (["gameend", "gameended", "nexuskill", "nexuskilled", "nexusdestroyed"].includes(name)) {
    return true;
  }
  const buildingType = normalizeLiveEventBuildingType(event);
  return (name === "buildingkill" || name === "buildingkilled" || name === "buildingdestroyed")
    && buildingType.includes("nexus");
}

function normalizeLiveEventTimeMs(event, fallbackMs) {
  const seconds = Number(event?.EventTime ?? event?.eventTime ?? event?.event_time);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallbackMs;
}

function normalizeLiveEventShopperName(event) {
  return String(
    event?.Recipient
    ?? event?.recipient
    ?? event?.Shopper
    ?? event?.shopper
    ?? event?.ShopperName
    ?? event?.shopperName
    ?? event?.Actor
    ?? event?.actor
    ?? event?.PlayerName
    ?? event?.playerName
    ?? event?.KillerName
    ?? event?.killerName
    ?? "",
  );
}

function resolveLivePlayerByName(players, rawName) {
  const parsed = parseTaggedShopperName(rawName);
  const search = normalizeIdentityKey(parsed.summonerName || rawName);
  if (!search) return null;
  return players.find((player) => {
    const summoner = normalizeIdentityKey(player?.summonerName);
    const riot = normalizeIdentityKey(player?.riotId?.riotId ?? player?.riotId ?? "");
    const riotName = normalizeIdentityKey(player?.riotId?.gameName ?? player?.riotIdGameName ?? "");
    return summoner === search
      || riot === search
      || riotName === search
      || (riot && riot.split("#")[0] === search);
  }) ?? null;
}

function eventPlayerPayload(player, rawName) {
  if (player) {
    return {
      shopper_name: buildTaggedShopperName(player),
      shopper_team: teamIdFromLivePlayer(player?.team),
      shopper_champion: String(player?.championName ?? ""),
    };
  }
  return {
    shopper_name: String(rawName ?? ""),
    shopper_team: 0,
    shopper_champion: "",
  };
}

function buildSyntheticItemEventFromLiveEvent(event, players, fallbackMs) {
  const name = compactLiveEventName(event);
  const timestamp = normalizeLiveEventTimeMs(event, fallbackMs);
  const rawShopperName = normalizeLiveEventShopperName(event);
  const player = resolveLivePlayerByName(players, rawShopperName);
  const payload = eventPlayerPayload(player, rawShopperName);
  const itemId = normalizeLiveEventItemId(event);
  const slot = normalizeLiveEventSlot(event);

  if ((name === "itempurchased" || name === "itempurchase") && itemId > 0) {
    return {
      ItemPurchased: {
        participant_id: 0,
        item_id: itemId,
        slot,
        ...payload,
      },
      timestamp,
    };
  }
  if ((name === "itemsold" || name === "itemsell") && itemId > 0) {
    return {
      ItemSold: {
        participant_id: 0,
        item_id: itemId,
        slot,
        ...payload,
      },
      timestamp,
    };
  }
  if (name === "itemundo") {
    const beforeId = Number(event?.BeforeID ?? event?.BeforeId ?? event?.beforeID ?? event?.beforeId ?? event?.before_id ?? 0);
    const afterId = Number(event?.AfterID ?? event?.AfterId ?? event?.afterID ?? event?.afterId ?? event?.after_id ?? 0);
    const goldGain = Number(event?.GoldGain ?? event?.goldGain ?? event?.gold_gain ?? 0);
    if (beforeId > 0 || afterId > 0) {
      return {
        ItemUndo: {
          participant_id: 0,
          before_id: beforeId,
          after_id: afterId,
          gold_gain: goldGain,
          ...payload,
        },
        timestamp,
      };
    }
  }
  return null;
}

function buildTaggedShopperName(player) {
  const name = String(player?.summonerName ?? "");
  const team = teamIdFromLivePlayer(player?.team);
  const champion = String(player?.championName ?? "");
  return `${name}#TEAM:${team}#CNAME:${champion}`;
}

function parseTaggedShopperName(raw) {
  const value = String(raw ?? "");
  const cnameIndex = value.lastIndexOf("#CNAME:");
  const beforeChampion = cnameIndex >= 0 ? value.slice(0, cnameIndex) : value;
  const championName = cnameIndex >= 0 ? value.slice(cnameIndex + "#CNAME:".length) : "";
  const teamIndex = beforeChampion.lastIndexOf("#TEAM:");
  if (teamIndex < 0) {
    const plainName = value.split("#")[0] ?? value;
    return {
      summonerName: plainName,
      summonerKey: normalizeIdentityKey(plainName),
      teamId: 0,
      championName,
      championKey: normalizeIdentityKey(championName),
    };
  }
  const summonerName = beforeChampion.slice(0, teamIndex);
  const teamPart = beforeChampion.slice(teamIndex + "#TEAM:".length);
  return {
    summonerName,
    summonerKey: normalizeIdentityKey(summonerName),
    teamId: Number(teamPart.split("#")[0] ?? 0),
    championName,
    championKey: normalizeIdentityKey(championName),
  };
}

function buildLivePlayerFallbackKey(player) {
  const team = teamIdFromLivePlayer(player?.team);
  const summoner = normalizeIdentityKey(player?.summonerName);
  const champion = normalizeIdentityKey(player?.championName);
  const riot = normalizeIdentityKey(player?.riotId?.riotId);
  return `fallback:${team}|${summoner}|${champion}|${riot}`;
}

function playersEqual(a, b) {
  const pa = normalizePlayer(a);
  const pb = normalizePlayer(b);
  return pa.gameName === pb.gameName && pa.tagLine === pb.tagLine;
}

function normalizeParticipant(participant, identities) {
  const participantId = Number(participant?.participantId ?? participant?.participant_id ?? 0);
  const identity = identities.find((pi) => Number(pi?.participantId ?? pi?.participant_id ?? 0) === participantId);
  const p = {
    participantId,
    teamId: Number(participant?.teamId ?? participant?.team_id ?? 0),
    championId: Number(participant?.championId ?? participant?.champion_id ?? 0),
    spell1Id: Number(participant?.spell1Id ?? participant?.spell1_id ?? 0),
    spell2Id: Number(participant?.spell2Id ?? participant?.spell2_id ?? 0),
    stats: { ...defaultStats(), ...(participant?.stats ?? {}) },
    lane: String(participant?.timeline?.lane ?? "NONE"),
    role: String(participant?.timeline?.role ?? "NONE"),
    summonerName: identity?.player ? `${normalizePlayer(identity.player).gameName}#${normalizePlayer(identity.player).tagLine}` : "Unknown",
    laneScore: 0,
    champLevel: participant?.champLevel ?? participant?.champ_level ?? 0,
    summonerLevel: null,
    rank: "Unranked",
  };
  for (const key of ["placement", "playersEliminated", "level", "traits", "units", "companion"]) {
    if (participant?.[key] !== undefined) p[key] = participant[key];
  }
  return p;
}

function normalizeQueue(game, queue) {
  const id = Number(game?.queueId ?? game?.queue_id ?? queue?.id ?? 0);
  if (id === -1) return { id, name: "Practicetool", isRanked: false };
  if (id === 0) return { id, name: "Custom Game", isRanked: false };
  return {
    id,
    name: String(queue?.name ?? game?.queue?.name ?? "Unknown Queue"),
    isRanked: Boolean(queue?.isRanked ?? queue?.is_ranked ?? false),
  };
}

function normalizeTimelineEvent(event) {
  const type = String(event?.type ?? "");
  const timestamp = Number(event?.timestamp ?? 0);
  if (type === "CHAMPION_KILL") {
    return {
      ChampionKill: {
        victim_id: Number(event.victimId ?? event.victim_id ?? 0),
        killer_id: Number(event.killerId ?? event.killer_id ?? 0),
        assisting_participant_ids: (event.assistingParticipantIds ?? event.assisting_participant_ids ?? []).map(Number),
        position: event.position ?? { x: 0, y: 0 },
      },
      timestamp,
    };
  }
  if (type === "BUILDING_KILL") {
    return {
      BuildingKill: {
        team_id: Number(event.teamId ?? event.team_id ?? 0),
        killer_id: Number(event.killerId ?? event.killer_id ?? 0),
        building_type: {
          buildingType: event.buildingType ?? event.building_type ?? "TOWER_BUILDING",
          laneType: event.laneType ?? event.lane_type ?? "MID_LANE",
          towerType: event.towerType ?? event.tower_type ?? "OUTER_TURRET",
        },
        assisting_participant_ids: (event.assistingParticipantIds ?? event.assisting_participant_ids ?? []).map(Number),
      },
      timestamp,
    };
  }
  if (type === "ELITE_MONSTER_KILL") {
    const monsterType = event.monsterType ?? event.monster_type ?? "";
    const monsterSubType = event.monsterSubType ?? event.monster_sub_type ?? null;
    return {
      EliteMonsterKill: {
        killer_id: Number(event.killerId ?? event.killer_id ?? 0),
        monster_type: monsterType === "DRAGON"
          ? { monsterType, monsterSubType: monsterSubType ?? "UNKNOWN" }
          : { monsterType },
        assisting_participant_ids: (event.assistingParticipantIds ?? event.assisting_participant_ids ?? []).map(Number),
      },
      timestamp,
    };
  }
  if (type === "ITEM_PURCHASED") {
    return {
      ItemPurchased: {
        participant_id: Number(event.participantId ?? event.participant_id ?? 0),
        item_id: Number(event.itemId ?? event.item_id ?? 0),
        slot: event.slot ?? null,
      },
      timestamp,
    };
  }
  if (type === "ITEM_SOLD") {
    return {
      ItemSold: {
        participant_id: Number(event.participantId ?? event.participant_id ?? 0),
        item_id: Number(event.itemId ?? event.item_id ?? 0),
        slot: event.slot ?? null,
      },
      timestamp,
    };
  }
  if (type === "ITEM_UNDO") {
    return {
      ItemUndo: {
        participant_id: Number(event.participantId ?? event.participant_id ?? 0),
        before_id: Number(event.beforeId ?? event.before_id ?? 0),
        after_id: Number(event.afterId ?? event.after_id ?? 0),
        gold_gain: Number(event.goldGain ?? event.gold_gain ?? 0),
      },
      timestamp,
    };
  }
  return null;
}

function encodeItemEventKey(kind, event) {
  const payload = event?.[kind] ?? {};
  return `${kind}:${event.timestamp}:${payload.participant_id}:${payload.item_id}:${payload.slot ?? ""}:${payload.before_id ?? ""}:${payload.after_id ?? ""}`;
}

function mergeItemEvents(baseEvents, extraEvents) {
  const out = [];
  const seen = new Set();
  for (const event of [...(baseEvents ?? []), ...(extraEvents ?? [])]) {
    if (!event || typeof event !== "object") continue;
    const kind = Object.keys(event).find((k) => k !== "timestamp");
    if (!kind) continue;
    if (!["ItemPurchased", "ItemSold", "ItemUndo"].includes(kind)) {
      out.push(event);
      continue;
    }
    const key = encodeItemEventKey(kind, event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  out.sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
  return out;
}

function resolveSyntheticItemEvents(extraEvents, participantsRaw, identities, championLookup = { nameToId: new Map() }) {
  const byTeamAndSummoner = new Map();
  const bySummoner = new Map();
  const byTeamAndChampion = new Map();
  const byTeamAndChampionId = new Map();
  const byTeamParticipants = new Map();
  const participantIds = [];
  for (const p of participantsRaw ?? []) {
    const participantId = Number(p?.participantId ?? p?.participant_id ?? 0);
    if (!participantId) continue;
    const teamId = Number(p?.teamId ?? p?.team_id ?? 0);
    participantIds.push(participantId);
    if (teamId) {
      const teamParticipants = byTeamParticipants.get(teamId) ?? [];
      teamParticipants.push(participantId);
      byTeamParticipants.set(teamId, teamParticipants);
    }
    const championName = normalizeIdentityKey(p?.championName ?? p?.champion_name ?? "");
    const championId = Number(p?.championId ?? p?.champion_id ?? 0);
    const identity = (identities ?? []).find((pi) => Number(pi?.participantId ?? pi?.participant_id ?? 0) === participantId);
    const player = identity?.player ?? {};
    const gameName = normalizeIdentityKey(player?.gameName ?? player?.game_name ?? "");
    if (gameName) {
      byTeamAndSummoner.set(`team:${teamId}|summoner:${gameName}`, participantId);
      if (!bySummoner.has(gameName)) bySummoner.set(gameName, participantId);
    }
    if (championName) byTeamAndChampion.set(`team:${teamId}|champion:${championName}`, participantId);
    if (championId) {
      byTeamAndChampion.set(`team:${teamId}|championId:${championId}`, participantId);
      byTeamAndChampionId.set(`team:${teamId}|championId:${championId}`, participantId);
    }
  }

  const resolvedEvents = (extraEvents ?? []).map((event) => {
    if (!event || typeof event !== "object") return event;
    const kind = Object.keys(event).find((k) => k !== "timestamp");
    if (!["ItemPurchased", "ItemSold", "ItemUndo"].includes(kind ?? "")) return event;
    const payload = event[kind] ?? {};
    const currentPid = Number(payload.participant_id ?? 0);
    if (currentPid > 0) return event;
    const parsed = parseTaggedShopperName(payload.shopper_name ?? "");
    const name = parsed.summonerKey || normalizeIdentityKey(payload.shopper_name ?? "");
    const teamId = Number(parsed.teamId || payload.shopper_team || 0);
    const championRaw = parsed.championName || String(payload.shopper_champion ?? "");
    const champion = normalizeChampionKey(championRaw) || parsed.championKey || normalizeIdentityKey(payload.shopper_champion ?? "");
    const championId = championLookup.nameToId?.get(champion) ?? 0;
    const resolved = byTeamAndSummoner.get(`team:${teamId}|summoner:${name}`)
      ?? bySummoner.get(name)
      ?? byTeamAndChampion.get(`team:${teamId}|champion:${champion}`)
      ?? byTeamAndChampionId.get(`team:${teamId}|championId:${championId}`)
      ?? resolveSingleParticipantFallback(teamId, byTeamParticipants, participantIds)
      ?? 0;
    if (!resolved) {
      void writeLog("metadata", `synthetic item unresolved kind=${kind} shopper=${String(payload.shopper_name ?? "")} team=${teamId} champion=${champion} championId=${championId} participants=${participantIds.length}`);
      return null;
    }
    if (kind === "ItemUndo") {
      return {
        ItemUndo: {
          participant_id: resolved,
          before_id: Number(payload.before_id ?? 0),
          after_id: Number(payload.after_id ?? 0),
          gold_gain: Number(payload.gold_gain ?? 0),
        },
        timestamp: Number(event.timestamp ?? 0),
      };
    }
    return {
      [kind]: {
        participant_id: resolved,
        item_id: Number(payload.item_id ?? 0),
        slot: payload.slot ?? null,
      },
      timestamp: Number(event.timestamp ?? 0),
    };
  }).filter(Boolean);
  void writeLog("metadata", `synthetic item events raw=${extraEvents?.length ?? 0} resolved=${resolvedEvents.length}`);
  return resolvedEvents;
}

function resolveSingleParticipantFallback(teamId, byTeamParticipants, participantIds) {
  const teamParticipants = byTeamParticipants.get(Number(teamId)) ?? [];
  if (teamParticipants.length === 1) return teamParticipants[0];
  if (participantIds.length === 1) return participantIds[0];
  return 0;
}

function buildGoldTimeline(timeline) {
  return (timeline?.frames ?? []).map((frame) => ({
    timestamp: Number(frame.timestamp ?? 0),
    participants: Object.values(frame.participantFrames ?? frame.participant_frames ?? {}).map((pf) => ({
      participantId: Number(pf.participantId ?? pf.participant_id ?? 0),
      totalGold: Number(pf.totalGold ?? pf.total_gold ?? 0),
      minions: Number(pf.minionsKilled ?? pf.minions_killed ?? 0) + Number(pf.jungleMinionsKilled ?? pf.jungle_minions_killed ?? 0),
      level: Number(pf.level ?? 0),
    })),
  }));
}

function resolveLiveParticipantId(shopperName, playerNameToPid) {
  const direct = playerNameToPid.get(shopperName);
  if (direct) return direct;
  const parsed = parseTaggedShopperName(shopperName);
  if (parsed.teamId && parsed.summonerKey) {
    const scoped = playerNameToPid.get(`team:${parsed.teamId}|summoner:${parsed.summonerKey}`);
    if (scoped) return scoped;
  }
  if (parsed.summonerKey) {
    const bySummoner = playerNameToPid.get(`summoner:${parsed.summonerKey}`) ?? playerNameToPid.get(parsed.summonerName);
    if (bySummoner) return bySummoner;
  }
  return 0;
}

function resolveLivePlayerParticipantIds(players, playerNameToPid) {
  const result = new Map();
  let orderNext = 1;
  let chaosNext = 6;
  for (const player of players) {
    const teamId = teamIdFromLivePlayer(player?.team);
    const summoner = normalizeIdentityKey(player?.summonerName);
    const resolved = playerNameToPid.get(String(player?.summonerName ?? ""))
      ?? playerNameToPid.get(`team:${teamId}|summoner:${summoner}`)
      ?? playerNameToPid.get(`summoner:${summoner}`)
      ?? (teamId === 200 ? chaosNext++ : orderNext++);
    result.set(player, resolved);
    if (summoner) {
      playerNameToPid.set(String(player?.summonerName ?? ""), resolved);
      playerNameToPid.set(`summoner:${summoner}`, resolved);
      playerNameToPid.set(`team:${teamId}|summoner:${summoner}`, resolved);
    }
  }
  return result;
}

function synthesizeDeferredParticipants(lastLiveGameData, playerNameToPid, pidToChampionId = new Map()) {
  const players = Array.isArray(lastLiveGameData?.allPlayers) ? lastLiveGameData.allPlayers : [];
  const ids = resolveLivePlayerParticipantIds(players, playerNameToPid);
  return players.map((player) => {
    const participantId = Number(ids.get(player) ?? 0);
    const items = Array.isArray(player?.items) ? player.items.map(normalizeLiveItem).filter((item) => item.itemId > 0) : [];
    const stats = {
      ...defaultStats(),
      kills: Number(player?.scores?.kills ?? 0),
      deaths: Number(player?.scores?.deaths ?? 0),
      assists: Number(player?.scores?.assists ?? 0),
      totalMinionsKilled: Number(player?.scores?.creepScore ?? player?.scores?.creep_score ?? 0),
      goldEarned: Number(player?.scores?.currentGold ?? 0),
    };
    for (let i = 0; i < Math.min(items.length, 7); i += 1) {
      stats[`item${i}`] = items[i].itemId;
    }
    return {
      participantId,
      teamId: teamIdFromLivePlayer(player?.team),
      championId: Number(pidToChampionId.get(participantId) ?? 0),
      spell1Id: 0,
      spell2Id: 0,
      stats,
      lane: "NONE",
      role: "NONE",
      summonerName: String(player?.summonerName ?? "Unknown"),
      laneScore: 0,
      champLevel: Number(player?.level ?? 0),
      summonerLevel: null,
      rank: "Unranked",
    };
  });
}

function convertSyntheticEventsForDeferred(syntheticItemEvents, playerNameToPid) {
  return (syntheticItemEvents ?? []).map((event) => {
    const kind = Object.keys(event ?? {}).find((key) => key !== "timestamp");
    if (!["ItemPurchased", "ItemSold", "ItemUndo"].includes(kind ?? "")) return null;
    const payload = event[kind] ?? {};
    const participantId = Number(payload.participant_id || resolveLiveParticipantId(payload.shopper_name ?? "", playerNameToPid));
    if (!participantId) return null;
    if (kind === "ItemUndo") {
      return {
        ItemUndo: {
          participant_id: participantId,
          before_id: Number(payload.before_id ?? 0),
          after_id: Number(payload.after_id ?? 0),
          gold_gain: Number(payload.gold_gain ?? 0),
        },
        timestamp: Number(event.timestamp ?? 0),
      };
    }
    return {
      [kind]: {
        participant_id: participantId,
        item_id: Number(payload.item_id ?? 0),
        slot: payload.slot ?? null,
      },
      timestamp: Number(event.timestamp ?? 0),
    };
  }).filter(Boolean).sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
}

async function buildDeferredFallbackMetadata(current, syntheticItemEvents, lastLiveGameData, playerNameToPid, pidToChampionId = new Map()) {
  const playerMap = new Map(playerNameToPid);
  const participants = synthesizeDeferredParticipants(lastLiveGameData, playerMap, pidToChampionId);
  const events = convertSyntheticEventsForDeferred(syntheticItemEvents, playerMap);
  await writeLog("metadata", `writing Deferred fallback events=${events.length} participants=${participants.length}`);
  return {
    Deferred: {
      favorite: false,
      matchId: {
        gameId: Number(current.gameId ?? 0),
        platformId: String(current.platformId ?? "UNKNOWN"),
      },
      ingameTimeRecStartOffset: Number(current.ingameTimeRecStartOffset ?? 0),
      highlights: current.highlights ?? [],
      events,
      participants,
    },
  };
}

async function fetchCurrentSummonerSafe() {
  try {
    return normalizePlayer(await lcuRequest("GET", "/lol-summoner/v1/current-summoner"));
  } catch {
    return { gameName: "Unknown", tagLine: "", summonerId: null };
  }
}

async function processRecordingMetadata(current, syntheticItemEvents = []) {
  const matchId = {
    gameId: Number(current.gameId ?? 0),
    platformId: String(current.platformId ?? await getPlatformIdSafe()),
  };
  if (!matchId.gameId) return null;

  const [player, game, timeline] = await Promise.all([
    fetchCurrentSummonerSafe(),
    lcuRequest("GET", `/lol-match-history/v1/games/${matchId.gameId}`),
    lcuRequest("GET", `/lol-match-history/v1/game-timelines/${matchId.gameId}`).catch(() => ({ frames: [] })),
  ]);
  const queue = await lcuRequest("GET", `/lol-game-queues/v1/queues/${Number(game.queueId ?? game.queue_id ?? 0)}`).catch(() => null);
  const identities = game.participantIdentities ?? game.participant_identities ?? [];
  const participantsRaw = game.participants ?? [];
  const participantIdentity = identities.find((pi) => playersEqual(pi.player, player));
  const participantId = Number(participantIdentity?.participantId ?? participantIdentity?.participant_id ?? 0);
  const selfParticipant = participantsRaw.find((p) => Number(p.participantId ?? p.participant_id ?? 0) === participantId) ?? participantsRaw[0] ?? {};
  const timelineEvents = (timeline.frames ?? [])
    .flatMap((frame) => frame.events ?? [])
    .map(normalizeTimelineEvent)
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
  const championLookup = await loadChampionLookup();
  const resolvedSyntheticEvents = resolveSyntheticItemEvents(syntheticItemEvents, participantsRaw, identities, championLookup);
  const events = mergeItemEvents(timelineEvents, resolvedSyntheticEvents);

  return {
    Metadata: {
      favorite: false,
      matchId,
      ingameTimeRecStartOffset: Number(current.ingameTimeRecStartOffset ?? 0),
      highlights: current.highlights ?? [],
      queue: normalizeQueue(game, queue),
      player,
      championName: "Unknown",
      stats: { ...defaultStats(), ...(selfParticipant.stats ?? {}) },
      participantId,
      participants: participantsRaw.map((p) => normalizeParticipant(p, identities)),
      teams: game.teams ?? [],
      events,
      goldTimeline: buildGoldTimeline(timeline),
      gameVersion: String(game.gameVersion ?? game.game_version ?? ""),
      gameDuration: Number(game.gameDuration ?? game.game_duration ?? 0),
      lpDiff: null,
    },
  };
}

async function processRecordingMetadataWithRetry(current, syntheticItemEvents = []) {
  let delay = 500;
  let lastError = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      return await processRecordingMetadata(current, syntheticItemEvents);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 3000);
    }
  }
  await writeLog("metadata", `failed to finalize metadata: ${String(lastError?.stack || lastError)}`);
  return null;
}

class GameMonitor {
  constructor(controller) {
    this.controller = controller;
    this.timer = null;
    this.ws = null;
    this.wsReconnectTimer = null;
    this.inGameStartedFired = false;
    this.seenGameIds = new Set();
    this.latestGameInfo = null;
    this.lastPhase = "";
    this.ingameFailureTicks = 0;
    this.ingameApiEverActive = false;
    this.lcuFailureTicks = 0;
    this.missingWindowTicks = 0;
    this.missingWindowLogged = false;
    this.nonRecordedGameStartedPoll = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        void writeLog("game-monitor", String(error?.stack || error));
      });
    }, 1000);
    this.connectWebSocket().catch((error) => {
      void writeLog("game-monitor", `websocket connect failed: ${String(error?.stack || error)}`);
    });
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = null;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.stopNonRecordedGameStartedPoll();
  }

  scheduleWebSocketReconnect() {
    if (this.wsReconnectTimer || !this.timer) return;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectWebSocket().catch((error) => {
        void writeLog("game-monitor", `websocket reconnect failed: ${String(error?.stack || error)}`);
      });
    }, 2000);
  }

  async connectWebSocket() {
    if (typeof WebSocket === "undefined" || this.ws) return;
    const auth = await getLcuAuth();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const ws = new WebSocket(`wss://riot:${encodeURIComponent(auth.password)}@127.0.0.1:${auth.port}/`);
    this.ws = ws;
    ws.addEventListener("open", () => {
      try {
        ws.send(JSON.stringify([5, "OnJsonApiEvent_lol-gameflow_v1_session"]));
        ws.send(JSON.stringify([5, "OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block"]));
      } catch {}
      void writeLog("game-monitor", "LCU websocket connected");
    });
    ws.addEventListener("message", (event) => {
      this.handleWebSocketMessage(String(event.data)).catch((error) => {
        void writeLog("game-monitor", `websocket message failed: ${String(error?.stack || error)}`);
      });
    });
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleWebSocketReconnect();
    });
    ws.addEventListener("error", () => {
      if (this.ws === ws) this.ws = null;
      try {
        ws.close();
      } catch {}
      this.scheduleWebSocketReconnect();
    });
  }

  async handleWebSocketMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(message) || message[0] !== 8) return;
    const payload = message[2];
    if (!payload || payload.eventType !== "Update") return;
    const uri = String(payload.uri ?? "");
    if (uri.includes("/lol-gameflow/v1/session")) {
      await this.handleSession(payload.data, "ws");
    } else if (uri.includes("/lol-end-of-game/v1/eog-stats-block")) {
      await writeLog("game-monitor", "received EogStatsBlock");
      await this.stopFromEvent("EogStatsBlock");
    }
  }

  async stopFromEvent(reason) {
    if (!this.controller.current || this.controller.stopping) return;
    await writeLog("game-monitor", `stopping recording reason=${reason}`);
    await this.controller.stopRecording(false).catch((error) => {
      void writeLog("recording", `auto stop failed: ${String(error?.stack || error)}`);
    });
  }

  async tick() {
    let session;
    try {
      session = await lcuRequest("GET", "/lol-gameflow/v1/session");
    } catch {
      await this.checkMissingLeagueWindow();
      this.lastPhase = "";
      if (!this.controller.current) this.inGameStartedFired = false;
      return;
    }
    this.lcuFailureTicks = 0;
    const phase = await getGameflowPhaseSafe();
    if (phase && session && typeof session === "object") {
      session.phase = phase;
    }
    await this.checkMissingLeagueWindow();
    await this.handleSession(session, "poll");
  }

  async checkMissingLeagueWindow() {
    if (!this.controller.current || this.controller.status !== "recording") {
      this.missingWindowTicks = 0;
      this.missingWindowLogged = false;
      return;
    }
    const available = await isLeagueWindowAvailable().catch(() => false);
    if (available) {
      this.missingWindowTicks = 0;
      this.missingWindowLogged = false;
      return;
    }
    this.missingWindowTicks += 1;
    if (this.missingWindowTicks >= 3 && !this.missingWindowLogged) {
      this.missingWindowLogged = true;
      await writeLog("game-monitor", `LoL window missing during recording ticks=${this.missingWindowTicks}; waiting for LCU/live end signal`);
    }
  }

  stopNonRecordedGameStartedPoll() {
    if (this.nonRecordedGameStartedPoll) clearInterval(this.nonRecordedGameStartedPoll);
    this.nonRecordedGameStartedPoll = null;
  }

  startNonRecordedGameStartedPoll(gameId) {
    if (this.nonRecordedGameStartedPoll) return;
    this.nonRecordedGameStartedPoll = setInterval(() => {
      ingameRequest("/liveclientdata/allgamedata").then(() => {
        this.stopNonRecordedGameStartedPoll();
        void writeLog("game-monitor", `in-game API first success for non-recorded game; emitting GameStarted gameId=${gameId}`);
        broadcastAppEvent("GameStarted", null);
      }).catch(() => {});
    }, 1000);
  }

  async handleSession(session, source = "poll") {
    const info = getSessionGameInfo(session);
    this.latestGameInfo = info;
    if (info.phase && info.phase !== this.lastPhase) {
      await writeLog("game-monitor", `phase=${info.phase} source=${source} gameId=${info.gameId} queue=${info.queueId} mode=${info.gameMode ?? ""}`);
      this.lastPhase = info.phase;
    }
    const gameflowActive = info.phase === "GameStart" || info.phase === "InProgress";

    if (gameflowActive && info.gameId && !this.seenGameIds.has(info.gameId)) {
      broadcastAppEvent("GameDetected", null);
    }

    if (!this.inGameStartedFired && gameflowActive) {
      this.inGameStartedFired = true;
      this.ingameFailureTicks = 0;
      this.ingameApiEverActive = false;
      const gameTime = await getGameTimeSafe();
      this.latestGameInfo = { ...info, gameTime };
      if (info.gameId && !this.seenGameIds.has(info.gameId)) {
        const settings = await readSettings();
        const allowed = isGameModeAllowed(settings, info.queueId, info.gameMode);
        await writeLog("game-monitor", `auto candidate gameId=${info.gameId} queue=${info.queueId} mode=${info.gameMode ?? ""} allowed=${allowed}`);
        this.seenGameIds.add(info.gameId);
        if (allowed) {
          const started = await this.controller.startRecording({ manual: false, gameInfo: { ...info, gameTime } }).catch((error) => {
            void writeLog("recording", `auto start failed: ${String(error?.stack || error)}`);
            return false;
          });
          this.ingameFailureTicks = 0;
          await writeLog("game-monitor", `auto start result=${Boolean(started)} gameId=${info.gameId}`);
        } else {
          await writeLog("game-monitor", `auto recording skipped by mode settings queue=${info.queueId} mode=${info.gameMode}`);
          this.startNonRecordedGameStartedPoll(info.gameId);
        }
      }
    } else if (this.inGameStartedFired) {
      try {
        await ingameRequest("/liveclientdata/gamestats");
        this.ingameFailureTicks = 0;
        this.ingameApiEverActive = true;
      } catch {
        this.ingameFailureTicks += 1;
      }
    }

    const stopPhases = new Set([
      "WaitingForStats",
      "PreEndOfGame",
      "EndOfGame",
      "TerminatedInError",
      "FailedToLaunch",
    ]);
    if (this.controller.current && stopPhases.has(info.phase)) {
      await writeLog("game-monitor", `stopping recording phase=${info.phase} ingameFailureTicks=${this.ingameFailureTicks}`);
      await this.controller.stopRecording(false).catch((error) => {
        void writeLog("recording", `auto stop failed: ${String(error?.stack || error)}`);
      });
    }

    if (!["GameStart", "InProgress"].includes(info.phase)) {
      this.inGameStartedFired = false;
      this.ingameFailureTicks = 0;
      this.ingameApiEverActive = false;
      this.stopNonRecordedGameStartedPoll();
    }
  }
}

function normalizeAccelerator(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value
    .replace(/\bCtrl\b/gi, "CommandOrControl")
    .replace(/\bCmdOrCtrl\b/gi, "CommandOrControl")
    .replace(/\bOption\b/gi, "Alt")
    .trim();
  return normalized || null;
}

function registerRecordingHotkeys(settings) {
  globalShortcut.unregisterAll();
  const start = normalizeAccelerator(settings.startRecordingHotkey);
  const stop = normalizeAccelerator(settings.stopRecordingHotkey);
  if (start) {
    const ok = globalShortcut.register(start, () => {
      void recorderController?.manualStart();
    });
    void writeLog("hotkey", `register start ${start}: ${ok}`);
  }
  if (stop) {
    const ok = globalShortcut.register(stop, () => {
      void recorderController?.manualStop(true);
    });
    void writeLog("hotkey", `register stop ${stop}: ${ok}`);
  }
}

function getReplayMatchId(metadata) {
  const value = metadata?.Metadata?.matchId ?? metadata?.Deferred?.matchId;
  if (!value || !Number(value.gameId)) {
    throw "Replay is not available for this recording.";
  }
  return value;
}

async function getReplayMatchIdForVideo(settings, videoId) {
  const id = toAbsoluteRecordingId(settings, videoId);
  const metadata = await readMetadataFor(id);
  return getReplayMatchId(metadata);
}

function replayRequestBodies(gameId) {
  return [
    { gameId },
    {},
    { componentType: "replay-button_match-history" },
  ];
}

async function postReplayAny(endpoints, gameId) {
  const errors = [];
  for (const endpoint of endpoints) {
    for (const body of replayRequestBodies(gameId)) {
      try {
        await lcuRequest("POST", endpoint, body);
        return null;
      } catch (error) {
        const message = String(error);
        if (message.includes("(409)")) return null;
        errors.push(message);
      }
    }
  }
  throw errors.join(" | ") || "Replay request failed.";
}

async function downloadRecordingReplay(settings, videoId) {
  const { gameId } = await getReplayMatchIdForVideo(settings, videoId);
  await postReplayAny([
    `/lol-replays/v1/rofls/${gameId}/download/graceful`,
    `/lol-replays/v1/rofls/${gameId}/download`,
  ], gameId);
  return null;
}

async function playRecordingReplay(settings, videoId) {
  const { gameId } = await getReplayMatchIdForVideo(settings, videoId);
  try {
    await postReplayAny([`/lol-replays/v1/rofls/${gameId}/watch`], gameId);
    return null;
  } catch {}
  await downloadRecordingReplay(settings, videoId);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  let lastError = "";
  for (let i = 0; i < 90; i++) {
    try {
      await postReplayAny([`/lol-replays/v1/rofls/${gameId}/watch`], gameId);
      return null;
    } catch (error) {
      lastError = String(error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw `Failed to start replay playback after download: ${lastError}`;
}

async function detectFfmpegVersion(pathValue) {
  const selectedPath = pathValue && String(pathValue).trim()
    ? String(pathValue)
    : await resolveFfmpegCommand({});
  try {
    const { stdout, stderr } = await runCommand(selectedPath, ["-version"]);
    const line = `${stdout}\n${stderr}`.split(/\r?\n/).find((v) => v.toLowerCase().startsWith("ffmpeg version")) ?? null;
    return {
      mode: pathValue && String(pathValue).trim() ? "custom_path" : selectedPath === "ffmpeg" ? "path" : "bundled",
      selectedPath,
      selectedExists: true,
      versionLine: line,
      provenance: null,
    };
  } catch {
    return {
      mode: pathValue && String(pathValue).trim() ? "custom_path" : "path",
      selectedPath,
      selectedExists: false,
      versionLine: null,
      provenance: null,
    };
  }
}

function makeClipOutputPath(settings, sourceBaseId, start, end) {
  const sourceName = path.basename(sourceBaseId).replace(/\.(mp4|webm)$/i, "");
  const now = new Date();
  const suffix = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const outName = sanitizeFileName(`${sourceName}_clip_${suffix}.mp4`);
  return path.join(settings.clipsFolder || settings.recordingsFolder, outName);
}

async function resolveSourceVideoPath(baseId) {
  const mp4 = `${baseId}.mp4`;
  try {
    await fs.stat(mp4);
    return mp4;
  } catch {}
  const webm = `${baseId}.webm`;
  await fs.stat(webm);
  return webm;
}

async function createClipWithFfmpeg(win, settings, videoId, start, end, gameAudioOnly, audioTrackIndex) {
  const ffmpegPath = await resolveFfmpegCommand(settings);
  const baseId = toAbsoluteRecordingId(settings, videoId);
  const source = await resolveSourceVideoPath(baseId);
  await ensureDir(settings.clipsFolder || settings.recordingsFolder);
  const output = makeClipOutputPath(settings, baseId, start, end);
  const duration = Math.max(0.1, Number(end) - Number(start));
  const args = [
    "-y",
    "-ss",
    Number(Math.max(0, Number(start))).toFixed(3),
    "-i",
    source,
    "-t",
    Number(duration).toFixed(3),
    "-progress",
    "pipe:2",
    "-nostats",
  ];

  if (Number.isInteger(audioTrackIndex)) {
    args.push("-map", "0:v:0", "-map", `0:a:${audioTrackIndex}`, "-c", "copy");
  } else if (gameAudioOnly) {
    args.push("-map", "0:v:0", "-map", "0:a:1", "-c", "copy");
  } else {
    args.push("-c", "copy");
  }

  args.push(output);
  const progressPayload = {
    videoId,
    start: Number(start),
    end: Number(end),
    percent: 0,
  };
  emitAppEvent(win, "ClipProgress", progressPayload);
  await runFfmpegClipCommand(ffmpegPath, args, {
    duration,
    onProgress: (percent) => {
      emitAppEvent(win, "ClipProgress", { ...progressPayload, percent });
    },
  });

  const sourceJson = `${baseId}.json`;
  const outputJson = output.replace(/\.(mp4|webm)$/i, ".json");
  try {
    await fs.copyFile(sourceJson, outputJson);
  } catch {
    await fs.writeFile(outputJson, JSON.stringify({ NoData: { favorite: false } }, null, 2), "utf8");
  }

  emitAppEvent(win, "ClipProgress", { ...progressPayload, percent: 100 });
  return output;
}

function createRecordingWatcher(win) {
  let watcher = null;
  let timer = null;
  let lastFolder = "";
  const pendingMetadata = new Set();

  const flush = async () => {
    timer = null;
    if (pendingMetadata.size > 0) {
      emitAppEvent(win, "MetadataChanged", Array.from(pendingMetadata));
      pendingMetadata.clear();
    }
    emitAppEvent(win, "RecordingsChanged", null);
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 200);
  };

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (watcher) watcher.close();
    watcher = null;
    lastFolder = "";
    pendingMetadata.clear();
  };

  const start = async (settings) => {
    const folder = settings.recordingsFolder;
    if (!folder) return;
    if (lastFolder === folder && watcher) return;
    stop();
    await ensureDir(folder);
    lastFolder = folder;
    watcher = fsWatch(folder, { recursive: true }, (_eventType, filename) => {
      if (!filename) {
        schedule();
        return;
      }
      const name = String(filename);
      if (name.toLowerCase().endsWith(".json")) {
        const base = stripKnownExt(path.join(folder, name.replace(/\.json$/i, "")));
        pendingMetadata.add(base);
      }
      schedule();
    });
  };

  return { start, stop };
}

function makeInvokeHandler(win) {
  return async (_event, payload) => {
    const settings = await readSettings();
    const { command, args = {} } = payload ?? {};
    switch (command) {
      case "get_marker_flags":
        return settings.markerFlags ?? defaultMarkerFlags;
      case "set_marker_flags":
        settings.markerFlags = args.markerFlags ?? settings.markerFlags;
        await writeSettings(settings);
        emitAppEvent(win, "MarkerflagsChanged", null);
        return null;
      case "get_recordings_path":
        return settings.recordingsFolder;
      case "get_recordings_size":
        return getRecordingsSize(settings);
      case "get_recordings_list":
        return getRecordingsList(settings);
      case "open_recordings_folder":
        await ensureDir(settings.recordingsFolder);
        await shell.openPath(settings.recordingsFolder);
        return null;
      case "delete_video": {
        const id = toAbsoluteRecordingId(settings, args.videoId);
        await rmFileWithRetry(`${id}.mp4`);
        await rmFileWithRetry(`${id}.webm`);
        await rmFileWithRetry(`${id}.json`);
        return true;
      }
      case "delete_video_only": {
        const id = toAbsoluteRecordingId(settings, args.videoId);
        await rmFileWithRetry(`${id}.mp4`);
        await rmFileWithRetry(`${id}.webm`);
        return true;
      }
      case "rename_video": {
        const before = toAbsoluteRecordingId(settings, args.videoId);
        const desired = toAbsoluteRecordingId(settings, args.newVideoId);
        const fromMp4 = `${before}.mp4`;
        const toMp4 = `${desired}.mp4`;
        const fromJson = `${before}.json`;
        const toJson = `${desired}.json`;
        try {
          await fs.rename(fromMp4, toMp4);
        } catch {
          await fs.rename(`${before}.webm`, `${desired}.webm`);
        }
        try {
          await fs.rename(fromJson, toJson);
        } catch {}
        return true;
      }
      case "get_metadata": {
        const id = toAbsoluteRecordingId(settings, args.videoId);
        return readMetadataFor(id);
      }
      case "toggle_favorite": {
        const id = toAbsoluteRecordingId(settings, args.videoId);
        const current = (await readMetadataFor(id)) ?? { NoData: { favorite: false } };
        if (current.Metadata) {
          current.Metadata.favorite = !current.Metadata.favorite;
        } else if (current.Deferred) {
          current.Deferred.favorite = !current.Deferred.favorite;
        } else if (current.NoData) {
          current.NoData.favorite = !current.NoData.favorite;
        }
        await fs.writeFile(`${id}.json`, JSON.stringify(current, null, 2), "utf8");
        return true;
      }
      case "confirm_delete":
        return Boolean(settings.confirmDelete ?? true);
      case "disable_confirm_delete":
        settings.confirmDelete = false;
        await writeSettings(settings);
        return null;
      case "get_settings":
        return settings;
      case "save_settings":
        await writeSettings(args.settings ?? settings);
        registerRecordingHotkeys(args.settings ?? settings);
        try {
          await win.__recordingWatcher?.start(args.settings ?? settings);
        } catch {}
        return null;
      case "manual_start_recording":
        return await recorderController?.manualStart();
      case "manual_stop_recording":
        return await recorderController?.manualStop(true);
      case "pick_recordings_folder": {
        const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
        return result.canceled ? null : result.filePaths[0];
      }
      case "get_running_applications":
        return await getRunningApplications();
      case "is_league_client_available": {
        try {
          await getLcuAuth();
          return true;
        } catch {
          return false;
        }
      }
      case "download_recording_replay":
        return await downloadRecordingReplay(settings, args.videoId);
      case "play_recording_replay":
        return await playRecordingReplay(settings, args.videoId);
      case "pick_clips_folder": {
        const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
        return result.canceled ? null : result.filePaths[0];
      }
      case "create_clip":
        return await createClipWithFfmpeg(
          win,
          settings,
          args.videoId,
          args.start,
          args.end,
          args.gameAudioOnly,
          args.audioTrackIndex,
        );
      case "get_clip_audio_tracks":
        return await getClipAudioTracks(settings, args.videoId);
      case "pick_ffmpeg_path": {
        const result = await dialog.showOpenDialog(win, { properties: ["openFile"] });
        return result.canceled ? null : result.filePaths[0];
      }
      case "get_ffmpeg_runtime_info":
        return await detectFfmpegVersion(settings.ffmpegPath ?? null);
      case "clear_cache":
        return clearCache();
      case "clear_cache_for_patch_update":
        return clearCacheForPatchUpdate();
      case "download_image": {
        const rel = path.join("img_cache", args.category ?? "misc", args.filename ?? "image.png");
        const abs = path.join(app.getPath("userData"), rel);
        try {
          await downloadToPath(args.url, abs);
          return abs;
        } catch (error) {
          console.warn("download_image failed; falling back to original URL", { url: args.url, error: String(error) });
          return String(args.url ?? "");
        }
      }
      case "save_scoreboard_cache": {
        const id = toAbsoluteRecordingId(settings, args.videoId);
        const hash = createHash("sha1").update(id).digest("hex");
        const cachePath = path.join(app.getPath("userData"), "scoreboard_cache", `${hash}.json`);
        await ensureDir(path.dirname(cachePath));
        await fs.writeFile(cachePath, String(args.content ?? ""), "utf8");
        return null;
      }
      case "load_scoreboard_cache": {
        const id = toAbsoluteRecordingId(settings, args.videoId);
        const hash = createHash("sha1").update(id).digest("hex");
        const cachePath = path.join(app.getPath("userData"), "scoreboard_cache", `${hash}.json`);
        return await fs.readFile(cachePath, "utf8");
      }
      case "update_champion_data":
        return await updateChampionData();
      case "load_tooltip_locale_db":
        return await loadTooltipLocaleDb(args.locale);
      case "check_tooltip_db_update":
        return await checkTooltipDbUpdate();
      case "apply_tooltip_db_update":
        return await applyTooltipDbUpdate(args.expectedSha256);
      default:
        throw new Error(`Unsupported invoke command in Electron: ${command}`);
    }
  };
}

function createWindow() {
  const windowIconPath = resolveAppAsset("app-icon.ico") ?? resolveAppAsset("app-icon.png");
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 720,
    backgroundColor: "#000000",
    frame: false,
    autoHideMenuBar: true,
    icon: windowIconPath,
    show: false,
    webPreferences: {
      preload: isDev ? path.join(process.cwd(), "electron", "preload.cjs") : appFile("electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: !isDev,
      backgroundThrottling: false,
    },
  });
  currentMainWindow = win;
  initTray();
  if (!recorderController) recorderController = new RecorderController(win);
  if (!gameMonitor) {
    gameMonitor = new GameMonitor(recorderController);
    gameMonitor.start();
  }
  win.setMenuBarVisibility(false);
  void writeLog("main", `window created dev=${isDev}`);
  win.__recordingWatcher = createRecordingWatcher(win);
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    void writeLog("renderer", `level=${level} ${sourceId}:${line} ${message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, desc, validatedUrl) => {
    void writeLog("renderer", `did-fail-load code=${code} url=${validatedUrl} desc=${desc}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    void writeLog("renderer", `render-process-gone ${safeJson(details)}`);
  });

  const safeHandle = (channel, handler) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
    ipcMain.handle(channel, async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        await writeLog("ipc", `${channel} failed: ${String(error?.stack || error)}`);
        throw error;
      }
    });
  };
  const safeOn = (channel, handler) => {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, handler);
  };

  safeHandle("tauri:invoke", makeInvokeHandler(win));
  const resolveBaseDir = (baseDir) => {
    if (baseDir === "AppLocalData") return getAppLocalDataPath();
    if (baseDir === "AppData") return app.getPath("appData");
    return "";
  };
  const resolveFsPath = (target, options = {}) => {
    const base = resolveBaseDir(options.baseDir);
    return base ? path.join(base, target) : target;
  };

  safeHandle("lr:path:appLocalDataDir", () => getAppLocalDataPath());
  safeHandle("lr:logs:getLatestPath", async () => {
    return path.join(app.getPath("userData"), "logs", "latest.log");
  });
  safeHandle("lr:path:join", (_e, ...parts) => path.join(...parts.filter(Boolean)));
  safeHandle("lr:shell:open", (_e, url) => shell.openExternal(String(url)));
  safeHandle("lr:drag:start", (event, options = {}) => {
    const file = Array.isArray(options.item) ? options.item[0] : null;
    if (!file) throw new Error("No file supplied for drag");
    const icon = typeof options.icon === "string" && options.icon.startsWith("data:")
      ? nativeImage.createFromDataURL(options.icon)
      : nativeImage.createEmpty();
    event.sender.startDrag({ file: String(file), icon });
    return null;
  });
  safeHandle("lr:clipboard:writeText", (_e, text) => {
    clipboard.writeText(String(text ?? ""));
    return null;
  });
  safeHandle("lr:fs:exists", async (_e, target, options) => {
    try {
      await fs.stat(resolveFsPath(target, options));
      return true;
    } catch {
      return false;
    }
  });
  safeHandle("lr:fs:mkdir", async (_e, target, options) => {
    await fs.mkdir(resolveFsPath(target, options), { recursive: Boolean(options?.recursive) });
    return null;
  });
  safeHandle("lr:fs:readFile", async (_e, target, options) => {
    const data = await fs.readFile(resolveFsPath(target, options));
    return new Uint8Array(data);
  });
  safeHandle("lr:fs:writeFile", async (_e, target, data, options) => {
    const fullPath = resolveFsPath(target, options);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const content = data instanceof Uint8Array ? data : new Uint8Array(data);
    await fs.writeFile(fullPath, content);
    return null;
  });
  safeHandle("lr:app:getVersion", () => app.getVersion());
  safeHandle("lr:updater:check", () => checkAppUpdate());
  safeHandle("lr:updater:downloadAndInstall", (_e, update) => downloadAndInstallAppUpdate(update));
  safeHandle("lr:process:relaunch", () => {
    if (externalInstallerPending) {
      app.quit();
      return null;
    }
    app.relaunch();
    app.exit(0);
  });
  safeHandle("lr:window:isMaximized", () => win.isMaximized());
  safeOn("lr:window:minimize", () => win.minimize());
  safeOn("lr:window:maximize", () => win.maximize());
  safeOn("lr:window:unmaximize", () => win.unmaximize());
  safeOn("lr:window:close", () => win.close());
  safeOn("lr:window:show", () => win.show());
  safeOn("lr:window:focus", () => win.focus());
  safeOn("lr:window:unminimize", () => win.restore());
  safeOn("lr:window:fullscreen", (_e, value) => win.setFullScreen(Boolean(value)));

  if (isDev) {
    void writeLog("main", "loading dev url http://localhost:1420");
    win.loadURL("http://localhost:1420");
  } else {
    const indexPath = appFile("dist", "index.html");
    void writeLog("main", `loading file ${indexPath}`);
    win.loadFile(indexPath);
  }

  win.webContents.on("did-finish-load", () => {
    readSettings()
      .then((s) => {
        registerRecordingHotkeys(s);
        return win.__recordingWatcher.start(s);
      })
      .catch(() => {});
    win.show();
  });
  win.on("closed", () => {
    void writeLog("main", "window closed");
    win.__recordingWatcher?.stop();
  });
}

function toFsPathFromRequestUrl(requestUrl) {
  const u = new URL(requestUrl);
  const decoded = decodeURIComponent(u.pathname || "");
  if (process.platform === "win32") {
    if (u.hostname && /^[a-zA-Z]$/.test(u.hostname)) {
      // lr-file://d:/path -> hostname=d, pathname=/path
      return `${u.hostname.toUpperCase()}:${decoded}`;
    }
    // /C:/Users/... -> C:/Users/...
    if (/^\/[a-zA-Z]:\//.test(decoded)) return decoded.slice(1);
  }
  return decoded;
}

appendBootLog(`main loaded packaged=${app.isPackaged} appPath=${app.getAppPath()}`);

app.whenReady().then(() => {
  return initLogging().then(() => {
    appendBootLog("logging initialized");
    process.on("uncaughtException", (error) => {
      appendBootLog(`uncaughtException ${String(error?.stack || error)}`);
      void writeLog("process", `uncaughtException ${String(error?.stack || error)}`);
    });
    process.on("unhandledRejection", (reason) => {
      appendBootLog(`unhandledRejection ${String(reason)}`);
      void writeLog("process", `unhandledRejection ${String(reason)}`);
    });
  }).then(() => {
  protocol.registerFileProtocol("lr-file", (request, callback) => {
    try {
      const fsPath = toFsPathFromRequestUrl(request.url);
      void writeLog("protocol", `lr-file ${fsPath}`);
      callback({ path: fsPath });
    } catch (error) {
      void writeLog("protocol", `lr-file failed ${String(error)}`);
      callback({ error: -2 });
    }
  });
  createWindow();
  });
}).catch((error) => {
  appendBootLog(`startup failed ${String(error?.stack || error)}`);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  gameMonitor?.stop();
  void recorderController?.shutdown();
});
