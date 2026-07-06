const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const userData = path.join(os.homedir(), "AppData", "Roaming", "LeagueRecord");
const latestPtr = path.join(userData, "logs", "latest.log");
if (!fs.existsSync(latestPtr)) {
  console.error(`latest.log not found: ${latestPtr}`);
  process.exit(1);
}
const latest = fs.readFileSync(latestPtr, "utf8").trim();
if (!fs.existsSync(latest)) {
  console.error(`session log not found: ${latest}`);
  process.exit(1);
}
const text = fs.readFileSync(latest, "utf8");
const lines = text.split(/\r?\n/);
const tail = lines.slice(Math.max(0, lines.length - 120)).join("\n");
console.log(tail);
