import { exists, mkdir, readFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { getCachedAssetUrl } from "./assets";
import { STATIC_ARAM_QUEUES, STATIC_SR_QUEUES, STATIC_TFT_QUEUES, STATIC_OTHER_QUEUES } from "./queues";
import { getCurrentPatchVersion } from "./version";

// Cache for data
// Keyed by version -> data
const cachedItemDataByVersion: Record<string, Record<string, any>> = {};
const cachedRuneDataByVersion: Record<string, Record<string, any>> = {};
let cachedChampionData: Record<string, any> | null = null;
let cachedChampionEnglishData: Record<string, any> | null = null;

// TFT Cache Maps
let tftTraitIconMap: Record<string, string> = {};
let tftUnitIconMap: Record<string, string> = {};
let tftTraitStyleMap: Record<string, Record<number, number>> = {};
let tftUnitCostMap: Record<string, number> = {};
let isTftDataLoaded = false;
let tftDataLoadPromise: Promise<void> | null = null;

let tftDDTraitMap: Record<string, string> = {};
let tftDDTraitApiNameMap: Record<string, string> = {};
let isTftDDTraitLoaded = false;
let tftDDTraitLoadPromise: Promise<void> | null = null;

let tftDDItemMap: Record<string, string> = {};
let isTftDDItemLoaded = false;
let tftDDItemLoadPromise: Promise<void> | null = null;

function rememberTftTraitIcon(key: unknown, filename: string) {
    if (typeof key !== "string") return;
    const normalized = key.trim().toLowerCase();
    if (!normalized) return;
    tftDDTraitMap[normalized] = filename;
}

function rememberTftTraitApiName(key: unknown, apiName: unknown) {
    if (typeof key !== "string" || typeof apiName !== "string") return;
    const normalized = key.trim().toLowerCase();
    const normalizedApiName = apiName.trim();
    if (!normalized || !normalizedApiName) return;
    tftDDTraitApiNameMap[normalized] = normalizedApiName;
}
const DD_FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, timeoutMs: number = DD_FETCH_TIMEOUT_MS, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function ensureTftDDItemLoaded() {
    if (isTftDDItemLoaded) return;
    if (tftDDItemLoadPromise) return tftDDItemLoadPromise;
    tftDDItemLoadPromise = ensureTftDDItemLoadedInner().finally(() => {
        tftDDItemLoadPromise = null;
    });
    return tftDDItemLoadPromise;
}

async function ensureTftDDItemLoadedInner() {
    try {
        const version = getCurrentPatchVersion();
        const cacheDir = "items_cache";
        const filePath = `${cacheDir}/tft_items_dd_${version}.json`;
        let data: any = null;

        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const raw = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const str = new TextDecoder().decode(raw);
            try {
                data = JSON.parse(str);
            } catch (e) { console.error("Bad TFT DD Item cache", e); }
        }

        if (!data) {
            const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/tft-item.json`;
            const res = await fetchWithTimeout(url);
            if (res.ok) {
                const json = await res.json();
                data = json.data;
                try {
                    if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
                         await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
                    }
                    await writeFile(filePath, new TextEncoder().encode(JSON.stringify(data)), { baseDir: BaseDirectory.AppLocalData });
                } catch(e) { }
            }
        }

        if (data) {
            for (const key of Object.keys(data)) {
                const item = data[key];
                if (item.image && item.image.full) {
                    // key is something like "TFT_Item_BFSword" or "TFTTutorial_Items/TFTTutorial_Item_RecurveBow"
                    // item.id is usually the clean name like "TFT_Item_BFSword"
                    const lookupKey = (item.id || key).split("/").pop()!.toLowerCase();
                    tftDDItemMap[lookupKey] = item.image.full;
                }
            }
        }
    } catch (e) {
        console.error("Failed to load DD TFT Items", e);
    }
    isTftDDItemLoaded = true;
}

export async function ensureTftDDTraitLoaded() {
    if (isTftDDTraitLoaded) return;
    if (tftDDTraitLoadPromise) return tftDDTraitLoadPromise;
    tftDDTraitLoadPromise = ensureTftDDTraitLoadedInner().finally(() => {
        tftDDTraitLoadPromise = null;
    });
    return tftDDTraitLoadPromise;
}

async function ensureTftDDTraitLoadedInner() {
    try {
        const version = getCurrentPatchVersion();
        const cacheDir = "items_cache";
        const filePath = `${cacheDir}/tft_traits_dd_${version}.json`;
        let data: any = null;

        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const raw = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const str = new TextDecoder().decode(raw);
            try {
                data = JSON.parse(str);
            } catch (e) { console.error("Bad TFT DD Trait cache", e); }
        }

        if (!data) {
            // "ja_JP" works safely to fetch the generic images; mapping names stays the same in image map.
            const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/ja_JP/tft-trait.json`;
            const res = await fetchWithTimeout(url);
            if (res.ok) {
                const json = await res.json();
                data = json.data;
                try {
                    if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
                         await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
                    }
                    await writeFile(filePath, new TextEncoder().encode(JSON.stringify(data)), { baseDir: BaseDirectory.AppLocalData });
                } catch(e) { }
            }
        }

        if (data) {
            for (const key of Object.keys(data)) {
                const trait = data[key];
                if (trait.image && trait.image.full) {
                    rememberTftTraitIcon(key, trait.image.full);
                    rememberTftTraitIcon(trait.id, trait.image.full);
                    rememberTftTraitIcon(trait.name, trait.image.full);
                    rememberTftTraitApiName(key, trait.id);
                    rememberTftTraitApiName(trait.id, trait.id);
                    rememberTftTraitApiName(trait.name, trait.id);
                }
            }
        }
    } catch (e) {
        console.error("Failed to load DD TFT Traits", e);
    }
    isTftDDTraitLoaded = true;
}
export function getDDragonLocale(lang: string): string {
    switch (lang) {
        case "ko": return "ko_KR";
        case "zh": return "zh_CN";
        case "vi": return "vi_VN";
        case "pt": return "pt_BR";
        case "es": return "es_ES";
        case "fr": return "fr_FR";
        case "de": return "de_DE";
        case "ru": return "ru_RU";
        case "tr": return "tr_TR";
        case "pl": return "pl_PL";
        case "it": return "it_IT";
        case "en": return "en_US";
        case "ja":
        default: return "ja_JP";
    }
}

function getBaseUrl() {
    return `https://ddragon.leagueoflegends.com/cdn/${getCurrentPatchVersion()}/img`;
}

