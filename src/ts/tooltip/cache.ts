import { BaseDirectory, exists, readFile, writeFile } from "../platform/fs";
import { invoke } from "../platform/core";
import { getCurrentPatchVersion } from "../version";
import { APP_TEXT, getText, type Language } from "../i18n";
import manualFallbackMappingsRaw from "../../assets/fallback_mappings.json";

export let dynamicTooltipFallback: Record<string, Record<string, string>> = {};
export let allCalcFormulas: Record<string, any> = {};
let tooltipFallbackRefreshPromise: Promise<void> | null = null;

// Debug/diagnostics helper: allow offline perf scripts to inject caches without Tauri runtime.
export function __setTooltipDebugCaches(
    fallbackMap: Record<string, Record<string, string>>,
    calcMap: Record<string, any>,
) {
    dynamicTooltipFallback = fallbackMap || {};
    allCalcFormulas = calcMap || {};
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeTooltipMapsKeepingOldValues(
    previous: Record<string, Record<string, string>>,
    next: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
    const merged: Record<string, Record<string, string>> = {};
    for (const spellId of Object.keys(previous || {})) {
        merged[spellId] = { ...(previous[spellId] || {}) };
    }
    for (const spellId of Object.keys(next || {})) {
        const existing = merged[spellId] || {};
        const incoming = next[spellId];
        merged[spellId] = isPlainObject(incoming) ? { ...existing, ...incoming } : existing;
    }
    return merged;
}

function mergeCalcFormulasKeepingOldValues(
    previous: Record<string, any>,
    next: Record<string, any>,
): Record<string, any> {
    const merged: Record<string, any> = { ...(previous || {}) };
    for (const key of Object.keys(next || {})) {
        const existing = merged[key];
        const incoming = next[key];
        if (isPlainObject(existing) && isPlainObject(incoming)) {
            merged[key] = { ...existing, ...incoming };
        } else {
            merged[key] = incoming;
        }
    }
    return merged;
}

function applyManualTooltipFallbackMappings(base: Record<string, Record<string, string>>) {
    const withManual = mergeTooltipMapsKeepingOldValues(base || {}, {});
    const manualFallbackMappings: Record<string, Record<string, string>> = manualFallbackMappingsRaw;
    for (const spellId of Object.keys(manualFallbackMappings)) {
        const existing = withManual[spellId] || {};
        withManual[spellId] = { ...existing, ...manualFallbackMappings[spellId] };
    }
    return withManual;
}

async function readJsonFromAppLocalData(filePath: string): Promise<any | null> {
    try {
        if (!(await exists(filePath, { baseDir: BaseDirectory.AppLocalData }))) {
            return null;
        }
        const raw = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
        return JSON.parse(new TextDecoder().decode(raw));
    } catch (e) {
        console.warn(`Failed to read JSON cache file ${filePath}:`, e);
        return null;
    }
}

export async function initTooltipFallback() {
    const cacheDir = "tooltip_cache";
    const filePath = `${cacheDir}/tooltip_variable_fallback.json`;
    const verPath = `${cacheDir}/tooltip_version.txt`;
    const calcFormulasPath = `${cacheDir}/all_calc_formulas.json`;
    const currentVersion = getCurrentPatchVersion();

    let shouldExtract = false;
    try {
        if (!(await exists(verPath, { baseDir: BaseDirectory.AppLocalData }))) {
            shouldExtract = true;
        } else {
            const rawVer = await readFile(verPath, { baseDir: BaseDirectory.AppLocalData });
            const savedVersion = new TextDecoder().decode(rawVer);
            if (savedVersion !== currentVersion) {
                console.log("Patch version changed. Re-extracting WADs...");
                shouldExtract = true;
            }
        }

        if (!(await exists(filePath, { baseDir: BaseDirectory.AppLocalData }))) {
            shouldExtract = true;
        }
    } catch (e) {
        console.warn("Failed to inspect tooltip cache metadata. Will try extraction and fallback to existing cache:", e);
        shouldExtract = true;
    }

    const existingGenerated =
        (await readJsonFromAppLocalData(filePath)) as Record<string, Record<string, string>> | null;
    const existingCalc = (await readJsonFromAppLocalData(calcFormulasPath)) as Record<string, any> | null;

    if (existingGenerated && isPlainObject(existingGenerated)) {
        dynamicTooltipFallback = applyManualTooltipFallbackMappings(existingGenerated);
        console.log("Loaded tooltip fallbacks from previous cache:", Object.keys(dynamicTooltipFallback).length, "spells");
    } else {
        dynamicTooltipFallback = applyManualTooltipFallbackMappings({});
        console.warn("tooltip_variable_fallback.json not found. Using manual fallback mappings only.");
    }

    if (existingCalc && isPlainObject(existingCalc)) {
        allCalcFormulas = existingCalc;
        console.log("Loaded all_calc_formulas from previous cache with", Object.keys(allCalcFormulas).length, "champions");
    } else {
        allCalcFormulas = {};
        console.warn("all_calc_formulas.json not found. Tooltip formulas may be limited.");
    }

    if (!shouldExtract || tooltipFallbackRefreshPromise) {
        return;
    }

    const previousGeneratedSnapshot = existingGenerated && isPlainObject(existingGenerated) ? existingGenerated : {};
    const previousCalcSnapshot = existingCalc && isPlainObject(existingCalc) ? existingCalc : {};
    tooltipFallbackRefreshPromise = (async () => {
        try {
            console.log("Starting background WAD extraction...");
            await invoke("update_champion_data");
            await writeFile(verPath, new TextEncoder().encode(currentVersion), { baseDir: BaseDirectory.AppLocalData });

            const extractedGenerated =
                (await readJsonFromAppLocalData(filePath)) as Record<string, Record<string, string>> | null;
            const extractedCalc = (await readJsonFromAppLocalData(calcFormulasPath)) as Record<string, any> | null;

            if (extractedGenerated && isPlainObject(extractedGenerated)) {
                const mergedGenerated = mergeTooltipMapsKeepingOldValues(previousGeneratedSnapshot, extractedGenerated);
                dynamicTooltipFallback = applyManualTooltipFallbackMappings(mergedGenerated);
                console.log(
                    "[tooltip-cache] merged fallbacks old=%d new=%d merged=%d",
                    Object.keys(previousGeneratedSnapshot).length,
                    Object.keys(extractedGenerated).length,
                    Object.keys(dynamicTooltipFallback).length,
                );
            }

            if (extractedCalc && isPlainObject(extractedCalc)) {
                allCalcFormulas = mergeCalcFormulasKeepingOldValues(previousCalcSnapshot, extractedCalc);
                console.log(
                    "[tooltip-cache] merged calc formulas old=%d new=%d merged=%d",
                    Object.keys(previousCalcSnapshot).length,
                    Object.keys(extractedCalc).length,
                    Object.keys(allCalcFormulas).length,
                );
            }
        } catch (e) {
            // Keep app usable: if extraction fails, continue using the previous in-memory cache.
            console.warn("WAD extraction failed. Continuing with previous tooltip cache:", e);
        } finally {
            tooltipFallbackRefreshPromise = null;
        }
    })();
}

