const fs = require("node:fs");
const { findLogsDir, latestLogPath, readText } = require("./electron-log-path.cjs");

const logsDir = findLogsDir();

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

const file = process.argv[2] || latestLogPath(logsDir);
if (!file || !fs.existsSync(file)) {
  console.error(`No log file found in ${logsDir}`);
  process.exit(1);
}

const text = readText(file);
const lines = text.split(/\r?\n/);
const interesting = lines.filter((line) => (
  line.includes("[game-monitor]")
  || line.includes("[recording]")
  || line.includes("[recorder]")
  || line.includes("[metadata]")
  || line.includes("auto")
  || line.includes("failed")
  || line.includes("error")
));

console.log(`Log: ${file}`);
console.log(`Lines: ${lines.length}`);
console.log(`Phase changes: ${countMatches(text, /\[game-monitor\] phase=/g)}`);
console.log(`Auto candidates: ${countMatches(text, /auto candidate/g)}`);
console.log(`Auto starts: ${countMatches(text, /starting manual=false/g)}`);
console.log(`Auto start failures: ${countMatches(text, /auto start failed/g)}`);
console.log(`Auto stops: ${countMatches(text, /stopping recording/g)}`);
console.log(`GameStarted live confirmations: ${countMatches(text, /in-game API first success/g)}`);
console.log(`Live capture failures: ${countMatches(text, /live capture tick failed/g)}`);
console.log(`Live capture samples: ${countMatches(text, /live capture players=/g)}`);
console.log(`Live item additions: ${countMatches(text, /live (?:item events added|capture .*added=[1-9])/g)}`);
console.log(`Participant maps: ${countMatches(text, /participant map size=/g)}`);
console.log(`Synthetic metadata resolves: ${countMatches(text, /synthetic item events raw=/g)}`);
console.log(`Deferred fallbacks: ${countMatches(text, /writing Deferred fallback/g)}`);
console.log("");
console.log("Recent recording-related lines:");
console.log(interesting.slice(-160).join("\n"));
