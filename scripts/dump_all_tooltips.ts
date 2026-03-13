/**
 * dump_all_tooltips.ts  (完全移植版)
 * ------------------------------------
 * tooltip.ts の buildChampionTooltipHtml を完全にそのままコピーし、
 * HTMLを生成 → タグを除去することでアプリと完全に同一のツールチップテキストを出力する。
 *
 * 実行方法:
 *   bun run scripts/dump_all_tooltips.ts
 *
 * 出力:
 *   .vscode/all_tooltips_plain.txt       ← 全チャンプ・全スペル
 *   .vscode/unresolved_tooltips_bun.txt  ← '?' が残るチャンプ
 */

// ===== 定数 =====
const LANG = "ja_JP";
const VSCODE_DIR: string = import.meta.dir;
const PROJECT_ROOT = `${VSCODE_DIR}/..`;
// WAD生成キャッシュ (AppLocalData) --- Tauriアプリが生成する
const APPDATA_FALLBACK = `${process.env.LOCALAPPDATA}/com.leaguerecord.custom/tooltip_cache/tooltip_variable_fallback.json`;
// .vscode/ 内の生成済みJSON (古い参照)
const FALLBACK_GENERATED = `${PROJECT_ROOT}/.vscode/tooltip_variable_fallback_generated.json`;
// 手動マッピング (src/assets/fallback_mappings.json)
const MANUAL_FALLBACK = `${PROJECT_ROOT}/src/assets/fallback_mappings.json`;

// ===== フォールバックマップ構築 (tooltip.ts initTooltipFallback と同一ロジック) =====
let dynamicTooltipFallback: Record<string, Record<string, string>> = {};

// 1. WAD生成キャッシュ (AppLocalData) を優先使用
let loaded = false;
try {
    const f = Bun.file(APPDATA_FALLBACK);
    if (f.size > 0) {
        dynamicTooltipFallback = JSON.parse(await f.text());
        console.log(`Loaded WAD cache: ${Object.keys(dynamicTooltipFallback).length} spells`);
        loaded = true;
    }
} catch {}

// 2. フォールバック: .vscode 内の生成JSON
if (!loaded) {
    try {
        const f = Bun.file(FALLBACK_GENERATED);
        if (f.size > 0) {
            dynamicTooltipFallback = JSON.parse(await f.text());
            console.log(`Loaded .vscode generated: ${Object.keys(dynamicTooltipFallback).length} spells`);
        }
    } catch {}
}

// 3. fallback_mappings.json をマージ (tooltip.ts と同一)
try {
    const manualRaw = JSON.parse(await Bun.file(MANUAL_FALLBACK).text());
    for (const spellId of Object.keys(manualRaw)) {
        if (!dynamicTooltipFallback[spellId]) dynamicTooltipFallback[spellId] = {};
        for (const k of Object.keys(manualRaw[spellId])) {
            dynamicTooltipFallback[spellId][k] = manualRaw[spellId][k];
        }
    }
    console.log(`After manual merge: ${Object.keys(dynamicTooltipFallback).length} spells`);
} catch (e) { console.warn("Could not load fallback_mappings.json:", e); }

// ===== HTTP =====
async function fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
}

// ===== バージョン =====
const versions: string[] = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
const VERSION = versions[0];
console.log(`Version: ${VERSION}`);

