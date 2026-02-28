import { BaseDirectory, exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentPatchVersion } from "./version";
import { APP_TEXT, getText, type Language } from "./i18n";

let dynamicTooltipFallback: Record<string, Record<string, string>> = {};

export async function initTooltipFallback() {
    try {
        const cacheDir = "tooltip_cache";
        const filePath = `${cacheDir}/tooltip_variable_fallback.json`;
        const verPath = `${cacheDir}/tooltip_version.txt`;
        const currentVersion = getCurrentPatchVersion();

        let shouldExtract = false;
        
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

        if (shouldExtract) {
            console.log("Starting background WAD extraction...");
            await invoke("update_champion_data");
            await writeFile(verPath, new TextEncoder().encode(currentVersion), { baseDir: BaseDirectory.AppLocalData });
        }

        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const raw = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const str = new TextDecoder().decode(raw);
            dynamicTooltipFallback = JSON.parse(str);
            console.log("Loaded dynamic tooltip fallbacks:", Object.keys(dynamicTooltipFallback).length, "spells");
        }
    } catch (e) {
        console.error("Failed to init tooltip fallbacks:", e);
    }
}

let globalTooltip: HTMLDivElement | null = null;
let currentTooltipTarget: HTMLElement | null = null;
let globalTooltipObserver: MutationObserver | null = null;
let globalTooltipMoveListener: ((e: MouseEvent) => void) | null = null;

export function showGlobalTooltip(target: HTMLElement, html: string) {
    if (!globalTooltip) {
        globalTooltip = document.createElement("div");
        globalTooltip.className = "league-tooltip";
        globalTooltip.style.position = "fixed";
        globalTooltip.style.background = "rgba(10, 20, 30, 0.95)";
        globalTooltip.style.color = "#eee";
        globalTooltip.style.padding = "10px";
        globalTooltip.style.borderRadius = "4px";
        globalTooltip.style.border = "1px solid #c8aa6e";
        globalTooltip.style.zIndex = "999999";
        globalTooltip.style.maxWidth = "800px";
        globalTooltip.style.fontSize = "16px";
        globalTooltip.style.lineHeight = "1.4";
        globalTooltip.style.pointerEvents = "none";
        document.body.appendChild(globalTooltip);
    }
    currentTooltipTarget = target;
    globalTooltip.innerHTML = html;
    globalTooltip.style.display = "block";

    const rect = target.getBoundingClientRect();
    let left = rect.left + rect.width / 2;
    let top = rect.top - 10;
    
    // First apply basic position (resetting any modifications from previous tooltips)
    globalTooltip.style.bottom = "";
    globalTooltip.style.overflowY = "hidden";
    globalTooltip.style.left = `${left}px`;
    globalTooltip.style.top = `${top}px`;
    globalTooltip.style.transform = "translate(-50%, -100%)";
    
    // Wait for the browser to render the tooltip to get its actual height
    requestAnimationFrame(() => {
        if (!globalTooltip) return;
        const tooltipRect = globalTooltip.getBoundingClientRect();
        
        // Check top edge collision
        if (tooltipRect.top < 10) {
            // If it goes above the screen, show it BELOW the target instead
            globalTooltip.style.top = `${rect.bottom + 10}px`;
            globalTooltip.style.transform = "translate(-50%, 0)";
            
            // Re-check bottom edge
            const newTooltipRect = globalTooltip.getBoundingClientRect();
            if (newTooltipRect.bottom > window.innerHeight - 10) {
                // If it still goes below the screen, just fix it to bottom to show as much as possible
                // (User requested no scrollbars)
                globalTooltip.style.top = "auto";
                globalTooltip.style.bottom = "10px";
                globalTooltip.style.transform = "translate(-50%, 0)";
            }
        }
        
        // Check horizontal collisions
        if (tooltipRect.left < 10) {
            globalTooltip.style.left = `10px`;
            globalTooltip.style.transform = globalTooltip.style.transform.replace("-50%", "0");
        } else if (tooltipRect.right > window.innerWidth - 10) {
            globalTooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
            globalTooltip.style.transform = globalTooltip.style.transform.replace("-50%", "0");
        }
    });

    if (globalTooltipObserver) globalTooltipObserver.disconnect();
    const observeRoot = target.parentElement ?? document.body;
    globalTooltipObserver = new MutationObserver(() => {
        if (currentTooltipTarget && !document.contains(currentTooltipTarget)) {
            hideGlobalTooltip();
        }
    });
    globalTooltipObserver.observe(observeRoot, { childList: true, subtree: true });

    if (globalTooltipMoveListener) {
        document.removeEventListener("mousemove", globalTooltipMoveListener);
    }
    let lastMoveCheck = 0;
    globalTooltipMoveListener = (e: MouseEvent) => {
        const now = Date.now();
        if (now - lastMoveCheck < 100) return; 
        lastMoveCheck = now;
        if (!currentTooltipTarget) return;
        const r = currentTooltipTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
            hideGlobalTooltip();
        }
    };
    document.addEventListener("mousemove", globalTooltipMoveListener, { passive: true });
}

