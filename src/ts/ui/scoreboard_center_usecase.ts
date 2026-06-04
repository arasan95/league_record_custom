import type { Participant, Settings } from "../bindings";

const pressedModifiers = {
    Shift: false,
    Ctrl: false,
    Alt: false,
    Meta: false,
};
if (!(window as any).__scoreboardCenterModifierTrackerInstalled) {
    window.addEventListener("keydown", (ev) => {
        pressedModifiers.Shift = ev.shiftKey || ev.getModifierState("Shift");
        pressedModifiers.Ctrl = ev.ctrlKey || ev.getModifierState("Control");
        pressedModifiers.Alt = ev.altKey || ev.getModifierState("Alt");
        pressedModifiers.Meta = ev.metaKey || ev.getModifierState("Meta");
    }, true);
    window.addEventListener("keyup", (ev) => {
        pressedModifiers.Shift = ev.shiftKey || ev.getModifierState("Shift");
        pressedModifiers.Ctrl = ev.ctrlKey || ev.getModifierState("Control");
        pressedModifiers.Alt = ev.altKey || ev.getModifierState("Alt");
        pressedModifiers.Meta = ev.metaKey || ev.getModifierState("Meta");
    }, true);
    window.addEventListener("blur", () => {
        pressedModifiers.Shift = false;
        pressedModifiers.Ctrl = false;
        pressedModifiers.Alt = false;
        pressedModifiers.Meta = false;
    });
    (window as any).__scoreboardCenterModifierTrackerInstalled = true;
}

function isModifierPressed(e: MouseEvent, modifier: string | null | undefined): boolean {
    if (modifier === "None") return true;
    if (modifier === "Ctrl") return e.ctrlKey || e.getModifierState("Control") || pressedModifiers.Ctrl;
    if (modifier === "Alt") return e.altKey || e.getModifierState("Alt") || pressedModifiers.Alt;
    if (modifier === "Meta") return e.metaKey || e.getModifierState("Meta") || pressedModifiers.Meta;
    return e.shiftKey || e.getModifierState("Shift") || pressedModifiers.Shift;
}

function isOpenableExternalUrl(url: string): boolean {
    return /^https?:\/\//i.test(url.trim());
}

export async function buildScoreboardCenterRows(input: {
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => HTMLElement;
    sorted100: Participant[];
    sorted200: Participant[];
    settings: Settings;
    participantId: number;
    buildGoldDiffRowState: (diff: number) => { className: string; html: string };
    getChampionNameById: (championId: number) => Promise<string | null>;
    getChampionEnglishNameByIdSync: (championId: number) => string | null;
    openUrl: (url: string) => Promise<void>;
}): Promise<{ centerDiv: HTMLElement; diffRefs: HTMLElement[] }> {
    const {
        createEl,
        sorted100,
        sorted200,
        settings,
        participantId,
        buildGoldDiffRowState,
        getChampionNameById,
        getChampionEnglishNameByIdSync,
        openUrl,
    } = input;

    const centerDiv = createEl("div", {}, { class: "scoreboard-center" }) as HTMLElement;
    const diffRefs: HTMLElement[] = [];

    for (let i = 0; i < 5; i++) {
        const p1 = sorted100[i];
        const p2 = sorted200[i];
        if (!p1 || !p2) continue;

        const diffRow = createEl("div", {}, { class: "center-diff-row" }) as HTMLElement;
        const rowState = buildGoldDiffRowState(p1.stats.goldEarned - p2.stats.goldEarned);
        diffRow.className = rowState.className;
        diffRow.innerHTML = rowState.html;

        if (settings.championMatchupUrl) {
            diffRow.style.cursor = "pointer";
            diffRow.title = "Open Matchup";
            diffRow.addEventListener("click", async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const useSub = isModifierPressed(e, (settings as any).scoreboardLinkModifier);
                const selectedBaseUrl = useSub
                    ? ((settings as any).championMatchupSubUrl || settings.championMatchupUrl)
                    : settings.championMatchupUrl;
                if (!selectedBaseUrl) return;

                let myP = p1;
                let oppP = p2;
                const userIsRed = sorted200.some((p) => p && p.participantId === participantId);
                if (participantId && userIsRed) {
                    myP = p2;
                    oppP = p1;
                }

                const myChampName = await getChampionNameById(myP.championId);
                const targetChampName = await getChampionNameById(oppP.championId);
                if (!myChampName || !targetChampName) {
                    console.warn("Could not resolve champion names for matchup");
                    return;
                }

                const myEng = getChampionEnglishNameByIdSync(myP.championId) || myChampName;
                const oppEng = getChampionEnglishNameByIdSync(oppP.championId) || targetChampName;
                const url = selectedBaseUrl
                    .replace(/{My_id}/g, myChampName)
                    .replace(/{My_name}/g, myEng)
                    .replace(/{My_name_}/g, myEng.replace(/\s+/g, "_"))
                    .replace(/{My_nameEsc}/g, encodeURIComponent(myEng))
                    .replace(/{My}/g, myChampName)
                    .replace(/{my}/g, myChampName.toLowerCase())
                    .replace(/{Opp_id}/g, targetChampName)
                    .replace(/{Opp_name}/g, oppEng)
                    .replace(/{Opp_name_}/g, oppEng.replace(/\s+/g, "_"))
                    .replace(/{Opp_nameEsc}/g, encodeURIComponent(oppEng))
                    .replace(/{Opponent}/g, targetChampName)
                    .replace(/{opponent}/g, targetChampName.toLowerCase());
                try {
                    if (!isOpenableExternalUrl(url)) {
                        console.warn("Skipped opening non-http(s) Matchup URL:", url);
                        return;
                    }
                    await openUrl(url.trim());
                } catch (error) {
                    console.error("Failed to open Matchup URL:", error);
                }
            });
        }

        centerDiv.append(diffRow);
        diffRefs.push(diffRow);
    }

    return { centerDiv, diffRefs };
}