// ========================================================================
// CDragon マージ (datadragon.ts の mergeCDragonData をそのまま移植)
// ========================================================================
function mergeCDragonData(champName: string, champData: any, cdragonData: any): any {
    if (!cdragonData) return champData;

    for (let i = 0; i < champData.spells.length; i++) {
        const spell = champData.spells[i];
        const slot  = ["Q", "W", "E", "R"][i];

        const searchStr1 = `Characters/${champName}/Spells/${champName}${slot}Ability/${champName}${slot}`;
        const searchStr2 = `Characters/${champName}/Spells/${champName}${slot}Ability`;
        const searchStr3 = `Characters/${champName}/Spells/${champName}${slot}`;
        const allKeys = Object.keys(cdragonData);
        let cdSpell: any = null;

        // Naafiri ID swap fix: DataDragon has W and R IDs swapped.
        let cdragonSlot = slot;
        if (champName === "Naafiri" && slot === "W") cdragonSlot = "R";
        else if (champName === "Naafiri" && slot === "R") cdragonSlot = "W";

        // Try exact paths first with correct cdragon slot
        const s1 = `Characters/${champName}/Spells/${champName}${cdragonSlot}Ability/${champName}${cdragonSlot}`;
        const s2 = `Characters/${champName}/Spells/${champName}${cdragonSlot}Ability`;
        const s3 = `Characters/${champName}/Spells/${champName}${cdragonSlot}`;
        if (cdragonData[s1]) cdSpell = cdragonData[s1];
        else if (cdragonData[s2]) cdSpell = cdragonData[s2];
        else if (cdragonData[s3]) cdSpell = cdragonData[s3];

        const expectedSlotId = `${champName}${cdragonSlot}`.toLowerCase();
        if (!cdSpell && spell.id.toLowerCase() !== expectedSlotId) {
            const idMatch = spell.id.toLowerCase();
            let bestKey: string | null = null;
            let bestHasCalcs = false;
            for (const k of allKeys) {
                const kl = k.toLowerCase();
                // Avoid mismatches where W matches R or vice versa
                if (champName === "Naafiri" && cdragonSlot === "W" && kl.includes("naafirir")) continue;
                if (champName === "Naafiri" && cdragonSlot === "R" && kl.includes("naafiriw")) continue;

                if (kl.includes(idMatch) && cdragonData[k].mSpell) {
                    const isExact = kl.endsWith("/" + idMatch);
                    const hasCalcs = !!cdragonData[k].mSpell.mSpellCalculations;
                    if (isExact && hasCalcs) { bestKey = k; break; }
                    if (isExact && !bestKey) { bestKey = k; bestHasCalcs = hasCalcs; }
                    if (!bestKey || (hasCalcs && !bestHasCalcs)) { bestKey = k; bestHasCalcs = hasCalcs; }
                }
            }
            if (bestKey) cdSpell = cdragonData[bestKey];
        }
        if (!cdSpell) {
            const slotPattern = `characters/${champName}/spells/${champName}${cdragonSlot}`.toLowerCase();
            let slotBest: string | null = null;
            let slotBestHasCalcs = false;
            for (const k of allKeys) {
                const kl = k.toLowerCase();
                if (kl.startsWith(slotPattern) && cdragonData[k].mSpell) {
                    const afterSlot = kl.substring(slotPattern.length);
                    if (afterSlot === "" || afterSlot.startsWith("ability") || afterSlot.startsWith("/")) {
                        const hasCalcs = !!cdragonData[k].mSpell.mSpellCalculations;
                        if (!slotBest || (hasCalcs && !slotBestHasCalcs)) {
                            slotBest = k; slotBestHasCalcs = hasCalcs;
                        }
                    }
                }
            }
            if (slotBest) cdSpell = cdragonData[slotBest];
        }
        if (!cdSpell) {
            const idMatch = spell.id.toLowerCase();
            let bestKey: string | null = null;
            let bestHasCalcs = false;
            for (const k of allKeys) {
                const kl = k.toLowerCase();
                if (kl.includes(idMatch) && cdragonData[k].mSpell) {
                    const isExact = kl.endsWith("/" + idMatch);
                    const hasCalcs = !!cdragonData[k].mSpell.mSpellCalculations;
                    if (isExact) { bestKey = k; break; }
                    if (!bestKey || (hasCalcs && !bestHasCalcs)) { bestKey = k; bestHasCalcs = hasCalcs; }
                }
            }
            if (bestKey) cdSpell = cdragonData[bestKey];
        }

        if (cdSpell?.mSpell) {
            // CDragonのSpell名（例: "AsheSpiritOfTheHawk"）を保存 → fallback_mappingsのキーとして使う
            const cdKeyFull = allKeys.find(k => cdragonData[k] === cdSpell) ?? "";
            const cdSpellName = cdKeyFull.split("/").pop() ?? "";
            spell.cd_spellName = cdSpellName;  // e.g. "Volley", "AsheSpiritOfTheHawk"
            const ms = cdSpell.mSpell;
            spell.cd_castTime     = ms.mCastTime;
            spell.cd_missileSpeed = ms.missileSpeed;
            spell.cd_castRange    = Array.isArray(ms.castRange) ? ms.castRange[0] : ms.castRange;
            if (ms.castRangeDisplayOverride)
                spell.cd_castRange = Array.isArray(ms.castRangeDisplayOverride) ? ms.castRangeDisplayOverride[0] : ms.castRangeDisplayOverride;
            spell.cd_lineWidth = ms.mLineWidth;

            const cdDataValuesMap: Record<string, any[]> = {};
            for (const k in ms) {
                const val = (ms as any)[k];
                if (typeof val === "number") cdDataValuesMap[k.toLowerCase()] = [val];
                else if (Array.isArray(val) && typeof val[0] === "number") cdDataValuesMap[k.toLowerCase()] = val;
            }
            if (ms.DataValues) {
                for (const dv of ms.DataValues) {
                    if (dv.mName && Array.isArray(dv.mValues)) {
                        const lowerName = dv.mName.toLowerCase();
                        cdDataValuesMap[lowerName] = dv.mValues;
                        // Also store under FNV hash for mSpellCalculations lookups
                        let h = 0x811c9dc5;
                        for (let ci = 0; ci < lowerName.length; ci++) {
                            h ^= lowerName.charCodeAt(ci);
                            h = Math.imul(h, 0x01000193);
                            h >>>= 0;
                        }
                        cdDataValuesMap["{" + h.toString(16).padStart(8, '0') + "}"] = dv.mValues;
                    }
                }
            }
            spell.cd_dataValuesMap = cdDataValuesMap;

            const cdIsPercentMap: Record<string, boolean> = {};
            const cdCalcMap: Record<string, string> = {};
            const scalings: string[] = [];

            if (ms.mSpellCalculations) {
                const processFormulaParts = (targetCalcKey: string, formulaParts: any[], isPercent: boolean, arrayMultiplier?: any[]) => {
                    const localScalings: string[] = [];
                    for (const part of formulaParts) {
                        if (part.__type === "StatByCoefficientCalculationPart" && part.mCoefficient) {
                            let statMatch = part.mStat ? String(part.mStat).replace(/.*\./, "") : "Stat";
                            const formId = String(part.mStatFormula), statId = String(part.mStat);
                            if (statMatch.includes("AttackDamage") || statId === "2" || formId === "2") statMatch = "AD";
                            else if (statMatch.includes("AbilityPower") || statId === "1" || formId === "1") statMatch = "AP";
                            else if (statMatch.includes("Health") || statId === "11") statMatch = "HP";
                            else if (statMatch.includes("Armor") || statId === "5") statMatch = "Armor";
                            else if (statMatch.includes("SpellBlock") || statMatch.includes("MagicResist") || statId === "6") statMatch = "MR";
                            const color = statMatch === "AD" ? "#ffb74d" : statMatch === "AP" ? "#bf55d9" : "";
                            let coeff = part.mCoefficient;
                            if (isPercent) coeff *= 100;
                            if (arrayMultiplier?.length) {
                                const maxRank = spell.maxrank || 5;
                                let mults = arrayMultiplier;
                                if (mults.length > maxRank) mults = mults.slice(1, maxRank + 1);
                                const allSame = mults.every((v: any) => v === mults[0]);
                                if (allSame || mults.length === 0) {
                                    const mNum = mults.length > 0 ? mults[0] : 1;
                                    let s = `+${Math.round(coeff * mNum * 100)}% ${statMatch}`;
                                    if (color) s = `<span style="color:${color}">${s}</span>`;
                                    localScalings.push(s); scalings.push(s);
                                } else {
                                    const joined = mults.map((m: any) => Math.round(coeff * m * 100)).join("/");
                                    let s = `+${joined}% ${statMatch}`;
                                    if (color) s = `<span style="color:${color}">${s}</span>`;
                                    localScalings.push(s); scalings.push(s);
                                }
                            } else {
                                let s = `+${Math.round(coeff * 100)}% ${statMatch}`;
                                if (color) s = `<span style="color:${color}">${s}</span>`;
                                localScalings.push(s); scalings.push(s);
                            }
                        }
                        let namedPart: any = null;
                        if (part.__type === "StatByNamedDataValueCalculationPart") namedPart = part;
                        else if (part.__type === "StatBySubPartCalculationPart" && part.mSubpart?.__type === "NamedDataValueCalculationPart")
                            namedPart = { mDataValue: part.mSubpart.mDataValue, mStat: part.mStat };
                        if (namedPart?.mDataValue) {
                            const dvKey = namedPart.mDataValue.toLowerCase();
                            if (cdDataValuesMap[dvKey]?.length) {
                                let statMatch = namedPart.mDataValue;
                                const statId = String(namedPart.mStat);
                                if (statMatch.includes("ADRatio") || statId === "2") statMatch = "AD";
                                else if (statMatch.includes("APRatio") || statId === "1") statMatch = "AP";
                                else statMatch = "Stat";
                                const color = statMatch === "AD" ? "#ffb74d" : statMatch === "AP" ? "#bf55d9" : "";
                                const maxRank = spell.maxrank || 5;
                                let ranks = cdDataValuesMap[dvKey];
                                if (ranks.length > maxRank) ranks = ranks.slice(1, maxRank + 1);
                                if (arrayMultiplier?.length) {
                                    let mults = arrayMultiplier;
                                    if (mults.length > maxRank) mults = mults.slice(1, maxRank + 1);
                                    ranks = ranks.map((rVal: any, i: number) => {
                                        const m = i < mults.length ? mults[i] : mults[mults.length - 1];
                                        return typeof rVal === "number" ? rVal * m : rVal;
                                    });
                                }
                                const allSame2 = ranks.every((v: any) => v === ranks[0]);
                                const multiplier = isPercent ? 10000 : 100;
                                let scaleStr = allSame2
                                    ? `+${Math.round(ranks[0] * multiplier)}% ${statMatch}`
                                    : `+${ranks.map((v: any) => Math.round(v * multiplier)).join("/")}% ${statMatch}`;
                                if (color) scaleStr = `<span style="color:${color}">${scaleStr}</span>`;
                                localScalings.push(scaleStr); scalings.push(scaleStr);
                            }
                        }
                    }
                    if (localScalings.length > 0) cdCalcMap[targetCalcKey.toLowerCase()] = localScalings.join(" ");
                };

                for (const calcKey in ms.mSpellCalculations) {
                    const calc = ms.mSpellCalculations[calcKey];
                    const isPercent = calc.mDisplayAsPercent === true;
                    if (isPercent) cdIsPercentMap[calcKey.toLowerCase()] = true;
                    if (calc.mFormulaParts) processFormulaParts(calcKey, calc.mFormulaParts, isPercent);
                }
            }

            const cdBaseMap: Record<string, any> = {};
            if (ms.mSpellCalculations) {
                const maxRankCalc = spell.maxrank || 5;

                // resolveFormulaPart: 単一パートを解決 (auto_resolve_all.py から移植)
                const resolveFormulaPart = (part: any, isPct: boolean): string | null => {
                    if (!part || typeof part !== "object") return null;
                    const ptype = part.__type || "";

                    if (ptype === "NamedDataValueCalculationPart") {
                        const dvKey = (part.mDataValue || "").toLowerCase();
                        if (cdDataValuesMap[dvKey]) {
                            let arr = [...cdDataValuesMap[dvKey]];
                            if (arr.length > maxRankCalc + 1) arr = arr.slice(1, maxRankCalc + 1);
                            else if (arr.length > maxRankCalc) arr = arr.slice(0, maxRankCalc);
                            if (isPct) arr = arr.map((v: any) => typeof v === "number" ? Math.round(v * 100 * 10) / 10 : v);
                            else arr = arr.map((v: any) => typeof v === "number" ? Math.round(v * 100) / 100 : v);
                            if (arr.every((v: any) => v === 0)) return null;
                            const allSame2 = arr.every((v: any) => v === arr[0]);
                            return allSame2 ? String(arr[0]) : arr.join("/");
                        }
                        return null;
                    }

                    if (ptype === "ByCharLevelInterpolationCalculationPart") {
                        let s = part.mStartValue ?? 0, e = part.mEndValue ?? 0;
                        if (isPct) { s *= 100; e *= 100; }
                        s = Math.round(s * 10) / 10; e = Math.round(e * 10) / 10;
                        if (s === e) return String(s);
                        return `${s}~${e}`;
                    }

                    if (ptype === "ByCharLevelBreakpointsCalculationPart") {
                        let base = part.mLevel1Value ?? 0, perLvl = part.mInitialBonusPerLevel ?? 0;
                        if (isPct) { base *= 100; perLvl *= 100; }
                        let v1 = Math.round(base * 10) / 10;
                        let v18 = Math.round((base + perLvl * 17) * 10) / 10;
                        if (v1 === v18) return String(v1);
                        return `${v1}~${v18}`;
                    }

                    if (ptype === "NumberCalculationPart") {
                        let num = part.mNumber ?? 0;
                        if (isPct) num *= 100;
                        num = Math.round(num * 100) / 100;
                        if (num === Math.floor(num)) num = Math.floor(num);
                        return String(num);
                    }

                    if (ptype === "ProductOfSubPartsCalculationPart") {
                        const p1 = resolveFormulaPart(part.mPart1, isPct);
                        const p2 = resolveFormulaPart(part.mPart2, false); // only first part gets isPct
                        if (p1 && p2) {
                            try {
                                const n1 = p1.split("/").map(Number), n2 = p2.split("/").map(Number);
                                let result: number[];
                                if (n1.length === 1) result = n2.map(n => Math.round(n1[0] * n * 100) / 100);
                                else if (n2.length === 1) result = n1.map(n => Math.round(n * n2[0] * 100) / 100);
                                else result = n1.map((n, i) => Math.round(n * (n2[i] ?? n2[n2.length-1]) * 100) / 100);
                                const allSame3 = result.every(v => v === result[0]);
                                return allSame3 ? String(result[0]) : result.join("/");
                            } catch { return `${p1} × ${p2}`; }
                        }
                        return p1 || p2;
                    }

                    if (ptype === "SumOfSubPartsCalculationPart" && part.mSubparts) {
                        const results: string[] = [];
                        for (const sp of part.mSubparts) {
                            const r = resolveFormulaPart(sp, isPct);
                            if (r) results.push(r);
                        }
                        return results.length ? results.join(" ") : null;
                    }

                    if (ptype === "StatBySubPartCalculationPart") {
                        const subR = resolveFormulaPart(part.mSubpart, false);
                        if (subR) return subR;
                        return null;
                    }

                    if (ptype === "BuffCounterByNamedDataValueCalculationPart") {
                        const dvKey = (part.mDataValue || "").toLowerCase();
                        if (cdDataValuesMap[dvKey]) {
                            let arr = [...cdDataValuesMap[dvKey]];
                            if (arr.length > maxRankCalc + 1) arr = arr.slice(1, maxRankCalc + 1);
                            if (arr.every((v: any) => v === 0)) return null;
                            const allSame4 = arr.every((v: any) => v === arr[0]);
                            return allSame4 ? String(arr[0]) : arr.join("/");
                        }
                        return null;
                    }

                    return null;
                };

                // resolveCalculation: 計算全体を解決 (GameCalculation / GameCalculationModified)
                const resolveCalculation = (calc: any): { base: string | null; scaling: string | null } => {
                    if (!calc || typeof calc !== "object") return { base: null, scaling: null };
                    const ctype = calc.__type || "";
                    const isPctCalc = calc.mDisplayAsPercent === true;

                    if (ctype === "GameCalculationModified" && calc.mModifiedGameCalculation) {
                        const baseKey = calc.mModifiedGameCalculation;
                        const baseLower = baseKey.toLowerCase();
                        const baseCalc = ms.mSpellCalculations[baseKey] ?? 
                            Object.entries(ms.mSpellCalculations).find(([k]) => k.toLowerCase() === baseLower)?.[1];
                        
                        const baseResult = baseCalc ? resolveCalculation(baseCalc) : { base: null, scaling: null };
                        
                        if (baseResult.base) {
                            const mult = calc.mMultiplier;
                            if (mult) {
                                // Try to resolve multiplier as a static number
                                const resolveMultNum = (m: any): number | null => {
                                    if (m?.mNumber !== undefined) return m.mNumber;
                                    if (m?.__type === "NumberCalculationPart" && m.mNumber !== undefined) return m.mNumber;
                                    if (m?.__type === "SumOfSubPartsCalculationPart" && m.mSubparts) {
                                        let sum = 0; let ok = true;
                                        for (const sp of m.mSubparts) { const v = resolveMultNum(sp); if (v !== null) sum += v; else ok = false; }
                                        return ok ? sum : null;
                                    }
                                    if (m?.__type === "ProductOfSubPartsCalculationPart") {
                                        let prod = 1; let ok = true;
                                        for (const k of ["mPart1", "mPart2"]) { if (m[k]) { const v = resolveMultNum(m[k]); if (v !== null) prod *= v; else ok = false; } }
                                        return ok ? prod : null;
                                    }
                                    if (m?.__type === "NamedDataValueCalculationPart" && m.mDataValue) {
                                        const dvArr = cdDataValuesMap[m.mDataValue.toLowerCase()];
                                        if (dvArr?.length) {
                                            // Only return scalar if all values are the same
                                            const allEqual = dvArr.every((v: any) => v === dvArr[0]);
                                            if (allEqual) return dvArr[0];
                                            // Otherwise return null → array fallback will handle it
                                            return null;
                                        }
                                    }
                                    // StatByCoefficientCalculationPart: default stat value = 2.0
                                    // (e.g. CritDamage defaults to 2.0, making 1+0.5*(2-1)=1.5 for MF Q bounce)
                                    if (m?.__type === "StatByCoefficientCalculationPart") {
                                        return (m.mCoefficient ?? 1) * 2;
                                    }
                                    return null;
                                };
                                const multVal = resolveMultNum(mult);
                                if (multVal !== null) {
                                    try {
                                        const baseNums = baseResult.base.split("/").map(Number);
                                        const result = baseNums.map(n => Math.round(n * multVal * 100) / 100);
                                        const allSame5 = result.every(v => v === result[0]);
                                        return { base: allSame5 ? String(result[0]) : result.join("/"), scaling: baseResult.scaling };
                                    } catch {}
                                }
                                // Fallback: try array-based multiplier (per-rank multiplication)
                                if (multVal === null && mult?.__type === "NamedDataValueCalculationPart" && mult.mDataValue) {
                                    const multArr = cdDataValuesMap[mult.mDataValue.toLowerCase()];
                                    if (multArr?.length) {
                                        try {
                                            const baseNums = baseResult.base.split("/").map(Number);
                                            const maxRk = spell.maxrank || 5;
                                            let mArr = multArr.length > maxRk + 1 ? multArr.slice(1, maxRk + 1) : multArr.length > maxRk ? multArr.slice(0, maxRk) : [...multArr];
                                            const result = baseNums.map((n: number, idx: number) => {
                                                const m = idx < mArr.length ? mArr[idx] : mArr[mArr.length - 1];
                                                return Math.round(n * m * 100) / 100;
                                            });
                                            const allSame6 = result.every((v: number) => v === result[0]);
                                            return { base: allSame6 ? String(result[0]) : result.join("/"), scaling: baseResult.scaling };
                                        } catch {}
                                    }
                                }
                            }
                        }
                        return baseResult;
                    }

                    // Standard GameCalculation with mFormulaParts
                    const parts = calc.mFormulaParts;
                    if (!parts || !Array.isArray(parts)) return { base: null, scaling: null };

                    const baseParts: string[] = [];
                    const scalingParts: string[] = [];

                    for (const part of parts) {
                        const ptype = part?.__type || "";
                        const isScaling = ["StatByCoefficientCalculationPart", "StatByNamedDataValueCalculationPart", 
                            "StatBySubPartCalculationPart", "AbilityResourceByCoefficientCalculationPart"].includes(ptype);
                        
                        if (isScaling) {
                            // handled by processFormulaParts above (already in cdCalcMap)
                            continue;
                        } else {
                            const r = resolveFormulaPart(part, isPctCalc);
                            if (r) baseParts.push(r);
                        }
                    }

                    return { base: baseParts.length ? baseParts[0] : null, scaling: null };
                };

                // Process all calculations
                for (const calcKey in ms.mSpellCalculations) {
                    const calc = ms.mSpellCalculations[calcKey];
                    const result = resolveCalculation(calc);
                    if (result.base !== null) {
                        // Convert string back to array for cdBaseMap
                        const baseStr = result.base;
                        if (baseStr.includes("~")) {
                            cdBaseMap[calcKey.toLowerCase()] = [baseStr];
                        } else if (baseStr.includes("/")) {
                            cdBaseMap[calcKey.toLowerCase()] = baseStr.split("/").map(Number);
                        } else {
                            const num = Number(baseStr);
                            cdBaseMap[calcKey.toLowerCase()] = isNaN(num) ? [baseStr] : [num];
                        }
                    }

                    // Propagate scalings for GameCalculationModified, multiplied by multVal
                    if (calc.__type === "GameCalculationModified" && calc.mModifiedGameCalculation) {
                        const baseCalcScaling = cdCalcMap[calc.mModifiedGameCalculation.toLowerCase()];
                        if (baseCalcScaling && !cdCalcMap[calcKey.toLowerCase()]) {
                            // If we resolved a multiplier, also scale the percentages
                            const resolveMultNum2 = (m: any): number | null => {
                                if (!m) return null;
                                if (m.mNumber !== undefined) return m.mNumber;
                                if (m.__type === "NumberCalculationPart" && m.mNumber !== undefined) return m.mNumber;
                                if (m.__type === "SumOfSubPartsCalculationPart" && m.mSubparts) {
                                    let sum = 0; let ok = true;
                                    for (const sp of m.mSubparts) { const v = resolveMultNum2(sp); if (v !== null) sum += v; else ok = false; }
                                    return ok ? sum : null;
                                }
                                if (m.__type === "ProductOfSubPartsCalculationPart") {
                                    let prod = 1; let ok = true;
                                    for (const k2 of ["mPart1", "mPart2"]) { if (m[k2]) { const v = resolveMultNum2(m[k2]); if (v !== null) prod *= v; else ok = false; } }
                                    return ok ? prod : null;
                                }
                                if (m.__type === "NamedDataValueCalculationPart" && m.mDataValue) {
                                    const dvArr = cdDataValuesMap[m.mDataValue.toLowerCase()];
                                    if (dvArr?.length) return dvArr[0];
                                }
                                if (m.__type === "StatByCoefficientCalculationPart") return (m.mCoefficient ?? 1) * 2;
                                return null;
                            };
                            const multVal2 = calc.mMultiplier ? resolveMultNum2(calc.mMultiplier) : null;
                            if (multVal2 !== null && multVal2 !== 1) {
                                // Scale percentage numbers in the scaling string
                                cdCalcMap[calcKey.toLowerCase()] = baseCalcScaling.replace(/([\d.]+)%/g, (_: string, num: string) => {
                                    return Math.round(parseFloat(num) * multVal2 * 10) / 10 + "%";
                                });
                            } else {
                                cdCalcMap[calcKey.toLowerCase()] = baseCalcScaling;
                            }
                        }
                    }
                }
            }
            spell.cd_baseMap      = cdBaseMap;
            spell.cd_calcMap      = cdCalcMap;
            spell.cd_isPercentMap = cdIsPercentMap;
            spell.cd_scaling      = [...new Set(scalings)];
        }
    }
    return champData;
}

