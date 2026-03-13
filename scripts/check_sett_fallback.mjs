import { readFileSync } from "fs";
const fallbackData = JSON.parse(readFileSync(".vscode/tooltip_variable_fallback_generated.json", "utf8"));
console.log("SettQ Fallback Data:", fallbackData["SettQ"]);
