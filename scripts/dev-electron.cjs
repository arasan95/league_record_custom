const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const devUrl = "http://localhost:1420/";
const watchElectronMainEnabled = process.argv.includes("--watch-main");

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 300);
      });
      req.setTimeout(2000, () => {
        req.destroy();
      });
    };
    check();
  });
}

function spawnChild(command, args) {
  return spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: { ...process.env },
  });
}

function terminateChild(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill();
}

function printLogAnalysis() {
  const result = spawnSync(process.execPath, ["scripts/analyze-logs.cjs"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.stdout) console.log(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
}

const devServer = spawnChild("bun", ["run", "dev"]);
let electron = null;
let electronRestartTimer = null;
let shuttingDown = false;

function startElectron() {
  const child = spawnChild("node", ["scripts/start-electron.cjs"]);
  electron = child;
  child.on("exit", (code) => {
    if (!shuttingDown && electron === child && code !== null) {
      shutdown(code ?? 0);
    }
  });
  child.on("error", (error) => {
    console.error("Failed to start Electron:", error);
    shutdown(1);
  });
}

function restartElectron(reason) {
  if (shuttingDown) return;
  if (electronRestartTimer) clearTimeout(electronRestartTimer);
  electronRestartTimer = setTimeout(() => {
    electronRestartTimer = null;
    console.log(`Restarting Electron: ${reason}`);
    const old = electron;
    electron = null;
    if (old) terminateChild(old);
    setTimeout(() => {
      if (!shuttingDown) startElectron();
    }, 300);
  }, 200);
}

function watchElectronMain() {
  const watchTargets = [
    path.join(root, "electron"),
    path.join(root, "scripts", "start-electron.cjs"),
  ];
  for (const target of watchTargets) {
    try {
      const stat = fs.statSync(target);
      fs.watch(target, { recursive: stat.isDirectory() }, (_eventType, filename) => {
        const changed = filename ? String(filename) : target;
        if (changed.includes("~") || changed.endsWith(".tmp")) return;
        restartElectron(changed);
      });
    } catch (error) {
      console.warn(`Could not watch ${target}: ${error.message}`);
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateChild(electron);
  terminateChild(devServer);
  setTimeout(() => {
    printLogAnalysis();
    process.exit(code);
  }, 250);
}

devServer.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`Dev server exited with code ${code ?? 0}`);
    shutdown(code ?? 1);
  }
});

waitForServer(devUrl)
  .then(() => {
    if (watchElectronMainEnabled) {
      console.log("Electron main-process auto-restart is enabled.");
      watchElectronMain();
    } else {
      console.log("Electron main-process auto-restart is disabled. Use electron:dev:watch to enable it.");
    }
    startElectron();
  })
  .catch((error) => {
    console.error(error.message);
    shutdown(1);
  });

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
