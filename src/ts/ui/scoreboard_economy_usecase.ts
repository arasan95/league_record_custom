import type { GoldFrame, Participant, ParticipantGold } from "../bindings";

export function resolveCurrentGoldFrame(goldTimeline: GoldFrame[], currentTimeMs: number): GoldFrame | null {
    for (let i = goldTimeline.length - 1; i >= 0; i--) {
        if (goldTimeline[i].timestamp <= currentTimeMs) {
            return goldTimeline[i];
        }
    }
    return null;
}

export function buildFrameDataMap(frame: GoldFrame): Map<number, ParticipantGold> {
    const frameDataMap = new Map<number, ParticipantGold>();
    frame.participants.forEach((pg) => frameDataMap.set(pg.participantId, pg));
    return frameDataMap;
}

export function buildTeamItemGoldTotals(
    participants: Participant[],
    itemGoldMap: Map<number, number>,
): { team100Total: number; team200Total: number } {
    let team100Total = 0;
    let team200Total = 0;
    participants.forEach((p) => {
        const g = itemGoldMap.get(p.participantId) || 0;
        if (p.teamId === 100) team100Total += g;
        else if (p.teamId === 200) team200Total += g;
    });
    return { team100Total, team200Total };
}

export function buildPairDiffs(
    participants: Participant[],
    itemGoldMap: Map<number, number>,
): Array<number | null> {
    const p100 = participants.filter((p) => p.teamId === 100);
    const p200 = participants.filter((p) => p.teamId === 200);
    const diffs: Array<number | null> = [];
    for (let i = 0; i < 5; i++) {
        const left = p100[i];
        const right = p200[i];
        if (!left || !right) {
            diffs.push(null);
            continue;
        }
        const g1 = itemGoldMap.get(left.participantId) || 0;
        const g2 = itemGoldMap.get(right.participantId) || 0;
        diffs.push(g1 - g2);
    }
    return diffs;
}