// Ensure data is loaded
export async function ensureDataLoaded(langStr: string = "ja") {
    if (cachedChampionData && cachedChampionEnglishData) return;
    
    try {
        const version = getCurrentPatchVersion();
        const locale = getDDragonLocale(langStr);
        const championListUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/champion.json`;
        const championEnglishListUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
        
        const [champRes, champEnRes] = await Promise.all([
            fetchWithTimeout(championListUrl),
            fetchWithTimeout(championEnglishListUrl),
        ]);

        if (champRes.ok) cachedChampionData = (await champRes.json()).data;
        if (champEnRes.ok) cachedChampionEnglishData = (await champEnRes.json()).data;
    } catch (e) {
        console.error("Failed to load DataDragon champion data:", e);
    }
}

/**
 * Derives the game mode category (SR, ARAM, TFT, OTHER) from a queue ID based on static mappings.
 * @param queueId The ID from metadata
 * @param fallbackQueueName Optional name from metadata just in case ID is unknown
 */
export function getGameModeByQueueId(queueId: number, fallbackQueueName: string = ""): 'SR' | 'ARAM' | 'TFT' | 'OTHER' | 'UNKNOWN' {
    if (STATIC_TFT_QUEUES.includes(queueId)) return 'TFT';
    if (STATIC_ARAM_QUEUES.includes(queueId)) return 'ARAM';
    if (STATIC_SR_QUEUES.includes(queueId)) return 'SR';
    if (STATIC_OTHER_QUEUES.includes(queueId)) return 'OTHER';
    
    // Fallback checks using name if ID is somehow entirely missing or unknown 0
    const fallbackName = fallbackQueueName.toLowerCase();
    if (fallbackName === "teamfight tactics" || fallbackName.includes("tft")) return 'TFT';
    if (fallbackName.includes("aram") || fallbackName.includes("howling abyss")) return 'ARAM';
    if (fallbackName.includes("arena") || fallbackName.includes("urf") || fallbackName.includes("nexus blitz") || fallbackName.includes("spellbook")) return 'OTHER';
    if (fallbackName.includes("rift") || fallbackName.includes("draft") || fallbackName.includes("blind") || fallbackName.includes("quickplay") || fallbackName.includes("swiftplay") || fallbackName.includes("normal") || fallbackName.includes("practice") || fallbackName.includes("bot")) return 'SR';
    
    return 'UNKNOWN';
}

/**
 * Ensures item data for a specific version is loaded.
 * 1. Checks in-memory cache.
 * 2. Checks local file system cache (appData/cache/items/{version}.json).
 * 3. Fetches from DataDragon (Japanese locale).
 * 4. Saves to local file system.
 */
export async function ensureItemDataLoaded(version: string, langStr: string = "ja") {
    const locale = getDDragonLocale(langStr);
    const cacheKey = `${version}_${locale}`;
    
    // 1. In-memory check
    if (cachedItemDataByVersion[cacheKey]) return;

    const cacheDir = "items_cache";
    const filename = `item_${version}_${locale}.json`;
    const filePath = `${cacheDir}/${filename}`;

    try {
        // Ensure cache directory exists
        if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
            await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }

        // 2. Local file check
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const jsonStr = new TextDecoder().decode(data);
            const json = JSON.parse(jsonStr);
            cachedItemDataByVersion[cacheKey] = json.data || json; // Handle structure differences if any
            return;
        }

        // 3. Fetch from DataDragon
        // Use Japanese locale as requested: ja_JP
        // URL format: https://ddragon.leagueoflegends.com/cdn/{version}/data/ja_JP/item.json
        
        let targetVersion = version;
        if (version.split('.').length > 3) {
             const parts = version.split('.');
             targetVersion = `${parts[0]}.${parts[1]}.1`;
        }

        let url = `https://ddragon.leagueoflegends.com/cdn/${targetVersion}/data/${locale}/item.json`;
        
        // Helper to fetch with retry on fallback
        const fetchItemData = async (v: string, u: string) => {
             const res = await fetchWithTimeout(u);
             if (res.ok) return { res, v };
             return null;
        };

        let result = await fetchItemData(targetVersion, url);
        
        // If failed and formatted version was different, try exact version just in case (unlikely but safe)
        if (!result && targetVersion !== version) {
             url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/item.json`;
             result = await fetchItemData(version, url);
        }

        // Final Fallback to Current Patch Version
        if (!result) {            
             const currentVer = getCurrentPatchVersion();
             if (currentVer !== version && currentVer !== targetVersion) {
                 url = `https://ddragon.leagueoflegends.com/cdn/${currentVer}/data/${locale}/item.json`;
                 result = await fetchItemData(currentVer, url);
             }
        }

        if (!result || !result.res.ok) {
            console.error(`Failed to fetch item data for version ${version} (and fallbacks).`);
            return;
        }

        const json = await result.res.json();
        const itemData = json.data;
        
        // Map cached data to the REQUESTED version key, so ui.ts can find it
        cachedItemDataByVersion[cacheKey] = itemData;

        // 4. Save to local file (Save under the requested version name so we verify existence next time)

        
        // 4. Save to local file
        const dataToSave = JSON.stringify(json); // Save entire response
        await writeFile(filePath, new TextEncoder().encode(dataToSave), { baseDir: BaseDirectory.AppLocalData });
        
        // console.log(`Saved item data for ${version} to local cache.`);

    } catch (e) {
        console.error(`Error ensuring item data for version ${version}:`, e);
    }
}

export function getItemPrice(itemId: number, version: string): number {
    const locale = getDDragonLocale("ja"); // Not strictly needed for UI, but safe fallback
    const cacheKey = `${version}_${locale}`;
    if (!cachedItemDataByVersion[cacheKey]) return 0;
    
    const item = cachedItemDataByVersion[cacheKey][itemId];
    if (item && item.gold && typeof item.gold.total === 'number') {
        return item.gold.total;
    }
    
    return 0;
}

export async function getItemData(itemId: number, langStr: string = "ja"): Promise<any> {
    const version = getCurrentPatchVersion();
    await ensureItemDataLoaded(version, langStr);
    const locale = getDDragonLocale(langStr);
    const cacheKey = `${version}_${locale}`;
    return cachedItemDataByVersion[cacheKey] ? cachedItemDataByVersion[cacheKey][itemId] : null;
}

export async function ensureRuneDataLoaded(version: string, langStr: string = "ja") {
    const locale = getDDragonLocale(langStr);
    const cacheKey = `${version}_${locale}`;
    
    // 1. In-memory check
    if (cachedRuneDataByVersion[cacheKey]) return;

    const cacheDir = "items_cache";
    const filename = `rune_${version}_${locale}.json`;
    const filePath = `${cacheDir}/${filename}`;

    try {
        if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
            await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }

        // 2. Local file check
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const jsonStr = new TextDecoder().decode(data);
            cachedRuneDataByVersion[cacheKey] = JSON.parse(jsonStr);
            return;
        }

        // 3. Fetch from DataDragon
        let targetVersion = version;
        if (version.split('.').length > 3) {
             const parts = version.split('.');
             targetVersion = `${parts[0]}.${parts[1]}.1`;
        }

        let url = `https://ddragon.leagueoflegends.com/cdn/${targetVersion}/data/${locale}/runesReforged.json`;
        
        const fetchRuneData = async (u: string) => {
             const res = await fetchWithTimeout(u);
             if (res.ok) return await res.json();
             return null;
        };

        let result = await fetchRuneData(url);
        
        if (!result && targetVersion !== version) {
             url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/runesReforged.json`;
             result = await fetchRuneData(url);
        }

        if (!result) {            
             const currentVer = getCurrentPatchVersion();
             if (currentVer !== version && currentVer !== targetVersion) {
                 url = `https://ddragon.leagueoflegends.com/cdn/${currentVer}/data/${locale}/runesReforged.json`;
                 result = await fetchRuneData(url);
             }
        }

        if (!result) {
            console.error(`Failed to fetch rune data for version ${version} (and fallbacks).`);
            return;
        }
        
        // 4. Flatten the rune tree to { [runeId]: RuneData }
        const flatRuneCache: Record<string, any> = {};
        for (const tree of result) {
            for (const slot of tree.slots) {
                for (const rune of slot.runes) {
                    flatRuneCache[rune.id] = rune;
                }
            }
        }
        
        cachedRuneDataByVersion[cacheKey] = flatRuneCache;

        // 5. Save flattened cache to local file
        const dataToSave = JSON.stringify(flatRuneCache);
        await writeFile(filePath, new TextEncoder().encode(dataToSave), { baseDir: BaseDirectory.AppLocalData });

    } catch (e) {
        console.error(`Error ensuring rune data for version ${version}:`, e);
    }
}

export async function getRuneData(runeId: number, langStr: string = "ja"): Promise<any> {
    const version = getCurrentPatchVersion();
    await ensureRuneDataLoaded(version, langStr);
    const locale = getDDragonLocale(langStr);
    const cacheKey = `${version}_${locale}`;
    return cachedRuneDataByVersion[cacheKey] ? cachedRuneDataByVersion[cacheKey][runeId] : null;
}

