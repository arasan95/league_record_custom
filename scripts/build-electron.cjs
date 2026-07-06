const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

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

const target = process.argv[2] || "nsis";
const args = ["--win", target, "--x64", "--publish", "never"];
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

ensureLibobsBundle();
ensureTooltipRebuildTool();

const child = spawn("electron-builder", args, {
  env,
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
