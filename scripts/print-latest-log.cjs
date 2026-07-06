const fs = require("node:fs");
const { findLogsDir, latestLogPath } = require("./electron-log-path.cjs");

const logsDir = findLogsDir();
const latest = latestLogPath(logsDir);
if (!latest || !fs.existsSync(latest)) {
  console.error(`session log not found in: ${logsDir}`);
  process.exit(1);
}
console.log(latest);
