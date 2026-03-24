import type { GameEvent } from "../bindings";
import type { ObjectiveConfig } from "../objectives";

export type SpawnInfo = { time: number; type: string };

export type ObjectiveTimerRefs = {
    baronTimerText: HTMLElement | null;
    baronTimerIcon: HTMLImageElement | null;
    baronTimerGroup2: HTMLElement | null;
    baronTimerText2: HTMLElement | null;
    baronTimerIcon2: HTMLImageElement | null;
    dragonTimerText: HTMLElement | null;
    dragonTimerIcon: HTMLImageElement | null;
};

export type ObjectiveTimerIcons = {
    voidgrub: string;
    herald: string;
    baron: string;
    dragon: string;
};

function sortedEliteEvents(events: GameEvent[]): GameEvent[] {
    return events
        .filter((e) => "EliteMonsterKill" in e)
        .toSorted((a, b) => a.timestamp - b.timestamp);
}

function findLastEventBefore(events: GameEvent[], nowSec: number): GameEvent | null {
    let last: GameEvent | null = null;
    for (const e of events) {
        if (e.timestamp <= nowSec * 1000) last = e;
        else break;
    }
    return last;
}

export function getNextObjectiveSpawn(
    category: "baron" | "dragon",
    events: GameEvent[],
    nowSec: number,
    config: ObjectiveConfig,
): SpawnInfo {
    let filtered = sortedEliteEvents(events);
    if (category === "baron") {
        filtered = filtered.filter((e) => {
            if (!("EliteMonsterKill" in e)) return false;
            const t = e.EliteMonsterKill.monster_type.monsterType;
            return t === "BARON_NASHOR" || t === "RIFTHERALD" || t === "HORDE";
        });
    } else {
        filtered = filtered.filter((e) => "EliteMonsterKill" in e && e.EliteMonsterKill.monster_type.monsterType === "DRAGON");
    }

    const last = findLastEventBefore(filtered, nowSec);
    if (!last) {
        if (category === "dragon") {
            return { time: 300, type: "dragon" };
        }
        if (!config.hasGrubs && !config.hasHerald) {
            return { time: config.baronSpawnTime, type: "baron" };
        }
        if (nowSec < 14 * 60 + 45) return { time: 480, type: "grub" };
        if (nowSec < 19 * 60) return { time: 900, type: "herald" };
        return { time: config.baronSpawnTime, type: "baron" };
    }

    if (!("EliteMonsterKill" in last)) {
        return { time: 0, type: "" };
    }

    const killTime = Math.floor(last.timestamp / 1000);
    const type = last.EliteMonsterKill.monster_type.monsterType;
    const subType = (last.EliteMonsterKill.monster_type as any)?.monsterSubType as string | undefined;

    if (category === "baron") {
        if (type === "HORDE") return { time: 900, type: "herald" };
        if (type === "RIFTHERALD") return { time: config.baronSpawnTime, type: "baron" };
        if (type === "BARON_NASHOR") return { time: killTime + config.baronRespawnTime, type: "baron" };
        return { time: 0, type: "" };
    }

    if (subType === "ELDER_DRAGON") {
        return { time: killTime + config.elderRespawnTime, type: "dragon" };
    }
    if (config.elderSpawnTime > 0) {
        const nextSpawn = killTime + config.dragonInterval;
        if (nextSpawn >= config.elderSpawnTime) {
            return { time: Math.max(nextSpawn, config.elderSpawnTime), type: "dragon" };
        }
        return { time: nextSpawn, type: "dragon" };
    }
    return { time: killTime + config.dragonInterval, type: "dragon" };
}

export function getBuffRemainingSeconds(
    events: GameEvent[],
    nowSec: number,
    buff: "baron" | "elder",
): number | null {
    const filtered = sortedEliteEvents(events).filter((e) => {
        if (!("EliteMonsterKill" in e)) return false;
        if (buff === "baron") return e.EliteMonsterKill.monster_type.monsterType === "BARON_NASHOR";
        return (
            e.EliteMonsterKill.monster_type.monsterType === "DRAGON" &&
            (e.EliteMonsterKill.monster_type as any).monsterSubType === "ELDER_DRAGON"
        );
    });
    const last = findLastEventBefore(filtered, nowSec);
    if (!last) return null;
    const killTime = Math.floor(last.timestamp / 1000);
    const duration = buff === "baron" ? 180 : 150;
    if (nowSec < killTime + duration) {
        return killTime + duration - nowSec;
    }
    return null;
}

