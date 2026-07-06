const fs = require("node:fs");
const { findLogsDir, latestLogPath } = require("./electron-log-path.cjs");

const logsDir = findLogsDir();
const latest = latestLogPath(logsDir);
if (!latest || !fs.existsSync(latest)) {
  console.error(`session log not found in: ${logsDir}`);
  process.exit(1);
}
const text = fs.readFileSync(latest, "utf8");
const lines = text.split(/\r?\n/);
const tail = lines.slice(Math.max(0, lines.length - 120)).join("\n");
console.log(tail);
