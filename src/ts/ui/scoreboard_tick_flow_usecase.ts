import type { GameEvent, GoldFrame, Participant } from "../bindings";
import type { ScoreboardRefsMap } from "./scoreboard_team_usecase";
import { applyScoreboardLiveSnapshot } from "./scoreboard_live_update_usecase";
import { applyScoreboardObjectiveTick } from "./scoreboard_objective_tick_usecase";

export function applyScoreboardTickFlow(params: {
    playerCurrentTimeSec: number;
    recordingOffset: number;
    currentQueueId: number;
    currentGameVersion: string;
    timeline: { getStateAt: (participantId: number, timestampMs: number) => any };
    scoreboardRefs: ScoreboardRefsMap;
    goldTimeline: GoldFrame[];
    goldDiffRefs: HTMLElement[];
    participants: Participant[];
    csRefs: HTMLElement[];
    kdaRefs: HTMLElement[];
    events: GameEvent[];
    team100GoldText: HTMLElement | null;
    team200GoldText: HTMLElement | null;
    team100LeadText: HTMLElement | null;
    team200LeadText: HTMLElement | null;
    team100KillsText: HTMLElement | null;
    team200KillsText: HTMLElement | null;
    team100TowerText: HTMLElement | null;
    team200TowerText: HTMLElement | null;
    team100DragonText: HTMLElement | null;
    team200DragonText: HTMLElement | null;
    team100BaronText: HTMLElement | null;
    team200BaronText: HTMLElement | null;
    team100VoidgrubText: HTMLElement | null;
    team200VoidgrubText: HTMLElement | null;
    team100HeraldText: HTMLElement | null;
    team200HeraldText: HTMLElement | null;
    headerTimeText: HTMLElement | null;
    baronTimerText: HTMLElement | null;
    baronTimerIcon: HTMLImageElement | null;
    baronTimerGroup2: HTMLElement | null;
    baronTimerText2: HTMLElement | null;
    baronTimerIcon2: HTMLImageElement | null;
    dragonTimerText: HTMLElement | null;
    dragonTimerIcon: HTMLImageElement | null;
    monoVoidgrub: string;
    monoHerald: string;
    monoBaron: string;
    monoDrake: string;
}): void {
    applyScoreboardLiveSnapshot({
        timeline: params.timeline,
        playerCurrentTimeSec: params.playerCurrentTimeSec,
        currentGameVersion: params.currentGameVersion,
        scoreboardRefs: params.scoreboardRefs,
        goldTimeline: params.goldTimeline,
        goldDiffRefs: params.goldDiffRefs,
        participants: params.participants,
        csRefs: params.csRefs,
        team100GoldText: params.team100GoldText,
        team200GoldText: params.team200GoldText,
        team100LeadText: params.team100LeadText,
        team200LeadText: params.team200LeadText,
        kdaRefs: params.kdaRefs,
        events: params.events,
        team100KillsText: params.team100KillsText,
        team200KillsText: params.team200KillsText,
        team100TowerText: params.team100TowerText,
        team200TowerText: params.team200TowerText,
        team100DragonText: params.team100DragonText,
        team200DragonText: params.team200DragonText,
        team100BaronText: params.team100BaronText,
        team200BaronText: params.team200BaronText,
        team100VoidgrubText: params.team100VoidgrubText,
        team200VoidgrubText: params.team200VoidgrubText,
        team100HeraldText: params.team100HeraldText,
        team200HeraldText: params.team200HeraldText,
    });

    applyScoreboardObjectiveTick({
        playerCurrentTimeSec: params.playerCurrentTimeSec,
        recordingOffset: params.recordingOffset,
        currentQueueId: params.currentQueueId,
        events: params.events,
        headerTimeText: params.headerTimeText,
        baronTimerText: params.baronTimerText,
        baronTimerIcon: params.baronTimerIcon,
        baronTimerGroup2: params.baronTimerGroup2,
        baronTimerText2: params.baronTimerText2,
        baronTimerIcon2: params.baronTimerIcon2,
        dragonTimerText: params.dragonTimerText,
        dragonTimerIcon: params.dragonTimerIcon,
        monoVoidgrub: params.monoVoidgrub,
        monoHerald: params.monoHerald,
        monoBaron: params.monoBaron,
        monoDrake: params.monoDrake,
    });
}
