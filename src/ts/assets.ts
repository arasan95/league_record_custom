
import { exists, mkdir, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

// We will store cached images in a subdirectory named 'img_cache' inside AppLocalData
const CACHE_DIR = "img_cache";

/**
 * Ensures the cache directory exists.
 */
async function ensureCacheDir() {
    // console.log("Checking cache dir in:", await appLocalDataDir());
    const dirExists = await exists(CACHE_DIR, { baseDir: BaseDirectory.AppLocalData });
    if (!dirExists) {
        await mkdir(CACHE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
    }
}

/**
 * Downloads a file from a URL and saves it to the cache, or returns the cached path if it exists.
 * @param url The remote URL of the image.
 * @param category A sub-folder category (e.g., 'champion', 'item', 'spell', 'rune') to organize files.
 * @param filename The specific filename (e.g., 'Aatrox.png').
 */
export async function getCachedAssetUrl(url: string, category: string, filename: string): Promise<string> {
    if (!url) return "";

    try {
        await ensureCacheDir();

        // Ensure category subdirectory
        const categoryDir = `${CACHE_DIR}/${category}`;
        const catExists = await exists(categoryDir, { baseDir: BaseDirectory.AppLocalData });
        if (!catExists) {
            await mkdir(categoryDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        }

        const filePath = `${categoryDir}/${filename}`;
        
        // Check cache
        if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
            // Construct absolute path for convertFileSrc
            const appData = await appLocalDataDir();
            const absPath = await join(appData, categoryDir, filename);
            return convertFileSrc(absPath);
        }

        // Download
        console.log(`Downloading ${url} to ${filePath}...`);
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Failed to fetch ${url}: ${response.statusText}`);
            return url; // Fallback to remote if download fails
        }
        
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        await writeFile(filePath, new Uint8Array(buffer), { baseDir: BaseDirectory.AppLocalData });

        // Return local src
        const appData = await appLocalDataDir();
        const absPath = await join(appData, categoryDir, filename);
        return convertFileSrc(absPath);

    } catch (err) {
        console.error("Error in asset caching:", err);
        return url; // Fallback
    }
}
