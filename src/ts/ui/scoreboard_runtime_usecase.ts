import type { GameMetadata } from "../bindings";

type ScoreboardRuntimeTarget = any;

export function resetScoreboardRuntimeState(target: ScoreboardRuntimeTarget, metadata: GameMetadata): void {
    target.goldTimeline = metadata.goldTimeline || [];
    target.goldDiffRefs = [];
    target.participants = metadata.participants;
    target.team100GoldText = null;
    target.team200GoldText = null;
    target.team100LeadText = null;
    target.team200LeadText = null;
    target.team100KillsText = null;
    target.team200KillsText = null;
    target.team100TowerText = null;
    target.team200TowerText = null;
    target.team100DragonText = null;
    target.team200DragonText = null;
    target.team100BaronText = null;
    target.team200BaronText = null;
    target.team100VoidgrubText = null;
    target.team200VoidgrubText = null;
    target.kdaRefs = [];
    target.csRefs = [];
    target.scoreboardRefs.clear();
    target.events = metadata.events;
    target.recordingOffset = metadata.ingameTimeRecStartOffset;
}