// ========================================================================
// buildChampionTooltipHtml (tooltip.ts からそのままコピー・Tauri依存なし)
// ========================================================================
function buildChampionTooltipHtml(data: any): string {
    if (!data || !data.spells) return "";

    let html = `
        <div>
            <b>${data.name}</b>
            <span>${data.title}</span>
            <div>${(data.tags || []).join(', ')}</div>
        </div>`;

    if (data.passive) {
        html += `
        <div>
            <b>[Passive] ${data.passive.name}</b><br>
            <div>${data.passive.description}</div>
        </div>`;
    }

    for (let i = 0; i < data.spells.length; i++) {
        const spell = data.spells[i];
        const key = ["Q", "W", "E", "R"][i];
        const costText = spell.costBurn && spell.costBurn !== "0" ? `Cost: ${spell.costBurn}` : "No Cost";

        let detailItems: string[] = [];
        const cleanStat = (val: any) => {
            if (typeof val === 'number') return Math.round(val * 100) / 100;
            if (typeof val === 'string' && !isNaN(Number(val))) return Math.round(Number(val) * 100) / 100;
            return val;
        };

        if (spell.cd_castRange)    detailItems.push(`Range: ${cleanStat(spell.cd_castRange)}`);
        if (spell.cd_castTime)     detailItems.push(`Cast: ${cleanStat(spell.cd_castTime)}s`);
        if (spell.cd_lineWidth)    detailItems.push(`Width: ${cleanStat(spell.cd_lineWidth)}`);
        if (spell.cd_missileSpeed) detailItems.push(`Speed: ${cleanStat(spell.cd_missileSpeed)}`);

        const detailsHtml = detailItems.length > 0
            ? `<span>${detailItems.join(' ')}</span>`
            : "";

        html += `
        <div>
            <div>
                <b>[${key}]</b>
                <span>${spell.name}</span>${detailsHtml}
            </div>
            <div>
                <span>${costText}</span> | CD: ${spell.cooldownBurn}s
            </div>
        </div>`;

        let descriptionHtml = spell.tooltip || spell.description;

        if (spell.id === "GangplankQWrapper") {
            descriptionHtml = (spell.description || "") + `<br><br><physicalDamage>{{ e1 }} (+100% AD)</physicalDamage> <gold>(+{{ e2 }} Gold)</gold>`;
        }

        // === tooltip.ts の fnv1a_32 (app と完全に同一: "{hex}" 形式) ===
        const fnv1a_32 = (s: string) => {
            let h = 0x811c9dc5;
            const lower = s.toLowerCase();
            for (let i = 0; i < lower.length; i++) {
                h ^= lower.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
                h >>>= 0;
            }
            return "{" + h.toString(16).padStart(8, '0') + "}";
        };

        // === tooltip.ts の resolveVar (クロージャで spell を参照) ===
        const resolveVar = (key: string): any[] | null => {
            key = key.toLowerCase();
            if (key.startsWith('e')) {
                const idx = parseInt(key.substring(1), 10);
                if (!isNaN(idx) && spell.effectBurn && spell.effectBurn[idx])
                    return [spell.effectBurn[idx]];
            }
            // f{n}.{m} format: sub-indexed effect value (e.g. f2.1 → spell.effect[2][1])
            const fMatch = key.match(/^f(\d+)\.(\d+)$/);
            if (fMatch) {
                const effIdx = parseInt(fMatch[1], 10);
                const subIdx = parseInt(fMatch[2], 10);
                if (spell.effect?.[effIdx]?.[subIdx] !== undefined)
                    return [spell.effect[effIdx][subIdx]];
            }
            if (spell.vars) {
                for (const v of spell.vars)
                    if (v.key && v.key.toLowerCase() === key) return v.coeff;
            }
            if (spell.cd_dataValuesMap) {
                if (spell.cd_dataValuesMap[key]) return spell.cd_dataValuesMap[key];
                for (const k of Object.keys(spell.cd_dataValuesMap))
                    if (k === `m${key}` || k.includes(key)) return spell.cd_dataValuesMap[k];
            }
            if (spell.cd_baseMap) {
                if (spell.cd_baseMap[key]) return spell.cd_baseMap[key];
                for (const k of Object.keys(spell.cd_baseMap))
                    if (k === `m${key}` || k.includes(key)) return spell.cd_baseMap[k];
            }
            if (key.length > 2 && /^[qwer]/i.test(key)) {
                const noPrefix = key.substring(1);
                if (spell.cd_dataValuesMap) {
                    if (spell.cd_dataValuesMap[noPrefix]) return spell.cd_dataValuesMap[noPrefix];
                    for (const k of Object.keys(spell.cd_dataValuesMap))
                        if (k === `m${noPrefix}` || k.includes(noPrefix)) return spell.cd_dataValuesMap[k];
                }
                if (spell.cd_baseMap) {
                    if (spell.cd_baseMap[noPrefix]) return spell.cd_baseMap[noPrefix];
                    for (const k of Object.keys(spell.cd_baseMap))
                        if (k === `m${noPrefix}` || k.includes(noPrefix)) return spell.cd_baseMap[k];
                }
            }
            if (key === 'cost') return [spell.costBurn];
            if (key === 'cooldown') return [spell.cooldownBurn];
            if (spell.id === "DariusCleave") {
                if (key === "bladedamage" && spell.effect?.[2] && spell.effect?.[1])
                    return [`${spell.effect[2].join("/")} + (${spell.effect[1].join("/")})AD%`];
                if (key === "handledamage" && spell.effect?.[2] && spell.effect?.[1]) {
                    const pctMult = (spell.effect[6] && typeof spell.effect[6][0] === 'number') ? spell.effect[6][0] / 100 : 0.35;
                    const cn = (n: number) => Math.round(n * 10) / 10;
                    return [`${spell.effect[2].map((v: number) => cn(v * pctMult)).join("/")} + (${spell.effect[1].map((v: number) => cn(v * pctMult)).join("/")}%AD)`];
                }
            }
            if (spell.id === "DariusNoxianTacticsONH") {
                if (key === "empoweredattackdamage" && spell.effect?.[4])
                    return [`${spell.effect[4].map((v: number) => Math.round((v - 1) * 100)).join("/")}%AD`];
            }
            return null;
        };

        // === tooltip.ts の evalMath ===
        const evalMath = (expression: string, varsMap: Record<string, string>): number | null => {
            try {
                let expr = expression;
                for (const [k, v] of Object.entries(varsMap))
                    expr = expr.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
                if (!/^[0-9\\.\\+\\-\\*\\/\\(\\)\\s]+$/.test(expr)) return null;
                const result = Function(`'use strict'; return (${expr})`)();
                return typeof result === 'number' && !isNaN(result) ? result : null;
            } catch { return null; }
        };

        // === tooltip.ts の formatArrayObj ===
        const formatArrayObj = (ranks: any[]): string => {
            if (!ranks || ranks.length === 0) return "?";
            let actualRanks = ranks;
            if (ranks.length > 5) {
                const maxRank = spell.maxrank || 5;
                actualRanks = ranks.slice(1, maxRank + 1);
            }
            if (actualRanks.length === 0) return "?";
            const cleanNum = (n: any) => typeof n !== 'number' ? n : Math.round(n * 100) / 100;
            const cleanedRanks = actualRanks.map(cleanNum);
            const allSame = cleanedRanks.every((v: any) => v === cleanedRanks[0]);
            if (allSame) return cleanedRanks[0].toString();
            return cleanedRanks.join("/");
        };

        // === tooltip.ts の {{ }} 置換ロジック (完全コピー) ===
        descriptionHtml = descriptionHtml.replace(/\{\{\s*(.*?)\s*\}\}/gi, (match: string, p1: string, offset: number, fullStr: string) => {
            const expr = p1.trim().toLowerCase();
            if (expr === 'spellmodifierdescriptionappend') return "";

            const expandMacros = (str: any): any => {
                if (typeof str !== "string" || !str.includes("{")) return str;
                return str.replace(/\{([a-z0-9_]+)\}/gi, (m, vName) => {
                    const resolved = resolveVar(vName);
                    if (resolved) return formatArrayObj(resolved);
                    return m;
                });
            };

            // spell.id と CDragonのSpell名の両方をfallback_mappingsから参照 (tooltip.ts と同一)
            const fbById   = dynamicTooltipFallback[spell.id] ?? {};
            const fbByCd   = spell.cd_spellName ? (dynamicTooltipFallback[spell.cd_spellName] ?? {}) : {};
            const fbMap    = { ...fbByCd, ...fbById };  // spell.id 優先でマージ
            if (fbMap && Object.keys(fbMap).length > 0) {
                const rawExpr = p1.trim();
                let directVal: string | undefined;
                const fnvHash = fnv1a_32(expr);

                if (fbMap[rawExpr] !== undefined) directVal = fbMap[rawExpr];
                else if (fbMap[expr] !== undefined) directVal = fbMap[expr];
                else if (fbMap[fnvHash] !== undefined) directVal = fbMap[fnvHash];
                else {
                    const key2 = expr.split(/\s*[\*\/\+\-]\s*/)[0];
                    const keyHash = fnv1a_32(key2);
                    if (fbMap[key2] !== undefined) directVal = fbMap[key2];
                    else if (fbMap[keyHash] !== undefined) directVal = fbMap[keyHash];
                    else {
                        const noSuffix = key2.split('.')[0];
                        const noSuffixHash = fnv1a_32(noSuffix);
                        if (fbMap[noSuffix] !== undefined) directVal = fbMap[noSuffix];
                        else if (fbMap[noSuffixHash] !== undefined) directVal = fbMap[noSuffixHash];
                    }
                }

                directVal = expandMacros(directVal);

                if (directVal !== undefined) {
                    let valStr = directVal ? String(directVal) : "";
                    const matchMath = p1.match(/\s*([*\/])\s*(-?[\d.]+)|\s*([+-])\s*([\d.]+)/);
                    if (matchMath) {
                        const op = matchMath[1] || matchMath[3];
                        const num = parseFloat(matchMath[2] || matchMath[4]);
                        if (!isNaN(num)) {
                            valStr = valStr.split('/').map(s => {
                                const v = parseFloat(s);
                                if (isNaN(v)) return s;
                                let res = v;
                                if (op === '*') res *= num;
                                else if (op === '/') res /= num;
                                else if (op === '+') res += num;
                                else if (op === '-') res -= num;
                                const suffix = s.replace(/^[\-\d\.]+/, '');
                                return String(Math.round(res * 100) / 100) + suffix;
                            }).join('/');
                        }
                    } else {
                        const nextCharStr = fullStr.substring(offset + match.length).trimStart();
                        const hasPercentNext = nextCharStr.startsWith('%');
                        const hasSecondsNext = /^秒/.test(nextCharStr);
                        const parts = valStr.split('/');
                        const allSmallDecimals = parts.every(s => {
                            const v = parseFloat(s);
                            if (isNaN(v)) return false;
                            if (v === 0) return true;
                            return (Math.abs(v) < 5.0 && (s.includes('.') || hasPercentNext));
                        });
                        if (allSmallDecimals && parts.length > 0 && !hasSecondsNext) {
                            valStr = parts.map(s => {
                                const v = parseFloat(s);
                                const res = v * 100.0;
                                const suffix = s.replace(/^[\-\d\.]+/, '');
                                return String(Math.round(res * 100) / 100) + suffix;
                            }).join('/');
                            if (!hasPercentNext && !valStr.includes('%')) valStr += '%';
                        }
                    }
                    const calcExpr = expr + "_calc";
                    const calcHash = fnvHash + "_calc";
                    let calcVal = fbMap[calcExpr] !== undefined ? fbMap[calcExpr] : fbMap[calcHash];
                    if (calcVal === undefined && spell.cd_calcMap) {
                        calcVal = spell.cd_calcMap[expr] ?? spell.cd_calcMap[calcExpr];
                    }
                    calcVal = expandMacros(calcVal);
                    if (valStr && calcVal) valStr += ` (${calcVal})`;
                    else if (!valStr && calcVal) valStr = calcVal;
                    return valStr;
                }
            }

            const nextChar = fullStr.charAt(offset + match.length);
            const isPercentFlagged = spell.cd_isPercentMap && spell.cd_isPercentMap[expr];

            if (/^[a-z0-9_]+$/.test(expr)) {
                const resolvedArr = resolveVar(expr);
                let valStr = "?";
                if (resolvedArr) {
                    valStr = formatArrayObj(resolvedArr);
                    if (isPercentFlagged && nextChar !== '%') valStr += '%';
                }
                const calcExpr = expr + "_calc";
                const calcHash = fnv1a_32(expr) + "_calc";
                const _fbById2 = dynamicTooltipFallback[spell.id] ?? {};
                const _fbByCd2 = spell.cd_spellName ? (dynamicTooltipFallback[spell.cd_spellName] ?? {}) : {};
                const fbMap2   = { ..._fbByCd2, ..._fbById2 };
                let calcVal = fbMap2[calcExpr] !== undefined ? fbMap2[calcExpr] : fbMap2[calcHash];
                if (calcVal === undefined && spell.cd_calcMap) {
                    calcVal = spell.cd_calcMap[expr] ?? spell.cd_calcMap[calcExpr];
                }
                calcVal = expandMacros(calcVal);
                if (calcVal) {
                    if (valStr === "?") valStr = `(${calcVal})`;
                    else valStr += ` (${calcVal})`;
                }
                return valStr;
            }

            const varNames = expr.match(/[a-z_]+/gi);
            if (!varNames) return "?";
            const valStrMap: Record<string, string> = {};
            const calcStrMap: Record<string, string> = {};
            let allResolved = true;
            for (const vName of varNames) {
                const resolved2 = resolveVar(vName);
                if (!resolved2) { allResolved = false; break; }
                valStrMap[vName] = formatArrayObj(resolved2);
                if (spell.cd_calcMap?.[vName]) calcStrMap[vName] = spell.cd_calcMap[vName];
            }
            if (!allResolved) return "?";
            const ranksCount = spell.maxrank || 5;
            const results2: (number | string)[] = [];
            for (let ri = 0; ri < ranksCount; ri++) {
                const iterMap: Record<string, string> = {};
                for (const vName of varNames) {
                    const parts2 = valStrMap[vName].split("/");
                    iterMap[vName] = parts2.length > 1 ? (parts2[ri] || parts2[parts2.length - 1]) : parts2[0];
                }
                const evaluated = evalMath(expr, iterMap);
                results2.push(evaluated !== null ? evaluated : "?");
            }
            const allSame2 = results2.every(v => v === results2[0]);
            let finalEvalStr = allSame2 ? results2[0]!.toString() : results2.join("/");
            const calcsToAppend = Object.values(calcStrMap);
            if (calcsToAppend.length > 0) finalEvalStr += ` (${calcsToAppend.join(' ')})`;
            return finalEvalStr;
        });

        // tooltip.ts の後処理 (broken templates cleanup)
        descriptionHtml = descriptionHtml
            .replace(/\?\s*\}\}/g, '')
            .replace(/\{\{\s*[^}]*\?\s*[^}]*\}\}/g, '')
            .replace(/\{\{[^}]*$/gm, '')
            .replace(/%i:[^%]*%/g, '');

        html += `<div>${descriptionHtml}</div>`;
        html += `</div>`;
    }
    return html;
}

