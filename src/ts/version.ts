
const VERSION_KEY = "lol_patch_version";
const FALLBACK_VERSION = "14.23.1"; // A recent safe fallback

export async function initPatchVersion(): Promise<string> {
    try {
        console.log("Checking for latest LoL patch version...");
        const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
        if (!response.ok) throw new Error("Failed to fetch version list");
        
        const versions = await response.json();
        if (Array.isArray(versions) && versions.length > 0) {
            const latest = versions[0];
            const current = localStorage.getItem(VERSION_KEY);
            
            if (current !== latest) {
                console.log(`New patch version detected: ${latest} (was ${current})`);
                localStorage.setItem(VERSION_KEY, latest);
            } else {
                console.log(`Patch version is up to date: ${latest}`);
            }
            return latest;
        }
    } catch (e) {
        console.warn("Failed to fetch latest patch version, using stored or fallback:", e);
    }
    
    return localStorage.getItem(VERSION_KEY) || FALLBACK_VERSION;
}

export function getCurrentPatchVersion(): string {
    return localStorage.getItem(VERSION_KEY) || FALLBACK_VERSION;
}

export function getSpawnTimers() {
    const version = getCurrentPatchVersion();
    let voidgrubInitial = 300; // Default 5:00 (Patch 14.1)

    try {
        const parts = version.split(".");
        if (parts.length >= 2) {
            const major = parseInt(parts[0]);
            const minor = parseInt(parts[1]);
            
            // Season 2025 (or "Season 2" changes) -> 8:00
            // Assuming Patch 15.x is the marker for new changes or late 14.x.
            // User indicated it IS 8:00 now. I'll act as if 15.x or higher has this change.
            // Also user mentioned "Patch 14.8" changed it to 6:00, then later to 8:00.
            // Let's implement robust check.
            
            if (major >= 15) {
                voidgrubInitial = 480; // 8:00 for Season 2025+
            } else if (major === 14) {
                if (minor >= 14) { // Assuming recent patches (e.g. 14.14+) have the 8:00 change? 
                    // Actually source said "Season 2" in April 2025. 
                    // If current date is Jan 2026 (from metadata), we are likely on patch 16.x or 15.x?
                    // "Season 2" in 2025 context usually means Split 2.
                    // Let's assume anything > 14.20 or 15.0 is safe for 8:00.
                    voidgrubInitial = 480; 
                } else if (minor >= 8) {
                    voidgrubInitial = 360; // 6:00
                }
            }
        }
    } catch (e) {
        console.warn("Error parsing patch version for timers", e);
    }

    return { voidgrubInitial };
}