export function hideGlobalTooltip() {
    if (globalTooltip) {
        globalTooltip.style.display = "none";
        currentTooltipTarget = null;

        if (globalTooltipObserver) {
            globalTooltipObserver.disconnect();
            globalTooltipObserver = null;
        }
        if (globalTooltipMoveListener) {
            document.removeEventListener("mousemove", globalTooltipMoveListener);
            globalTooltipMoveListener = null;
        }
    }
}

export function buildSummonerSpellTooltipHtml(spellData: any): string {
    return `<b style="color:#c8aa6e; font-size: 13px;">${spellData.name}</b><br>
    <span style="color:#aaa; font-size: 13px;">Cooldown: ${spellData.cooldownBurn}s</span><hr style="border-color:#333; margin:5px 0;">
    <div style="font-size: 13px; color:#ddd;">${spellData.description}</div>`;
}

export function buildItemTooltipHtml(itemData: any): string {
    return `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>
    <div style="color:#aaa; font-size: 13px; margin-bottom: 5px;">Cost: <span style="color:#e8d154">${itemData.gold?.total || 0}g</span></div>
    <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;
}

export function buildTrinketTooltipHtml(itemData: any): string {
    return `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>
    <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;
}

export function buildChampionTooltipHtml(data: any, lang: string = "ja"): string {
    if (!data || !data.spells) return "";
    
    // === Header ===
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 8px;">
            <div>
                <b style="color:#c8aa6e; font-size: 16px;">${data.name}</b> 
                <span style="color:#aaa; font-size: 12px; margin-left: 5px;">${data.title}</span>
            </div>
            <div style="color: #888; font-size: 11px;">${(data.tags || []).join(', ')}</div>
        </div>`;

    // === Passive ===
    if (data.passive) {
        html += `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #333;">
            <b style="color:#ffeb3b; font-size: 13px;">[Passive] ${data.passive.name}</b><br>
            <div style="font-size: 12px; margin-top:2px; color:#ccc; line-height: 1.3;">${data.passive.description}</div>
        </div>`;
    }

    // === Spells (QWER) ===
    for (let i = 0; i < data.spells.length; i++) {
        const spell = data.spells[i];
        const key = ["Q", "W", "E", "R"][i];
        const costText = spell.costBurn && spell.costBurn !== "0" ? `Cost: ${spell.costBurn}` : "No Cost";

        html += `
        <div style="margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <div>
                    <b style="color:#00d2ff; font-size: 13px;">[${key}]</b> 
                    <span style="color:#eee; font-size: 13px; font-weight: bold;">${spell.name}</span>
                </div>
                <div style="color:#aaa; font-size: 11px; text-align: right;">
                    <span style="color:#ffb74d;">${costText}</span> | CD: ${spell.cooldownBurn}s
                </div>
            </div>`;

        // --- CDragon Extended Detailed Stats ---
        let detailItems = [];
        const cleanStat = (val: any) => {
            if (typeof val === 'number') return Math.round(val * 100) / 100;
            if (typeof val === 'string' && !isNaN(Number(val))) return Math.round(Number(val) * 100) / 100;
            return val;
        };

        if (spell.cd_castRange) detailItems.push(`Range: ${cleanStat(spell.cd_castRange)}`);
        if (spell.cd_castTime) detailItems.push(`Cast: ${cleanStat(spell.cd_castTime)}s`);
        if (spell.cd_lineWidth) detailItems.push(`Width: ${cleanStat(spell.cd_lineWidth)}`);
        if (spell.cd_missileSpeed) detailItems.push(`Speed: ${cleanStat(spell.cd_missileSpeed)}`);

        if (detailItems.length > 0) {
            html += `<div style="display: flex; gap: 8px; font-size: 11px; color:#888; margin-top: 2px;">
                        ${detailItems.map(d => `<span>${d}</span>`).join('')}
                     </div>`;
        }



        let descriptionHtml = spell.tooltip || spell.description;
        const originalHasTemplate = /\{\{.*?\}\}/.test(descriptionHtml);

        // Helper function to resolve variables
        // Resolves a key (like 'e1', 'a1', 'maximumtraps') to its array of values
        const resolveVar = (key: string): any[] | null => {
            key = key.toLowerCase();
            
            // 1. Check effectBurn e1, e2...
            if (key.startsWith('e')) {
                const idx = parseInt(key.substring(1), 10);
                if (!isNaN(idx) && spell.effectBurn && spell.effectBurn[idx]) {
                    return [spell.effectBurn[idx]];
                }
            }
            
            // 2. Check DataDragon vars list (a1, f1, etc)
            if (spell.vars) {
                for (const v of spell.vars) {
                    if (v.key && v.key.toLowerCase() === key) {
                        return v.coeff; 
                    }
                }
            }

            // 3. Check CommunityDragon DataValues Map
            if (spell.cd_dataValuesMap) {
                 if (spell.cd_dataValuesMap[key]) return spell.cd_dataValuesMap[key];
                 for (const k of Object.keys(spell.cd_dataValuesMap)) {
                     if (k === `m${key}` || k.includes(key)) return spell.cd_dataValuesMap[k];
                 }
            }

            // 4. Check CommunityDragon BaseMap (for GameCalculation base arrays)
            if (spell.cd_baseMap) {
                 if (spell.cd_baseMap[key]) return spell.cd_baseMap[key];
                 for (const k of Object.keys(spell.cd_baseMap)) {
                     if (k === `m${key}` || k.includes(key)) return spell.cd_baseMap[k];
                 }
            }

            // 5. Retry mapping without the spell slot prefix (e.g. 'wslowpercentage' -> 'slowpercentage')
            if (key.length > 2 && /^[qwer]/i.test(key)) {
                 const noPrefix = key.substring(1);
                 if (spell.cd_dataValuesMap) {
                     if (spell.cd_dataValuesMap[noPrefix]) return spell.cd_dataValuesMap[noPrefix];
                     for (const k of Object.keys(spell.cd_dataValuesMap)) {
                         if (k === `m${noPrefix}` || k.includes(noPrefix)) return spell.cd_dataValuesMap[k];
                     }
                 }
                 if (spell.cd_baseMap) {
                     if (spell.cd_baseMap[noPrefix]) return spell.cd_baseMap[noPrefix];
                     for (const k of Object.keys(spell.cd_baseMap)) {
                         if (k === `m${noPrefix}` || k.includes(noPrefix)) return spell.cd_baseMap[k];
                     }
                 }
            }
            
            // 4. Check cost or cooldown
            if (key === 'cost') return [spell.costBurn];
            if (key === 'cooldown') return [spell.cooldownBurn];
            
            // Manual override for Darius Q & W
            if (spell.id === "DariusCleave") {
                if (key === "bladedamage" && spell.effect && spell.effect[2] && spell.effect[1]) {
                    const base = spell.effect[2].join("/");
                    const adRatio = spell.effect[1].join("/");
                    return [`${base} + (${adRatio})AD%`];
                }
                if (key === "handledamage" && spell.effect && spell.effect[2] && spell.effect[1]) {
                    const pctMult = (spell.effect[6] && typeof spell.effect[6][0] === 'number') ? spell.effect[6][0] / 100 : 0.35;
                    const cleanNum = (n: number) => Math.round(n * 10) / 10;
                    
                    const handleBase = spell.effect[2].map((v: number) => cleanNum(v * pctMult)).join("/");
                    const handleRatio = spell.effect[1].map((v: number) => cleanNum(v * pctMult)).join("/");
                    return [`${handleBase} + (${handleRatio}%AD)`];
                }
            }
            if (spell.id === "DariusNoxianTacticsONH") {
                if (key === "empoweredattackdamage" && spell.effect && spell.effect[4]) {
                     // effect[4] is [1.4, 1.45, 1.5, ...]. The user wants "40/45/50/55/60%AD".
                     const adPct = spell.effect[4].map((v: number) => Math.round((v - 1) * 100)).join("/");
                     return [`${adPct}%AD`];
                }
            }
            
            return null;
        };

        // Try to evaluate basic JS math inside {{ }}
        const evalMath = (expression: string, varsMap: Record<string, string>): number | null => {
            try {
                let expr = expression;
                for (const [k, v] of Object.entries(varsMap)) {
                    expr = expr.replace(new RegExp(`\\\\b${k}\\\\b`, 'gi'), v);
                }
                // only allow basic math characters
                if (!/^[0-9\\.\\+\\-\\*\\/\\(\\)\\s]+$/.test(expr)) return null;
                const result = Function(`'use strict'; return (${expr})`)();
                return typeof result === 'number' && !isNaN(result) ? result : null;
            } catch (e) {
                return null;
            }
        };

        const formatArrayObj = (ranks: any[]): string => {
            if (!ranks || ranks.length === 0) return "?";
            
            let actualRanks = ranks;
            if (ranks.length > 5) {
                 const maxRank = spell.maxrank || 5;
                 actualRanks = ranks.slice(1, maxRank + 1);
            }
            if (actualRanks.length === 0) return "?";

            const cleanNum = (n: any) => {
                 if (typeof n !== 'number') return n;
                 return Math.round(n * 100) / 100;
            };
            const cleanedRanks = actualRanks.map(cleanNum);
            
            const allSame = cleanedRanks.every((v: any) => v === cleanedRanks[0]);
            if (allSame) return cleanedRanks[0].toString();
            return cleanedRanks.join("/");
        };

        // Interpolate {{ expression }} inside description
        descriptionHtml = descriptionHtml.replace(/\{\{\s*(.*?)\s*\}\}/gi, (match: string, p1: string, offset: number, fullStr: string) => {
            const expr = p1.trim().toLowerCase();
            if (expr === 'spellmodifierdescriptionappend') return "";
            
            // --- VARIABLE FALLBACK ---
            // If we have a language-agnostic mapped value for this variable, substitute it immediately!
            const fbMap = dynamicTooltipFallback[spell.id] || {};
            if (fbMap && Object.keys(fbMap).length > 0) {
                 const rawExpr = p1.trim();
                 if (fbMap[rawExpr] !== undefined) return fbMap[rawExpr] ? fbMap[rawExpr] : "";
                 if (fbMap[expr] !== undefined) return fbMap[expr] ? fbMap[expr] : "";
                 
                 const key = expr.split(/\s*[\*\/\+\-]\s*/)[0];
                 if (fbMap[key] !== undefined) return fbMap[key] ? fbMap[key] : "";
                 
                 const noSuffix = key.split('.')[0];
                 if (fbMap[noSuffix] !== undefined) return fbMap[noSuffix] ? fbMap[noSuffix] : "";
            }
            // -------------------------

            
            const nextChar = fullStr.charAt(offset + match.length);
            const isPercentFlagged = spell.cd_isPercentMap && spell.cd_isPercentMap[expr];
            
            // Basic single variable fetch
            if (/^[a-z0-9_]+$/.test(expr)) {
                const resolvedArr = resolveVar(expr);
                let valStr = "?";
                if (resolvedArr) {
                    valStr = formatArrayObj(resolvedArr);
                    if (isPercentFlagged && nextChar !== '%') {
                         valStr += '%';
                    }
                }
                
                if (spell.cd_calcMap && spell.cd_calcMap[expr]) {
                    valStr += ` (${spell.cd_calcMap[expr]})`;
                }
                return valStr;
            }
            
            // Math expression like armor_penetration*100
            // Extract all variable names from the expression
            const varNames = expr.match(/[a-z_]+/gi);
            if (!varNames) return "?";
            
            const valStrMap: Record<string, string> = {};
            const calcStrMap: Record<string, string> = {};
            
            let allResolved = true;
            for (const vName of varNames) {
                 const resolvedArr = resolveVar(vName);
                 if (!resolvedArr) {
                     allResolved = false;
                     break;
                 }
                 valStrMap[vName] = formatArrayObj(resolvedArr);
                 if (spell.cd_calcMap && spell.cd_calcMap[vName]) {
                     calcStrMap[vName] = spell.cd_calcMap[vName];
                 }
            }
            
            if (!allResolved) return "?";
            
            const ranksCount = spell.maxrank || 5;
            const results: (number | string)[] = [];
            for (let i = 0; i < ranksCount; i++) {
                 const iterMap: Record<string, string> = {};
                 for (const vName of varNames) {
                     const arrStr = valStrMap[vName];
                     const parts = arrStr.split("/");
                     iterMap[vName] = parts.length > 1 ? (parts[i] || parts[parts.length-1]) : parts[0];
                 }
                 const evaluated = evalMath(expr, iterMap);
                 results.push(evaluated !== null ? evaluated : "?");
            }
            
            const allSame = results.every((v) => v === results[0]);
            let finalEvalStr = allSame ? results[0].toString() : results.join("/");
            
            // Append any trailing logic calculations
            const calcsToAppend = Object.values(calcStrMap);
            if (calcsToAppend.length > 0) {
                 finalEvalStr += ` (${calcsToAppend.join(' ')})`;
            }
            
        });

        // Clean up broken template remnants (e.g., Aphelios R has incomplete {{ syntax)
        descriptionHtml = descriptionHtml
            .replace(/\?\s*\}\}/g, '')           // ?}} remnants
            .replace(/\{\{\s*[^}]*\?\s*[^}]*\}\}/g, '')  // {{ ... ? ... }} broken templates
            .replace(/\{\{[^}]*$/gm, '');        // unclosed {{ at end of line

        // Colorize Riot's XML tags
        descriptionHtml = descriptionHtml
            .replace(new RegExp("<physicalDamage>", "gi"), '<span style="color:#ffb74d">')
            .replace(new RegExp("</physicalDamage>", "gi"), '</span>')
            .replace(new RegExp("<magicDamage>", "gi"), '<span style="color:#00d2ff">')
            .replace(new RegExp("</magicDamage>", "gi"), '</span>')
            .replace(new RegExp("<status>", "gi"), '<span style="color:#ff4d4d">')
            .replace(new RegExp("</status>", "gi"), '</span>')
            .replace(new RegExp("<keyword[^>]*>", "gi"), '<span style="color:#c8aa6e; font-weight:bold;">')
            .replace(new RegExp("</keyword[^>]*>", "gi"), '</span>')
            .replace(new RegExp("<rules>", "gi"), '<i style="color:#aaa">')
            .replace(new RegExp("</rules>", "gi"), '</i>')
            .replace(new RegExp("<spellName>", "gi"), '<span style="color:#ffd700">')
            .replace(new RegExp("</spellName>", "gi"), '</span>')
            .replace(new RegExp("<trueDamage>", "gi"), '<span style="color:#fff">')
            .replace(new RegExp("</trueDamage>", "gi"), '</span>')
            .replace(new RegExp("<healing>", "gi"), '<span style="color:#11ff11">')
            .replace(new RegExp("</healing>", "gi"), '</span>')
            .replace(new RegExp("<shield>", "gi"), '<span style="color:#e8e8e8; font-weight:bold;">')
            .replace(new RegExp("</shield>", "gi"), '</span>')
            .replace(new RegExp("<speed>", "gi"), '<span style="color:#f5f55a">')
            .replace(new RegExp("</speed>", "gi"), '</span>')
            .replace(new RegExp("<attackSpeed>", "gi"), '<span style="color:#ffcc00">')
            .replace(new RegExp("</attackSpeed>", "gi"), '</span>')
            .replace(new RegExp("<scaleArmor>", "gi"), '<span style="color:#ff9900">')
            .replace(new RegExp("</scaleArmor>", "gi"), '</span>')
            .replace(new RegExp("<scaleMR>", "gi"), '<span style="color:#cc77ff">')
            .replace(new RegExp("</scaleMR>", "gi"), '</span>')
            .replace(new RegExp("<scaleMana>", "gi"), '<span style="color:#5599ff">')
            .replace(new RegExp("</scaleMana>", "gi"), '</span>')
            .replace(new RegExp("<scaleHealth>", "gi"), '<span style="color:#11ff11">')
            .replace(new RegExp("</scaleHealth>", "gi"), '</span>')
            .replace(new RegExp("<scaleAD>", "gi"), '<span style="color:#ffb74d">')
            .replace(new RegExp("</scaleAD>", "gi"), '</span>')
            .replace(new RegExp("<scaleAP>", "gi"), '<span style="color:#7b68ee">')
            .replace(new RegExp("</scaleAP>", "gi"), '</span>')
            .replace(new RegExp("<scaleLv>", "gi"), '<span style="color:#c89b3c">')
            .replace(new RegExp("</scaleLv>", "gi"), '</span>')
            .replace(new RegExp("<attention>", "gi"), '<span style="color:#fff; font-weight:bold;">')
            .replace(new RegExp("</attention>", "gi"), '</span>')
            .replace(new RegExp("<OnHit>", "gi"), '<span style="color:#ffdd44">')
            .replace(new RegExp("</OnHit>", "gi"), '</span>')
            .replace(new RegExp("<passive>", "gi"), '<span style="color:#ddd">')
            .replace(new RegExp("</passive>", "gi"), '</span>')
            .replace(new RegExp("<spellPassive>", "gi"), '<span style="color:#ffeb3b; font-weight:bold;">')
            .replace(new RegExp("</spellPassive>", "gi"), '</span>')
            .replace(new RegExp("<spellActive>", "gi"), '<span style="color:#00d2ff; font-weight:bold;">')
            .replace(new RegExp("</spellActive>", "gi"), '</span>')
            .replace(new RegExp("<recast>", "gi"), '<span style="color:#00bcd4; font-weight:bold;">')
            .replace(new RegExp("</recast>", "gi"), '</span>')
            .replace(new RegExp("<lifeSteal>", "gi"), '<span style="color:#ff5555">')
            .replace(new RegExp("</lifeSteal>", "gi"), '</span>')
            .replace(new RegExp("<keywordStealth>", "gi"), '<span style="color:#c8aa6e;">')
            .replace(new RegExp("</keywordStealth>", "gi"), '</span>')
            .replace(new RegExp("<flavorText>", "gi"), '<span style="color:#999; font-style:italic;">')
            .replace(new RegExp("</flavorText>", "gi"), '</span>')
            .replace(new RegExp("<keywordMajor>", "gi"), '<span style="color:#c8aa6e; font-weight:bold;">')
            .replace(new RegExp("</keywordMajor>", "gi"), '</span>');

        html += `<div style="font-size: 12px; margin-top:5px; color:#ddd; line-height: 1.4;">${descriptionHtml}</div>`;
        html += `</div>`;
    }
    return html;
}
