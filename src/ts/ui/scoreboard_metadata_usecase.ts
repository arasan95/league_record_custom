import type { GameEvent, Participant } from "../bindings";

type PositionSum = { x: number; y: number; count: number };

export type TeamObjectiveCounts = {
    t100Towers: number;
    t200Towers: number;
    t100Dragons: number;
    t200Dragons: number;
    t100Barons: number;
    t200Barons: number;
    t100Grubs: number;
    t200Grubs: number;
    t100Heralds: number;
    t200Heralds: number;
};

const SUPPORT_ITEMS = [3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877];

function isStandardMode(queueName: string, queueId: number): boolean {
    const qLower = queueName.toLowerCase();
    return (
        qLower.includes("ranked") ||
        qLower.includes("rank") ||
        qLower.includes("normal") ||
        qLower.includes("draft") ||
        qLower.includes("blind") ||
        qLower.includes("swift") ||
        qLower.includes("swiftplay") ||
        queueId === 480
    );
}

function hasSmite(p: Participant): boolean {
    return p.spell1Id === 11 || p.spell2Id === 11;
}

function hasSupportItem(p: Participant, events: GameEvent[]): boolean {
    const items = [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5];
    if (items.some((id) => SUPPORT_ITEMS.includes(id))) {
        return true;
    }
    return events.some(
        (e) =>
            "ItemPurchased" in e &&
            e.ItemPurchased.participant_id === p.participantId &&
            SUPPORT_ITEMS.includes(e.ItemPurchased.item_id),
    );
}

function getSpatialScore(p: Participant, posSums: Map<number, PositionSum>): number {
    const pAny = p as any;
    if (typeof pAny.laneScore === "number" && pAny.laneScore !== 0) {
        return pAny.laneScore;
    }
    const entry = posSums.get(p.participantId);
    if (!entry || entry.count === 0) {
        return 0;
    }
    const avgX = entry.x / entry.count;
    const avgY = entry.y / entry.count;
    return avgY - avgX;
}

export function sortParticipantsForScoreboard(
    team: Participant[],
    events: GameEvent[],
    queueName: string,
    queueId: number,
): Participant[] {
    const slots: { [key: number]: Participant } = {};
    const remaining: Participant[] = [];

    for (const p of team) {
        if (hasSmite(p)) {
            if (!slots[2]) slots[2] = p;
            else remaining.push(p);
        } else if (hasSupportItem(p, events)) {
            if (!slots[5]) slots[5] = p;
            else remaining.push(p);
        } else {
            remaining.push(p);
        }
    }

    if (isStandardMode(queueName, queueId)) {
        const currentRemaining = [...remaining];
        currentRemaining.forEach((p) => {
            const nativeSlot = ((p.participantId - 1) % 5) + 1;
            if ([1, 3, 4].includes(nativeSlot) && !slots[nativeSlot]) {
                slots[nativeSlot] = p;
                const idx = remaining.indexOf(p);
                if (idx > -1) remaining.splice(idx, 1);
            }
        });
    } else {
        const posSums = new Map<number, PositionSum>();
        const TIME_LIMIT = 14 * 60 * 1000;

        remaining.forEach((p) => posSums.set(p.participantId, { x: 0, y: 0, count: 0 }));

        for (const e of events) {
            if (e.timestamp > TIME_LIMIT) break;
            if (!("ChampionKill" in e)) continue;
            const kill = e.ChampionKill;
            const pos = kill.position;
            const update = (pid: number) => {
                const entry = posSums.get(pid);
                if (!entry) return;
                entry.x += pos.x;
                entry.y += pos.y;
                entry.count++;
            };
            update(kill.victim_id);
            update(kill.killer_id);
            kill.assisting_participant_ids.forEach((aid) => update(aid));
        }

        remaining.sort((a, b) => getSpatialScore(b, posSums) - getSpatialScore(a, posSums));
        const targetSlots = [1, 3, 4].filter((s) => !slots[s]);
        remaining.forEach((p, i) => {
            if (i < targetSlots.length) slots[targetSlots[i]] = p;
        });
        if (remaining.length > 0 && targetSlots.length > 0) {
            remaining.splice(0, Math.min(remaining.length, targetSlots.length));
        }
    }

    const emptySlots = [1, 2, 3, 4, 5].filter((s) => !slots[s]);
    remaining.forEach((p, i) => {
        if (i < emptySlots.length) slots[emptySlots[i]] = p;
    });

    const result: Participant[] = [];
    [1, 2, 3, 4, 5].forEach((i) => {
        if (slots[i]) result.push(slots[i]);
    });
    remaining.forEach((p) => {
        if (!Object.values(slots).includes(p)) result.push(p);
    });
    return result;
}

export function calcTeamKills(participants: Participant[]): number {
    return participants.reduce((acc, p) => acc + p.stats.kills, 0);
}

export function calcTeamItemGold(
    participants: Participant[],
    gameVersion: string,
    getItemPrice: (itemId: number, gameVersion?: string) => number,
): number {
    return participants.reduce((total, p) => {
        let pTotal = 0;
        [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5, p.stats.item6].forEach((id) => {
            if (id) pTotal += getItemPrice(id, gameVersion);
        });
        return total + pTotal;
    }, 0);
}

function resolveMonsterTeamId(event: Extract<GameEvent, { EliteMonsterKill: any }>, participants: Participant[]): number {
    const killer = participants.find((p) => p.participantId == event.EliteMonsterKill.killer_id);
    if (killer) return killer.teamId;
    const assists = event.EliteMonsterKill.assisting_participant_ids;
    const assister = participants.find((p) => assists.includes(p.participantId));
    return assister?.teamId ?? 0;
}

export function countTeamObjectives(events: GameEvent[], participants: Participant[]): TeamObjectiveCounts {
    const counts: TeamObjectiveCounts = {
        t100Towers: 0,
        t200Towers: 0,
        t100Dragons: 0,
        t200Dragons: 0,
        t100Barons: 0,
        t200Barons: 0,
        t100Grubs: 0,
        t200Grubs: 0,
        t100Heralds: 0,
        t200Heralds: 0,
    };

    for (const e of events) {
        if ("BuildingKill" in e && e.BuildingKill.building_type.buildingType === "TOWER_BUILDING") {
            const teamId = e.BuildingKill.team_id as unknown as number;
            if (teamId === 100) counts.t200Towers++;
            else counts.t100Towers++;
            continue;
        }
        if (!("EliteMonsterKill" in e)) continue;

        const teamId = resolveMonsterTeamId(e, participants);
        const type = e.EliteMonsterKill.monster_type.monsterType;
        if (teamId === 100) {
            if (type === "DRAGON") counts.t100Dragons++;
            else if (type === "BARON_NASHOR") counts.t100Barons++;
            else if (type === "HORDE") counts.t100Grubs++;
            else if (type === "RIFTHERALD") counts.t100Heralds++;
        } else if (teamId === 200) {
            if (type === "DRAGON") counts.t200Dragons++;
            else if (type === "BARON_NASHOR") counts.t200Barons++;
            else if (type === "HORDE") counts.t200Grubs++;
            else if (type === "RIFTHERALD") counts.t200Heralds++;
        }
    }
    return counts;
}
