const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const electronBin = require("electron");

const root = path.resolve(__dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.LR_ELECTRON_DEV = "1";

function findRcedit(projectDir) {
  const fallback = path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  if (fs.existsSync(fallback)) return fallback;

  const cacheDir = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache", "winCodeSign");
  if (fs.existsSync(cacheDir)) {
    const candidates = fs.readdirSync(cacheDir)
      .map((name) => path.join(cacheDir, name, "rcedit-x64.exe"))
      .filter((file) => fs.existsSync(file));
    if (candidates.length > 0) return candidates[0];
  }

  return null;
}

function getDevElectronBin() {
  if (process.platform !== "win32") return electronBin;

  const sourceExe = electronBin;
  const sourceDir = path.dirname(sourceExe);
  const devExe = path.join(sourceDir, "LeagueRecordDev.exe");
  const iconPath = path.join(root, "app-icon.ico");
  const stampPath = `${devExe}.icon-stamp.json`;
  const sourceStat = fs.statSync(sourceExe);
  const iconStat = fs.statSync(iconPath);
  const nextStamp = {
    sourceMtimeMs: sourceStat.mtimeMs,
    iconMtimeMs: iconStat.mtimeMs,
    iconSize: iconStat.size,
    version: 2,
  };

  let currentStamp = null;
  try {
    currentStamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
  } catch {}

  const needsRefresh =
    !fs.existsSync(devExe)
    || !currentStamp
    || currentStamp.sourceMtimeMs !== nextStamp.sourceMtimeMs
    || currentStamp.iconMtimeMs !== nextStamp.iconMtimeMs
    || currentStamp.iconSize !== nextStamp.iconSize
    || currentStamp.version !== nextStamp.version;

  if (!needsRefresh) return devExe;

  try {
    fs.copyFileSync(sourceExe, devExe);
  } catch (error) {
    if (error && error.code === "EBUSY" && fs.existsSync(devExe)) {
      console.warn("LeagueRecordDev.exe is currently locked; using the existing dev executable. Close the running app once to refresh its icon.");
      return devExe;
    }
    throw error;
  }
  const rcedit = findRcedit(root);
  if (!rcedit) {
    console.warn("rcedit.exe was not found; dev taskbar icon may remain Electron default.");
    return devExe;
  }

  const result = spawnSync(rcedit, [
    devExe,
    "--set-version-string", "FileDescription", "LeagueRecord Electron Dev",
    "--set-version-string", "ProductName", "LeagueRecord Electron Dev",
    "--set-version-string", "InternalName", "LeagueRecordDev",
    "--set-version-string", "OriginalFilename", "LeagueRecordDev.exe",
    "--set-version-string", "CompanyName", "arasan95",
    "--set-icon", iconPath,
  ], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`rcedit failed with exit code ${result.status}`);

  fs.writeFileSync(stampPath, JSON.stringify(nextStamp, null, 2), "utf8");
  return devExe;
}

const child = spawn(getDevElectronBin(), ["electron/main.cjs"], {
  cwd: root,
  stdio: "inherit",
  env,
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("Failed to start Electron:", error);
  process.exit(1);
});
