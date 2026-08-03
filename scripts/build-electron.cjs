const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { prepareYouTubeClientId } = require("./youtube-client-id.cjs");

const root = path.resolve(__dirname, "..");

function ensureLibobsBundle() {
  const libobsDir = path.join(root, "src-tauri", "target", "libobs");
  const required = [
    "extprocess_recorder.exe",
    "obs.dll",
    path.join("obs-plugins", "64bit", "win-capture.dll"),
    path.join("data", "libobs", "default.effect"),
  ];
  const ready = required.every((name) => fs.existsSync(path.join(libobsDir, name)));
  if (ready) return;

  console.log("Preparing libobs recorder resources...");
  const cargoArgs = [];
  if (process.env.LEAGUE_RECORD_CARGO_TOOLCHAIN) {
    cargoArgs.push(process.env.LEAGUE_RECORD_CARGO_TOOLCHAIN);
  }
  cargoArgs.push("build");
  if (process.env.LEAGUE_RECORD_CARGO_BINDEPS === "1") {
    cargoArgs.push("-Z", "bindeps");
  }
  cargoArgs.push("--manifest-path", path.join(root, "src-tauri", "Cargo.toml"));

  const result = spawnSync("cargo", cargoArgs, {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo build failed with exit code ${result.status}`);
  }
  const built = required.every((name) => fs.existsSync(path.join(libobsDir, name)));
  if (!built) {
    throw new Error(`libobs recorder resources were not created in ${libobsDir}`);
  }
}

function ensureTooltipRebuildTool() {
  const exeName = process.platform === "win32" ? "rebuild_tooltip_cache.exe" : "rebuild_tooltip_cache";
  const toolPath = path.join(root, "src-tauri", "devtools", "target", "release", exeName);
  if (fs.existsSync(toolPath)) return;

  console.log("Preparing tooltip rebuild helper...");
  const result = spawnSync("cargo", ["build", "--release", "--manifest-path", path.join(root, "src-tauri", "devtools", "Cargo.toml")], {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`tooltip helper cargo build failed with exit code ${result.status}`);
  }
  if (!fs.existsSync(toolPath)) {
    throw new Error(`tooltip rebuild helper was not created at ${toolPath}`);
  }
}

function ensureHotkeyListener() {
  const exeName = process.platform === "win32" ? "hotkey_listener.exe" : "hotkey_listener";
  const toolPath = path.join(root, "src-tauri", "devtools", "target", "release", exeName);
  if (fs.existsSync(toolPath)) return;

  console.log("Preparing raw-input hotkey listener...");
  const result = spawnSync("cargo", ["build", "--release", "--bin", "hotkey_listener", "--manifest-path", path.join(root, "src-tauri", "devtools", "Cargo.toml")], {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`hotkey listener cargo build failed with exit code ${result.status}`);
  }
  if (!fs.existsSync(toolPath)) {
    throw new Error(`hotkey listener was not created at ${toolPath}`);
  }
}

const target = process.argv[2] || "nsis";
const args = ["--win", target, "--x64", "--publish", "never"];
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

const outputDir = path.join(root, "release-electron");
const unpackedDir = path.join(outputDir, "win-unpacked");

const TRANSIENT_ERROR_PATTERN = /ENOENT|EBUSY|EPERM|ELOCKED|EACCES/;

function isUnpackedExeRunning() {
  const exePath = path.join(unpackedDir, "LeagueRecordElectron.exe").toLowerCase();
  try {
    const { execSync } = require("node:child_process");
    const output = execSync(
      "powershell -NoProfile -Command \"Get-Process -Name LeagueRecordElectron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path\"",
      { encoding: "utf8" }
    );
    return output.split(/\r?\n/).some((line) => line.trim().toLowerCase() === exePath);
  } catch {
    return false;
  }
}

function cleanUnpackedDirs() {
  for (const dir of [unpackedDir, `${unpackedDir}.tmp`]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function runElectronBuilder() {
  return new Promise((resolve, reject) => {
    const child = spawn("electron-builder", args, {
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, output }));
  });
}

(async () => {
  const maxAttempts = 3;
  let exitCode = 1;
  let signal = null;

  if (isUnpackedExeRunning()) {
    console.warn("LeagueRecordElectron is running from release-electron\\win-unpacked. Close it before building to avoid locked-file errors.");
  }

  const { generatedModulePath } = prepareYouTubeClientId(root);
  ensureLibobsBundle();
  ensureTooltipRebuildTool();
  if (process.platform === "win32") ensureHotkeyListener();
  cleanUnpackedDirs();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      console.warn(`\nelectron-builder failed; cleaning unpacked output and retrying (attempt ${attempt}/${maxAttempts})...\n`);
      cleanUnpackedDirs();
    }
    let result;
    try {
      result = await runElectronBuilder();
    } catch (err) {
      console.error(err);
      break;
    }
    if (result.signal) {
      signal = result.signal;
      break;
    }
    exitCode = result.code ?? 1;
    if (result.code === 0) break;
    if (attempt >= maxAttempts || !TRANSIENT_ERROR_PATTERN.test(result.output)) break;
  }

  fs.rmSync(generatedModulePath, { force: true });
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(exitCode);
})();
