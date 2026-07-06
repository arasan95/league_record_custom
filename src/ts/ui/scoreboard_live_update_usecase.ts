import type { GoldFrame, Participant, GameEvent } from "../bindings";
import { getCurrentPatchVersion } from "../version";
import { buildGoldDiffRowState, buildTeamLeadState } from "./scoreboard_usecase";
import { buildFrameDataMap, buildPairDiffs, buildTeamItemGoldTotals, resolveCurrentGoldFrame } from "./scoreboard_economy_usecase";
import { updateScoreboardItemsAndGold } from "./scoreboard_items_usecase";
import { applyTimelineCombatSummaryToRefs, buildTimelineCombatSummary } from "./scoreboard_timeline_usecase";
import { getItemIconUrl, getItemPrice } from "../datadragon";
import type { ScoreboardRefsMap } from "./scoreboard_team_usecase";

function buildPairDiffsFromVisibleRowOrder(
    goldDiffRefs: HTMLElement[],
    itemGoldMap: Map<number, number>,
): Array<number | null> | null {
    const firstDiffRow = goldDiffRefs[0];
    if (!firstDiffRow) return null;

    const scoreboardEl = firstDiffRow.closest(".scoreboard");
    if (!scoreboardEl) return null;

    const blueRows = Array.from(scoreboardEl.querySelectorAll(".team-100 .player-row")) as HTMLElement[];
    const redRows = Array.from(scoreboardEl.querySelectorAll(".team-200 .player-row")) as HTMLElement[];
    if (blueRows.length < 5 || redRows.length < 5) return null;

    const pairDiffs: Array<number | null> = [];
    for (let i = 0; i < 5; i++) {
        const leftPid = Number(blueRows[i].dataset.pid || "");
        const rightPid = Number(redRows[i].dataset.pid || "");
        if (!Number.isFinite(leftPid) || !Number.isFinite(rightPid)) {
            pairDiffs.push(null);
            continue;
        }

        const leftGold = itemGoldMap.get(leftPid) || 0;
        const rightGold = itemGoldMap.get(rightPid) || 0;
        pairDiffs.push(leftGold - rightGold);
    }
    return pairDiffs;
}

export function applyScoreboardLiveSnapshot(params: {
    timeline: { getStateAt: (participantId: number, timestampMs: number) => any };
    playerCurrentTimeSec: number;
    recordingOffset: number;
    currentGameVersion: string;
    scoreboardRefs: ScoreboardRefsMap;
    goldTimeline: GoldFrame[];
    goldDiffRefs: HTMLElement[];
    participants: Participant[];
    csRefs: HTMLElement[];
    team100GoldText: HTMLElement | null;
    team200GoldText: HTMLElement | null;
    team100LeadText: HTMLElement | null;
    team200LeadText: HTMLElement | null;
    kdaRefs: HTMLElement[];
    events: GameEvent[];
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
}): void {
    const {
        timeline,
        playerCurrentTimeSec,
        recordingOffset,
        currentGameVersion,
        scoreboardRefs,
        goldTimeline,
        goldDiffRefs,
        participants,
        csRefs,
        team100GoldText,
        team200GoldText,
        team100LeadText,
        team200LeadText,
        kdaRefs,
        events,
        team100KillsText,
        team200KillsText,
        team100TowerText,
        team200TowerText,
        team100DragonText,
        team200DragonText,
        team100BaronText,
        team200BaronText,
        team100VoidgrubText,
        team200VoidgrubText,
        team100HeraldText,
        team200HeraldText,
    } = params;

    const currentTime = (playerCurrentTimeSec + recordingOffset) * 1000 + 2000;
    const gameVersion = currentGameVersion || getCurrentPatchVersion();

    const itemGoldMap = updateScoreboardItemsAndGold({
        scoreboardRefs,
        currentTimeMs: currentTime,
        gameVersion,
        getTimelineStateAt: (participantId, timestampMs) => timeline.getStateAt(participantId, timestampMs) ?? null,
        getItemPrice: (itemId, version) => getItemPrice(itemId, version ?? gameVersion),
        getItemIconUrl,
    });

    if (goldTimeline.length > 0 && goldDiffRefs.length === 5 && participants.length >= 10) {
        const currentFrame = resolveCurrentGoldFrame(goldTimeline, currentTime);
        if (currentFrame) {
            const frameDataMap = buildFrameDataMap(currentFrame);

            participants.forEach((p) => {
                const idx = participants.indexOf(p);
                const ref = csRefs[idx];

                if (ref) {
                    const data = frameDataMap.get(p.participantId);
                    const cs = data?.minions || 0;
                    ref.textContent = `${cs}`;
                    const level = data?.level ?? null;
                    const champLevelText = scoreboardRefs.get(p.participantId)?.champLevelText;
                    if (champLevelText && level !== null && level > 0) {
                        champLevelText.textContent = `${level}`;
                    }
                }
            });

            const { team100Total: t100Total, team200Total: t200Total } = buildTeamItemGoldTotals(participants, itemGoldMap);
            const pairDiffs =
                buildPairDiffsFromVisibleRowOrder(goldDiffRefs, itemGoldMap) ?? buildPairDiffs(participants, itemGoldMap);

            for (let i = 0; i < 5; i++) {
                const row = goldDiffRefs[i];
                if (!row) continue;
                const diff = pairDiffs[i];
                if (diff !== null) {
                    const rowState = buildGoldDiffRowState(diff);
                    row.className = rowState.className;
                    row.innerHTML = rowState.html;
                } else {
                    row.className = "center-diff-row";
                    row.innerHTML = `<span class="diff-val">-</span>`;
                }
            }

            const leadState = buildTeamLeadState(t100Total, t200Total);
            if (team100GoldText) team100GoldText.textContent = leadState.team100GoldText;
            if (team200GoldText) team200GoldText.textContent = leadState.team200GoldText;
            if (team100LeadText) {
                team100LeadText.textContent = leadState.team100LeadText;
                team100LeadText.style.color = leadState.team100LeadColor;
            }
            if (team200LeadText) {
                team200LeadText.textContent = leadState.team200LeadText;
                team200LeadText.style.color = leadState.team200LeadColor;
            }
        }
    }

    if (kdaRefs.length === 10 && events.length > 0) {
        const summary = buildTimelineCombatSummary(events, participants, currentTime);
        applyTimelineCombatSummaryToRefs(summary, participants, {
            kdaRefs,
            team100KillsText,
            team200KillsText,
            team100TowerText,
            team200TowerText,
            team100DragonText,
            team200DragonText,
            team100BaronText,
            team200BaronText,
            team100VoidgrubText,
            team200VoidgrubText,
            team100HeraldText,
            team200HeraldText,
        });
    }
}