export async function getChampionData(championIdOrName: string | number): Promise<any> {
    await ensureDataLoaded();
    if (!cachedChampionData) return null;
    
    if (typeof championIdOrName === "string") {
        return cachedChampionData[championIdOrName];
    } else {
        // Search by ID (DataDragon is keyed by Name, but entries have "key" property which is ID)
        return Object.values(cachedChampionData).find((c: any) => c.key == championIdOrName);
    }
}

const detailedChampionCache: Record<string, any> = {};

let allChampionsLocalTooltipCache: Record<string, any> | null = null;
let allChampionsLocalTooltipLocale: string = "";

export async function getLocalChampionTooltips(championId: number, langStr: string = "ja"): Promise<any> {
    const champName = await getChampionNameById(championId);
    if (!champName) return null;
    
    const locale = getDDragonLocale(langStr);
    
    if (allChampionsLocalTooltipCache && allChampionsLocalTooltipLocale !== locale) {
        allChampionsLocalTooltipCache = null;
    }

    if (!allChampionsLocalTooltipCache) {
        try {
            const mergeExtraKeysFromFallbackJson = async () => {
                try {
                    const filePath = `tooltip_cache/all_champions_${locale}.json`;
                    if (!(await exists(filePath, { baseDir: BaseDirectory.AppLocalData }))) return;
                    const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
                    const jsonStr = new TextDecoder().decode(data);
                    const fallbackAll = JSON.parse(jsonStr);
                    if (!fallbackAll || typeof fallbackAll !== "object" || !allChampionsLocalTooltipCache) return;

                    for (const [champNameKey, fallbackChamp] of Object.entries(fallbackAll as Record<string, any>)) {
                        if (!fallbackChamp || typeof fallbackChamp !== "object") continue;
                        const currentChamp = (allChampionsLocalTooltipCache as any)[champNameKey];
                        if (!currentChamp || typeof currentChamp !== "object") continue;
                        for (const [k, v] of Object.entries(fallbackChamp as Record<string, any>)) {
                            if (!k.startsWith("Extra_")) continue;
                            if (typeof v !== "string" || !v.trim()) continue;
                            (currentChamp as any)[k] = v;
                        }
                    }
                } catch (e) {
                    // Keep DB payload usable even when optional local fallback merge fails.
                    console.warn("mergeExtraKeysFromFallbackJson failed:", e);
                }
            };

            // Preferred source: bundled SQLite DB copied to AppData (survives AppLocalData cache cleanup).
            const dbJson = await invoke<string | null>("load_tooltip_locale_db", { locale });
            if (dbJson) {
                allChampionsLocalTooltipCache = JSON.parse(dbJson);
                await mergeExtraKeysFromFallbackJson();
                allChampionsLocalTooltipLocale = locale;
            } else {
                // Backward-compatible fallback: old JSON cache file in AppLocalData.
                const filePath = `tooltip_cache/all_champions_${locale}.json`;
                if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
                    const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
                    const jsonStr = new TextDecoder().decode(data);
                    allChampionsLocalTooltipCache = JSON.parse(jsonStr);
                    allChampionsLocalTooltipLocale = locale;
                } else {
                    return null;
                }
            }
        } catch(e) {
            console.error(`Failed to load all local tooltips for (${locale}):`, e);
            return null;
        }
    }

    if (allChampionsLocalTooltipCache && allChampionsLocalTooltipCache[champName]) {
        return allChampionsLocalTooltipCache[champName];
    }
    
    return null;
}