export function getSecondaryBaronSpawn(primary: SpawnInfo, nowSec: number, config: ObjectiveConfig): SpawnInfo | null {
    if (!config.hasGrubs) return null;
    const heraldSpawn = 900;
    const baronSpawn = config.baronSpawnTime;

    if (primary.type === "grub" && nowSec >= 480 && nowSec >= heraldSpawn - 120) {
        return { time: heraldSpawn, type: "herald" };
    }
    if (primary.type === "herald" && nowSec >= heraldSpawn && nowSec >= baronSpawn - 120) {
        return { time: baronSpawn, type: "baron" };
    }
    return null;
}

export function toCountdownLabel(nowSec: number, next: SpawnInfo): { text: string; live: boolean } {
    if (nowSec >= next.time) {
        return { text: "LIVE", live: true };
    }
    const diff = next.time - nowSec;
    const m = Math.floor(diff / 60);
    const s = Math.floor(diff % 60);
    return { text: `${m}:${s.toString().padStart(2, "0")}`, live: false };
}

function setObjectiveIcon(iconEl: HTMLImageElement | null, type: string, icons: ObjectiveTimerIcons): void {
    if (!iconEl) return;
    if (type === "grub") iconEl.src = icons.voidgrub;
    else if (type === "herald") iconEl.src = icons.herald;
    else if (type === "baron") iconEl.src = icons.baron;
    else if (type === "dragon") iconEl.src = icons.dragon;
}

function applySpawnLabel(
    nowSec: number,
    next: SpawnInfo,
    labelEl: HTMLElement,
    iconEl: HTMLImageElement | null,
    icons: ObjectiveTimerIcons,
    defaultColor = "white",
): void {
    setObjectiveIcon(iconEl, next.type, icons);
    const label = toCountdownLabel(nowSec, next);
    labelEl.textContent = label.text;
    labelEl.style.color = label.live ? "#ffffff" : defaultColor;
}

export function toGameClockLabel(nowSec: number): string {
    const absNow = Math.abs(nowSec);
    const m = Math.floor(absNow / 60);
    const s = Math.floor(absNow % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function applyObjectiveTimers(input: {
    events: GameEvent[];
    nowSec: number;
    config: ObjectiveConfig;
    refs: ObjectiveTimerRefs;
    icons: ObjectiveTimerIcons;
}): void {
    const { events, nowSec, config, refs, icons } = input;

    if (refs.baronTimerText) {
        const nextBaron = getNextObjectiveSpawn("baron", events, nowSec, config);
        const baronBuffRemaining = getBuffRemainingSeconds(events, nowSec, "baron");

        if (baronBuffRemaining !== null) {
            const m = Math.floor(baronBuffRemaining / 60);
            const s = Math.floor(baronBuffRemaining % 60);
            refs.baronTimerText.textContent = `${m}:${s.toString().padStart(2, "0")}`;
            refs.baronTimerText.style.color = "#a335ee";
            if (refs.baronTimerIcon) {
                refs.baronTimerIcon.src = icons.baron;
                refs.baronTimerIcon.style.filter = "drop-shadow(0 0 5px #a335ee)";
            }
        } else {
            if (refs.baronTimerIcon) refs.baronTimerIcon.style.filter = "none";
            applySpawnLabel(nowSec, nextBaron, refs.baronTimerText, refs.baronTimerIcon, icons, "#ffffffff");
        }

        if (refs.baronTimerGroup2 && refs.baronTimerText2 && refs.baronTimerIcon2) {
            const nextBaronSecondary = getSecondaryBaronSpawn(nextBaron, nowSec, config);
            if (nextBaronSecondary) {
                refs.baronTimerGroup2.style.display = "flex";
                applySpawnLabel(nowSec, nextBaronSecondary, refs.baronTimerText2, refs.baronTimerIcon2, icons, "#cccccc");
            } else {
                refs.baronTimerGroup2.style.display = "none";
            }
        }
    }

    if (refs.dragonTimerText) {
        const nextDragon = getNextObjectiveSpawn("dragon", events, nowSec, config);
        const elderBuffRemaining = getBuffRemainingSeconds(events, nowSec, "elder");

        if (elderBuffRemaining !== null) {
            const m = Math.floor(elderBuffRemaining / 60);
            const s = Math.floor(elderBuffRemaining % 60);
            refs.dragonTimerText.textContent = `${m}:${s.toString().padStart(2, "0")}`;
            refs.dragonTimerText.style.color = "#aaddff";
            if (refs.dragonTimerIcon) {
                refs.dragonTimerIcon.style.filter = "drop-shadow(0 0 5px #aaddff)";
            }
        } else {
            if (refs.dragonTimerIcon) refs.dragonTimerIcon.style.filter = "none";
            applySpawnLabel(nowSec, nextDragon, refs.dragonTimerText, refs.dragonTimerIcon, icons, "#ffffffff");
        }
    }
}
