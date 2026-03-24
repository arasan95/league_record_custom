import { promises as fs } from "node:fs";
import path from "node:path";

const TARGET_ROOTS = ["src", "src-tauri/src"];
const TARGET_EXTENSIONS = new Set([".ts", ".rs"]);

/**
 * Exactly one rule must match each source file.
 * Keep directory-level rules mutually exclusive to avoid accidental overlap.
 */
const RULES = [
  // Frontend
  { area: "frontend.contract", pattern: /^src\/bindings\.ts$/ },
  { area: "frontend.platform-types", pattern: /^src\/vite-env\.d\.ts$/ },
  { area: "frontend.runtime", pattern: /^src\/ts\/main\.ts$/ },
  { area: "frontend.runtime", pattern: /^src\/ts\/main_.*\.ts$/ },
  { area: "frontend.ui", pattern: /^src\/ts\/ui\.ts$/ },
  { area: "frontend.ui", pattern: /^src\/ts\/ui\/.*\.ts$/ },
  { area: "frontend.ui", pattern: /^src\/ts\/titlebar\.ts$/ },
  { area: "frontend.ui", pattern: /^src\/ts\/ui_methods_temp\.ts$/ },
  { area: "frontend.tooltip", pattern: /^src\/ts\/tooltip\.ts$/ },
  { area: "frontend.tooltip", pattern: /^src\/ts\/tooltip_variable_fallback\.ts$/ },
  { area: "frontend.data", pattern: /^src\/ts\/datadragon\.ts$/ },
  { area: "frontend.data", pattern: /^src\/ts\/assets\.ts$/ },
  { area: "frontend.data", pattern: /^src\/ts\/version\.ts$/ },
  { area: "frontend.domain", pattern: /^src\/ts\/queues\.ts$/ },
  { area: "frontend.domain", pattern: /^src\/ts\/objectives\.ts$/ },
  { area: "frontend.domain", pattern: /^src\/ts\/timeline\.ts$/ },
  { area: "frontend.input", pattern: /^src\/ts\/keybinds\.ts$/ },
  { area: "frontend.events", pattern: /^src\/ts\/listeners\.ts$/ },
  { area: "frontend.common", pattern: /^src\/ts\/util\.ts$/ },
  { area: "frontend.i18n", pattern: /^src\/ts\/i18n\.ts$/ },
  { area: "frontend.contract", pattern: /^src\/ts\/bindings\.ts$/ },

  // Backend
  { area: "backend.bootstrap", pattern: /^src-tauri\/src\/main\.rs$/ },
  { area: "backend.commands", pattern: /^src-tauri\/src\/commands\.rs$/ },
  { area: "backend.commands", pattern: /^src-tauri\/src\/commands\/.*\.rs$/ },
  { area: "backend.constants", pattern: /^src-tauri\/src\/constants\.rs$/ },
  { area: "backend.filewatcher", pattern: /^src-tauri\/src\/filewatcher\.rs$/ },
  { area: "backend.build-tools", pattern: /^src-tauri\/src\/generate_bindings\.rs$/ },
  { area: "backend.common", pattern: /^src-tauri\/src\/util\.rs$/ },
  { area: "backend.app-shell", pattern: /^src-tauri\/src\/app\/.*\.rs$/ },
  { area: "backend.recorder", pattern: /^src-tauri\/src\/recorder\/.*\.rs$/ },
  { area: "backend.state", pattern: /^src-tauri\/src\/state\/.*\.rs$/ },
  { area: "backend.wad", pattern: /^src-tauri\/src\/wad\/.*\.rs$/ },
  { area: "backend.dev-bin", pattern: /^src-tauri\/src\/bin\/.*\.rs$/ },
];

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (TARGET_EXTENSIONS.has(ext)) {
        files.push(full);
      }
    }
  }
  return files;
}

function normalizeToRepoPath(repoRoot, absolutePath) {
  const rel = path.relative(repoRoot, absolutePath);
  return rel.split(path.sep).join("/");
}

function matchedAreas(relPath) {
  return RULES.filter((r) => r.pattern.test(relPath)).map((r) => r.area);
}

function printList(title, list) {
  if (list.length === 0) return;
  console.error(`\n${title} (${list.length})`);
  for (const item of list) {
    console.error(`- ${item}`);
  }
}

async function main() {
  const repoRoot = process.cwd();
  const files = [];
  for (const root of TARGET_ROOTS) {
    const abs = path.join(repoRoot, root);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isDirectory()) {
      console.error(`Missing target root: ${root}`);
      process.exit(1);
    }
    await walk(abs, files);
  }

  const relFiles = files
    .map((f) => normalizeToRepoPath(repoRoot, f))
    .sort((a, b) => a.localeCompare(b));

  const unmapped = [];
  const ambiguous = [];
  const areaCount = new Map();

  for (const rel of relFiles) {
    const areas = matchedAreas(rel);
    if (areas.length === 0) {
      unmapped.push(rel);
      continue;
    }
    if (areas.length > 1) {
      ambiguous.push(`${rel} -> [${areas.join(", ")}]`);
      continue;
    }
    areaCount.set(areas[0], (areaCount.get(areas[0]) ?? 0) + 1);
  }

  if (unmapped.length > 0 || ambiguous.length > 0) {
    printList("Unmapped source files", unmapped);
    printList("Ambiguous source files (matched >1 area)", ambiguous);
    console.error("\nResponsibility coverage check failed.");
    process.exit(1);
  }

  const sortedAreas = [...areaCount.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log("Responsibility coverage check passed.");
  console.log(`Checked files: ${relFiles.length}`);
  for (const [area, count] of sortedAreas) {
    console.log(`- ${area}: ${count}`);
  }
}

await main();