export async function getDetailedChampionData(championId: number, version: string, langStr: string = "ja"): Promise<any> {
    const champName = await getChampionNameById(championId);
    if (!champName) return null;
    
    const locale = getDDragonLocale(langStr);
    // Check in-memory cache
    const cacheKey = `${version}_${locale}_${champName}`;
    if (detailedChampionCache[cacheKey]) return detailedChampionCache[cacheKey];
    
    let targetVersion = version;
    if (version.split('.').length > 3) {
         const parts = version.split('.');
         targetVersion = `${parts[0]}.${parts[1]}.1`;
    }

    const cacheDir = "items_cache";
    const filename = `champion_${targetVersion}_${locale}_${champName}.json`;
    const cdragonFilename = `cdragon_${targetVersion}_${champName.toLowerCase()}.json`;
    const filePath = `${cacheDir}/${filename}`;
    const cdragonFilePath = `${cacheDir}/${cdragonFilename}`;

    try {
        if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
            await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const jsonStr = new TextDecoder().decode(data);
            const json = JSON.parse(jsonStr);
            let champData = json.data[champName];
            if (!champData.cd_merged) {
                champData = await mergeCDragonData(champName, champData, cdragonFilePath);
                champData.cd_merged = true;
                json.data[champName] = champData;
                try {
                    await writeFile(filePath, new TextEncoder().encode(JSON.stringify(json)), { baseDir: BaseDirectory.AppLocalData });
                } catch(e) {}
            }
            detailedChampionCache[cacheKey] = champData;
            return detailedChampionCache[cacheKey];
        }
    } catch(e) {}

    let url = `https://ddragon.leagueoflegends.com/cdn/${targetVersion}/data/${locale}/champion/${champName}.json`;
    try {
        let res = await fetchWithTimeout(url);
        if (!res.ok) {
            // fallback
            res = await fetchWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${getCurrentPatchVersion()}/data/${locale}/champion/${champName}.json`);
        }
        if (res.ok) {
             const json = await res.json();
             let champData = json.data[champName];

             champData = await mergeCDragonData(champName, champData, cdragonFilePath);
             champData.cd_merged = true;
             json.data[champName] = champData;

             detailedChampionCache[cacheKey] = champData;
             try {
                 const dataToSave = JSON.stringify(json); // Save combined DDragon + CDragon JSON to cache
                 await writeFile(filePath, new TextEncoder().encode(dataToSave), { baseDir: BaseDirectory.AppLocalData });
             } catch(e) {}
             return detailedChampionCache[cacheKey];
        }
    } catch(e) {}

    return null;
}

async function mergeCDragonData(champName: string, champData: any, cdragonFilePath: string) {
    try {
        let cdragonData: any = null;
        if (await exists(cdragonFilePath, { baseDir: BaseDirectory.AppLocalData })) {
            const cdDataBytes = await readFile(cdragonFilePath, { baseDir: BaseDirectory.AppLocalData });
            cdragonData = JSON.parse(new TextDecoder().decode(cdDataBytes));
        } else {
            const cdRes = await fetchWithTimeout(`https://raw.communitydragon.org/latest/game/data/characters/${champName.toLowerCase()}/${champName.toLowerCase()}.bin.json`);
            if (cdRes.ok) {
                cdragonData = await cdRes.json();
                try {
                    await writeFile(cdragonFilePath, new TextEncoder().encode(JSON.stringify(cdragonData)), { baseDir: BaseDirectory.AppLocalData });
                } catch(e) {}
            }
        }

        if (cdragonData) {
            if (champName === "Elise" && champData.spells.length === 4) {
                champData.spells.push({
                    id: "EliseSpiderQCast",
                    spellKey: "Spider Q",
                    name: "毒牙 (Venomous Bite)",
                    description: "対象の敵ユニットに飛びかかって噛み付き、<magicDamage>{{ 03da00f9 }} (+対象の減少体力の {{ 10e877f6 }}%)の魔法ダメージ</magicDamage>を与える。",
                    tooltip: "",
                    cooldownBurn: "6",
                    costBurn: "0",
                    maxrank: 5
                });
                champData.spells.push({
                    id: "EliseSpiderW",
                    spellKey: "Spider W",
                    name: "猛食 (Skittering Frenzy)",
                    description: "発動効果: {{ d955a324 }}秒間、自身と子蜘蛛の攻撃速度が <attackDamage>{{ fe0b1c92 }}</attackDamage> 増加する。",
                    tooltip: "",
                    cooldownBurn: "10",
                    costBurn: "0",
                    maxrank: 5
                });
                champData.spells.push({
                    id: "EliseSpiderEInitial",
                    spellKey: "Spider E",
                    name: "蜘蛛の糸 (Rappel)",
                    description: "敵または中立モンスターに使用した時: 糸を引いて空中へと飛び上がり、対象の上に落下する。<br><br>地面に使用した時: 糸を引いて空中へと飛び上がる。周囲の対象を指定することで、そこに落下できる。<br><br>着地後は{{ d955a324 }}秒間、蜘蛛形態の通常攻撃による追加ダメージと回復量が <magicDamage>{{ 80d12992 }}%</magicDamage> 増加する。",
                    tooltip: "",
                    cooldownBurn: "22/21/20/19/18",
                    costBurn: "0",
                    maxrank: 5
                });
            }
            if (champName === "Nidalee" && champData.spells.length === 4) {
                champData.spells.push({
                    id: "Takedown", // Nidalee's internal Q
                    spellKey: "Cougar Q",
                    name: "テイクダウン (Takedown)",
                    description: "次の通常攻撃時に大量の追加ダメージを与える。",
                    tooltip: "",
                    cooldownBurn: "6",
                    costBurn: "0",
                    maxrank: 5
                });
                champData.spells.push({
                    id: "Pounce", // Nidalee's internal W
                    spellKey: "Cougar W",
                    name: "ジャンプ (Pounce)",
                    description: "指定方向にジャンプし、着地点周辺の範囲内にいる敵ユニットにダメージを与える。",
                    tooltip: "",
                    cooldownBurn: "6",
                    costBurn: "0",
                    maxrank: 5
                });
                champData.spells.push({
                    id: "Swipe", // Nidalee's internal E
                    spellKey: "Cougar E",
                    name: "クロウ (Swipe)",
                    description: "かぎ爪で攻撃し、自身の前方範囲内の敵ユニットにダメージを与える。",
                    tooltip: "",
                    cooldownBurn: "6",
                    costBurn: "0",
                    maxrank: 5
                });
            }
            if (champName === "Jayce" && champData.spells.length === 4) {
                champData.spells.push({
                    id: "JayceToTheSkies", // Jayce's internal Melee Q
                    spellKey: "Hammer Q",
                    name: "スカイバスター (To the Skies!)",
                    description: "敵に飛びかかって物理ダメージとスロウ効果を与える。",
                    tooltip: "",
                    cooldownBurn: "16/14/12/10/8/6",
                    costBurn: "40",
                    maxrank: 6
                });
                champData.spells.push({
                    id: "JayceStaticField", // Jayce's internal Melee W  
                    spellKey: "Hammer W",
                    name: "ライトニングフィールド (Lightning Field)",
                    description: "雷のフィールドを発生させ、周囲の敵に数秒間ダメージを与える。",
                    tooltip: "",
                    cooldownBurn: "10",
                    costBurn: "40",
                    maxrank: 6
                });
                champData.spells.push({
                    id: "JayceThunderingBlow", // Jayce's internal Melee E
                    spellKey: "Hammer E",
                    name: "サンダーブロー (Thundering Blow)",
                    description: "敵に魔法ダメージを与え、わずかに突き飛ばす。",
                    tooltip: "",
                    cooldownBurn: "20/18/16/14/12/10",
                    costBurn: "40",
                    maxrank: 6
                });
            }

            for (let i = 0; i < champData.spells.length; i++) {
                const spell = champData.spells[i];
                const slot = ["Q", "W", "E", "R"][i];
                
                // Because some champs (like Aatrox) use "AatroxQWrapperCast" or "AatroxQ3",
                // we search the keys dynamically for the best match.
                const searchStr1 = `Characters/${champName}/Spells/${champName}${slot}Ability/${champName}${slot}`;
                const searchStr2 = `Characters/${champName}/Spells/${champName}${slot}Ability`;
                const searchStr3 = `Characters/${champName}/Spells/${champName}${slot}`;
                
                const allKeys = Object.keys(cdragonData);
                let cdSpell = null;
                
                // 1. Try exact matches first
                if (cdragonData[searchStr1]) cdSpell = cdragonData[searchStr1];
                else if (cdragonData[searchStr2]) cdSpell = cdragonData[searchStr2];
                else if (cdragonData[searchStr3]) cdSpell = cdragonData[searchStr3];
                
                // 2. Try fuzzy match (e.g. AatroxQWrapperCast)
                if (!cdSpell) {
                    const exactPrefix = `Characters/${champName}/Spells/${champName}${slot}`.toLowerCase();
                    for (const k of allKeys) {
                        if (k.toLowerCase().startsWith(exactPrefix) && cdragonData[k].mSpell) {
                            cdSpell = cdragonData[k];
                            break;
                        }
                    }
                }
                
                // 3. Ultimate fallback (just search the ID)
                if (!cdSpell) {
                    const idMatch = spell.id.toLowerCase();
                    for (const k of allKeys) {
                        if (k.toLowerCase().includes(idMatch) && cdragonData[k].mSpell) {
                            cdSpell = cdragonData[k];
                            break;
                        }
                    }
                }

                if (cdSpell && cdSpell.mSpell) {
                    spell.cd_castTime = cdSpell.mSpell.mCastTime;
                    spell.cd_missileSpeed = cdSpell.mSpell.missileSpeed;
                    spell.cd_castRange = cdSpell.mSpell.castRange ? cdSpell.mSpell.castRange[0] : null;
                    if (cdSpell.mSpell.castRangeDisplayOverride) spell.cd_castRange = cdSpell.mSpell.castRangeDisplayOverride[0];
                    spell.cd_lineWidth = cdSpell.mSpell.mLineWidth;
                    
                    // First gather DataValues early so calculations can reference them
                    const cdDataValuesMap: Record<string, any[]> = {};
                    for (const k in cdSpell.mSpell) {
                        const val = cdSpell.mSpell[k];
                        if (typeof val === 'number') {
                            cdDataValuesMap[k.toLowerCase()] = [val];
                        } else if (Array.isArray(val) && typeof val[0] === 'number') {
                            cdDataValuesMap[k.toLowerCase()] = val;
                        }
                    }
                    if (cdSpell.mSpell.DataValues) {
                        for (const dv of cdSpell.mSpell.DataValues) {
                            if (dv.mName && dv.mValues && Array.isArray(dv.mValues)) {
                                cdDataValuesMap[dv.mName.toLowerCase()] = dv.mValues;
                            }
                        }
                    }
                    spell.cd_dataValuesMap = cdDataValuesMap;

                    const cdIsPercentMap: Record<string, boolean> = {};
                    const cdCalcMap: Record<string, string> = {};
                    const scalings: string[] = [];

                    if (cdSpell.mSpell.mSpellCalculations) {
                        const processFormulaParts = (targetCalcKey: string, formulaParts: any[], isPercent: boolean, arrayMultiplier?: any[]) => {
                            const localScalings = [];
                            for (const part of formulaParts) {
                                // 1. Direct Coefficient (Old style)
                                if (part.__type === "StatByCoefficientCalculationPart" && part.mCoefficient) {
                                    let statMatch = part.mStat ? String(part.mStat).replace(/.*\./, "") : "Stat";
                                    const formId = String(part.mStatFormula);
                                    const statId = String(part.mStat);

                                    if (statMatch.includes("AttackDamage") || statId === "2" || formId === "2") statMatch = "AD";
                                    else if (statMatch.includes("AbilityPower") || statId === "1" || formId === "1") statMatch = "AP";
                                    else if (statMatch.includes("Health") || statId === "11" || statId === "12") statMatch = "HP";
                                    else if (statMatch.includes("Armor") || statId === "5") statMatch = "Armor";
                                    else if (statMatch.includes("SpellBlock") || statMatch.includes("MagicResist") || statId === "6") statMatch = "MR";
                                    
                                    if (statMatch === "AD") statMatch = "AD";
                                    else if (statMatch === "AP") statMatch = "AP";

                                    let color = "";
                                    if (statMatch === "AD") color = "#ffb74d";
                                    else if (statMatch === "AP") color = "#bf55d9";

                                    let coeff = part.mCoefficient;
                                    if (isPercent) coeff *= 100;

                                    if (arrayMultiplier && arrayMultiplier.length > 0) {
                                        const maxRank = spell.maxrank || 5;
                                        let mults = arrayMultiplier;
                                        if (mults.length > maxRank) mults = mults.slice(1, maxRank + 1);
                                        const allSame = mults.every((v: any) => v === mults[0]);
                                        if (allSame || mults.length === 0) {
                                            const mNum = mults.length > 0 ? mults[0] : 1;
                                            let scaleStr = `+${Math.round(coeff * mNum * 100)}% ${statMatch}`;
                                            if (color) scaleStr = `<span style="color:${color}">${scaleStr}</span>`;
                                            localScalings.push(scaleStr);
                                            scalings.push(scaleStr);
                                        } else {
                                            const joined = mults.map((m: any) => Math.round(coeff * m * 100)).join('/');
                                            let scaleStr = `+${joined}% ${statMatch}`;
                                            if (color) scaleStr = `<span style="color:${color}">${scaleStr}</span>`;
                                            localScalings.push(scaleStr);
                                            scalings.push(scaleStr);
                                        }
                                    } else {
                                        let scaleStr = `+${Math.round(coeff * 100)}% ${statMatch}`;
                                        if (color) scaleStr = `<span style="color:${color}">${scaleStr}</span>`;
                                        localScalings.push(scaleStr);
                                        scalings.push(scaleStr);
                                    }
                                }
                                
                                // 2. Named Base Value (Kai'Sa RShield Base, etc.)
                                if (part.__type === "NamedDataValueCalculationPart" && part.mDataValue) {
                                    const dvKey = part.mDataValue.toLowerCase();
                                    if (cdDataValuesMap[dvKey]) {
                                         let arr = [...cdDataValuesMap[dvKey]];
                                         if (isPercent) {
                                             arr = arr.map((v: any) => typeof v === 'number' ? Math.round(v * 1000) / 10 : v);
                                         }
                                         if (arrayMultiplier && arrayMultiplier.length > 0) {
                                             arr = arr.map((v: any, i: number) => {
                                                 const m = arrayMultiplier.length > i ? arrayMultiplier[i] : arrayMultiplier[arrayMultiplier.length - 1];
                                                 return typeof v === 'number' ? Math.round(v * m * 100)/100 : v;
                                             });
                                         }
                                         cdDataValuesMap[targetCalcKey.toLowerCase()] = arr;
                                    }
                                }
                                
                                // 3. Named Ratio (Kai'Sa RShield AD/AP ratios, plus Caitlyn Q nested SubParts)
                                let namedPart: any = null;
                                if (part.__type === "StatByNamedDataValueCalculationPart") {
                                    namedPart = part;
                                } else if (part.__type === "StatBySubPartCalculationPart" && part.mSubpart && part.mSubpart.__type === "NamedDataValueCalculationPart") {
                                    namedPart = { mDataValue: part.mSubpart.mDataValue, mStat: part.mStat };
                                }

                                if (namedPart && namedPart.mDataValue) {
                                    const dvKey = namedPart.mDataValue.toLowerCase();
                                    if (cdDataValuesMap[dvKey] && cdDataValuesMap[dvKey].length > 0) {
                                         let statMatch = namedPart.mDataValue;
                                         const statId = String(namedPart.mStat);
                                         if (statMatch.includes("ADRatio") || statId === "2") statMatch = "AD";
                                         else if (statMatch.includes("APRatio") || statId === "1") statMatch = "AP";
                                         else statMatch = "Stat";

                                         let color = "";
                                         if (statMatch === "AD") color = "#ffb74d";
                                         else if (statMatch === "AP") color = "#bf55d9";

                                         const maxRank = spell.maxrank || 5;
                                         let ranks = cdDataValuesMap[dvKey];
                                         if (ranks.length > maxRank) {
                                              ranks = ranks.slice(1, maxRank + 1);
                                         }
                                         
                                         // If there is an external multiplier array apply it before checking uniformness
                                         if (arrayMultiplier && arrayMultiplier.length > 0) {
                                             let mults = arrayMultiplier;
                                             if (mults.length > maxRank) mults = mults.slice(1, maxRank + 1);
                                             ranks = ranks.map((rVal: any, i: number) => {
                                                  const m = mults.length > i ? mults[i] : mults[mults.length - 1];
                                                  return typeof rVal === 'number' ? rVal * m : rVal;
                                             });
                                         }
                                         
                                         const allSame = ranks.every((v: any) => v === ranks[0]);
                                         let scaleStr = "";
                                         const multiplier = isPercent ? 10000 : 100; // If it's a fraction of a percent like 0.0003, multiplying by 10000 gets 3(%)

                                         if (allSame || ranks.length === 0) {
                                              const coeff = ranks.length > 0 ? ranks[0] : 0;
                                              scaleStr = `+${Math.round(coeff * multiplier)}% ${statMatch}`;
                                         } else {
                                              const joined = ranks.map((v: any) => Math.round(v * multiplier)).join('/');
                                              scaleStr = `+${joined}% ${statMatch}`;
                                         }
                                         if (color) scaleStr = `<span style="color:${color}">${scaleStr}</span>`;

                                         localScalings.push(scaleStr);
                                         scalings.push(scaleStr);
                                    }
                                }
                            }
                            if (localScalings.length > 0) {
                                cdCalcMap[targetCalcKey.toLowerCase()] = localScalings.join(" ");
                            }
                        };

                        // First pass: resolve explicit formulas
                        for (const calcKey in cdSpell.mSpell.mSpellCalculations) {
                            const calc = cdSpell.mSpell.mSpellCalculations[calcKey];
                            const isPercent = calc.mDisplayAsPercent === true;
                            if (isPercent) cdIsPercentMap[calcKey.toLowerCase()] = true;
                            if (calc.mFormulaParts) {
                                processFormulaParts(calcKey, calc.mFormulaParts, isPercent);
                            }
                        }

                        // Second pass: resolve modified calculations (e.g. Caitlyn Q SecondaryDamage = InitialDamage * SecondaryMult, or Yone R Damage * 0.5)
                        for (const calcKey in cdSpell.mSpell.mSpellCalculations) {
                             const calc = cdSpell.mSpell.mSpellCalculations[calcKey];
                             if (calc.__type === "GameCalculationModified" && calc.mModifiedGameCalculation && calc.mMultiplier) {
                                  const baseCalcKey = calc.mModifiedGameCalculation;
                                  const baseCalc = cdSpell.mSpell.mSpellCalculations[baseCalcKey];
                                  
                                  let multArray;
                                  if (calc.mMultiplier.mDataValue) {
                                       multArray = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];
                                  } else if (calc.mMultiplier.mNumber !== undefined) {
                                       multArray = [calc.mMultiplier.mNumber];
                                  }
                                  
                             }
                        }

                        // Determine the BaseDamage array for each GameCalculation so the UI can interpolate it
                        const cdBaseMap: Record<string, any[]> = {};
                        for (const calcKey in cdSpell.mSpell.mSpellCalculations) {
                             const calc = cdSpell.mSpell.mSpellCalculations[calcKey];
                             if (calc.mFormulaParts) {
                                 for (const part of calc.mFormulaParts) {
                                      if (part.__type === "NamedDataValueCalculationPart" && part.mDataValue) {
                                          const dvKey = part.mDataValue.toLowerCase();
                                          if (cdDataValuesMap[dvKey]) {
                                              cdBaseMap[calcKey.toLowerCase()] = cdDataValuesMap[dvKey];
                                              break; // grab the first valid flat base array
                                          }
                                      }
                                 }
                             } else if (calc.__type === "GameCalculationModified" && calc.mModifiedGameCalculation) {
                                  const baseCalcKey = calc.mModifiedGameCalculation.toLowerCase();
                                  if (cdBaseMap[baseCalcKey]) {
                                       let arr = [...cdBaseMap[baseCalcKey]];
                                       if (calc.mMultiplier && calc.mMultiplier.mNumber !== undefined) {
                                            arr = arr.map(v => typeof v === 'number' ? Math.round(v * calc.mMultiplier.mNumber * 100)/100 : v);
                                       } else if (calc.mMultiplier && calc.mMultiplier.__type === "NamedDataValueCalculationPart" && calc.mMultiplier.mDataValue) {
                                             const mData = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];
                                             if (mData) {
                                                  arr = arr.map((v, i) => {
                                                       const m = mData.length > i ? mData[i] : mData[mData.length - 1];
                                                       return typeof v === 'number' ? Math.round(v * m * 100)/100 : v;
                                                  });
                                             }
                                        } else if (calc.mMultiplier && calc.mMultiplier.mDataValue) {
                                            const mData = cdDataValuesMap[calc.mMultiplier.mDataValue.toLowerCase()];
                                            if (mData) {
                                                 arr = arr.map((v, i) => {
                                                      const m = mData.length > i ? mData[i] : mData[mData.length - 1];
                                                      return typeof v === 'number' ? Math.round(v * m * 100)/100 : v;
                                                 });
                                            }
                                       }
                                       cdBaseMap[calcKey.toLowerCase()] = arr;
                                  }
                             }
                        }
                        spell.cd_baseMap = cdBaseMap;
                    }
                    spell.cd_calcMap = cdCalcMap;
                    // Unique scalings to avoid duplicates
                    spell.cd_scaling = Array.from(new Set(scalings));

                    // Duplicate block removed

                    // Extract base damages and ratios from DataValues
                    const damages = [];
                    if (cdSpell.mSpell.DataValues) {
                        for (const dv of cdSpell.mSpell.DataValues) {
                            if (dv.mName && dv.mValues && Array.isArray(dv.mValues)) {
                                // Skip internal boring identifiers
                                const nameLow = dv.mName.toLowerCase();
                                if (nameLow.includes("time") || nameLow.includes("speed") || nameLow.includes("mult")) continue;

                                const maxRank = spell.maxrank || 5;
                                const ranks = dv.mValues.slice(1, maxRank + 1);
                                if (ranks.length === 0) continue;
                                
                                const allSame = ranks.every((val: any) => val === ranks[0]);
                                let fmtName = dv.mName.replace("BaseDamage", "Base DMG").replace("Ratio", " Ratio");
                                
                                if (allSame) {
                                    if (ranks[0] === 0) continue;
                                    let valStr = ranks[0].toString();
                                    if (nameLow.includes("ratio")) {
                                        if (ranks[0] < 5) valStr = Math.round(ranks[0]*100) + "%";
                                    }
                                    damages.push(`${fmtName}: ${valStr}`);
                                } else {
                                    // varying per rank
                                    const valStr = ranks.map((v: any) => {
                                        if (v < 5 && nameLow.includes("ratio")) return Math.round(v*100) + "%";
                                        return Math.round(v);
                                    }).join("/");
                                    damages.push(`${fmtName}: ${valStr}`);
                                }
                            }
                        }
                    }
                    spell.cd_damages = damages;
                }
                    }
                }
             } catch(e) { console.error("CDragon fetch failed", e); }
             return champData;
}

