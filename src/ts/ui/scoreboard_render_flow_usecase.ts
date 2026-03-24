import { commands, type GameMetadata, type Participant } from "../bindings";
import { getChampionEnglishNameByIdSync, getChampionNameById } from "../datadragon";
import { open } from "@tauri-apps/plugin-shell";
import { buildGoldDiffRowState } from "./scoreboard_usecase";
import { buildScoreboardContext } from "./scoreboard_context_usecase";
import { assignScoreboardHeaderRefs, buildSpectatorHeader } from "./scoreboard_header_usecase";
import { buildScoreboardCenterRows } from "./scoreboard_center_usecase";
import {
    cleanupDuplicateScoreboardElements,
    createScoreboardShell,
    ensureSpectatorHeader,
    mountScoreboardInPlayer,
    setupScoreboardResize,
} from "./scoreboard_dom_usecase";
import { renderScoreboardTeam, type ScoreboardRefsMap } from "./scoreboard_team_usecase";

export type PreparedScoreboardView = {
    playerEl: HTMLElement;
    scoreboardEl: HTMLElement;
    sorted100: Participant[];
    sorted200: Participant[];
    isTFT: boolean;
};

export function prepareScoreboardView(input: {
    data: GameMetadata;
    events: any[];
    participants: Participant[];
    gameVersion: string;
    scoreboardScale: number | null;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => Element;
    emptyEl: (el: HTMLElement) => void;
    playerEl: HTMLElement;
    setScoreboardHeight: (targetHeight: number, baseHeight: number) => void;
    saveScale: (scale: number) => void;
    monoTower: string;
    monoVoidgrub: string;
    monoDrake: string;
    setParticipants: (participants: Participant[]) => void;
    assignHeaderRefs: (refs: Record<string, HTMLElement | HTMLImageElement | null>) => void;
}): PreparedScoreboardView | null {
    const {
        data,
        events,
        participants,
        gameVersion,
        scoreboardScale,
        createEl,
        emptyEl,
        playerEl,
        setScoreboardHeight,
        saveScale,
        monoTower,
        monoVoidgrub,
        monoDrake,
        setParticipants,
        assignHeaderRefs,
    } = input;

    const mainContainer = document.getElementById("main");
    const playerElement = document.getElementById("video_player");
    const spectatorHeader = ensureSpectatorHeader({
        createEl: createEl as any,
        emptyEl,
        mainContainer,
        playerElement,
        existingHeader: document.getElementById("video-header") as HTMLElement | null,
    });
    if (!spectatorHeader) return null;

    cleanupDuplicateScoreboardElements(playerEl, spectatorHeader);

    const context = buildScoreboardContext({
        metadata: data,
        events,
        participants,
        gameVersion,
    });

    const sorted100 = context.sorted100;
    const sorted200 = context.sorted200;
    setParticipants([...sorted100, ...sorted200]);

    const header = buildSpectatorHeader({
        createEl: createEl as any,
        spectatorHeader,
        monoTower,
        monoVoidgrub,
        monoDrake,
        stats: context.headerStats,
        isSR: context.isSR,
        isTFT: context.isTFT,
    });
    assignHeaderRefs(header.refs);

    const scoreboardShell = createScoreboardShell(createEl as any, scoreboardScale);
    const scoreboardEl = scoreboardShell.scoreboardEl;
    setupScoreboardResize({
        scoreboardEl,
        resizeHandle: scoreboardShell.resizeHandle,
        baseHeight: 220,
        setScoreboardHeight: (targetHeight, baseHeight) => setScoreboardHeight(targetHeight, baseHeight),
        saveScale,
    });

    return {
        playerEl,
        scoreboardEl,
        sorted100,
        sorted200,
        isTFT: context.isTFT,
    };
}

export async function renderScoreboardMainRows(input: {
    data: GameMetadata;
    sorted100: Participant[];
    sorted200: Participant[];
    currentGameVersion: string;
    currentRenderId: number;
    isRenderValid: () => boolean;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => Element;
    csRefs: HTMLElement[];
    kdaRefs: HTMLElement[];
    scoreboardRefs: ScoreboardRefsMap;
    goldDiffRefs: HTMLElement[];
    scoreboardEl: HTMLElement;
    playerEl: HTMLElement;
    controlBarEl: HTMLElement | null;
}): Promise<boolean> {
    const {
        data,
        sorted100,
        sorted200,
        currentGameVersion,
        currentRenderId,
        isRenderValid,
        createEl,
        csRefs,
        kdaRefs,
        scoreboardRefs,
        goldDiffRefs,
        scoreboardEl,
        playerEl,
        controlBarEl,
    } = input;

    const topDiv = await renderScoreboardTeam({
        teamId: 100,
        participants: sorted100,
        data,
        currentGameVersion,
        currentRenderId,
        isRenderValid,
        createEl: createEl as any,
        csRefs,
        kdaRefs,
        scoreboardRefs,
    });
    const botDiv = await renderScoreboardTeam({
        teamId: 200,
        participants: sorted200,
        data,
        currentGameVersion,
        currentRenderId,
        isRenderValid,
        createEl: createEl as any,
        csRefs,
        kdaRefs,
        scoreboardRefs,
    });

    if (!isRenderValid()) return false;
    if (!topDiv || !botDiv) return false;

    const settings = await commands.getSettings();
    const center = await buildScoreboardCenterRows({
        createEl: createEl as any,
        sorted100,
        sorted200,
        settings,
        participantId: data.participantId,
        buildGoldDiffRowState,
        getChampionNameById,
        getChampionEnglishNameByIdSync,
        openUrl: open,
    });
    goldDiffRefs.push(...center.diffRefs);

    scoreboardEl.style.display = "";
    scoreboardEl.append(topDiv, center.centerDiv, botDiv);
    mountScoreboardInPlayer({
        playerEl,
        scoreboardEl,
        controlBarEl,
    });

    return true;
}
