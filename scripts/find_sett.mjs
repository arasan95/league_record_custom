import { readFileSync } from "fs";
const text = readFileSync(".vscode/all_tooltips_plain.txt", "utf8");
const lines = text.split("\n");
let inSett = false;
for (const line of lines) {
  if (line.includes("=== Sett ===")) inSett = true;
  else if (line.startsWith("===") && inSett) break;
  if (inSett) console.log(line);
}
