
import { exists, mkdir, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

import { commands } from "./bindings";

// We will store cached images in a subdirectory named 'img_cache' inside AppLocalData
const CACHE_DIR = "img_cache";

/**
 * Downloads a file from a URL and saves it to the cache, or returns the cached path if it exists.
 * @param url The remote URL of the image.
 * @param category A sub-folder category (e.g., 'champion', 'item', 'spell', 'rune') to organize files.
 * @param filename The specific filename (e.g., 'Aatrox.png').
 */
export async function getCachedAssetUrl(url: string, category: string, filename: string): Promise<string> {
    if (!url) return "";

    try {
        // Ensure category subdirectory (Frontend check)
        // Backend also checks, but checking here allows skipping the invoke if file exists
        const categoryDir = `${CACHE_DIR}/${category}`;
        const filePath = `${categoryDir}/${filename}`;
        
        // Check cache
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            const appData = await appLocalDataDir();
            const absPath = await join(appData, categoryDir, filename);
            return convertFileSrc(absPath);
        }

        // Download via Backend to bypass CORS
        if (!url.startsWith("http")) return url;

        // console.log(`Downloading (Native) ${url} to ${category}/${filename}...`);
        
        // Backend returns the absolute path on success
        const result = await commands.downloadImage(url, category, filename);

        if (result.status === "ok") {
            return convertFileSrc(result.data);
        } else {
            console.error(`Failed to download image (${url}):`, result.error);
            return url;
        }

    } catch (err) {
        console.error("Error in asset caching:", err);
        return url; // Fallback
    }
}