let cachedSummonersDataByVersion: Record<string, Record<string, any>> = {};

export async function getSummonerSpellData(spellId: number, version: string, langStr: string = "ja"): Promise<any> {
    let targetVersion = version;
    if (version.split('.').length > 3) {
         const parts = version.split('.');
         targetVersion = `${parts[0]}.${parts[1]}.1`;
    }
    
    const locale = getDDragonLocale(langStr);
    const dictKey = `${targetVersion}_${locale}`;
    
    if (cachedSummonersDataByVersion[dictKey]) {
        return Object.values(cachedSummonersDataByVersion[dictKey]).find((s: any) => s.key == spellId);
    }

    const cacheDir = "items_cache";
    const filename = `summoner_${targetVersion}_${locale}.json`;
    const filePath = `${cacheDir}/${filename}`;

    try {
        if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
            await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const jsonStr = new TextDecoder().decode(data);
            const json = JSON.parse(jsonStr);
            cachedSummonersDataByVersion[dictKey] = json.data;
            return Object.values(cachedSummonersDataByVersion[dictKey]).find((s: any) => s.key == spellId);
        }
    } catch(e) {}
    
    try {
        let res = await fetchWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${targetVersion}/data/${locale}/summoner.json`);
        if (!res.ok) {
            res = await fetchWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${getCurrentPatchVersion()}/data/${locale}/summoner.json`);
        }
        if (res.ok) {
             const json = await res.json();
             cachedSummonersDataByVersion[dictKey] = json.data;
             try {
                 const dataToSave = JSON.stringify(json);
                 await writeFile(filePath, new TextEncoder().encode(dataToSave), { baseDir: BaseDirectory.AppLocalData });
             } catch(e) {}
             return Object.values(cachedSummonersDataByVersion[dictKey]).find((s: any) => s.key == spellId);
        }
    } catch(e) {
        console.error("Failed to fetch summoner data", e);
    }
    return null;
}

