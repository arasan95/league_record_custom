
import { exists, mkdir, writeFile, BaseDirectory } from "./platform/fs";
import { appLocalDataDir, join } from "./platform/path";
import { convertFileSrc } from "./platform/core";

import { commands } from "./bindings";

// We will store cached images in a subdirectory named 'img_cache' inside AppLocalData
const CACHE_DIR = "img_cache";

// In-memory cache to prevent thousands of Tauri IPC calls per second during UI renders
const inMemoryAssetCache = new Map<string, string>();
const inFlightAssetCache = new Map<string, Promise<string>>();
const failedAssetCacheUntil = new Map<string, number>();
let cachedAppLocalDataDir: string | null = null;
const FAILED_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Downloads a file from a URL and saves it to the cache, or returns the cached path if it exists.
 * @param url The remote URL of the image.
 * @param category A sub-folder category (e.g., 'champion', 'item', 'spell', 'rune') to organize files.
 * @param filename The specific filename (e.g., 'Aatrox.png').
 */
export async function getCachedAssetUrl(url: string, category: string, filename: string): Promise<string> {
    if (!url) return "";

    const categoryDir = `${CACHE_DIR}/${category}`;
    const filePath = `${categoryDir}/${filename}`;

    // Fast-path in-memory Cache (Massively speeds up TFT rendering)
    if (inMemoryAssetCache.has(filePath)) {
        return inMemoryAssetCache.get(filePath)!;
    }

    // Fast-path for known failing assets (avoid re-request storm)
    const now = Date.now();
    const failedUntil = failedAssetCacheUntil.get(filePath);
    if (failedUntil && failedUntil > now) {
        return url;
    }

    // Deduplicate same asset requests while a download/exists-check is in progress.
    if (inFlightAssetCache.has(filePath)) {
        return inFlightAssetCache.get(filePath)!;
    }

    const task = (async () => {
    try {
        // Check local disk cache (via IPC)
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            if (!cachedAppLocalDataDir) {
                cachedAppLocalDataDir = await appLocalDataDir();
            }
            const absPath = await join(cachedAppLocalDataDir, categoryDir, filename);
            const finalUrl = convertFileSrc(absPath);
            inMemoryAssetCache.set(filePath, finalUrl);
            return finalUrl;
        }

        // Download via Backend to bypass CORS
        if (!url.startsWith("http")) return url;

        // console.log(`Downloading (Native) ${url} to ${category}/${filename}...`);
        
        // Backend returns the absolute path on success
        const result = await commands.downloadImage(url, category, filename);

        if (result.status === "ok") {
            const finalUrl = convertFileSrc(result.data);
            inMemoryAssetCache.set(filePath, finalUrl);
            failedAssetCacheUntil.delete(filePath);
            return finalUrl;
        } else {
            console.error(`Failed to download image (${url}):`, result.error);
            failedAssetCacheUntil.set(filePath, Date.now() + FAILED_CACHE_TTL_MS);
            return url;
        }

    } catch (err) {
        console.error("Error in asset caching:", err);
        failedAssetCacheUntil.set(filePath, Date.now() + FAILED_CACHE_TTL_MS);
        return url; // Fallback
    } finally {
        inFlightAssetCache.delete(filePath);
    }
    })();

    inFlightAssetCache.set(filePath, task);
    return task;
}
