
export interface ObjectiveConfig {
    hasGrubs: boolean;
    hasHerald: boolean;
    
    // Initial Spawn Times (Seconds)
    baronSpawnTime: number; 
    elderSpawnTime: number; // If -1, determined by Soul logic (Standard)
    
    // Intervals (Seconds)
    dragonInterval: number;
    baronRespawnTime: number;
    elderRespawnTime: number;
}

export const STANDARD_OBJECTIVES: ObjectiveConfig = {
    hasGrubs: true,
    hasHerald: true,
    baronSpawnTime: 20 * 60, // 20:00
    elderSpawnTime: -1,      // Dynamic
    dragonInterval: 5 * 60,  // 5:00
    baronRespawnTime: 6 * 60,// 6:00
    elderRespawnTime: 6 * 60 // 6:00
};

export const SWIFTPLAY_OBJECTIVES: ObjectiveConfig = {
    hasGrubs: false,
    hasHerald: false,
    baronSpawnTime: 12 * 60, // 12:00
    elderSpawnTime: 15 * 60, // 15:00 (Fixed spawn for Swiftplay)
    dragonInterval: 5 * 60,  // 5:00 (Updated per user request)
    baronRespawnTime: 6 * 60,// 6:00 (Assuming standard if not specified, safe default)
    elderRespawnTime: 6 * 60 // 6:00 (User specified)
};

export function getObjectiveConfig(queueId: number): ObjectiveConfig {
    // 490 = Swiftplay (Quickplay replaced)
    // 480 = Swiftplay (Observed)
    // 830-850, 890 = Co-op vs AI
    if (queueId === 490 || queueId === 480 || (queueId >= 830 && queueId <= 890)) {
        return SWIFTPLAY_OBJECTIVES;
    }
    return STANDARD_OBJECTIVES;
}