export async function ensureTftDataLoaded(langStr: string = "en") {
    if (isTftDataLoaded) return;
    if (tftDataLoadPromise) return tftDataLoadPromise;
    tftDataLoadPromise = ensureTftDataLoadedInner(langStr).finally(() => {
        tftDataLoadPromise = null;
    });
    return tftDataLoadPromise;
}

async function ensureTftDataLoadedInner(langStr: string = "en") {
    try {
        let locale = "en_us";
        if (langStr.startsWith("ja")) locale = "ja_jp";
        
        const cacheDir = "items_cache";
        const filename = `tft_data_${locale}.json`;
        const filePath = `${cacheDir}/${filename}`;
        
        let data: any = null;
        
        // Try Cache
        try {
            if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
                await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
            }
            if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
                const fsData = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
                const jsonStr = new TextDecoder().decode(fsData);
                data = JSON.parse(jsonStr);
                console.log("Loaded TFT Data from Cache.");
            }
        } catch (e) {
            console.error("Failed to read TFT cache:", e);
        }

        // Fetch if no cache
        if (!data) {
            console.log("Fetching TFT Data from CDragon...");
            // Use en_us as fallback if localization breaks, but we will try lang locale just in case.
            const res = await fetchWithTimeout(`https://raw.communitydragon.org/latest/cdragon/tft/en_us.json`);
            if (!res.ok) throw new Error("Failed to fetch TFT data");
            data = await res.json();
            
            try {
                const dataToSave = JSON.stringify(data);
                await writeFile(filePath, new TextEncoder().encode(dataToSave), { baseDir: BaseDirectory.AppLocalData });
            } catch (e) {
                console.error("Failed to write TFT cache:", e);
            }
        }
        
        for (const setKey of Object.keys(data.sets || {})) {
            const set = data.sets[setKey];
            if (set.traits) {
                for (const trait of set.traits) {
                    if (trait.apiName) {
                        const lname = trait.apiName.toLowerCase();
                        if (trait.icon) {
                            tftTraitIconMap[lname] = trait.icon.toLowerCase().replace(".tex", ".png");
                        }
                        if (trait.effects) {
                            tftTraitStyleMap[lname] = {};
                            for (const effect of trait.effects) {
                                tftTraitStyleMap[lname][effect.minUnits] = effect.style;
                            }
                        }
                    }
                }
            }
            if (set.champions) {
                for (const champ of set.champions) {
                    if (champ.apiName) {
                        const lname = champ.apiName.toLowerCase();
                        if (champ.tileIcon) {
                            tftUnitIconMap[lname] = champ.tileIcon.toLowerCase().replace(".tex", ".png");
                        }
                        if (champ.cost !== undefined) {
                            tftUnitCostMap[lname] = champ.cost;
                        }
                    }
                }
            }
        }
        isTftDataLoaded = true;
    } catch (e) {
        console.error("Error loading TFT data:", e);
    }
}



