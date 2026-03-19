import { BaseDirectory, exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentPatchVersion } from "./version";
import { APP_TEXT, getText, type Language } from "./i18n";
import manualFallbackMappingsRaw from "../assets/fallback_mappings.json";

let dynamicTooltipFallback: Record<string, Record<string, string>> = {};
let allCalcFormulas: Record<string, any> = {};

// Debug/diagnostics helper: allow offline perf scripts to inject caches without Tauri runtime.
export function __setTooltipDebugCaches(
    fallbackMap: Record<string, Record<string, string>>,
    calcMap: Record<string, any>,
) {
    dynamicTooltipFallback = fallbackMap || {};
    allCalcFormulas = calcMap || {};
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

    if (shouldExtract) {
        try {
            console.log("Starting background WAD extraction...");
            await invoke("update_champion_data");
            await writeFile(verPath, new TextEncoder().encode(currentVersion), { baseDir: BaseDirectory.AppLocalData });
        } catch (e) {
            // Keep app usable: if extraction fails, continue loading previous cache data.
            console.warn("WAD extraction failed. Falling back to existing tooltip cache:", e);
        }
    }

    try {
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const raw = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const str = new TextDecoder().decode(raw);
            const generated = JSON.parse(str);

            dynamicTooltipFallback = { ...generated };
            const manualFallbackMappings: Record<string, Record<string, string>> = manualFallbackMappingsRaw;

            for (const spellId of Object.keys(manualFallbackMappings)) {
                if (!dynamicTooltipFallback[spellId]) {
                    dynamicTooltipFallback[spellId] = {};
                }
                for (const k of Object.keys(manualFallbackMappings[spellId])) {
                    dynamicTooltipFallback[spellId][k] = manualFallbackMappings[spellId][k];
                }
            }

            console.log("Loaded dynamic tooltip fallbacks:", Object.keys(dynamicTooltipFallback).length, "spells");
        } else {
            console.warn("tooltip_variable_fallback.json not found. Tooltip variable resolution may be limited.");
        }
    } catch (e) {
        console.error("Failed to load tooltip_variable_fallback.json:", e);
    }

    try {
        if (await exists(calcFormulasPath, { baseDir: BaseDirectory.AppLocalData })) {
            const raw = await readFile(calcFormulasPath, { baseDir: BaseDirectory.AppLocalData });
            const str = new TextDecoder().decode(raw);
            allCalcFormulas = JSON.parse(str);
            console.log("Loaded all_calc_formulas with", Object.keys(allCalcFormulas).length, "champions");
        } else {
            console.warn("all_calc_formulas.json not found. Tooltip formulas may be limited.");
        }
    } catch (e) {
        console.error("Failed to load all_calc_formulas.json:", e);
    }
}

let globalTooltip: HTMLDivElement | null = null;
let currentTooltipTarget: HTMLElement | null = null;
let globalTooltipObserver: MutationObserver | null = null;
let globalTooltipMoveListener: ((e: MouseEvent) => void) | null = null;
let globalTooltipWheelListener: ((e: WheelEvent) => void) | null = null;
let globalTooltipMouseDownListener: ((e: MouseEvent) => void) | null = null;

