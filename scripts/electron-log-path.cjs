const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function candidateUserDataDirs() {
  const roaming = path.join(os.homedir(), "AppData", "Roaming");
  const explicit = process.env.LEAGUE_RECORD_ELECTRON_USER_DATA;
  return [
    explicit,
    path.join(roaming, "LeagueRecord Electron Dev"),
    path.join(roaming, "LeagueRecord Electron"),
  ].filter(Boolean);
}

function findLogsDir() {
  const candidates = candidateUserDataDirs()
    .map((dir) => path.join(dir, "logs"))
    .filter((dir) => fs.existsSync(dir));
  if (candidates.length === 0) return path.join(candidateUserDataDirs()[0], "logs");
  candidates.sort((a, b) => {
    const latestA = path.join(a, "latest.log");
    const latestB = path.join(b, "latest.log");
    const timeA = fs.existsSync(latestA) ? fs.statSync(latestA).mtimeMs : fs.statSync(a).mtimeMs;
    const timeB = fs.existsSync(latestB) ? fs.statSync(latestB).mtimeMs : fs.statSync(b).mtimeMs;
    return timeB - timeA;
  });
  return candidates[0];
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function latestLogPath(logsDir = findLogsDir()) {
  const latestPtr = path.join(logsDir, "latest.log");
  const pointed = readText(latestPtr).trim();
  if (pointed && fs.existsSync(pointed)) return pointed;
  const logs = fs.existsSync(logsDir)
    ? fs.readdirSync(logsDir)
      .filter((name) => /^session-.*\.log$/i.test(name))
      .map((name) => path.join(logsDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  return logs[0] ?? null;
}

module.exports = { findLogsDir, latestLogPath, readText };