const CDRAGON_BASE = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles";
const DDRAGON_IMG_BASE = "https://ddragon.leagueoflegends.com/cdn/img";

const SPELL_MAP: Record<number, string> = {
    1: "SummonerBoost",
    3: "SummonerExhaust",
    4: "SummonerFlash",
    6: "SummonerHaste",
    7: "SummonerHeal",
    11: "SummonerSmite",
    12: "SummonerTeleport",
    13: "SummonerMana",
    14: "SummonerDot", // Ignite
    17: "SummonerPoroRecall",
    18: "SummonerPoroThrow",
    19: "SummonerSnowball",
    20: "SummonerSnowURFSnowball_Mark",
    71: "Summoner_UltBookPlaceholder",
    2201: "SummonerCherryHold",
    2202: "SummonerCherryFlash",
    21: "SummonerBarrier"
};

const RUNE_MAP: Record<number, string> = {
    // Precision
    8005: "precision/presstheattack/presstheattack.png",
    8008: "precision/lethaltempo/lethaltempotemp.png",
    8021: "precision/fleetfootwork/fleetfootwork.png",
    8010: "precision/conqueror/conqueror.png",
    // Domination
    8112: "domination/electrocute/electrocute.png",
    8124: "domination/predator/predator.png",
    8128: "domination/darkharvest/darkharvest.png",
    9923: "domination/hailofblades/hailofblades.png",
    // Sorcery
    8214: "sorcery/summonaery/summonaery.png",
    8229: "sorcery/arcanecomet/arcanecomet.png",
    8230: "sorcery/phaserush/phaserush.png",
    // Resolve
    8437: "resolve/graspoftheundying/graspoftheundying.png",
    8439: "resolve/veteranaftershock/veteranaftershock.png",
    8465: "resolve/guardian/guardian.png",
    // Inspiration
    8351: "inspiration/glacialaugment/glacialaugment.png",
    8360: "inspiration/unsealedspellbook/unsealedspellbook.png",
    8369: "inspiration/firststrike/firststrike.png",
};

export async function getChampionIconUrl(championName: string): Promise<string> {
    if (!championName) return "";
    await ensureDataLoaded();
    if (cachedChampionData) {
        const lower = championName.toLowerCase();
        const entry = Object.values(cachedChampionData).find((c: any) => {
            const idStr = String(c?.id ?? "").toLowerCase();
            const nameStr = String(c?.name ?? "").toLowerCase();
            const keyStr = String(c?.key ?? "");
            return idStr === lower || nameStr === lower || keyStr === championName;
        }) as any;
        const idNum = entry ? Number(entry.key) : 0;
        if (Number.isFinite(idNum) && idNum > 0) {
            return await getChampionIconUrlById(idNum);
        }
    }

    // Fallback for unknown names (kept for compatibility).
    const url = `${getBaseUrl()}/champion/${championName}.png`;
    return await getCachedAssetUrl(url, "champion", `${championName}.png`);
}

export async function getChampionIconUrlById(championId: number): Promise<string> {
    if (championId === 0) return ""; // 0 is invalid
    const url = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`;
    return await getCachedAssetUrl(url, "champion", `${championId}.png`);
}

export async function getChampionNameById(championId: number): Promise<string | null> {
    await ensureDataLoaded();
    if (!cachedChampionData) return null;
    const entry = Object.values(cachedChampionData).find((c: any) => c.key == championId) as any;
    return entry ? entry.id : null; // entry.id is the internal name (e.g. "MonkeyKing"), entry.name is display name (e.g. "Wukong"). Wiki likely uses ID or Name. User said "English Champion Name". Usually ID is safer for URLs but Name might be required. Let's use ID (Caitlyn, Ahri, etc are IDs).
}

/**
 * Returns the English internal ID (e.g. "MonkeyKing", "Caitlyn") synchronously if data is cached.
 */
export function getChampionEnglishNameByIdSync(championId: number): string | null {
    if (!cachedChampionEnglishData) return null;
    const entry = Object.values(cachedChampionEnglishData).find((c: any) => c.key == championId) as any;
    // For English names, the entry.name in en_US is the proper capitalized english string.
    return entry ? entry.name : null;
}

/**
 * Returns the Localized display name (e.g. "ウーコン", "ケイトリン") synchronously if data is cached.
 */
export function getChampionLocalizedNameByIdSync(championId: number): string | null {
    if (!cachedChampionData) return null;
    const entry = Object.values(cachedChampionData).find((c: any) => c.key == championId) as any;
    return entry ? entry.name : null;
}

export async function getItemIconUrl(itemId: number): Promise<string> {
    if (itemId === 0) return "";
    const url = `${getBaseUrl()}/item/${itemId}.png`;
    return await getCachedAssetUrl(url, "item", `${itemId}.png`);
}

export async function getSpellIconUrl(spellId: number): Promise<string> {
    const spellName = SPELL_MAP[spellId];
    if (!spellName) return "";
    
    const url = `${getBaseUrl()}/spell/${spellName}.png`;
    return await getCachedAssetUrl(url, "spell", `${spellName}.png`);
}

export async function getRuneIconUrl(perkId: number, styleId?: number): Promise<string> {
    if (perkId === 0) return "";

    const runeData = await getRuneData(perkId);
    const ddragonIconPath = typeof runeData?.icon === "string" ? runeData.icon.replace(/^\/+/, "") : "";
    if (ddragonIconPath) {
        const url = `${DDRAGON_IMG_BASE}/${ddragonIconPath}`;
        return await getCachedAssetUrl(url, "rune", `${perkId}.png`);
    }

    const path = RUNE_MAP[perkId];
    if (!path) return "";

    const url = `${CDRAGON_BASE}/${path}`;
    return await getCachedAssetUrl(url, "rune", `${perkId}.png`);
}

export async function getProfileIconUrl(iconId: number): Promise<string> {
    const url = `${getBaseUrl()}/profileicon/${iconId}.png`;
    return await getCachedAssetUrl(url, "profileicon", `${iconId}.png`);
}

export async function getTftUnitIconUrl(characterId: string): Promise<string> {
    if (!characterId) return "";
    await ensureTftDataLoaded();
    const charName = characterId.toLowerCase();
    
    // Check mapping first
    if (tftUnitIconMap[charName]) {
        const cdragonPath = tftUnitIconMap[charName];
        // Path is something like "assets/characters/tft16_lulu/hud/tft16_lulu_square.tft_set16.png"
        // Needs `game/` prefix in CDragon URL
        let cleanPath = cdragonPath.startsWith('assets') ? `game/${cdragonPath}` : cdragonPath;
        const url = `https://raw.communitydragon.org/latest/${cleanPath}`;
        const basename = cdragonPath.split('/').pop() || `${charName}.png`;
        return await getCachedAssetUrl(url, "tft_unit", basename);
    }

    // Fallback if not found in map
    const match = charName.match(/^tft(\d+)_/);
    const suffix = match ? `.tft_set${match[1]}` : "";
    const url = `https://raw.communitydragon.org/latest/game/assets/characters/${charName}/hud/${charName}_square${suffix}.png`;
    return await getCachedAssetUrl(url, "tft_unit", `${charName}${suffix}.png`);
}