function normalizeScaleCoefficientsForDisplay(html: string): string {
    if (!html) return html;
    const trimNum = (n: number): string => {
        return String(n)
            .replace(/\.0+$/, "")
            .replace(/(\.\d*?[1-9])0+$/, "$1");
    };
    const ratioToPercentText = (n: number): string => {
        const p = n * 100;
        const abs = Math.abs(p);
        let digits = 1;
        if (abs < 0.1) digits = 3;
        else if (abs < 1) digits = 2;
        else if (abs < 10) digits = 1;
        const rounded = Number(p.toFixed(digits));
        return trimNum(rounded);
    };

    const toPercent = (rawNum: string): string | null => {
        const n = Number(rawNum);
        if (!Number.isFinite(n)) return null;
        if (Math.abs(n) > 1) return null;
        return `${ratioToPercentText(n)}%`;
    };
    const convertSeriesToPercent = (raw: string, maxAbs: number = 1, includeOne: boolean = true): string | null => {
        const parts = raw.split(/([~/])/);
        const out: string[] = [];
        let hasNumeric = false;
        for (const part of parts) {
            if (part === "~" || part === "/") {
                out.push(part);
                continue;
            }
            const t = part.trim();
            if (!t) {
                out.push(part);
                continue;
            }
            const n = Number(t);
            if (!Number.isFinite(n) || Math.abs(n) > maxAbs) return null;
            if (!includeOne && Math.abs(n) >= 1) return null;
            out.push(ratioToPercentText(n));
            hasNumeric = true;
        }
        return hasNumeric ? `${out.join("")}%` : null;
    };
    let out = html;

    // e.g. 増加攻撃力x0.1 / AP*0.6 -> 増加攻撃力x10% / AP*60%
    out = out.replace(
        /((?:増加攻撃力|追加攻撃力|合計攻撃力|攻撃力|魔力|AP|AD|bonusAD|bAD)\s*[x×*]\s*)([+\-]?\d*\.\d+)/gi,
        (_m, prefix: string, num: string) => {
            const pct = toPercent(num);
            if (!pct) return `${prefix}${num}`;
            return `${prefix}${pct}`;
        },
    );

    // e.g. +0.5AP / +0.35AD -> +50%AP / +35%AD
    out = out.replace(
        /([+\-]\s*)(\d*\.\d+)\s*(AD|AP|bonusAD|bAD)\b/gi,
        (_m, sign: string, num: string, stat: string) => {
            const pct = toPercent(num);
            if (!pct) return `${sign}${num}${stat}`;
            return `${sign}${pct}${stat}`;
        },
    );

    // e.g. +0.02%AD / +0.01%AP -> +2%AD / +1%AP
    out = out.replace(
        /([+\-]?\s*)(\d*\.\d+)%\s*(AD|AP|bonusAD|bAD)\b/gi,
        (_m, sign: string, num: string, stat: string) => {
            const pct = toPercent(num);
            if (!pct) return `${sign}${num}%${stat}`;
            return `${sign}${pct}${stat}`;
        },
    );

    // e.g. 最大体力の0.1~0.18の魔法ダメージ -> 最大体力の10~18%の魔法ダメージ
    // Also handles already-scaled percent values written without '%' (e.g. 5~9).
    // Applies only to health-based damage clauses to avoid changing unrelated decimals.
    // NOTE:
    // The previous lookahead-heavy regexes here could catastrophically backtrack
    // on long slash-separated rank values (observed with JA Garen passive).
    // We match the numeric block first, then validate the immediate tail context.
    out = out.replace(
        /((?:最大|現在|減少)?体力の)\s*([0-9]*\.?[0-9]+(?:[~/][0-9]*\.?[0-9]+)*)/gi,
        (match: string, prefix: string, series: string, offset: number, full: string) => {
            const tail = full.slice(offset + match.length);
            if (!/^\s*の(?:物理|魔法|確定)?ダメージ/.test(tail)) return match;
            const converted = convertSeriesToPercent(series, 100);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );
    out = out.replace(
        /((?:最大|現在|減少)?体力の)\s*([0-9]*\.?[0-9]+(?:[~/][0-9]*\.?[0-9]+)*)/gi,
        (match: string, prefix: string, series: string, offset: number, full: string) => {
            const tail = full.slice(offset + match.length);
            if (!/^\s*にあたる(?:物理|魔法|確定)?ダメージ/.test(tail)) return match;
            const converted = convertSeriesToPercent(series, 100);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // e.g. 与えたダメージの0.2~0.4の魔法ダメージ / ダメージの0.25にあたる体力を回復
    out = out.replace(
        /((?:与えた|受けた)?(?:物理|魔法|確定)?ダメージの)\s*([0-9]*\.?[0-9]+(?:[~/][0-9]*\.?[0-9]+)*)\s*(?=(?:の(?:物理|魔法|確定)?ダメージ|にあたる体力を回復))/gi,
        (_m, prefix: string, series: string) => {
            const converted = convertSeriesToPercent(series, 1);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // e.g. 移動速度が0.03増加 / 移動速度が0.03 -> 移動速度が3%
    out = out.replace(
        /((?:移動速度|攻撃速度|クリティカル率|ライフスティール|オムニヴァンプ)(?:が|は))\s*([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)\s*(?!%)(?=(?:<\/[^>]+>\s*)?(?:増加|減少|上昇|低下|\(|。|、|,|$))/gi,
        (_m, prefix: string, series: string) => {
            if (/(?:秒|秒間|秒ごと|秒かけて)/.test(series)) return `${prefix}${series}`;
            const converted = convertSeriesToPercent(series, 1, false);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // Broader stat-ratio fallback:
    // e.g. 攻撃速度: 0.03 / 攻撃速度は0.03 など、語尾が「増加」で終わらない表記も補正。
    // Avoid base-stat phrases such as 基礎攻撃速度 0.625.
    out = out.replace(
        /((?:(?!基礎|基本)[^0-9<]{0,8})?(?:移動速度|攻撃速度|クリティカル率|ライフスティール|オムニヴァンプ|ヘイスト|スロウ|ダメージ軽減率|軽減率)\s*(?:が|は|:|：)\s*)([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)(?!%)/gi,
        (_m, prefix: string, series: string) => {
            const converted = convertSeriesToPercent(series, 1, false);
            if (!converted) return `${prefix}${series}`;
            return `${prefix}${converted}`;
        },
    );

    // e.g. 体力0.03/0.04/0.05, 攻撃力0.03(...) など、粒度の粗い stat-label 表記を補正
    out = out.replace(
        /((?:最大|現在|減少)?体力|攻撃力|移動速度|攻撃速度|物理防御|魔法防御)\s*([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)(?!%)(?=(?:<\/[^>]+>\s*)?(?:\(|増加|減少|上昇|低下|の|。|、|,|$))/gi,
        (_m, label: string, series: string) => {
            const converted = convertSeriesToPercent(series, 1, false);
            if (!converted) return `${label}${series}`;
            return `${label}${converted}`;
        },
    );

    // e.g. 100 + (60%AP) * 0.01 -> 1% (+60%AP)
    out = out.replace(
        /([+\-]?(?:\d+\.?\d*|\d*\.\d+)(?:[~/][+\-]?(?:\d+\.?\d*|\d*\.\d+))*)\s*\+\s*\(([^()]*%[a-zA-Z][^()]*)\)\s*\*\s*0\.0*1\b/g,
        (_m, baseSeries: string, scaling: string) => {
            return `${baseSeries} + (${scaling}) * 0.01`;
        },
    );
    out = out.replace(/(%){2,}/g, "%");
    out = out.replace(/\s\*\s/g, " × ");
    return out;
}

function normalizeTooltipTextLight(input: string): string {
    return (input || "")
        .replace(/<br\/>\s*<br\/>\s*<br\/>/g, "<br/><br/>")
        .replace(/\s{2,}/g, " ");
}

function estimateNormalizeComplexity(input: string): number {
    const len = input.length;
    const atVars = (input.match(/@[A-Za-z0-9_.:*+\-]+@/g) || []).length;
    const tags = (input.match(/<[^>]+>/g) || []).length;
    const braces = (input.match(/\{[A-Za-z0-9_]+\}/g) || []).length;
    const ratios = (input.match(/[0-9]+(?:\.[0-9]+)?\/[0-9]+(?:\.[0-9]+)?/g) || []).length;
    return len + atVars * 80 + tags * 20 + braces * 30 + ratios * 40;
}

const NORMALIZE_COMPLEXITY_THRESHOLD = 9000;
const NORMALIZE_SLOW_MS = 24;
const heavyNormalizeBypassKeys = new Set<string>();

function normalizeTooltipTextSafe(input: string, guardKey: string = ""): string {
    if (!input) return input;
    const out = normalizeTooltipTextLight(input);
    // Keep this path intentionally cheap to avoid hover-time UI stalls.
    return out
        .replace(/(%){2,}/g, "%")
        .replace(/\s\*\s(?=\d)/g, " × ");
}

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
        globalTooltip.style.width = "max-content"; // 画面端での極端な幅縮小を防ぐ
        globalTooltip.style.maxWidth = "min(800px, 90vw)"; // 画面幅に応じて可変
        globalTooltip.style.maxHeight = "80vh";
        globalTooltip.style.fontSize = "16px";
        globalTooltip.style.lineHeight = "1.4";
        globalTooltip.style.overflowY = "auto";
        (globalTooltip.style as any).overscrollBehavior = "contain";
        // Keep tooltip non-interactive so hover ownership stays on icon elements.
        globalTooltip.style.pointerEvents = "none";
        document.body.appendChild(globalTooltip);
    }
    currentTooltipTarget = target;
    globalTooltip.innerHTML = html;
    globalTooltip.style.display = "block";

    const rect = target.getBoundingClientRect();
    const viewportMargin = 10;
    const verticalGap = 10;
    const maxTooltipHeight = Math.max(120, window.innerHeight - viewportMargin * 2);

    // Always allow tooltip to use full viewport height before enabling internal scroll.
    globalTooltip.style.bottom = "";
    globalTooltip.style.overflowY = "auto";
    globalTooltip.style.maxHeight = `${maxTooltipHeight}px`;
    globalTooltip.style.transform = "none";

    // Start centered on target, then clamp.
    globalTooltip.style.left = `${rect.left + rect.width / 2}px`;
    globalTooltip.style.top = `${rect.top}px`;

    requestAnimationFrame(() => {
        if (!globalTooltip) return;
        const tooltipRect = globalTooltip.getBoundingClientRect();

        // Prefer above the cursor/target. If not enough room, pin to top edge and keep max height.
        const preferredTop = rect.top - verticalGap - tooltipRect.height;
        let top = Math.max(viewportMargin, preferredTop);
        const maxTop = window.innerHeight - viewportMargin - tooltipRect.height;
        if (top > maxTop) top = Math.max(viewportMargin, maxTop);

        // Center horizontally; clamp within viewport.
        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        left = Math.max(viewportMargin, Math.min(left, window.innerWidth - viewportMargin - tooltipRect.width));

        globalTooltip.style.left = `${left}px`;
        globalTooltip.style.top = `${top}px`;
    });

    if (globalTooltipObserver) globalTooltipObserver.disconnect();
    const observeRoot = target.parentElement ?? document.body;
    globalTooltipObserver = new MutationObserver(() => {
        if (currentTooltipTarget && !document.contains(currentTooltipTarget)) {
            hideGlobalTooltip();
        }
    });
    globalTooltipObserver.observe(observeRoot, { childList: true, subtree: true });
    if (!globalTooltipMouseDownListener) {
        globalTooltipMouseDownListener = (e: MouseEvent) => {
            if (!currentTooltipTarget) return;
            const targetEl = e.target as HTMLElement | null;
            if (!targetEl) {
                hideGlobalTooltip();
                return;
            }
            if (targetEl === currentTooltipTarget || targetEl.closest?.(".champ-icon") === currentTooltipTarget) {
                return;
            }
            hideGlobalTooltip();
        };
        document.addEventListener("mousedown", globalTooltipMouseDownListener, { capture: true });
    }
    if (!globalTooltipWheelListener) {
        globalTooltipWheelListener = (e: WheelEvent) => {
            if (!globalTooltip || globalTooltip.style.display === "none" || !currentTooltipTarget) return;
            const hovered = (currentTooltipTarget as any).matches?.(":hover");
            if (!hovered) return;
            if (globalTooltip.scrollHeight <= globalTooltip.clientHeight) return;
            globalTooltip.scrollTop += e.deltaY;
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener("wheel", globalTooltipWheelListener, { capture: true, passive: false });
    }
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
        if (globalTooltipWheelListener) {
            document.removeEventListener("wheel", globalTooltipWheelListener, true);
            globalTooltipWheelListener = null;
        }
        if (globalTooltipMouseDownListener) {
            document.removeEventListener("mousedown", globalTooltipMouseDownListener, true);
            globalTooltipMouseDownListener = null;
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

export function buildRuneTooltipHtml(runeData: any): string {
    if (!runeData) return "";
    
    // Some runes use shortDesc, some use longDesc. longDesc is preferred if full detail needed.
    let desc = runeData.longDesc || runeData.shortDesc || "";
    
    // Clean up Riot's specific tags
    // e.g. <lol-uikit-tooltipped-keyword key='LinkTooltip_Description_AdaptiveDmg'>Adaptive Damage</lol-uikit-tooltipped-keyword>
    desc = desc.replace(/<lol-uikit-tooltipped-keyword[^>]*>/gi, '<span style="color:#00bcd4; font-weight:bold; border-bottom: 1px dotted #00bcd4;">');
    desc = desc.replace(/<\/lol-uikit-tooltipped-keyword>/gi, '</span>');
    
    // Sometimes there are nested <font> tags or color attributes
    desc = desc.replace(/<font color='([^']*)'>/gi, '<span style="color:$1;">');
    desc = desc.replace(/<\/font>/gi, '</span>');
    desc = normalizeTooltipTextSafe(desc, "rune");

    return `
    <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <img src="https://ddragon.leagueoflegends.com/cdn/img/${runeData.icon}" style="width: 32px; height: 32px; margin-right: 10px; border-radius: 50%;">
        <b style="color:#c8aa6e; font-size: 15px;">${runeData.name}</b>
    </div>
    <div style="font-size: 13px; color:#ddd; max-width: 300px; line-height: 1.4;">${desc}</div>
    `;
}

export function buildChampionTooltipHtml(data: any, lang: string = "ja"): string {
    if (!data || !data.spells) return "";
    
    const ms = data?.stats?.movespeed ?? data?.stats?.moveSpeed;
    const aaRange = data?.stats?.attackrange ?? data?.stats?.attackRange;
    const rightMeta: string[] = [];
    if (typeof ms === "number") rightMeta.push(`MS: ${Math.round(ms)}`);
    if (typeof aaRange === "number") rightMeta.push(`AA: ${Math.round(aaRange)}`);
    if (Array.isArray(data.tags) && data.tags.length > 0) rightMeta.push(data.tags.join(", "));
    
    // === Header ===
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 8px;">
            <div>
                <b style="color:#c8aa6e; font-size: 16px;">${data.name}</b> 
                <span style="color:#aaa; font-size: 12px; margin-left: 5px;">${data.title}</span>
            </div>
            <div style="color: #888; font-size: 11px; text-align: right;">${rightMeta.join(" | ")}</div>
        </div>`;

    // === Passive ===
    if (data.passive) {
        html += `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #333;">
            <b style="color:#ffeb3b; font-size: 13px;">[Passive] ${data.passive.name}</b><br>
            <div style="font-size: 12px; margin-top:2px; color:#ccc; line-height: 1.3;">${data.passive.description}</div>
        </div>`;
    }

    // === Spells (QWER+) ===
    for (let i = 0; i < data.spells.length; i++) {
        const spell = data.spells[i];
        let key = spell.spellKey || ["Q", "W", "E", "R"][i];
        if (!key) key = "Extra";
        const costText = spell.costBurn && spell.costBurn !== "0" ? `Cost: ${spell.costBurn}` : "No Cost";

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

        const detailsHtml = detailItems.length > 0 
            ? `<span style="margin-left: 10px; font-weight: normal; font-size: 11px; color:#888;">${detailItems.join('&nbsp; ')}</span>` 
            : "";

        html += `
        <div style="margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <div>
                    <b style="color:#00d2ff; font-size: 13px;">[${key}]</b> 
                    <span style="color:#eee; font-size: 13px; font-weight: bold;">${spell.name}</span>${detailsHtml}
                </div>
                <div style="color:#aaa; font-size: 11px; text-align: right;">
                    <span style="color:#ffb74d;">${costText}</span> | CD: ${spell.cooldownBurn}s
                </div>
            </div>`;



        let descriptionHtml = spell.tooltip || spell.description;
        // Hide Riot helper hint blocks (e.g. key-bound "show details" prompts) by structural key tag.
        descriptionHtml = descriptionHtml.replace(/<infoArea>[\s\S]*?<\/infoArea>/gi, "");
        
        // Manual override for Gangplank Q to support multiple languages
        if (spell.id === "GangplankQWrapper") {
             descriptionHtml = (spell.description || "") + "<br><br><physicalDamage>{{ e1 }} (+100% AD)</physicalDamage> <gold>(+{{ e2 }} Gold)</gold>";
        }

        const originalHasTemplate = /\{\{.*?\}\}/.test(descriptionHtml);

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

        const fbMap = dynamicTooltipFallback[spell.id] || {};

        // Helper function to resolve variables
        // Resolves a key (like 'e1', 'a1', 'maximumtraps') to its array of values
        const resolveVar = (key: string): any[] | null => {
            key = key.toLowerCase();
            
            // 0. Check locally generated fallback maps first
            if (fbMap) {
                let val = fbMap[key];
                if (val === undefined) val = fbMap[`{${key}}`];
                if (val === undefined) val = fbMap[`m${key}`];
                if (val === undefined) val = fbMap[`${key}_calc`];
                if (val === undefined) val = fbMap[fnv1a_32(key)];
                
                if (val !== undefined && String(val).trim() !== "") {
                    return String(val).split('/');
                }
            }
            
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
            
            // --- FORMULA EVALUATION HELPER ---
            // Evaluates "=baseExpr|ratioExpr:StatName|ratioExpr:StatName" formulas
            // using WAD data values from the same spell entry.
            const evaluateFormulaFallback = (formula: string, wadMap: Record<string, string>, maxRank: number): string | null => {
                if (!formula.startsWith('=')) return null;
                const body = formula.substring(1);
                const sections = body.split('|');
                const baseSection = sections[0];
                const scalingSections = sections.slice(1);

                // Parse a WAD value string into a number array
                const parseWadVal = (name: string): number[] => {
                    name = name.trim().toLowerCase();
                    const raw = wadMap[name];
                    if (!raw) return [];
                    const nums = raw.split('/').map(Number).filter(n => !isNaN(n));
                    if (nums.length > maxRank + 1) return nums.slice(1, maxRank + 1);
                    if (nums.length > maxRank && nums[0] === 0) return nums.slice(1, maxRank + 1);
                    if (nums.length > maxRank) return nums.slice(0, maxRank);
                    return nums;
                };

                // Evaluate a simple expression: supports var, var*var, var*(num+var)
                const evalExpr = (exprStr: string): number[] => {
                    const factors = exprStr.split('*').map(f => f.trim());
                    let result: number[] | null = null;
                    for (const factor of factors) {
                        let values: number[];
                        // (num+var) pattern e.g. (1+critdamagemultiplier)
                        const stripped = factor.replace(/^\(/, '').replace(/\)$/, '');
                        const addMatch = stripped.match(/^([\d.]+)\s*\+\s*(\w+)$/);
                        if (addMatch) {
                            const c = parseFloat(addMatch[1]);
                            const vv = parseWadVal(addMatch[2]);
                            values = vv.length ? vv.map(v => c + v) : [c];
                        } else if (/^[\d.]+$/.test(factor)) {
                            values = [parseFloat(factor)];
                        } else {
                            values = parseWadVal(factor);
                        }
                        if (values.length === 0) continue;
                        if (result === null) {
                            result = values;
                        } else {
                            if (result.length === 1) result = values.map(v => Math.round(result![0] * v * 10000) / 10000);
                            else if (values.length === 1) result = result.map(v => Math.round(v * values[0] * 10000) / 10000);
                            else result = result.map((v, i) => Math.round(v * (values[i] ?? values[values.length-1]) * 10000) / 10000);
                        }
                    }
                    return result || [];
                };

                const formatArr = (arr: number[]) => {
                    if (arr.length === 0) return '';
                    const allSame = arr.every(v => v === arr[0]);
                    return allSame ? String(arr[0]) : arr.join('/');
                };

                const baseVals = evalExpr(baseSection);
                if (baseVals.length === 0) return null;
                let out = formatArr(baseVals);

                // Scaling parts
                const scalings: string[] = [];
                for (const sp of scalingSections) {
                    const colonIdx = sp.lastIndexOf(':');
                    if (colonIdx === -1) continue;
                    const ratioExpr = sp.substring(0, colonIdx).trim();
                    const statName = sp.substring(colonIdx + 1).trim();
                    const ratioVals = evalExpr(ratioExpr);
                    if (ratioVals.length === 0) continue;
                    const pctVals = ratioVals.map(v => Math.round(v * 100 * 10) / 10);
                    const pctStr = formatArr(pctVals);
                    if (pctStr) scalings.push(`+${pctStr}% ${statName}`);
                }
                if (scalings.length > 0) out += ` (${scalings.join(' ')})`;
                return out;
            };

            const expandMacros = (str: any): any => {
                if (typeof str !== "string" || !str.includes("{")) return str;
                return str.replace(/\{([a-z0-9_]+)\}/gi, (m, vName) => {
                    const resolved = resolveVar(vName);
                    if (resolved) {
                        // formatArrayObj logic for tooltip.ts:
                        let actualRanks = resolved;
                        if (actualRanks.length > 5) {
                            const maxR = spell.maxrank || 5;
                            actualRanks = actualRanks.slice(1, maxR + 1);
                        }
                        if (actualRanks.length === 0) return "?";
                        const cleanNum = (n: any) => typeof n !== 'number' ? n : Math.round(n * 100) / 100;
                        const cleanedRanks = actualRanks.map(cleanNum);
                        const allSame = cleanedRanks.every((v: any) => v === cleanedRanks[0]);
                        return allSame ? cleanedRanks[0].toString() : cleanedRanks.join("/");
                    }
                    return m;
                });
            };

            // --- VARIABLE FALLBACK ---
            // If we have a language-agnostic mapped value for this variable, substitute it immediately!
            if (fbMap && Object.keys(fbMap).length > 0) {
                 const rawExpr = p1.trim();
                 let directVal = undefined;
                 const fnvHash = fnv1a_32(expr);
                 
                 if (fbMap[rawExpr] !== undefined) directVal = fbMap[rawExpr];
                 else if (fbMap[expr] !== undefined) directVal = fbMap[expr];
                 else if (fbMap[fnvHash] !== undefined) directVal = fbMap[fnvHash];
                 else {
                     const key = expr.split(/\s*[\*\/\+\-]\s*/)[0];
                     const keyHash = fnv1a_32(key);
                     if (fbMap[key] !== undefined) directVal = fbMap[key];
                     else if (fbMap[keyHash] !== undefined) directVal = fbMap[keyHash];
                     else {
                         const noSuffix = key.split('.')[0];
                         const noSuffixHash = fnv1a_32(noSuffix);
                         if (fbMap[noSuffix] !== undefined) directVal = fbMap[noSuffix];
                         else if (fbMap[noSuffixHash] !== undefined) directVal = fbMap[noSuffixHash];
                     }
                 }
                 
                 directVal = expandMacros(directVal);

                 if (directVal !== undefined) {
                     let valStr = directVal ? String(directVal) : "";

                     // === Formula evaluation: values starting with '=' ===
                     if (valStr.startsWith('=')) {
                         const maxRank = spell.maxrank || 5;
                         const computed = evaluateFormulaFallback(valStr, fbMap, maxRank);
                         if (computed) return computed;
                         return "?";
                     }
                     
                     // ツールチップ内の変数参照に簡単な四則演算（例: * 100, *-100）が含まれている場合、要素ごとに適用する
                     const matchMath = p1.match(/\s*([*\/])\s*(-?[\d.]+)\s*|\s*([+-])\s*([\d.]+)/);
                     if (matchMath) {
                         const op = matchMath[1] || matchMath[3];
                         const num = parseFloat(matchMath[2] || matchMath[4]);
                         if (!isNaN(num)) {
                             // Use regex to find and replace all floating point values in the string, preserving brackets and complex text
                             valStr = valStr.replace(/-?\d+(?:\.\d+)?/g, (matchNum) => {
                                 const v = parseFloat(matchNum);
                                 if (isNaN(v)) return matchNum;
                                 let res = v;
                                 if (op === '*') res *= num;
                                 else if (op === '/') res /= num;
                                 else if (op === '+') res += num;
                                 else if (op === '-') res -= num;
                                 return String(Math.round(res * 1000) / 1000);
                             });
                         }
                     } else {
                         // 数式がなく、値がすべて5.0未満の小数である場合は100倍する（例: 0.4 -> 40%表示）
                         // (Often Riot's tooltips forget the % sign or are formatted weirdly)
                         const nextCharStr = fullStr.substring(offset + match.length).trimStart();
                         const hasPercentNext = nextCharStr.startsWith('%');
                         const hasSecondsNext = /^秒/.test(nextCharStr);
                         
                         const parts = valStr.split('/');
                         
                         // Check if ALL parts are small decimals (e.g. 0.4, 0.45) AND not just plain 0
                         // Try resolving the prefix before any complex calculation scaling bracket
                         const basePartOnly = valStr.split(/\s*\(/)[0];
                         const baseParts = basePartOnly.split('/');
                         
                         const allSmallDecimals = baseParts.every(s => {
                             const v = parseFloat(s);
                             if (isNaN(v)) return false;
                             if (v === 0) return true; // 0 is fine
                             // If it's explicitly a decimal block (like 0.4) or we have a % sign
                             return (Math.abs(v) < 5.0 && (s.includes('.') || hasPercentNext));
                         });

                         if (allSmallDecimals && parts.length > 0 && !hasSecondsNext) {
                             // Safely multiply only numerical elements in the string
                             valStr = valStr.replace(/-?\d+(?:\.\d+)?/g, (matchNum) => {
                                 const v = parseFloat(matchNum);
                                 if (isNaN(v)) return matchNum;
                                 // Don't multiply if it's 0 to preserve semantic zeros, but if we need to it's fine.
                                 let res = v * 100.0;
                                 return String(Math.round(res * 1000) / 1000);
                             });
                             
                             // If we multiplied it but the text doesn't have a % afterwards, and doesn't already have one in the template
                             if (!hasPercentNext && !valStr.includes('%')) {
                                 valStr += '%';
                             }
                         }
                     }

                     const calcExpr = expr + "_calc";
                     const calcHash = fnvHash + "_calc";
                     let calcVal = fbMap[calcExpr] !== undefined ? fbMap[calcExpr] : fbMap[calcHash];

                     calcVal = expandMacros(calcVal);

                     // Only append calcVal if the base valStr is purely numerical and doesn't already contain the scaling elements like + or %
                     if (valStr && calcVal) {
                         const hasScalingAlready = valStr.includes('%') || valStr.includes('+') || valStr.includes('-');
                         const onlyRanks = /^[0-9\/\.]*$/.test(valStr.trim());
                         
                         if (onlyRanks && !hasScalingAlready) {
                             valStr += ` (${calcVal})`;
                         }
                     } else if (!valStr && calcVal) {
                         valStr = calcVal;
                     }
                     return valStr;
                 }
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
                const calcExpr = expr + "_calc";
                const calcHash = fnv1a_32(expr) + "_calc";
                const fbMap = dynamicTooltipFallback[spell.id] || {};
                const calcVal = fbMap[calcExpr] !== undefined ? fbMap[calcExpr] : fbMap[calcHash];

                if (calcVal) {
                    const norm = (s: string) => s
                        .toLowerCase()
                        .replace(/[()\[\]{}]/g, "")
                        .replace(/\s+/g, "")
                        .replace(/＋/g, "+")
                        .replace(/\+{2,}/g, "+");
                    const valNorm = norm(valStr || "");
                    const calcNorm = norm(String(calcVal));
                    const calcNoPlus = calcNorm.replace(/^\+/, "");
                    const alreadyIncluded = !!calcNorm && (valNorm.includes(calcNorm) || (calcNoPlus && valNorm.includes(calcNoPlus)));
                    if (valStr === "?") {
                        valStr = `(${calcVal})`;
                    } else if (!alreadyIncluded) {
                        valStr += ` (${calcVal})`;
                    }
                }
                valStr = valStr
                    .replace(/\(([^()]+)\)\s*\(\1\)/gi, "($1)")
                    .replace(/([+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)*%[a-zA-Z]+)\s*\+\s*\1/gi, "$1");
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

        // Removed hardcoded Tryndamere override here, replaced by general decimal scaling rule.
        
        // Clean up broken template remnants (e.g., Aphelios R has incomplete {{ syntax)
        descriptionHtml = descriptionHtml
            .replace(/\?\s*\}\}/g, '')           // ?}} remnants
            .replace(/\{\{\s*[^}]*\?\s*[^}]*\}\}/g, '')  // {{ ... ? ... }} broken templates
            .replace(/\{\{[^}]*$/gm, '')        // unclosed {{ at end of line
            .replace(/%i:[^%]*%/g, '');          // %i:OnHit% etc. icon references

        // Colorize Riot's XML tags
        descriptionHtml = descriptionHtml
            .replace(new RegExp("<physicalDamage>", "gi"), '<span style="color:#ffb74d">')
            .replace(new RegExp("</physicalDamage>", "gi"), '</span>')
            .replace(new RegExp("<magicDamage>", "gi"), '<span style="color:#00d2ff">')
            .replace(new RegExp("</magicDamage>", "gi"), '</span>')
            .replace(/([\d./]+%?(?:秒間|秒)?[^<>]{0,30}?)<status>(.*?)<\/status>/gi, '<span style="color:#ff4d4d">$1$2</span>')
            .replace(new RegExp("<status>", "gi"), '<span style="color:#ff4d4d">')
            .replace(new RegExp("</status>", "gi"), '</span>')
            .replace(new RegExp("<keyword[^>]*>", "gi"), '<span style="color:#c8aa6e; font-weight:bold;">')
            .replace(new RegExp("</keyword[^>]*>", "gi"), '</span>')
            .replace(new RegExp("<rules>", "gi"), '<i style="color:#aaa">')
            .replace(new RegExp("</rules>", "gi"), '</i>')
            .replace(new RegExp("<spellName>", "gi"), '<span style="color:#ffd700">')
            .replace(new RegExp("</spellName>", "gi"), '</span>')
            .replace(new RegExp("<trueDamage>", "gi"), '<span style="color:#f9966b">')
            .replace(new RegExp("</trueDamage>", "gi"), '</span>')
            .replace(new RegExp("<healing>", "gi"), '<span style="color:#11ff11">')
            .replace(new RegExp("</healing>", "gi"), '</span>')
            .replace(new RegExp("<shield>", "gi"), '<span style="color:#5bc0de; font-weight:bold;">')
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

        const champKey = String(data?.id || data?.name || "unknown");
        descriptionHtml = normalizeTooltipTextSafe(descriptionHtml, `${lang}:${champKey}:${key}`);

        html += `<div style="font-size: 12px; margin-top:5px; color:#ddd; line-height: 1.4;">${descriptionHtml}</div>`;
        html += `</div>`;
    }
    return html;
}

export async function buildLocalChampionTooltipHtml(
    champTooltipJson: any,
    lang: string = "ja",
    fallbackChampionData: any = null,
    options?: {
        isCancelled?: () => boolean;
        timeoutMs?: number;
        onProfile?: (profile: any) => void;
    },
): Promise<string> {
    if (!champTooltipJson) return "";

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

    // === Header ===
    const localChampionName =
        champTooltipJson.champion_local ||
        champTooltipJson.champion_name ||
        fallbackChampionData?.name ||
        champTooltipJson.champion;
    const localChampionTitle = champTooltipJson.champion_title || fallbackChampionData?.title || "";
    const englishChampionName = champTooltipJson.champion_en || fallbackChampionData?.id || champTooltipJson.champion || "";
    const localMs =
        champTooltipJson?.champion_stats?.movespeed ??
        fallbackChampionData?.stats?.movespeed ??
        fallbackChampionData?.stats?.moveSpeed;
    const localAaRange =
        champTooltipJson?.champion_stats?.attackrange ??
        fallbackChampionData?.stats?.attackrange ??
        fallbackChampionData?.stats?.attackRange;
    const localMeta: string[] = [];
    if (typeof localMs === "number") localMeta.push(`MS: ${Math.round(localMs)}`);
    if (typeof localAaRange === "number") localMeta.push(`AA: ${Math.round(localAaRange)}`);

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 8px;">
            <div>
                <b style="color:#c8aa6e; font-size: 16px;">${localChampionName}</b>
                ${localChampionTitle ? `<span style="color:#aaa; font-size: 12px; margin-left: 6px;">${localChampionTitle}</span>` : ""}
                ${englishChampionName ? `<span style="color:#888; font-size: 11px; margin-left: 8px;">(${englishChampionName})</span>` : ""}
            </div>
            <div style="color:#888; font-size: 11px; text-align: right;">${localMeta.join(" | ")}</div>
        </div>`;
    let lastYieldAt = Date.now();
    const isCancelled = options?.isCancelled;
    const timeoutMs = typeof options?.timeoutMs === "number" ? Math.max(0, options.timeoutMs) : 0;
    const startedAt = Date.now();
    const prof: any = {
        champion: String(champTooltipJson?.champion || ""),
        startedAt,
        precomputeMs: 0,
        slots: {},
        counters: {
            resolveLocalVar: 0,
            resolveFromChampionAliases: 0,
            resolveCalcSuffix: 0,
            expandCalcMacros: 0,
        },
    };
    const enableDetailedProfile = typeof options?.onProfile === "function";
    const shouldAbort = (): "cancelled" | "timeout" | null => {
        if (isCancelled?.()) return "cancelled";
        if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) return "timeout";
        return null;
    };
    const assertNotAborted = () => {
        const state = shouldAbort();
        if (state === "cancelled") {
            throw new Error("tooltip_render_cancelled");
        }
        if (state === "timeout") {
            throw new Error("tooltip_render_timeout");
        }
    };
    const maybeYield = async () => {
        assertNotAborted();
        if (Date.now() - lastYieldAt < 8) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldAt = Date.now();
        assertNotAborted();
    };
    const replaceTokensCooperatively = async (
        input: string,
        tokenRe: RegExp,
        replacer: (match: string, p1: string, offset: number, fullStr: string) => string,
    ): Promise<string> => {
        if (!input) return input;
        const flags = tokenRe.flags.includes("g") ? tokenRe.flags : `${tokenRe.flags}g`;
        const re = new RegExp(tokenRe.source, flags);
        let out = "";
        let lastIndex = 0;
        let m: RegExpExecArray | null = null;
        while ((m = re.exec(input)) !== null) {
            assertNotAborted();
            const whole = m[0] ?? "";
            const p1 = m[1] ?? "";
            const at = m.index ?? 0;
            out += input.slice(lastIndex, at);
            out += replacer(whole, p1, at, input);
            lastIndex = at + whole.length;
            await maybeYield();
        }
        out += input.slice(lastIndex);
        return out;
    };

    const toResolvedMap = (obj: Record<string, any>): Map<string, string> => {
        const m = new Map<string, string>();
        for (const [k, v] of Object.entries(obj || {})) {
            if (v === undefined || v === null) continue;
            const raw = typeof v === "object" && v !== null && "resolvedValue" in (v as any)
                ? (v as any).resolvedValue
                : v;
            if (raw === undefined || raw === null) continue;
            const s = String(raw);
            if (!s.trim()) continue;
            const lower = k.toLowerCase();
            if (!m.has(lower)) m.set(lower, s);
        }
        return m;
    };
    const candidateNames = (nameLower: string): string[] => {
        const dotTrimmed = nameLower.replace(/\.\d+$/, "");
        return dotTrimmed !== nameLower ? [nameLower, dotTrimmed] : [nameLower];
    };

    const slots = ["Passive", "Q", "W", "E", "R"];
    const championAliasKeys = slots
        .map((k) => champTooltipJson.spell_map?.[k] || champTooltipJson.spell_map?.[k === "Passive" ? "P" : k])
        .filter((v: any): v is string => typeof v === "string" && v.length > 0);
    const champKeyLower = String(champTooltipJson.champion || "").toLowerCase();
    const championRelatedCalcKeys = champKeyLower
        ? Object.keys(allCalcFormulas).filter((k) => k.toLowerCase().includes(champKeyLower))
        : [];
    const aliasKeyList = Array.from(new Set([...championAliasKeys, ...championRelatedCalcKeys]));
    const championAliasResolvedMaps = new Map<string, { vm: Map<string, string>, dv: Map<string, string> }>();
    const precomputeStart = Date.now();
    let aliasScanCount = 0;
    for (const alias of aliasKeyList) {
        const slotData = allCalcFormulas[alias];
        if (!slotData || typeof slotData !== "object") continue;
        championAliasResolvedMaps.set(alias, {
            vm: toResolvedMap(slotData.variableMapping || {}),
            dv: toResolvedMap(slotData.dataValues || {}),
        });
        aliasScanCount++;
        if ((aliasScanCount & 7) === 0) {
            await maybeYield();
        }
    }
    prof.precomputeMs = Date.now() - precomputeStart;
    
    for (const slot of slots) {
        const slotStart = Date.now();
        await maybeYield();
        const slotCandidates = slot === "Passive" ? ["Passive", "P", ""] : [slot];
        let rawHtml = "";
        for (const key of slotCandidates) {
            const slotHtml = champTooltipJson[key];
            if (typeof slotHtml === "string" && slotHtml.trim()) {
                rawHtml = slotHtml.trim();
                break;
            }
        }
        if (!rawHtml) continue;
        
        html += `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #333;">`;
        
        let descriptionHtml = rawHtml;

        const extractTag = (tag: string) => {
            const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
            const m = descriptionHtml.match(re);
            return m ? m[1] : "";
        };
        const stripTag = (tag: string) => {
            const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi");
            descriptionHtml = descriptionHtml.replace(re, "");
        };

        const titleLeftRaw = extractTag("titleLeft");
        const titleRightRaw = extractTag("titleRight");
        const subtitleLeftRaw = extractTag("subtitleLeft");
        const subtitleRightRaw = extractTag("subtitleRight");

        if (slot === "Passive") {
            const mainTextRaw = extractTag("mainText");
            if (mainTextRaw && /<spellActive>/i.test(mainTextRaw)) {
                const passiveOnly = mainTextRaw
                    .split(/<spellActive>/i)[0]
                    .replace(/<br\s*\/?>\s*<br\s*\/?>\s*$/i, "")
                    .trim();
                descriptionHtml = descriptionHtml.replace(
                    /<mainText>[\s\S]*?<\/mainText>/i,
                    `<mainText>${passiveOnly}</mainText>`,
                );
            }
        }

        stripTag("titleLeft");
        stripTag("titleRight");
        stripTag("subtitleLeft");
        stripTag("subtitleRight");

        // Resolve @Variables@
        const spellId = slot === "Passive" ? `${champTooltipJson.champion}Passive` : `${champTooltipJson.champion}${slot}`;
        
        // 1. Check allCalcFormulas -> variableMapping
        let calcData = allCalcFormulas[champTooltipJson.champion]?.["spells"]?.[slot];
        const varMapping = calcData?.["variableMapping"] || {};
        const dataValues = calcData?.["dataValues"] || {};
        
        // 2. Check dynamicTooltipFallback (Merge default + CDragon spell_map alias)
        const spellMapAlias = champTooltipJson.spell_map?.[slot] || champTooltipJson.spell_map?.[slot === "Passive" ? "P" : slot];
        if (!calcData) {
            if (spellMapAlias && allCalcFormulas[spellMapAlias]) {
                calcData = allCalcFormulas[spellMapAlias];
            } else if (spellId && allCalcFormulas[spellId]) {
                calcData = allCalcFormulas[spellId];
            }
        }
        const varMapping2 = calcData?.["variableMapping"] || varMapping;
        const dataValues2 = calcData?.["dataValues"] || dataValues;

        const fbById = dynamicTooltipFallback[spellId] || {};
        const fbByCd = spellMapAlias ? (dynamicTooltipFallback[spellMapAlias] || {}) : {};
        const fbMap = { ...fbByCd, ...fbById };

        const baseVarResolvedMap = toResolvedMap(varMapping2 || {});
        const baseDataValueMap = toResolvedMap(dataValues2 || {});
        const aliasResolvedMaps = championAliasResolvedMaps;
        const championAliasLookupCache = new Map<string, string | undefined>();
        const localResolveMemo = new Map<string, string | undefined>();

        const resolveFromChampionAliases = (nameLower: string): string | undefined => {
            prof.counters.resolveFromChampionAliases++;
            if (championAliasLookupCache.has(nameLower)) {
                return championAliasLookupCache.get(nameLower);
            }
            const candidates = candidateNames(nameLower);
            const found = new Set<string>();

            for (const alias of aliasKeyList) {
                const maps = aliasResolvedMaps.get(alias);
                if (!maps) continue;
                for (const cand of candidates) {
                    const val = maps.vm.get(cand);
                    if (val !== undefined) found.add(val);
                }
            }
            const result = found.size === 1 ? Array.from(found)[0] : undefined;
            championAliasLookupCache.set(nameLower, result);
            return result;
        };

        const resolveFromAlias = (alias: string, nameLower: string): string | undefined => {
            const maps = aliasResolvedMaps.get(alias);
            if (!maps) return undefined;
            const candidates = candidateNames(nameLower);
            for (const cand of candidates) {
                const vmVal = maps.vm.get(cand);
                if (vmVal !== undefined) return vmVal;
                const dvVal = maps.dv.get(cand);
                if (dvVal !== undefined) return dvVal;
            }
            return undefined;
        };

        const resolveLocalVar = (nameRaw: string, targetFbMap: Record<string, any> = fbMap): string | undefined => {
            prof.counters.resolveLocalVar++;
            assertNotAborted();
            const name = nameRaw.toLowerCase();
            const memoKey = targetFbMap === fbMap ? name : "";
            if (memoKey && localResolveMemo.has(memoKey)) {
                return localResolveMemo.get(memoKey);
            }
            const candidates = candidateNames(name);

            // Many tooltip placeholders are formatting-only wrappers and intentionally missing in data maps.
            if (/(?:prefix|postfix|tooltip|nl)$/.test(name)) {
                if (memoKey) localResolveMemo.set(memoKey, "");
                return "";
            }

            for (const cand of candidates) {
                assertNotAborted();
                if (targetFbMap === fbMap && baseVarResolvedMap.has(cand)) {
                    const v = baseVarResolvedMap.get(cand);
                    if (memoKey) localResolveMemo.set(memoKey, v);
                    return v;
                }
                if (targetFbMap === fbMap) {
                    const v = baseDataValueMap.get(cand);
                    if (v !== undefined) {
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                }
                if (targetFbMap[cand] !== undefined) {
                    const v = String(targetFbMap[cand]);
                    if (memoKey) localResolveMemo.set(memoKey, v);
                    return v;
                }
                const candHash = fnv1a_32(cand);
                if (targetFbMap[candHash] !== undefined) {
                    const v = String(targetFbMap[candHash]);
                    if (memoKey) localResolveMemo.set(memoKey, v);
                    return v;
                }
            }

            // Common pattern in WAD tooltips: "@FooCalc@" while variable mapping stores "foo".
            if (targetFbMap === fbMap && name.endsWith("calc")) {
                const stem = name.replace(/calc$/, "");
                const stemCandidates = [stem, stem.replace(/_$/, "")].filter(Boolean);
                for (const stemKey of stemCandidates) {
                    assertNotAborted();
                    if (varMapping2[stemKey]?.resolvedValue !== undefined) {
                        const v = String(varMapping2[stemKey].resolvedValue);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                    const dvVal = baseDataValueMap.get(stemKey);
                    if (dvVal !== undefined) {
                        if (memoKey) localResolveMemo.set(memoKey, dvVal);
                        return dvVal;
                    }
                    if (targetFbMap[stemKey] !== undefined) {
                        const v = String(targetFbMap[stemKey]);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                    const stemHash = fnv1a_32(stemKey);
                    if (targetFbMap[stemHash] !== undefined) {
                        const v = String(targetFbMap[stemHash]);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                }
            }

            // Some champions store passive tooltip text that references the W spell's variables.
            // Example: Vayne passive text reuses Silver Bolts (% max HP true damage) placeholders.
            if (targetFbMap === fbMap && slot === "Passive") {
                const wAlias = champTooltipJson.spell_map?.["W"];
                if (wAlias && typeof wAlias === "string" && wAlias !== spellMapAlias) {
                    const v = resolveFromAlias(wAlias, name);
                    if (v !== undefined) return v;
                }
            }

            // Last resort (same champion, other slots): use exact var name only when value is unique.
            if (targetFbMap === fbMap) {
                const champWide = resolveFromChampionAliases(name);
                if (champWide !== undefined) {
                    if (memoKey) localResolveMemo.set(memoKey, champWide);
                    return champWide;
                }
            }

            // Heuristic fallback for template-only keys that differ from WAD variable names.
            // Example: QPassiveScaling -> qmaxhealthtruedamageperstack
            const semanticPick = (() => {
                const keys = Object.keys(targetFbMap || {});
                const nonHash = keys.filter((k) => !k.startsWith("{") && !k.endsWith("_calc"));
                if (nonHash.length === 0) return undefined;
                const pickBy = (pred: (k: string) => boolean) => {
                    const hit = nonHash.find((k) => pred(k.toLowerCase()) && targetFbMap[k] !== undefined && String(targetFbMap[k]).trim() !== "");
                    if (!hit) return undefined;
                    return String(targetFbMap[hit]);
                };
                if (name.includes("execute")) {
                    const v = pickBy((k) => k.includes("execution") || k.includes("execute"));
                    if (v !== undefined) return v;
                }
                if (name.startsWith("q") && name.includes("passive") && name.includes("scaling")) {
                    const v = pickBy((k) => k.startsWith("q") && (k.includes("perstack") || k.includes("maxhealth") || k.includes("ratio")));
                    if (v !== undefined) return v;
                }
                if (name.startsWith("e") && name.includes("passive") && name.includes("scaling")) {
                    const v = pickBy((k) => k.startsWith("e") && (k.includes("execution") || k.includes("threshold") || k.includes("growth")));
                    if (v !== undefined) return v;
                }
                return undefined;
            })();
            if (semanticPick !== undefined) {
                if (memoKey) localResolveMemo.set(memoKey, semanticPick);
                return semanticPick;
            }

            const fMatch = name.match(/^f(\d+)(?:\.\d+)?$/);
            if (fMatch && targetFbMap === fbMap) {
                const idx = parseInt(fMatch[1], 10);
                if (!Number.isNaN(idx) && idx > 0) {
                    const effectAmountKey = `effect${idx}amount`;
                    if (varMapping2[effectAmountKey]?.resolvedValue !== undefined) {
                        const v = String(varMapping2[effectAmountKey].resolvedValue);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                    const effectKey = `effect${idx}`;
                    if (varMapping2[effectKey]?.resolvedValue !== undefined) {
                        const v = String(varMapping2[effectKey].resolvedValue);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                    const calcKeys = Object.keys(varMapping2)
                        .filter((k) => !!varMapping2[k] && varMapping2[k].source === "calculationFull" && !k.startsWith("{"))
                        .sort();
                    const picked = calcKeys[idx - 1];
                    if (picked && varMapping2[picked]?.resolvedValue !== undefined) {
                        const v = String(varMapping2[picked].resolvedValue);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }

                    // Fallback: some tooltips still reference f1/f2/f3 style placeholders even when
                    // WAD exposes only named keys. Use the ordered non-hash resolved keys.
                    const genericKeys = Object.keys(varMapping2).filter((k) => {
                        const row = varMapping2[k];
                        if (!row || row.resolvedValue === undefined) return false;
                        if (k.endsWith("_calc")) return false;
                        return true;
                    });
                    const genericPicked = genericKeys[idx - 1];
                    if (genericPicked && varMapping2[genericPicked]?.resolvedValue !== undefined) {
                        const v = String(varMapping2[genericPicked].resolvedValue);
                        if (memoKey) localResolveMemo.set(memoKey, v);
                        return v;
                    }
                }
            }

            // WAD updates sometimes move base damage into missile/aux spell records
            // (e.g. Ahri Q: BaseDamage* missing on AhriQ, present as effect1amount on AhriQReturnMissile).
            if (targetFbMap === fbMap) {
                const slotStem = `${String(champTooltipJson.champion || "").toLowerCase()}${slot.toLowerCase()}`;
                const relatedAliasKeys = aliasKeyList.filter((k) => {
                    const kl = String(k || "").toLowerCase();
                    if (!kl) return false;
                    if (spellMapAlias && kl === String(spellMapAlias).toLowerCase()) return true;
                    return slotStem.length > 0 && kl.includes(slotStem);
                });
                const orderedAliasKeys = Array.from(new Set([
                    ...(spellMapAlias ? [spellMapAlias] : []),
                    ...relatedAliasKeys,
                    ...aliasKeyList,
                ]));

                const getAliasSeries = (seriesKeys: string[]): string | undefined => {
                    for (const alias of orderedAliasKeys) {
                        const maps = aliasResolvedMaps.get(alias);
                        if (!maps) continue;
                        for (const sk of seriesKeys) {
                            const cands = candidateNames(sk.toLowerCase());
                            for (const cand of cands) {
                                const vm = maps.vm.get(cand);
                                if (vm !== undefined && String(vm).trim() !== "") return vm;
                                const dv = maps.dv.get(cand);
                                if (dv !== undefined && String(dv).trim() !== "") return dv;
                            }
                        }
                    }
                    return undefined;
                };

                const pickRank = (series: string, idx1: number): string | undefined => {
                    const parts = String(series).split("/");
                    if (parts.length === 0) return undefined;
                    if (idx1 >= 1 && idx1 <= parts.length) return parts[idx1 - 1];
                    if (parts.length === 1) return parts[0];
                    return undefined;
                };

                const bdMatch = name.match(/^basedamage(\d+)$/);
                if (bdMatch) {
                    const rank = parseInt(bdMatch[1], 10);
                    const series = getAliasSeries(["effect1amount", "effect1", "damage", "basedamage"]);
                    if (series) {
                        const picked = pickRank(series, rank);
                        if (picked !== undefined) {
                            if (memoKey) localResolveMemo.set(memoKey, picked);
                            return picked;
                        }
                    }
                }

                if (name === "basedamage") {
                    const series = getAliasSeries(["effect1amount", "effect1", "damage"]);
                    if (series) {
                        if (memoKey) localResolveMemo.set(memoKey, series);
                        return series;
                    }
                }
            }
            if (memoKey) localResolveMemo.set(memoKey, undefined);
            return undefined;
        };

        const resolveCalcSuffix = (nameRaw: string, nameLower: string, targetFbMap: Record<string, any>): string | undefined => {
            prof.counters.resolveCalcSuffix++;
            const keys = [
                `${nameRaw}_calc`,
                `${nameLower}_calc`,
                `${fnv1a_32(nameLower)}_calc`,
            ];
            const head = nameLower.split(".")[0];
            if (head !== nameLower) {
                keys.push(`${head}_calc`);
                keys.push(`${fnv1a_32(head)}_calc`);
            }
            for (const k of keys) {
                if (targetFbMap[k] !== undefined) return String(targetFbMap[k]);
            }
            return undefined;
        };

        const expandCalcMacros = (text: string, targetFbMap: Record<string, any>): string => {
            prof.counters.expandCalcMacros++;
            return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, macroKey: string) => {
                const macroVal = resolveLocalVar(macroKey, targetFbMap);
                if (macroVal === undefined) return `{${macroKey}}`;
                return formatFallbackValue(macroVal);
            });
        };

        const normalizeCalcText = (text: string): string => {
            return text
                .replace(/\+{2,}/g, "+")
                .replace(/\s{2,}/g, " ")
                .trim();
        };
        const hasEquivalentScaling = (baseText: string, scalingText: string): boolean => {
            const norm = (s: string) => s
                .toLowerCase()
                .replace(/[()\[\]{}]/g, "")
                .replace(/\s+/g, "")
                .replace(/\uFF0B/g, "+")
                .replace(/\+{2,}/g, "+");
            const baseNorm = norm(baseText || "");
            const scalingNorm = norm(scalingText || "");
            if (!scalingNorm) return true;
            if (baseNorm.includes(scalingNorm)) return true;
            // "+100%ap" vs "100%ap" の差も同一とみなす
            const scalingNoPlus = scalingNorm.replace(/^\+/, "");
            return !!scalingNoPlus && baseNorm.includes(scalingNoPlus);
        };
        const collapseDuplicateScalings = (text: string): string => {
            let out = text || "";
            for (let i = 0; i < 3; i++) {
                const prev = out;
                out = out
                    // "(+100%AP) (+100%AP)" -> "(+100%AP)"
                    .replace(/\(([^()]+)\)\s*\(\1\)/gi, "($1)")
                    // "+125%AD +125%AD" -> "+125%AD"
                    .replace(/([+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)*%[a-zA-Z]+)\s*\+\s*\1/gi, "$1")
                    .replace(/([+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)*%[a-zA-Z]+)\s+\1/gi, "$1");
                if (out === prev) break;
            }
            return out;
        };
        const isLikelyPercentLikeVar = (varKey: string): boolean => {
            const key = (varKey || "").toLowerCase();
            if (!key) return false;
            if (/(duration|time|cast|delay|stun|silence|root|knockup|taunt|fear|charm)/.test(key)) {
                return false;
            }
            return /(percent|ratio|movespeed|attackspeed|(?:^|_)slow(?:$|_)|haste|lifesteal|omnivamp|tenacity|(?:^|_)cdr(?:$|_)|cooldownreduction|cdrefund|max_?health.*damage|missing_?health.*damage|current_?health.*damage|hpdamage|healthdamage|percenthealth|(?:^|_)ms(?:$|_)|ms$|(?:^|_)as(?:$|_)|as$)/.test(key);
        };
        const splitNumericSeriesHead = (text: string): { head: string; tail: string } | null => {
            const trimmed = String(text || "").trim();
            if (!trimmed) return null;
            let end = 0;
            for (; end < trimmed.length; end++) {
                const ch = trimmed.charCodeAt(end);
                const isDigit = ch >= 48 && ch <= 57;
                if (
                    isDigit ||
                    ch === 46 || // .
                    ch === 47 || // /
                    ch === 126 || // ~
                    ch === 43 || // +
                    ch === 45 // -
                ) {
                    continue;
                }
                break;
            }
            if (end === 0) return null;
            const head = trimmed.slice(0, end);
            const tail = trimmed.slice(end);
            if (!head || /^[~/]/.test(head) || /[~/]$/.test(head) || /[~/]{2,}/.test(head)) {
                return null;
            }
            const parts = head.split(/[~/]/);
            if (parts.length === 0) return null;
            for (const part of parts) {
                if (!/^[+\-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(part)) {
                    return null;
                }
            }
            return { head, tail };
        };
        const maybePercentizeByVarName = (valueText: string, varKey: string): string => {
            const trimNum = (n: number): string => {
                return String(n).replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
            };
            const ratioToPercentText = (n: number): string => {
                const p = n * 100;
                const abs = Math.abs(p);
                let digits = 1;
                if (abs < 0.1) digits = 3;
                else if (abs < 1) digits = 2;
                else if (abs < 10) digits = 1;
                return trimNum(Number(p.toFixed(digits)));
            };
            const key = (varKey || "").toLowerCase();
            if (/(duration|time|cooldown|cast|delay|stun|silence|root|slowduration|knockup|taunt|fear|charm)/.test(key)) {
                return valueText;
            }
            if (!isLikelyPercentLikeVar(key)) {
                return valueText;
            }
            if (!valueText) return valueText;

            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed) {
                return valueText;
            }
            const numericHead = parsed.head;
            const tail = parsed.tail;
            const isPlain = !tail.trim();
            if (!isPlain && /^\s*%/.test(tail)) {
                return valueText;
            }
            const parts = numericHead.split(/([~/])/);
            const out: string[] = [];
            let changed = false;
            for (const p of parts) {
                if (p === "~" || p === "/") {
                    out.push(p);
                    continue;
                }
                const n = Number(p);
                if (!Number.isFinite(n) || Math.abs(n) >= 1) {
                    changed = false;
                    break;
                }
                out.push(ratioToPercentText(n));
                changed = true;
            }
            if (changed) {
                return `${out.join("")}%${tail}`;
            }

            // Some WAD formulas resolve percent-like stats as already-scaled numbers
            // (e.g. movespeed=25, calc_max_health_damage=1), so keep the number and append %.
            const shouldForcePercentSuffix =
                /(movespeed|attackspeed|(?:^|_)slow(?:$|_)|haste|lifesteal|omnivamp|tenacity|max_?health.*damage|missing_?health.*damage|current_?health.*damage|hpdamage|healthdamage|(?:^|_)ms(?:$|_)|ms$|(?:^|_)as(?:$|_)|as$)/.test(key)
                && !/(flat|absolute|raw|duration|time)/.test(key);
            if (shouldForcePercentSuffix) {
                return `${numericHead}%${tail}`;
            }
            if (/(percent|ratio)/.test(key)) {
                return `${numericHead}%${tail}`;
            }
            return valueText;
        };
        const maybePercentizeByTemplateContext = (valueText: string, fullText: string, tokenEnd: number): string => {
            const trimNum = (n: number): string => {
                return String(n).replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
            };
            const ratioToPercentText = (n: number): string => {
                const p = n * 100;
                const abs = Math.abs(p);
                let digits = 1;
                if (abs < 0.1) digits = 3;
                else if (abs < 1) digits = 2;
                else if (abs < 10) digits = 1;
                return trimNum(Number(p.toFixed(digits)));
            };
            if (!valueText || valueText.includes("%")) return valueText;
            const next = fullText.slice(tokenEnd).trimStart();
            if (!next.startsWith("%")) return valueText;
            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed || !!parsed.tail.trim()) {
                return valueText;
            }
            const parts = parsed.head.split(/([~/])/);
            const out: string[] = [];
            let changed = false;
            for (const p of parts) {
                if (p === "~" || p === "/") {
                    out.push(p);
                    continue;
                }
                const n = Number(p);
                if (!Number.isFinite(n) || Math.abs(n) >= 1) {
                    return valueText;
                }
                out.push(ratioToPercentText(n));
                changed = true;
            }
            return changed ? `${out.join("")}` : valueText;
        };
        const maybePercentizeByHealthPhraseContext = (
            valueText: string,
            fullText: string,
            tokenStart: number,
            tokenEnd: number,
        ): string => {
            if (!valueText || valueText.includes("%")) return valueText;
            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed) return valueText;
            const head = parsed.head;
            const tail = parsed.tail || "";
            if (/^\s*%/.test(tail)) return valueText;

            const next = String(fullText || "").slice(tokenEnd).trimStart();
            if (next.startsWith("%")) return valueText;

            const left = String(fullText || "").slice(Math.max(0, tokenStart - 24), tokenStart);
            const right = String(fullText || "").slice(tokenEnd, Math.min((fullText || "").length, tokenEnd + 24));
            const ctx = `${left} ${right}`;
            if (!/(最大体力|減少体力|現在体力|max(?:imum)?\s*health|missing\s*health|current\s*health)/i.test(ctx)) {
                return valueText;
            }

            const arr = parseSeries(head);
            if (!arr || arr.length === 0) return valueText;
            const maxAbs = Math.max(...arr.map((n) => Math.abs(n)));
            if (maxAbs >= 120 && maxAbs <= 20000) {
                return `${formatSeries(arr.map((n) => n / 100))}%${tail}`;
            }
            if (maxAbs > 0 && maxAbs <= 100) {
                return `${head}%${tail}`;
            }
            return valueText;
        };
        const parseSeries = (s: string): number[] | null => {
            const parsed = splitNumericSeriesHead(s || "");
            if (!parsed || !!parsed.tail.trim()) return null;
            const parts = parsed.head.split(/[~/]/).map((x) => Number(x));
            if (parts.some((n) => !Number.isFinite(n))) return null;
            return parts;
        };
        const formatSeries = (arr: number[]): string => {
            return arr
                .map((n) => String(Math.round(n * 10000) / 10000).replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1"))
                .join("/");
        };
        const maybeNormalizePercentProductExpression = (valueText: string, varKey: string): string => {
            const key = (varKey || "").toLowerCase();
            if (!/(hp|health|percent|ratio|heal|damage)/.test(key)) return valueText;
            const raw = valueText.trim();
            const starIdx = raw.lastIndexOf("*");
            if (starIdx <= 0) return valueText;
            const ratioLiteral = raw.slice(starIdx + 1).trim();
            if (!/^0\.0*1$/i.test(ratioLiteral)) return valueText;
            const left = raw.slice(0, starIdx).trim();
            const closeParen = left.lastIndexOf(")");
            const openParen = closeParen >= 0 ? left.lastIndexOf("(", closeParen) : -1;
            if (openParen < 0 || closeParen < 0 || openParen >= closeParen) return valueText;
            const scaling = left.slice(openParen + 1, closeParen).trim();
            if (!/%[a-zA-Z]/i.test(scaling)) return valueText;
            const plusIdx = left.lastIndexOf("+", openParen);
            if (plusIdx <= 0) return valueText;
            const baseExpr = left.slice(0, plusIdx).trim();
            const base = parseSeries(baseExpr);
            if (!base) return valueText;
            const scaled = formatSeries(base.map((n) => n * 0.01));
            const scaleExpr = scaling.replace(/^\+/, "").trim();
            return `${scaled}% (+${scaleExpr})`;
        };
        const maybeDownscaleOverscaledPercent = (valueText: string, varKey: string): string => {
            const key = (varKey || "").toLowerCase();
            if (!isLikelyPercentLikeVar(key)) {
                return valueText;
            }
            // Downscaling by 1/100 is only safe for health-ratio damage families.
            // For speed/AS style keys, values like 50~130 are already display-scale percentages.
            if (!/(max_?health.*damage|missing_?health.*damage|current_?health.*damage|hpdamage|healthdamage|percenthealth)/.test(key)) {
                return valueText;
            }
            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed) return valueText;
            const head = parsed.head;
            const tail = parsed.tail || "";
            if (/%/.test(head)) return valueText;
            const arr = parseSeries(head);
            if (!arr || arr.length === 0) return valueText;

            const maxAbs = Math.max(...arr.map((n) => Math.abs(n)));
            // Heuristic: values like 2000/3500... or 150/170... in percent-like vars
            // are typically already multiplied by 100 compared to expected display scale.
            if (maxAbs < 120 || maxAbs > 20000) return valueText;

            const down = arr.map((n) => n / 100);
            return `${formatSeries(down)}${tail}`;
        };
        const maybeDownscaleOverscaledPercentByTemplateContext = (valueText: string, fullText: string, tokenEnd: number): string => {
            if (!valueText || valueText.includes("%")) return valueText;
            const next = String(fullText || "").slice(tokenEnd).trimStart();
            if (!next.startsWith("%")) return valueText;

            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed) return valueText;
            const head = parsed.head;
            const tail = parsed.tail || "";
            const arr = parseSeries(head);
            if (!arr || arr.length === 0) return valueText;
            const maxAbs = Math.max(...arr.map((n) => Math.abs(n)));
            if (maxAbs < 120 || maxAbs > 20000) return valueText;
            return `${formatSeries(arr.map((n) => n / 100))}${tail}`;
        };
        const maybeFixOverscaledAttackSpeedFromBase = (
            valueText: string,
            varKey: string,
            targetFbMap: Record<string, any>,
        ): string => {
            const key = (varKey || "").toLowerCase();
            if (!key.includes("bonusattackspeed")) return valueText;
            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed) return valueText;
            const head = parsed.head;
            const tail = parsed.tail || "";
            const arr = parseSeries(head);
            if (!arr || arr.length === 0) return valueText;
            const maxAbs = Math.max(...arr.map((n) => Math.abs(n)));
            if (maxAbs < 500) return valueText;

            const baseRaw =
                resolveLocalVar("baseattackspeed", targetFbMap) ??
                resolveLocalVar("attackspeed", targetFbMap) ??
                String(targetFbMap["baseattackspeed"] ?? targetFbMap["attackspeed"] ?? "");
            if (!baseRaw) return valueText;
            const baseSeries = parseSeries(baseRaw);
            if (!baseSeries || baseSeries.length === 0) return valueText;
            const expandedBase = baseSeries.map((n, i) => {
                const v = baseSeries[Math.min(i, baseSeries.length - 1)];
                return v * 100;
            });
            if (!approxEqSeries(arr, expandedBase, 5)) return valueText;
            return `${formatSeries(baseSeries)}${tail}`;
        };
        const normalizeMultiplySign = (valueText: string): string => {
            return valueText.replace(/\s\*\s(?=\d)/g, " × ");
        };
        const approxEqSeries = (a: number[], b: number[], eps: number = 0.25): boolean => {
            if (a.length === 0 || b.length === 0) return false;
            const n = Math.max(a.length, b.length);
            for (let i = 0; i < n; i++) {
                const av = a[Math.min(i, a.length - 1)];
                const bv = b[Math.min(i, b.length - 1)];
                if (Math.abs(av - bv) > eps) return false;
            }
            return true;
        };
        const maybePercentizeBySemanticHpMap = (
            valueText: string,
            targetFbMap: Record<string, any>,
            targetVarName: string,
        ): string => {
            if (!valueText) return valueText;
            const parsed = splitNumericSeriesHead(valueText);
            if (!parsed) return valueText;
            const head = parsed.head;
            const tail = parsed.tail || "";
            if (/%/.test(head) || /^\s*%/.test(tail)) return valueText;
            if (!/%\s*(?:AP|AD|bonusAD|bAD|HP|Health)/i.test(tail)) return valueText;

            // Quick path: key itself strongly implies HP-ratio damage.
            const key = (targetVarName || "").toLowerCase();
            if (/(?:^|_)(?:max|missing|current)_?health|(?:^|_)hp(?:$|_)|hpdamage|healthdamage/.test(key)) {
                return `${head}%${tail}`;
            }

            // Language-agnostic inference:
            // If resolved head (e.g. "1") matches *100 of any hp/health ratio source value
            // (e.g. "basehpdamage=0.01"), treat the head as percentage.
            const headSeries = parseSeries(head);
            if (!headSeries) return valueText;
            if (headSeries.some((n) => !Number.isFinite(n) || n <= 0 || n > 100)) return valueText;

            const hpLike = /(hp|health|maxhealth|missinghealth|currenthealth)/i;
            const candidateSeries: number[][] = [];

            for (const [k, v] of Object.entries(targetFbMap || {})) {
                if (!hpLike.test(k)) continue;
                const arr = parseSeries(String(v));
                if (!arr || arr.length === 0) continue;
                if (arr.some((n) => Math.abs(n) > 1.0)) continue;
                candidateSeries.push(arr.map((n) => n * 100));
            }
            for (const [k, v] of baseVarResolvedMap.entries()) {
                if (!hpLike.test(k)) continue;
                const arr = parseSeries(String(v));
                if (!arr || arr.length === 0) continue;
                if (arr.some((n) => Math.abs(n) > 1.0)) continue;
                candidateSeries.push(arr.map((n) => n * 100));
            }

            if (candidateSeries.some((cand) => approxEqSeries(headSeries, cand))) {
                return `${head}%${tail}`;
            }
            return valueText;
        };
        const normalizeResolvedTokenValue = (
            rawValue: string | number,
            targetVarName: string,
            targetFbMap: Record<string, any>,
            fullText: string,
            tokenStart: number,
            tokenEnd: number,
        ): string => {
            let renderedVal = formatFallbackValue(rawValue);
            renderedVal = maybeFixOverscaledAttackSpeedFromBase(renderedVal, targetVarName, targetFbMap);
            renderedVal = maybeNormalizePercentProductExpression(renderedVal, targetVarName);
            renderedVal = maybeDownscaleOverscaledPercent(renderedVal, targetVarName);
            renderedVal = maybeDownscaleOverscaledPercentByTemplateContext(renderedVal, fullText, tokenEnd);
            renderedVal = maybePercentizeByHealthPhraseContext(renderedVal, fullText, tokenStart, tokenEnd);
            renderedVal = maybePercentizeByVarName(renderedVal, targetVarName);
            renderedVal = maybePercentizeByTemplateContext(renderedVal, fullText, tokenEnd);
            renderedVal = maybePercentizeBySemanticHpMap(renderedVal, targetFbMap, targetVarName);
            renderedVal = collapseDuplicateScalings(renderedVal);
            renderedVal = normalizeMultiplySign(renderedVal);
            renderedVal = renderedVal.replace(/(%){2,}/g, "%");
            return renderedVal;
        };

        let resolvedTokenCount = 0;
        let unresolvedTokenCount = 0;
        const tokenMsByVar = new Map<string, number>();
        const tokenHitByVar = new Map<string, number>();
        const tokenStageMsByVar = enableDetailedProfile
            ? new Map<string, { resolve: number; normalize: number; calc: number; total: number; hits: number }>()
            : null;
        descriptionHtml = await replaceTokensCooperatively(descriptionHtml, /@([a-zA-Z0-9_\.:\*\-\+]+)@/g, (match, p1, offset, fullStr) => {
            const tokenProfileKey = String(p1 || "").toLowerCase();
            const tokenProfileStart = Date.now();
            let stageResolveMs = 0;
            let stageNormalizeMs = 0;
            let stageCalcMs = 0;
            try {
                assertNotAborted();
                let varName = p1.toLowerCase();
                if (varName === 'spellmodifierdescriptionappend' || varName === 'spellmodifierdescription') return "";
                if (varName === 'hotkey') return slot;

                let targetFbMap = fbMap;
                
                // Check cross-spell references e.g. spell.KarmaMantra:RQImpactDamage
                if (varName.startsWith('spell.')) {
                    const parts = varName.split(':');
                    if (parts.length === 2) {
                        const spellRef = parts[0].replace('spell.', '');
                        const actualSpellKey = Object.keys(dynamicTooltipFallback).find(k => k.toLowerCase() === spellRef);
                        if (actualSpellKey) {
                            targetFbMap = dynamicTooltipFallback[actualSpellKey];
                        }
                        varName = parts[1];
                    }
                }

                // Check basic math modifiers e.g. RQSlow*-100
                let multiplier = 1;
                if (varName.includes('*')) {
                    const parts = varName.split('*');
                    varName = parts[0];
                    multiplier = parseFloat(parts[1]);
                    if (isNaN(multiplier)) multiplier = 1;
                }

                const tokenEnd = Number(offset || 0) + String(match || "").length;
                
                let resolvedVal: string | number | undefined = undefined;
                const resolveStart = Date.now();

            // first check if pre-resolved in all_calc_formulas (only if not a cross-spell ref)
            if (targetFbMap === fbMap) {
                const vmVal = baseVarResolvedMap.get(varName);
                if (vmVal !== undefined) {
                    resolvedVal = vmVal;
                } else {
                    const dvVal = baseDataValueMap.get(varName);
                    if (dvVal !== undefined) {
                        resolvedVal = dvVal;
                    }
                }
            }
            
            // then check fallback
            if (resolvedVal === undefined) {
                // If it's a cross-spell ref, p1 won't match. 
                const originalVarSearch = p1.split(':').pop()?.split('*')[0] || p1;
                const hashKey = fnv1a_32(originalVarSearch.toLowerCase());
                const hashKeyLower = fnv1a_32(varName);
                
                if (targetFbMap[originalVarSearch] !== undefined) {
                    resolvedVal = targetFbMap[originalVarSearch];
                } else if (targetFbMap[varName] !== undefined) {
                    resolvedVal = targetFbMap[varName];
                } else if (targetFbMap[hashKey] !== undefined) {
                    resolvedVal = targetFbMap[hashKey];
                } else if (targetFbMap[hashKeyLower] !== undefined) {
                    resolvedVal = targetFbMap[hashKeyLower];
                } else {
                    // Allow indexing into arrays (e.g. Cooldown1 -> cooldown[0], BaseDamage2Prefix -> "")
                    const dottedRankMatch = varName.match(/^([a-z0-9_\.:]+)\.(\d+)$/);
                    if (dottedRankMatch) {
                        const baseKey = dottedRankMatch[1];
                        const baseResolved = resolveLocalVar(baseKey, targetFbMap);
                        if (baseResolved !== undefined) {
                            const parts = String(baseResolved).split("/");
                            const index = parseInt(dottedRankMatch[2], 10);
                            if (!Number.isNaN(index) && index >= 0 && index < parts.length) {
                                resolvedVal = parts[index];
                            } else {
                                resolvedVal = baseResolved;
                            }
                        }
                    }

                    const numMatch = varName.match(/^([a-z0-9_\.:]+?)(\d+)(prefix|postfix)?$/);
                    if (numMatch) {
                        let baseKey = numMatch[1];
                        if (baseKey === "basecost") baseKey = "cost";
                        if (baseKey === "costnl") baseKey = "cost";
                        if (baseKey === "cooldownnl") baseKey = "cooldown";
                        const index = parseInt(numMatch[2], 10) - 1;
                        const affix = numMatch[3];
                        
                        if (affix) return ""; // Hide unmapped prefixes/postfixes to prevent clutter
                        
                        let baseVal: string | number | undefined = resolveLocalVar(baseKey, targetFbMap);
                        if (targetFbMap === fbMap) {
                            const vmVal = baseVarResolvedMap.get(baseKey);
                            if (vmVal !== undefined) {
                                baseVal = vmVal;
                            } else {
                                const dvVal = baseDataValueMap.get(baseKey);
                                if (dvVal !== undefined) {
                                    baseVal = dvVal;
                                }
                            }
                        }
                        if (baseVal === undefined) {
                            if (targetFbMap[baseKey] !== undefined) {
                                baseVal = targetFbMap[baseKey];
                            } else if (targetFbMap[baseKey.toLowerCase()] !== undefined) {
                                baseVal = targetFbMap[baseKey.toLowerCase()];
                            } else {
                                const baseHash = fnv1a_32(baseKey.toLowerCase());
                                if (targetFbMap[baseHash] !== undefined) {
                                    baseVal = targetFbMap[baseHash];
                                }
                            }
                        }
                        
                        if (baseVal !== undefined) {
                            const parts = String(baseVal).split('/');
                            if (index >= 0 && index < parts.length) {
                                resolvedVal = parts[index];
                            } else if (parts.length === 1) {
                                resolvedVal = parts[0];
                            }
                        }
                    }
                }
            }
            
            if (resolvedVal === undefined) {
                const localResolved = resolveLocalVar(varName, targetFbMap);
                if (localResolved !== undefined) {
                    resolvedVal = localResolved;
                }
            }
            stageResolveMs = Date.now() - resolveStart;

            if (resolvedVal !== undefined) {
                assertNotAborted();
                if (multiplier !== 1) {
                    const nextTokenText = String(fullStr || "").slice(Number(offset || 0) + String(match || "").length).trimStart();
                    const isPercentLikeVar = /(percent|ratio|movespeed|attackspeed|slow|haste|lifesteal|omnivamp|tenacity|cdr|cooldownreduction|max_?health.*damage|missing_?health.*damage|current_?health.*damage)/.test(varName);
                    const maybeSeries = parseSeries(String(resolvedVal));
                    const alreadyScaledPercentLike =
                        isPercentLikeVar &&
                        Math.abs(multiplier) >= 99 &&
                        !!maybeSeries &&
                        maybeSeries.every((n) => Number.isFinite(n) && Math.abs(n) >= 1 && Math.abs(n) <= 1000);

                    if (alreadyScaledPercentLike) {
                        // Some sources already provide percent-scaled values (e.g. 20/35/50...)
                        // while template still uses *100. Avoid double-scaling to 2000/3500/...
                        multiplier = 1;
                    }
                    if (multiplier !== 1 && Math.abs(multiplier) >= 99 && !!maybeSeries && nextTokenText.startsWith("%")) {
                        // Template like @AttackSpeed*100@% with already-scaled values should not be multiplied again.
                        multiplier = 1;
                    }
                }
                if (multiplier !== 1) {
                    if (typeof resolvedVal === 'string' && resolvedVal.includes('/')) {
                        const parts = resolvedVal.split('/');
                        resolvedVal = parts.map(p => {
                            const num = parseFloat(p);
                            return isNaN(num) ? p : String(Math.round(num * multiplier * 100) / 100);
                        }).join('/');
                    } else {
                        const num = parseFloat(String(resolvedVal));
                        if (!isNaN(num)) {
                            resolvedVal = String(Math.round(num * multiplier * 100) / 100);
                        }
                    }
                }
                const normalizeStart = Date.now();
                let renderedVal = normalizeResolvedTokenValue(
                    resolvedVal,
                    varName,
                    targetFbMap,
                    String(fullStr || ""),
                    Number(offset || 0),
                    tokenEnd,
                );
                stageNormalizeMs = Date.now() - normalizeStart;
                assertNotAborted();
                const calcStart = Date.now();
                let calcSuffix = resolveCalcSuffix(p1, varName, targetFbMap);
                if (calcSuffix === undefined && targetFbMap === fbMap && spellMapAlias) {
                    // Fallback to alias map when current map is merged and key is alias-centric.
                    calcSuffix = resolveCalcSuffix(p1, varName, fbByCd);
                }
                if (calcSuffix) {
                    calcSuffix = expandCalcMacros(calcSuffix, targetFbMap);
                    calcSuffix = normalizeCalcText(calcSuffix);
                    if (calcSuffix && !hasEquivalentScaling(renderedVal, calcSuffix)) {
                        renderedVal += ` (${calcSuffix})`;
                    }
                }
                // Some slots store "TotalDamage" as scaling-only text while base values are in effect1amount.
                if (targetFbMap === fbMap && varName.includes("totaldamage")) {
                    const renderedTrim = renderedVal.replace(/\s+/g, "");
                    const scalingOnly = /%/.test(renderedTrim) && !/\d+\s*(?:\/\s*\d+)+/.test(renderedTrim) && !/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*$/.test(renderedTrim);
                    if (scalingOnly) {
                        const slotStem = `${String(champTooltipJson.champion || "").toLowerCase()}${slot.toLowerCase()}`;
                        const relatedAliasKeys = aliasKeyList.filter((k) => String(k || "").toLowerCase().includes(slotStem));
                        const orderedAliasKeys = Array.from(new Set([
                            ...(spellMapAlias ? [spellMapAlias] : []),
                            ...relatedAliasKeys,
                            ...aliasKeyList,
                        ]));
                        let baseSeries: string | undefined;
                        for (const alias of orderedAliasKeys) {
                            const maps = aliasResolvedMaps.get(alias);
                            if (!maps) continue;
                            baseSeries = maps.vm.get("effect1amount") || maps.dv.get("effect1amount") || maps.vm.get("effect1") || maps.dv.get("effect1");
                            if (baseSeries && String(baseSeries).trim() !== "") break;
                        }
                        if (baseSeries && !renderedVal.includes(baseSeries)) {
                            renderedVal = `${baseSeries}${renderedVal.startsWith("(") ? "" : " "}${renderedVal}`;
                        }
                    }
                }
                stageCalcMs = Date.now() - calcStart;
                resolvedTokenCount++;
                return collapseDuplicateScalings(renderedVal);
            }

                if (varName === "abilityresourcename") {
                    resolvedTokenCount++;
                    return "";
                }
                unresolvedTokenCount++;
                return ""; // unresolvable: hide unknown placeholders
            } finally {
                const d = Date.now() - tokenProfileStart;
                tokenMsByVar.set(tokenProfileKey, (tokenMsByVar.get(tokenProfileKey) || 0) + d);
                tokenHitByVar.set(tokenProfileKey, (tokenHitByVar.get(tokenProfileKey) || 0) + 1);
                if (tokenStageMsByVar) {
                    const staged = tokenStageMsByVar.get(tokenProfileKey) || { resolve: 0, normalize: 0, calc: 0, total: 0, hits: 0 };
                    staged.resolve += stageResolveMs;
                    staged.normalize += stageNormalizeMs;
                    staged.calc += stageCalcMs;
                    staged.total += d;
                    staged.hits += 1;
                    tokenStageMsByVar.set(tokenProfileKey, staged);
                }
            }
        });
        descriptionHtml = descriptionHtml
            .replace(/\s\*\s(?=\d)/g, " × ")
            .replace(/(%){2,}/g, "%");

        // Keep WAD tooltip as source of truth even when some vars are unresolved.

        const cleanTitle = (s: string) => {
            if (!s) return "";
            return s
                .replace(/\[@hotkey@\]\s*&nbsp;?/gi, "")
                .replace(/\[@hotkey@\]/gi, "")
                .replace(/&nbsp;/gi, " ")
                .trim();
        };

        const hotkeyLabel = slot === "Passive" ? "P" : slot;
        const slotIndex = slot === "Q" ? 0 : slot === "W" ? 1 : slot === "E" ? 2 : slot === "R" ? 3 : -1;
        const fallbackSpell = slot === "Passive" ? fallbackChampionData?.passive : (slotIndex >= 0 ? fallbackChampionData?.spells?.[slotIndex] : null);
        const spellName = cleanTitle(titleLeftRaw) || fallbackSpell?.name || (slot === "Passive" ? "Passive" : slot);
        const normalizeHeaderValue = (raw: string, kind: "cost" | "cooldown"): string => {
            const t = (raw || "").trim();
            if (!t) return "";
            const plain = t.match(/^([+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)*)$/);
            if (!plain) return t;

            let parts = plain[1].split("/");
            if (slot === "R" && parts.length > 3) {
                parts = parts.slice(0, 3);
            }
            if (kind === "cost") {
                while (parts.length > 1) {
                    const tail = parseFloat(parts[parts.length - 1]);
                    if (!isNaN(tail) && tail === 0) parts.pop();
                    else break;
                }
            }
            if (parts.length > 1 && parts.every(p => p === parts[0])) return parts[0];
            return parts.join("/");
        };

        const ddSpellStats = champTooltipJson.spell_stats?.[slot] || {};
        const costRaw = formatFallbackValue(
            resolveLocalVar("cost") ??
            resolveLocalVar("manacost") ??
            resolveLocalVar("mana") ??
            ddSpellStats.cost ??
            ""
        );
        const cooldownRaw = formatFallbackValue(
            resolveLocalVar("cooldown") ??
            resolveLocalVar("cooldowntime") ??
            resolveLocalVar("ammorechargetime") ??
            ddSpellStats.cooldown ??
            ""
        );

        let costText = normalizeHeaderValue(costRaw, "cost");
        const ddCostText = normalizeHeaderValue(formatFallbackValue(ddSpellStats.cost || ""), "cost");
        if ((!costText || /(?:^|\/)0(?:\/0)*$/.test(costText)) && ddCostText) {
            costText = ddCostText;
        }
        const cooldownText = normalizeHeaderValue(cooldownRaw, "cooldown");
        const range = formatFallbackValue(
            resolveLocalVar("castrange") ??
            resolveLocalVar("range") ??
            ddSpellStats.range ??
            ""
        );
        const cast = formatFallbackValue(resolveLocalVar("casttime") ?? "");
        const width = formatFallbackValue(
            resolveLocalVar("linewidth") ??
            resolveLocalVar("width") ??
            resolveLocalVar("castradius") ??
            ""
        );
        const speed = formatFallbackValue(resolveLocalVar("speed") ?? resolveLocalVar("missilespeed") ?? "");

        const detailItems: string[] = [];
        if (range) detailItems.push(`Range: ${range}`);
        if (cast) detailItems.push(`Cast: ${cast}s`);
        if (width) detailItems.push(`Width: ${width}`);
        if (speed) detailItems.push(`Speed: ${speed}`);
        const detailsHtml = detailItems.length
            ? `<span style="margin-left: 10px; font-weight: normal; font-size: 11px; color:#888;">${detailItems.join("&nbsp; ")}</span>`
            : "";

        const headerHtml = slot === "Passive"
            ? `
            <div style="display: flex; align-items: baseline; margin-bottom: 4px;">
                <b style="color:#00d2ff; font-size: 13px;">[${hotkeyLabel}]</b> 
                <span style="color:#eee; font-size: 13px; font-weight: bold; margin-left: 4px;">${spellName}</span>
            </div>`
            : `
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <div>
                    <b style="color:#00d2ff; font-size: 13px;">[${hotkeyLabel}]</b> 
                    <span style="color:#eee; font-size: 13px; font-weight: bold;">${spellName}</span>${detailsHtml}
                </div>
                <div style="color:#aaa; font-size: 11px; text-align: right;">
                    <span style="color:#ffb74d;">Cost: ${costText || "-"}</span> | CD: ${cooldownText ? `${cooldownText}s` : "-"}
                </div>
            </div>`;

        // Helper function to format fallback values that might be slash-separated strings
        function formatFallbackValue(val: string | number): string {
            if (typeof val === 'number') return String(Math.round(val * 100) / 100);
            if (!val || typeof val !== 'string') return String(val);
            let out = val.trim().replace(/\+{2,}/g, "+");

            // R rank values should be displayed as 3 tiers.
            if (slot === "R") {
                const m = out.match(/^([+\-]?\d+(?:\.\d+)?%?(?:\/[+\-]?\d+(?:\.\d+)?%?){3,})([\s\S]*)$/);
                if (m) {
                    const head = m[1].split("/").slice(0, 3).join("/");
                    out = head + (m[2] || "");
                }
            }

            if (!out.includes('/')) return out;

            // Keep complex expressions intact (e.g. "210 (+125%AD +80%AP)").
            if (/[()a-zA-Z]/.test(out)) return out;

            const parts = out.split('/');
            const cleanParts = parts.map(p => {
                const num = parseFloat(p);
                return isNaN(num) ? p : String(Math.round(num * 100) / 100);
            });

            if (cleanParts.every(p => p === cleanParts[0])) {
                return cleanParts[0];
            }
            return cleanParts.join('/');
        }
        
        // Fix Riot specific tags: <mainText> etc.
        descriptionHtml = descriptionHtml
            .replace(/<infoArea>[\s\S]*?<\/infoArea>/gi, "")
            .replace(/<mainText>(.*?)<\/mainText>/gi, '<div class="tooltip-main-text">$1</div>')
            .replace(/<postscriptLeft>(.*?)<\/postscriptLeft>/gi, '<div class="tooltip-postscript-left">$1</div>')
            .replace(/<postscriptRight>(.*?)<\/postscriptRight>/gi, '<div class="tooltip-postscript-right">$1</div>')
            .replace(/<postscriptTitle>(.*?)<\/postscriptTitle>/gi, '<div class="tooltip-postscript-title">$1</div>')
            .replace(/<br>/gi, '<br/>');
            
        // Additional cleanup: {{...}} leftovers (some WADs still have them)
        descriptionHtml = descriptionHtml.replace(/\{\{\s*[^}]+\s*\}\}/g, "");

        // Strip icon placeholders like %i:cooldown%
        descriptionHtml = descriptionHtml.replace(/%i:[^%]*%/g, '');

        // Colorize Riot's XML tags
        descriptionHtml = descriptionHtml
            .replace(new RegExp("<physicalDamage>", "gi"), '<span class="tooltip-physical-damage">')
            .replace(new RegExp("</physicalDamage>", "gi"), '</span>')
            .replace(new RegExp("<magicDamage>", "gi"), '<span class="tooltip-magic-damage">')
            .replace(new RegExp("</magicDamage>", "gi"), '</span>')
            .replace(new RegExp("<status>", "gi"), '<span class="tooltip-status">')
            .replace(new RegExp("</status>", "gi"), '</span>')
            .replace(new RegExp("<keyword[^>]*>", "gi"), '<span class="tooltip-keyword">')
            .replace(new RegExp("</keyword[^>]*>", "gi"), '</span>')
            .replace(new RegExp("<rules>", "gi"), '<i class="tooltip-rules">')
            .replace(new RegExp("</rules>", "gi"), '</i>')
            .replace(new RegExp("<spellName>", "gi"), '<span class="tooltip-spell-name">')
            .replace(new RegExp("</spellName>", "gi"), '</span>')
            .replace(new RegExp("<trueDamage>", "gi"), '<span class="tooltip-true-damage">')
            .replace(new RegExp("</trueDamage>", "gi"), '</span>')
            .replace(new RegExp("<healing>", "gi"), '<span class="tooltip-healing">')
            .replace(new RegExp("</healing>", "gi"), '</span>')
            .replace(new RegExp("<shield>", "gi"), '<span class="tooltip-shield">')
            .replace(new RegExp("</shield>", "gi"), '</span>')
            .replace(new RegExp("<speed>", "gi"), '<span class="tooltip-speed">')
            .replace(new RegExp("</speed>", "gi"), '</span>')
            .replace(new RegExp("<attackSpeed>", "gi"), '<span class="tooltip-attack-speed">')
            .replace(new RegExp("</attackSpeed>", "gi"), '</span>')
            .replace(new RegExp("<scaleArmor>", "gi"), '<span class="tooltip-scale-armor">')
            .replace(new RegExp("</scaleArmor>", "gi"), '</span>')
            .replace(new RegExp("<scaleMR>", "gi"), '<span class="tooltip-scale-mr">')
            .replace(new RegExp("</scaleMR>", "gi"), '</span>')
            .replace(new RegExp("<scaleMana>", "gi"), '<span class="tooltip-scale-mana">')
            .replace(new RegExp("</scaleMana>", "gi"), '</span>')
            .replace(new RegExp("<scaleHealth>", "gi"), '<span class="tooltip-scale-health">')
            .replace(new RegExp("</scaleHealth>", "gi"), '</span>')
            .replace(new RegExp("<scaleAD>", "gi"), '<span class="tooltip-scale-ad">')
            .replace(new RegExp("</scaleAD>", "gi"), '</span>')
            .replace(new RegExp("<scaleAP>", "gi"), '<span class="tooltip-scale-ap">')
            .replace(new RegExp("</scaleAP>", "gi"), '</span>')
            .replace(new RegExp("<scaleLv>", "gi"), '<span class="tooltip-scale-lv">')
            .replace(new RegExp("</scaleLv>", "gi"), '</span>')
            .replace(new RegExp("<attention>", "gi"), '<span class="tooltip-attention">')
            .replace(new RegExp("</attention>", "gi"), '</span>')
            .replace(new RegExp("<OnHit>", "gi"), '<span class="tooltip-on-hit">')
            .replace(new RegExp("</OnHit>", "gi"), '</span>')
            .replace(new RegExp("<passive>", "gi"), '<span class="tooltip-passive">')
            .replace(new RegExp("</passive>", "gi"), '</span>')
            .replace(new RegExp("<spellPassive>", "gi"), '<span class="tooltip-spell-passive">')
            .replace(new RegExp("</spellPassive>", "gi"), '</span>')
            .replace(new RegExp("<spellActive>", "gi"), '<span class="tooltip-spell-active">')
            .replace(new RegExp("</spellActive>", "gi"), '</span>')
            .replace(new RegExp("<recast>", "gi"), '<span class="tooltip-recast">')
            .replace(new RegExp("</recast>", "gi"), '</span>')
            .replace(new RegExp("<lifeSteal>", "gi"), '<span class="tooltip-life-steal">')
            .replace(new RegExp("</lifeSteal>", "gi"), '</span>')
            .replace(new RegExp("<keywordStealth>", "gi"), '<span class="tooltip-keyword-stealth">')
            .replace(new RegExp("</keywordStealth>", "gi"), '</span>')
            .replace(new RegExp("<flavorText>", "gi"), '<span class="tooltip-flavor-text">')
            .replace(new RegExp("</flavorText>", "gi"), '</span>')
            .replace(new RegExp("<keywordMajor>", "gi"), '<span class="tooltip-keyword-major">')
            .replace(new RegExp("</keywordMajor>", "gi"), '</span>')
            .replace(new RegExp("<scaleLethality>", "gi"), '<span class="tooltip-scale-lethality">')
            .replace(new RegExp("</scaleLethality>", "gi"), '</span>')
            .replace(/<font[^>]*>/gi, "<span>")
            .replace(/<\/font>/gi, "</span>")
            .replace(/<size=[^>]*>/gi, "")
            .replace(/<\/size>/gi, "")
            .replace(/font-size\s*:\s*[^;"]+;?/gi, "")
            .replace(new RegExp("<infoArea>", "gi"), '')
            .replace(new RegExp("</infoArea>", "gi"), '');

        descriptionHtml = descriptionHtml
            .replace(/\?+/g, "")
            .replace(/\[\s*\]/g, "")
            .replace(/<li>\s*<\/li>/gi, "")
            .replace(/<span[^>]*>\s*\/\s*<\/span>/gi, "")
            .replace(/<li>\s*[:：]\s*<\/li>/gi, "")
            .replace(/<li>\s*[:：]?\s*(?:<span[^>]*>\s*<\/span>\s*)*<\/li>/gi, "")
            .replace(/<br\/>\s*<br\/>\s*<br\/>/g, "<br/><br/>")
            .replace(/\s{2,}/g, " ");

        // Some extracted slots may come as plain text without <mainText> wrapper.
        // Keep visual consistency (and avoid larger default font) by wrapping them.
        if (!/class=\"tooltip-main-text\"/i.test(descriptionHtml)) {
            descriptionHtml = `<div class="tooltip-main-text">${descriptionHtml}</div>`;
        }
        const champKey = String(champTooltipJson?.champion || "unknown");
        descriptionHtml = normalizeTooltipTextSafe(descriptionHtml, `${lang}:${champKey}:${slot}`);

        const plainDesc = descriptionHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, "").trim();
        const unresolvedSpellLocKey = /\{\{\s*Spell_[^}]+\}\}/i.test(descriptionHtml);
        const unresolvedTemplateKey = /\{\{[^}]+\}\}/.test(descriptionHtml);
        const looksBrokenPassive = slot === "Passive" && (
            !plainDesc ||
            plainDesc === "クリックまたは[]でレベルアップ" ||
            plainDesc.length <= 6
        );
        const looksBrokenAny =
            !plainDesc ||
            plainDesc === "クリックまたは[]でレベルアップ" ||
            unresolvedSpellLocKey ||
            (unresolvedTemplateKey && plainDesc.length < 40);
        const fallbackPlainDesc = String(fallbackSpell?.description || "")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, "")
            .trim();
        const localLooksTooSimple =
            slot !== "Passive" &&
            !!fallbackPlainDesc &&
            plainDesc.length > 0 &&
            fallbackPlainDesc.length >= Math.floor(plainDesc.length * 1.35) &&
            !/<postscriptleft>|<postscriptright>/i.test(rawHtml);
        const localLooksVeryShort =
            slot !== "Passive" &&
            !!fallbackPlainDesc &&
            plainDesc.length > 0 &&
            plainDesc.length < 180 &&
            fallbackPlainDesc.length >= Math.max(plainDesc.length + 30, Math.floor(plainDesc.length * 1.15));
        if ((looksBrokenPassive || looksBrokenAny || localLooksTooSimple || localLooksVeryShort) && fallbackSpell?.description) {
            const fallbackDesc = String(fallbackSpell.description)
                .replace(/<br\s*\/?>/gi, "<br/>")
                .replace(/<\/?font[^>]*>/gi, "")
                .replace(/<br\/>\s*<br\/>\s*<br\/>/g, "<br/><br/>");
            descriptionHtml = `<div class="tooltip-main-text">${normalizeTooltipTextSafe(fallbackDesc, `${lang}:${champKey}:${slot}:fallback`)}</div>`;
        }

        html += headerHtml;
        html += descriptionHtml;
        html += `</div>`;
        const topTokenCosts = Array.from(tokenMsByVar.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([token, ms]) => ({ token, ms, hits: tokenHitByVar.get(token) || 0 }));
        const topTokenStageCosts = tokenStageMsByVar
            ? Array.from(tokenStageMsByVar.entries())
                .sort((a, b) => b[1].total - a[1].total)
                .slice(0, 6)
                .map(([token, stat]) => ({ token, ...stat }))
            : [];
        prof.slots[slot] = {
            ms: Date.now() - slotStart,
            resolvedTokenCount,
            unresolvedTokenCount,
            topTokenCosts,
            topTokenStageCosts,
        };
    }

    const apheliosWeaponSummary = String(champTooltipJson?.Extra_ApheliosWeaponSummary || "").trim();
    if (apheliosWeaponSummary) {
        const summaryLabel = String(lang || "").toLowerCase().startsWith("ja") ? "武器説明" : "Weapon Summary";
        const summaryHtml = normalizeTooltipTextSafe(
            apheliosWeaponSummary
                .replace(/<br>/gi, "<br/>")
                .replace(/\{\{[^}]+\}\}/g, "")
                .replace(/@([a-zA-Z0-9_\.:\*\-\+]+)@/g, ""),
            `${lang}:${String(champTooltipJson?.champion || "unknown")}:Extra_ApheliosWeaponSummary`,
        );
        html += `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #333;">
            <div style="display: flex; align-items: baseline; margin-bottom: 4px;">
                <b style="color:#00d2ff; font-size: 13px;">[Extra]</b>
                <span style="color:#eee; font-size: 13px; font-weight: bold; margin-left: 4px;">${summaryLabel}</span>
            </div>
            <div class="tooltip-main-text">${summaryHtml}</div>
        </div>`;
    }
    prof.totalMs = Date.now() - startedAt;
    if (options?.onProfile) {
        try {
            options.onProfile(prof);
        } catch {}
    }
    
    return html;
}

export function buildLocalChampionTooltipHtmlLite(champTooltipJson: any, lang: string = "ja"): string {
    if (!champTooltipJson) return "";
    const localChampionName = champTooltipJson.champion_local || champTooltipJson.champion_name || champTooltipJson.champion || "Champion";
    const localChampionTitle = champTooltipJson.champion_title || "";
    const englishChampionName = champTooltipJson.champion_en || champTooltipJson.champion || "";

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:8px;">
            <div>
                <b style="color:#c8aa6e; font-size:16px;">${localChampionName}</b>
                ${localChampionTitle ? `<span style="color:#aaa; font-size:12px; margin-left:6px;">${localChampionTitle}</span>` : ""}
                ${englishChampionName ? `<span style="color:#888; font-size:11px; margin-left:8px;">(${englishChampionName})</span>` : ""}
            </div>
            <div style="color:#888; font-size:11px;">Lite</div>
        </div>`;

    const slots = ["Passive", "Q", "W", "E", "R"];
    const slotLabel = (slot: string) => (slot === "Passive" ? "P" : slot);
    const extractTag = (src: string, tag: string): string => {
        const m = src.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return m ? m[1] : "";
    };

    for (const slot of slots) {
        const rawHtml = String(champTooltipJson[slot] || "");
        if (!rawHtml) continue;
        const title = extractTag(rawHtml, "titleLeft")
            .replace(/\[@hotkey@\]\s*&nbsp;?/gi, "")
            .replace(/\[@hotkey@\]/gi, "")
            .replace(/&nbsp;/gi, " ")
            .trim();
        let mainText = extractTag(rawHtml, "mainText");
        if (!mainText) {
            mainText = rawHtml;
        }
        mainText = mainText
            .replace(/<titleLeft>[\s\S]*?<\/titleLeft>/gi, "")
            .replace(/<titleRight>[\s\S]*?<\/titleRight>/gi, "")
            .replace(/<subtitleLeft>[\s\S]*?<\/subtitleLeft>/gi, "")
            .replace(/<subtitleRight>[\s\S]*?<\/subtitleRight>/gi, "")
            .replace(/<postScriptLeft>[\s\S]*?<\/postScriptLeft>/gi, "")
            .replace(/<postScriptRight>[\s\S]*?<\/postScriptRight>/gi, "")
            .replace(/@([a-zA-Z0-9_\.:\*\-\+]+)@/g, "")
            .replace(/%i:[^%]*%/g, "")
            .replace(/<mainText>/gi, "")
            .replace(/<\/mainText>/gi, "")
            .replace(/<br>/gi, "<br/>")
            .replace(/<br\/>\s*<br\/>\s*<br\/>/g, "<br/><br/>")
            .replace(/\s{2,}/g, " ");

        html += `
        <div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px dashed #333;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                <div>
                    <b style="color:#00d2ff; font-size:13px;">[${slotLabel(slot)}]</b>
                    <span style="color:#eee; font-size:13px; font-weight:bold; margin-left:4px;">${title || slot}</span>
                </div>
            </div>
            <div style="font-size:12px; margin-top:5px; color:#ddd; line-height:1.4;">${mainText}</div>
        </div>`;
    }
    return html;
}

type TooltipLiteSafetyDecision = {
    useLite: boolean;
    reason: string;
};

export function evaluateLocalTooltipSafety(champTooltipJson: any): TooltipLiteSafetyDecision {
    const slots = ["Passive", "Q", "W", "E", "R"];
    let totalLen = 0;
    let totalTokenCount = 0;
    let maxSlotTokenCount = 0;
    let maxSeriesCount = 0;
    let maxSlotLen = 0;
    let maxSlotComplexity = 0;

    for (const slot of slots) {
        const raw = champTooltipJson?.[slot];
        if (typeof raw !== "string") continue;
        const len = raw.length;
        totalLen += len;
        if (len > maxSlotLen) maxSlotLen = len;

        const tokenCount = (raw.match(/@[A-Za-z0-9_.:*+\-]+@/g) || []).length;
        totalTokenCount += tokenCount;
        if (tokenCount > maxSlotTokenCount) maxSlotTokenCount = tokenCount;

        const seriesCount = (raw.match(/[0-9]+(?:\.[0-9]+)?(?:\/[0-9]+(?:\.[0-9]+)?){3,}/g) || []).length;
        if (seriesCount > maxSeriesCount) maxSeriesCount = seriesCount;

        const slotComplexity = estimateNormalizeComplexity(raw);
        if (slotComplexity > maxSlotComplexity) maxSlotComplexity = slotComplexity;
    }

    if (maxSlotLen > 5500) {
        return { useLite: true, reason: `slot_too_long:${maxSlotLen}` };
    }
    if (totalLen > 15000) {
        return { useLite: true, reason: `payload_too_large:${totalLen}` };
    }
    // Token count alone is not a strong freeze signal for many modern champions.
    // Keep this threshold very high to avoid unnecessary lite fallback.
    if (totalTokenCount > 500) {
        return { useLite: true, reason: `too_many_tokens:${totalTokenCount}` };
    }
    // Per-slot token bursts are a stronger freeze signal than total count.
    if (maxSlotTokenCount >= 74) {
        return { useLite: true, reason: `slot_token_burst:${maxSlotTokenCount}` };
    }
    // Keep full rendering away from slots that are near pathological regex/token workloads.
    if (maxSlotComplexity > 8600) {
        return { useLite: true, reason: `slot_complexity:${maxSlotComplexity}` };
    }
    if (maxSeriesCount > 26) {
        return { useLite: true, reason: `too_many_numeric_series:${maxSeriesCount}` };
    }
    return { useLite: false, reason: "" };
}
