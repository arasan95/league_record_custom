import { exists, mkdir, readFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { getCachedAssetUrl } from "./assets";
import { getCurrentPatchVersion } from "./version";

// Cache for data
// Keyed by version -> data
const cachedItemDataByVersion: Record<string, Record<string, any>> = {};
let cachedChampionData: Record<string, any> | null = null;

// TFT Cache Maps
let tftTraitIconMap: Record<string, string> = {};
let tftUnitIconMap: Record<string, string> = {};
let tftTraitStyleMap: Record<string, Record<number, number>> = {};
let tftUnitCostMap: Record<string, number> = {};
let isTftDataLoaded = false;

let tftDDTraitMap: Record<string, string> = {};
let isTftDDTraitLoaded = false;

let tftDDItemMap: Record<string, string> = {};
let isTftDDItemLoaded = false;

export async function ensureTftDDItemLoaded() {
    if (isTftDDItemLoaded) return;
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
            const res = await fetch(url);
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
            const res = await fetch(url);
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
                    tftDDTraitMap[key.toLowerCase()] = trait.image.full;
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
        case "vi": return "vn_VN";
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
async function ensureDataLoaded() {
    if (cachedChampionData) return;
    
    try {
        const version = getCurrentPatchVersion();
        const championListUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
        
        const champRes = await fetch(championListUrl);
        if (champRes.ok) cachedChampionData = (await champRes.json()).data;
    } catch (e) {
        console.error("Failed to load DataDragon champion data:", e);
    }
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
             const res = await fetch(u);
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
    const filePath = `${cacheDir}/${filename}`;

    try {
        if (!(await exists(cacheDir, { baseDir: BaseDirectory.AppLocalData }))) {
            await mkdir(cacheDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const data = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            const jsonStr = new TextDecoder().decode(data);
            const json = JSON.parse(jsonStr);
            detailedChampionCache[cacheKey] = json.data[champName];
            return detailedChampionCache[cacheKey];
        }
    } catch(e) {}

    let url = `https://ddragon.leagueoflegends.com/cdn/${targetVersion}/data/${locale}/champion/${champName}.json`;
    try {
        let res = await fetch(url);
        if (!res.ok) {
            // fallback
            res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${getCurrentPatchVersion()}/data/${locale}/champion/${champName}.json`);
        }
        if (res.ok) {
             const json = await res.json();
             detailedChampionCache[cacheKey] = json.data[champName];
             try {
                 const dataToSave = JSON.stringify(json);
                 await writeFile(filePath, new TextEncoder().encode(dataToSave), { baseDir: BaseDirectory.AppLocalData });
             } catch(e) {}
             return detailedChampionCache[cacheKey];
        }
    } catch (e) {
        console.error("Failed to fetch detailed champion data", e);
    }
    return null;
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
        let res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${targetVersion}/data/${locale}/summoner.json`);
        if (!res.ok) {
            res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${getCurrentPatchVersion()}/data/${locale}/summoner.json`);
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
            const res = await fetch(`https://raw.communitydragon.org/latest/cdragon/tft/en_us.json`);
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
    const url = `${getBaseUrl()}/champion/${championName}.png`;
    return await getCachedAssetUrl(url, "champion", `${championName}.png`);
}

export async function getChampionIconUrlById(championId: number): Promise<string> {
    if (championId === 0) return ""; // 0 is invalid
    const url = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`;
    return await getCachedAssetUrl(url, "champion_id", `${championId}.png`);
}

export async function getChampionNameById(championId: number): Promise<string | null> {
    await ensureDataLoaded();
    if (!cachedChampionData) return null;
    const entry = Object.values(cachedChampionData).find((c: any) => c.key == championId) as any;
    return entry ? entry.id : null; // entry.id is the internal name (e.g. "MonkeyKing"), entry.name is display name (e.g. "Wukong"). Wiki likely uses ID or Name. User said "English Champion Name". Usually ID is safer for URLs but Name might be required. Let's use ID (Caitlyn, Ahri, etc are IDs).
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
    const path = RUNE_MAP[perkId];
    if (!path) return "";
    
    // Legacy handling removed as Patch 26 revived Lethal Tempo
    
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
    const lowerName = traitName.toLowerCase();
    
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
        
        if (!cachedChampionData || !cachedItemDataByVersion[CURRENT_VERSION]) throw new Error("Failed to load data lists");

        // Use cached data
        const champions = Object.keys(cachedChampionData);
        // Ensure cachedItemDataByVersion[CURRENT_VERSION] is not null/undefined before accessing
        const items = Object.keys(cachedItemDataByVersion[CURRENT_VERSION]).map(id => parseInt(id));
        const spells = Object.keys(SPELL_MAP).map(id => parseInt(id));
        const runes = Object.keys(RUNE_MAP).map(id => parseInt(id));

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
