import type { GameMetadata } from "../bindings";

export function createClipIconElement(): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("class", "sidebar-clip-icon");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    const make = (tag: string, attrs: Record<string, string>) => {
        const el = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    };
    svg.append(
        make("rect", { x: "2", y: "2", width: "20", height: "20", rx: "2.18", ry: "2.18" }),
        make("line", { x1: "7", y1: "2", x2: "7", y2: "22" }),
        make("line", { x1: "17", y1: "2", x2: "17", y2: "22" }),
        make("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
        make("line", { x1: "2", y1: "7", x2: "7", y2: "7" }),
        make("line", { x1: "2", y1: "17", x2: "7", y2: "17" }),
        make("line", { x1: "17", y1: "17", x2: "22", y2: "17" }),
        make("line", { x1: "17", y1: "7", x2: "22", y2: "7" }),
    );
    return svg;
}

export function formatSidebarDate(name: string): string {
    let m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})(?:-\d{2})?$/);
    if (m) {
        return `${m[1]}/${parseInt(m[2], 10)}/${parseInt(m[3], 10)} ${m[4]}:${m[5]}`;
    }
    m = name.match(/_clip_(\d{8})_(\d{6})$/);
    if (!m) {
        m = name.match(/(\d{8})_(\d{6})$/);
    }
    if (m) {
        const d = m[1];
        const t = m[2];
        const y = d.slice(0, 4);
        const mo = parseInt(d.slice(4, 6), 10);
        const da = parseInt(d.slice(6, 8), 10);
        return `${y}/${mo}/${da} ${t.slice(0, 2)}:${t.slice(2, 4)}`;
    }
    return name;
}

export function getMatchResultMeta(meta: GameMetadata): { result: string; resultClass: string } {
    if (meta.stats.gameEndedInEarlySurrender) {
        return { result: "Remake", resultClass: "remake-text" };
    }
    if (meta.stats.win) {
        return { result: "Victory", resultClass: "win-text" };
    }
    return { result: "Defeat", resultClass: "loss-text" };
}

export function isRedSideMeta(meta: GameMetadata): boolean {
    const selfPart = meta.participants.find((p) => p.participantId === meta.participantId);
    if (selfPart && "teamId" in selfPart) {
        return selfPart.teamId === 200;
    }
    const pIndex = meta.participants.findIndex((p) => p.participantId === meta.participantId);
    if (pIndex !== -1) {
        return pIndex >= 5;
    }
    return meta.participantId > 5;
}

export function resolveDurationSeconds(meta: GameMetadata): number {
    const statsAny = meta.stats as any;
    let rawDuration = Math.floor((statsAny?.gameDuration as number | undefined) || 0);
    if (rawDuration === 0 && meta.goldTimeline && meta.goldTimeline.length > 0) {
        const lastFrame = meta.goldTimeline[meta.goldTimeline.length - 1];
        rawDuration = Math.floor(lastFrame.timestamp / 1000);
    }
    if (rawDuration > 20000) {
        return Math.floor(rawDuration / 1000);
    }
    return rawDuration;
}

export function formatDurationMmSs(durationSec: number): string {
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function calcCsPerMin(totalCS: number, durationSec: number): string {
    return durationSec > 0 ? (totalCS / (durationSec / 60)).toFixed(1) : "0.0";
}

export function resolveTftTraitStyleClass(tierCurrent: number, tierTotal: number): string {
    let styleClass = "tft-inactive";
    if (tierCurrent > 0) {
        if (tierTotal === 1 && tierCurrent === 1) styleClass = "tft-unique";
        else if (tierTotal === 2) {
            if (tierCurrent === 1) styleClass = "tft-bronze";
            else if (tierCurrent >= 2) styleClass = "tft-gold";
        } else if (tierTotal === 3) {
            if (tierCurrent === 1) styleClass = "tft-bronze";
            else if (tierCurrent === 2) styleClass = "tft-silver";
            else if (tierCurrent >= 3) styleClass = "tft-gold";
        } else if (tierTotal === 4) {
            if (tierCurrent === 1) styleClass = "tft-bronze";
            else if (tierCurrent === 2) styleClass = "tft-silver";
            else if (tierCurrent === 3) styleClass = "tft-gold";
            else if (tierCurrent >= 4) styleClass = "tft-prismatic";
        } else if (tierTotal >= 5) {
            if (tierCurrent === 1) styleClass = "tft-bronze";
            else if (tierCurrent === 2) styleClass = "tft-silver";
            else if (tierCurrent === 3) styleClass = "tft-silver";
            else if (tierCurrent === 4) styleClass = "tft-gold";
            else if (tierCurrent >= 5) styleClass = "tft-prismatic";
        }
    }
    return styleClass;
}

export function resolveTftUnitCost(rarity: number): number {
    if (rarity === 0) return 1;
    if (rarity === 1) return 2;
    if (rarity === 2) return 3;
    if (rarity === 3 || rarity === 4) return 4;
    if (rarity >= 5) return 5;
    return 1;
}
