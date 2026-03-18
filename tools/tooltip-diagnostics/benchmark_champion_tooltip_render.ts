import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildLocalChampionTooltipHtml, __setTooltipDebugCaches } from "../../src/ts/tooltip";

type BenchRow = {
  champion: string;
  totalMs: number;
  slotMaxMs: number;
  slotAvgMs: number;
  slotCount: number;
  status: "ok" | "timeout" | "error";
  error?: string;
  hottestToken?: {
    token: string;
    total: number;
    resolve: number;
    normalize: number;
    calc: number;
    hits: number;
    slot: string;
  };
};

const argMap = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const cur = process.argv[i];
  if (!cur.startsWith("--")) continue;
  const key = cur.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) {
    argMap.set(key, "1");
    continue;
  }
  argMap.set(key, next);
  i++;
}

const locale = argMap.get("locale") || "ja_JP";
const timeoutMs = Math.max(0, Number(argMap.get("timeout-ms") || 10000));
const slowThresholdMs = Math.max(0, Number(argMap.get("slow-ms") || 250));
const topN = Math.max(1, Number(argMap.get("top") || 30));

const appData = process.env.APPDATA || "";
const localAppData = process.env.LOCALAPPDATA || "";
const dbPath = argMap.get("db-path") || `${appData}/com.leaguerecord.custom/tooltip_db/tooltip_data.db`;
const cacheDir = argMap.get("cache-dir") || `${localAppData}/com.leaguerecord.custom/tooltip_cache`;

const fallbackPath = resolve(cacheDir, "tooltip_variable_fallback.json");
const calcPath = resolve(cacheDir, "all_calc_formulas.json");

const fallbackMap = JSON.parse(readFileSync(fallbackPath, "utf-8"));
const calcMap = JSON.parse(readFileSync(calcPath, "utf-8"));
__setTooltipDebugCaches(fallbackMap, calcMap);

const db = new Database(dbPath, { readonly: true });
const row = db.query("SELECT data_json FROM champion_tooltips WHERE locale = ?").get(locale) as any;
if (!row?.data_json) {
  throw new Error(`locale not found in DB: ${locale}`);
}

const allChampions = JSON.parse(String(row.data_json || "{}")) as Record<string, any>;
const names = Object.keys(allChampions).sort((a, b) => a.localeCompare(b));

const rows: BenchRow[] = [];
if (names.length > 0) {
  try {
    await buildLocalChampionTooltipHtml(allChampions[names[0]], locale.split("_")[0], null, { timeoutMs });
  } catch {}
}
for (let i = 0; i < names.length; i++) {
  const champion = names[i];
  const champData = allChampions[champion];
  let profile: any = null;
  const t0 = performance.now();
  let status: BenchRow["status"] = "ok";
  let error = "";
  try {
    await buildLocalChampionTooltipHtml(champData, locale.split("_")[0], null, {
      timeoutMs,
      onProfile: (p) => {
        profile = p;
      },
    });
  } catch (e) {
    const msg = String((e as any)?.message || e || "");
    if (msg.includes("tooltip_render_timeout")) {
      status = "timeout";
    } else {
      status = "error";
    }
    error = msg;
  }
  const totalMs = Number((performance.now() - t0).toFixed(2));

  const slotValues = Object.entries<any>(profile?.slots || {});
  const slotMs = slotValues.map(([, s]) => Number(s?.ms || 0));
  const slotMaxMs = slotMs.length ? Math.max(...slotMs) : 0;
  const slotAvgMs = slotMs.length ? Number((slotMs.reduce((a, b) => a + b, 0) / slotMs.length).toFixed(2)) : 0;

  let hottestToken: BenchRow["hottestToken"];
  const tokenEntries: Array<BenchRow["hottestToken"]> = [];
  for (const [slot, s] of slotValues) {
    for (const tok of (s?.topTokenStageCosts || []) as any[]) {
      tokenEntries.push({
        token: String(tok?.token || ""),
        total: Number(tok?.total || 0),
        resolve: Number(tok?.resolve || 0),
        normalize: Number(tok?.normalize || 0),
        calc: Number(tok?.calc || 0),
        hits: Number(tok?.hits || 0),
        slot,
      });
    }
  }
  tokenEntries.sort((a, b) => (b?.total || 0) - (a?.total || 0));
  hottestToken = tokenEntries[0];

  rows.push({ champion, totalMs, slotMaxMs, slotAvgMs, slotCount: slotValues.length, status, error, hottestToken });

  if ((i + 1) % 20 === 0 || i + 1 === names.length) {
    console.log(`progress ${i + 1}/${names.length}`);
  }
}

rows.sort((a, b) => b.totalMs - a.totalMs);

const slowRows = rows.filter((r) => r.totalMs >= slowThresholdMs || r.status !== "ok");

const outPath = (() => {
  const custom = argMap.get("out");
  if (custom) return resolve(custom);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(`tmp/tooltip_diagnostics/${stamp}/render_benchmark_${locale}.json`);
})();

mkdirSync(dirname(outPath), { recursive: true });

const report = {
  locale,
  generatedAt: new Date().toISOString(),
  timeoutMs,
  slowThresholdMs,
  dbPath,
  cacheDir,
  championCount: rows.length,
  slowCount: slowRows.length,
  top: rows.slice(0, topN),
  slow: slowRows,
};

writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

console.log(`WROTE ${outPath}`);
console.log(`TOP_${Math.min(topN, rows.length)}`);
for (const r of rows.slice(0, topN)) {
  const tok = r.hottestToken;
  const cause = tok && tok.total > 0
    ? (tok.normalize / tok.total >= 0.8 ? "normalize" : tok.resolve / tok.total >= 0.8 ? "resolve" : "mixed")
    : "none";
  console.log(`${r.champion.padEnd(16)} total=${r.totalMs.toFixed(1)}ms slotMax=${r.slotMaxMs.toFixed(1)}ms status=${r.status} cause=${cause} token=${tok?.token || "-"}`);
}
