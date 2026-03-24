import { getGameModeByQueueId } from "../datadragon";

export function getShortQueueLabel(queueId?: number, queueName: string = ""): string {
    const id = queueId ?? 0;
    const staticMap: Record<number, string> = {
        0: "Custom",
        400: "Draft",
        420: "Solo",
        430: "Blind",
        440: "Flex",
        450: "ARAM",
        480: "Swift",
        490: "Swift",
        700: "Clash",
        830: "AI",
        840: "AI",
        850: "AI",
        890: "AI",
        1090: "TFT",
        1100: "TFT",
        1130: "TFT",
        1160: "TFT",
        1220: "TFT",
        1700: "Arena",
        3140: "Practice",
    };
    if (staticMap[id]) return staticMap[id];

    const lower = queueName.toLowerCase();
    if (lower.includes("rank")) return "Ranked";
    if (lower.includes("normal")) return "Normal";
    if (lower.includes("practice")) return "Practice";
    if (lower.includes("custom")) return "Custom";
    if (lower.includes("bot") || lower.includes("ai") || lower.includes("co-op") || lower.includes("intro") || lower.includes("intermediate")) return "AI";
    if (lower.includes("aram")) return "ARAM";
    if (lower.includes("arena")) return "Arena";
    if (lower.includes("swift")) return "Swift";
    if (lower.includes("clash")) return "Clash";
    if (lower.includes("draft")) return "Draft";
    if (lower.includes("blind")) return "Blind";
    if (lower.includes("solo")) return "Solo";
    if (lower.includes("flex")) return "Flex";
    if (lower.includes("quick")) return "Quick";
    if (lower.includes("urf")) return "URF";
    if (lower.includes("tft") || lower.includes("teamfight")) return "TFT";

    const modeGroup = getGameModeByQueueId(id, queueName);
    if (modeGroup === "TFT") return "TFT";
    if (modeGroup === "ARAM") return "ARAM";
    if (modeGroup === "SR") return "SR";
    return "Match";
}

export function matchesQueueSearchTerm(queueId: number | undefined, queueName: string | undefined, term: string): boolean {
    const qName = (queueName || "").toLowerCase();
    if (qName.includes(term)) {
        return true;
    }

    const qId = queueId || 0;
    const displayName = getShortQueueLabel(qId, queueName || "").toLowerCase();
    if (displayName.includes(term) || term.includes(displayName)) {
        return true;
    }

    const queueFilterMode = getGameModeByQueueId(qId, queueName || "");
    return queueFilterMode.toLowerCase().includes(term);
}