export async function getTftTraitIconUrl(traitName: string): Promise<string> {
    if (!traitName) return "";
    const lowerName = traitName.trim().toLowerCase();
    if (!lowerName) return "";
    
    // Check DataDragon (DD) first for multi-set compatibility
    await ensureTftDDTraitLoaded();
    if (tftDDTraitMap[lowerName]) {
        const version = getCurrentPatchVersion();
        const filename = tftDDTraitMap[lowerName];
        const url = `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-trait/${filename}`;
        return await getCachedAssetUrl(url, "tft_trait", filename);
    }

    // Fallback to CommunityDragon (CDragon) map if DD doesn't have it
    await ensureTftDataLoaded();
    
    // Check mapping first
    if (tftTraitIconMap[lowerName]) {
        const cdragonPath = tftTraitIconMap[lowerName];
        let cleanPath = cdragonPath.startsWith('assets') ? `game/${cdragonPath}` : cdragonPath;
        const url = `https://raw.communitydragon.org/latest/${cleanPath}`;
        const basename = cdragonPath.split('/').pop() || `${lowerName}.png`;
        return await getCachedAssetUrl(url, "tft_trait", basename);
    }

    // Fallback if not found in map
    const match = lowerName.match(/^tft(\d+)_/);
    if (!match) {
        if (!/^[a-z0-9_.-]+$/.test(lowerName)) {
            console.warn(`[Trait Icon] no icon mapping for localized TFT trait: ${traitName}`);
            return "";
        }
        const url = `https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_${lowerName}.png`;
        return await getCachedAssetUrl(url, "tft_trait", `${lowerName}.png`);
    }

    const setNum = match[1];
    const traitBase = lowerName.substring(match[0].length); // e.g. "yordle"

    const url1 = `https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_${setNum}_${traitBase}.tft_set${setNum}.png`;
    const url2 = `https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_${traitBase}.png`;

    let result = await getCachedAssetUrl(url1, "tft_trait", `${setNum}_${traitBase}.png`);
    
    console.log(`[Trait Debug] fetching ${traitName}`);
    console.log(`[Trait Debug] URL1: ${url1} => result: ${result}`);

    // If getting the first URL fails, getCachedAssetUrl returns the original remote URL.
    // We check if result === url1 to know if it failed. (Tauri convertFileSrc can start with 'http://asset.localhost' so don't check startsWith('http'))
    if (result === url1) {
        console.warn(`[Trait Debug] URL1 failed or wasn't cached, falling back to URL2: ${url2}`);
        result = await getCachedAssetUrl(url2, "tft_trait", `${traitBase}.png`);
        console.log(`[Trait Debug] URL2 result: ${result}`);
    }

    return result;
}

export async function getTftItemIconUrl(itemName: string): Promise<string> {
    if (!itemName) return "";
    const lowerName = itemName.toLowerCase();
    
    // Check DataDragon (DD) first
    await ensureTftDDItemLoaded();
    if (tftDDItemMap[lowerName]) {
        const version = getCurrentPatchVersion();
        const filename = tftDDItemMap[lowerName];
        const url = `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-item/${filename}`;
        return await getCachedAssetUrl(url, "tft_item", filename);
    }

    // Fallback to CDragon direct URL guessing if not found
    const match = lowerName.match(/^tft(\d+)_item_(.*)/);
    const suffix = match ? match[2] : lowerName.replace("tft_item_", "");
    
    const url = `https://raw.communitydragon.org/latest/game/assets/maps/particles/tft/item_icons/traits/spatula/set16/${lowerName}.png`;
    return await getCachedAssetUrl(url, "tft_item", `${lowerName}.png`);
}

// Helper for concurrency
async function runConcurrent<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>, onProgress: (completed: number, total: number) => void) {
    let index = 0;
    const total = items.length;
    const workers = new Array(concurrency).fill(null).map(async () => {
        while (index < total) {
            const i = index++;
            try {
                await fn(items[i]);
            } catch (e) {
                console.error("Error processing item:", e);
            }
            onProgress(index, total);
        }
    });
    await Promise.all(workers);
}

export async function downloadAllAssets(onProgress: (msg: string) => void) {
    try {
        onProgress("Fetching Lists...");
        await ensureDataLoaded();
        const CURRENT_VERSION = getCurrentPatchVersion();
        await ensureItemDataLoaded(CURRENT_VERSION);
        await ensureRuneDataLoaded(CURRENT_VERSION);
        const dataLocale = getDDragonLocale("ja");
        const itemCacheKey = `${CURRENT_VERSION}_${dataLocale}`;
        const runeCacheKey = `${CURRENT_VERSION}_${dataLocale}`;

        if (!cachedChampionData || !cachedItemDataByVersion[itemCacheKey]) throw new Error("Failed to load data lists");

        // Use cached data
        const champions = Object.keys(cachedChampionData);
        const items = Object.keys(cachedItemDataByVersion[itemCacheKey]).map(id => parseInt(id));
        const spells = Object.keys(SPELL_MAP).map(id => parseInt(id));
        const runes = Array.from(
            new Set([
                ...Object.keys(cachedRuneDataByVersion[runeCacheKey] || {}).map(id => parseInt(id)),
                ...Object.keys(RUNE_MAP).map(id => parseInt(id)),
            ]),
        );

        const totalChamps = champions.length;
        const totalItems = items.length;
        const totalSpells = spells.length;
        const totalRunes = runes.length;
        
        onProgress(`Found ${totalChamps} Ch, ${totalItems} It, ${totalSpells} Sp, ${totalRunes} Ru. Downloading...`);

        // Champions
        await runConcurrent(champions, 10, async (name) => {
            await getChampionIconUrl(name);
        }, (c, t) => {
            onProgress(`Downloading Champions: ${c}/${t}`);
        });

        // Items
        await runConcurrent(items, 10, async (id) => {
            await getItemIconUrl(id);
        }, (c, t) => {
            onProgress(`Downloading Items: ${c}/${t}`);
        });

        // Spells
        await runConcurrent(spells, 5, async (id) => {
            await getSpellIconUrl(id);
        }, (c, t) => {
            onProgress(`Downloading Spells: ${c}/${t}`);
        });

        // Runes
         await runConcurrent(runes, 5, async (id) => {
            await getRuneIconUrl(id);
        }, (c, t) => {
            onProgress(`Downloading Runes: ${c}/${t}`);
        });

        onProgress("Download Complete!");

    } catch (e) {
        console.error("Asset download failed:", e);
        onProgress(`Error: ${e}`);
    }
}

export function getTftUnitCost(characterId: string): number | null {
    if (!characterId) return null;
    return tftUnitCostMap[characterId.toLowerCase()] ?? null;
}

export function getTftTraitStyle(apiName: string, numUnits: number): number | null {
    if (!apiName) return null;
    const styles = tftTraitStyleMap[apiName.toLowerCase()];
    if (!styles) return null;
    
    // Find the highest minUnits that is <= numUnits
    let bestStyle = null;
    let maxMinUnits = -1;
    for (const minU of Object.keys(styles).map(Number)) {
        if (numUnits >= minU && minU > maxMinUnits) {
            maxMinUnits = minU;
            bestStyle = styles[minU];
        }
    }
    return bestStyle;
}

function tftTraitStyleValueToClass(style: number): string | null {
    if (style <= 0) return "tft-inactive";
    if (style === 1) return "tft-bronze";
    if (style === 3) return "tft-silver";
    if (style === 4) return "tft-unique";
    if (style === 5) return "tft-gold";
    if (style >= 6) return "tft-prismatic";
    return null;
}

export async function getTftTraitStyleClass(apiNameOrLocalizedName: string, numUnits: number): Promise<string | null> {
    if (!apiNameOrLocalizedName || numUnits <= 0) return null;
    await ensureTftDDTraitLoaded();
    await ensureTftDataLoaded();

    const key = apiNameOrLocalizedName.trim().toLowerCase();
    const apiName = tftTraitStyleMap[key] ? key : tftDDTraitApiNameMap[key]?.toLowerCase();
    if (!apiName) return null;

    const style = getTftTraitStyle(apiName, numUnits);
    return style === null ? null : tftTraitStyleValueToClass(style);
}