// ========================================================================
// HTML → プレーンテキスト変換
// ========================================================================
function htmlToPlain(html: string): string {
    // &nbsp; をスペースに
    let t = html.replace(/&nbsp;/gi, ' ');
    // <br> を改行 → スペース
    t = t.replace(/<br\s*\/?>/gi, ' ');
    // それ以外のタグを除去
    t = t.replace(/<[^>]+>/g, ' ');
    // 連続する空白を1つに
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

// ========================================================================
// メイン処理
// ========================================================================
async function main() {
    const champList = await fetchJson(`https://ddragon.leagueoflegends.com/cdn/${VERSION}/data/${LANG}/champion.json`);
    if (!champList) { console.error("Failed to fetch champion list"); process.exit(1); }

    const champIds: string[] = Object.keys(champList.data).sort();
    console.log(`Champions: ${champIds.length}`);

    const results: { cid: string; html: string; plainText: string }[] = [];
    const CONCURRENCY = 20;

    for (let i = 0; i < champIds.length; i += CONCURRENCY) {
        const chunk = champIds.slice(i, i + CONCURRENCY);
        Bun.stdout.write(`\r  [${Math.min(i + CONCURRENCY, champIds.length)}/${champIds.length}] Fetching...`.padEnd(30));
        
        await Promise.all(chunk.map(async (cid) => {
            try {
                const dd = await fetchJson(`https://ddragon.leagueoflegends.com/cdn/${VERSION}/data/${LANG}/champion/${cid}.json`);
                if (!dd?.data?.[cid]) return;
                let champ = dd.data[cid];

                const cd = await fetchJson(
                    `https://raw.communitydragon.org/latest/game/data/characters/${cid.toLowerCase()}/${cid.toLowerCase()}.bin.json`
                );
                champ = mergeCDragonData(cid, champ, cd);

                const html      = buildChampionTooltipHtml(champ);
                const plainText = htmlToPlain(html);
                
                results.push({ cid, html, plainText });
            } catch (e) {
                console.error(`\nError fetching ${cid}:`, e);
            }
        }));
    }

    results.sort((a, b) => a.cid.localeCompare(b.cid));

    const allLines: string[]         = [];
    const unresolvedLines: string[]  = [];
    const jsonRows: { championId: string; containsQuestionMark: boolean; html: string; plainText: string }[] = [];

    for (const { cid, html, plainText } of results) {
        allLines.push(`=== ${cid} ===`);
        allLines.push(plainText);
        allLines.push("");

        const containsQuestionMark = plainText.includes("?") || html.includes("?");
        jsonRows.push({
            championId: cid,
            containsQuestionMark,
            html,
            plainText,
        });

        if (containsQuestionMark) {
            unresolvedLines.push(`=== ${cid} ===`);
            unresolvedLines.push(plainText);
            unresolvedLines.push("");
        }
    }

    console.log("\n");

    const outAll = `${PROJECT_ROOT}/.vscode/all_tooltips_plain.txt`;
    const outBad = `${PROJECT_ROOT}/.vscode/unresolved_tooltips_bun.txt`;
    const outJson = `${PROJECT_ROOT}/tmp/fallback_tooltips_display.json`;

    await Bun.write(outAll, allLines.join("\n"));
    console.log(`All tooltips → ${outAll}`);

    const badCount = unresolvedLines.filter(l => l.startsWith("===")).length;
    await Bun.write(outBad, `Unresolved champions: ${badCount}\n\n` + unresolvedLines.join("\n"));
    console.log(`Unresolved (${badCount}) → ${outBad}`);

    // UTF-8 BOM to keep Japanese text readable in Windows editors.
    await Bun.write(outJson, "\uFEFF" + JSON.stringify(jsonRows, null, 2));
    console.log(`Fallback tooltip JSON → ${outJson}`);
}

main();
