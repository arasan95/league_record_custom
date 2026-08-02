const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const asar = require("@electron/asar");

function findRcedit(projectDir) {
  const fallback = path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  if (fs.existsSync(fallback)) return fallback;

  const nodeModulesDir = path.join(projectDir, "node_modules");
  const stack = [nodeModulesDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === "rcedit.exe") {
        return entryPath;
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }

  const cacheDir = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache", "winCodeSign");
  if (fs.existsSync(cacheDir)) {
    const candidates = fs.readdirSync(cacheDir)
      .map((name) => path.join(cacheDir, name, "rcedit-x64.exe"))
      .filter((file) => fs.existsSync(file));
    if (candidates.length > 0) return candidates[0];
  }

  throw new Error("rcedit.exe was not found");
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDir = context.packager.info.projectDir;
  const exePath = path.join(context.appOutDir, "LeagueRecordElectron.exe");
  const generatedIconPath = path.join(projectDir, "release-electron", ".icon-ico", "icon.ico");
  const iconPath = fs.existsSync(generatedIconPath)
    ? generatedIconPath
    : path.join(projectDir, "app-icon.ico");
  const rcedit = findRcedit(projectDir);
  const version = context.packager.appInfo.version;
  const resourcesDir = path.join(context.appOutDir, "resources");
  const appDir = path.join(resourcesDir, "app");
  const asarPath = path.join(resourcesDir, "app.asar");
  const generatedOAuthRelative = "electron/youtube/official-client.generated.cjs";
  const generatedOAuthClient = path.join(appDir, ...generatedOAuthRelative.split("/"));
  let generatedOAuthSource;
  let packagedEntries = [];
  if (fs.existsSync(asarPath)) {
    const archiveEntries = asar.listPackage(asarPath);
    packagedEntries = archiveEntries.map((entry) => entry.replace(/^[/\\]+/, "").replace(/\\/g, "/"));
    if (!packagedEntries.includes(generatedOAuthRelative)) {
      throw new Error("The generated official Desktop OAuth client module is missing from app.asar");
    }
    generatedOAuthSource = asar
      .extractFile(asarPath, generatedOAuthRelative.replace(/\//g, path.sep))
      .toString("utf8");
  } else {
    if (!fs.existsSync(generatedOAuthClient)) {
      throw new Error("The generated official Desktop OAuth client module is missing from the packaged application");
    }
    generatedOAuthSource = fs.readFileSync(generatedOAuthClient, "utf8");
  }
  const legacyOAuthRelativeFiles = [
    "electron/youtube/local-client-id.txt",
    "electron/youtube/local-client-secret.txt",
  ];
  const legacyOAuthFiles = [
    path.join(resourcesDir, "youtube", "client-id.txt"),
    path.join(resourcesDir, "youtube", "client-secret.txt"),
    ...legacyOAuthRelativeFiles.map((entry) => path.join(appDir, ...entry.split("/"))),
  ];
  if (legacyOAuthFiles.some((file) => fs.existsSync(file))
    || legacyOAuthRelativeFiles.some((entry) => packagedEntries.includes(entry))) {
    throw new Error("A legacy plaintext OAuth credential file was included in the packaged application");
  }
  const generatedModule = { exports: {} };
  vm.runInNewContext(generatedOAuthSource, {
    module: generatedModule,
    exports: generatedModule.exports,
    Buffer,
    Uint8Array,
  });
  const packagedOAuth = generatedModule.exports;
  const youtubeDisabled = packagedOAuth?.disabled === true
    && packagedOAuth?.clientId === ""
    && packagedOAuth?.clientSecret === ""
    && packagedOAuth?.publicClient === false;
  if (!youtubeDisabled && (
    typeof packagedOAuth?.clientId !== "string"
    || !packagedOAuth.clientId.endsWith(".apps.googleusercontent.com")
    || typeof packagedOAuth?.clientSecret !== "string"
    || packagedOAuth.clientSecret.length === 0
    || packagedOAuth.publicClient !== true
  )) {
    throw new Error("The generated official Desktop OAuth client module is invalid");
  }
  if (!youtubeDisabled && (
    generatedOAuthSource.includes(packagedOAuth.clientId)
    || generatedOAuthSource.includes(packagedOAuth.clientSecret)
  )) {
    throw new Error("The generated official Desktop OAuth client module contains a plaintext credential value");
  }

  const args = [
    exePath,
    "--set-version-string", "FileDescription", "LeagueRecord Electron",
    "--set-version-string", "ProductName", "LeagueRecord Electron",
    "--set-version-string", "InternalName", "LeagueRecordElectron",
    "--set-version-string", "OriginalFilename", "LeagueRecordElectron.exe",
    "--set-version-string", "CompanyName", "arasan95",
    "--set-version-string", "LegalCopyright", "Copyright (c) arasan95",
    "--set-file-version", version,
    "--set-product-version", version,
    "--set-icon", iconPath,
  ];

  const result = spawnSync(rcedit, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`rcedit failed with exit code ${result.status}`);
};
