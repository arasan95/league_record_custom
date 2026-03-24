import type { GameEvent, Participant } from "../bindings";

export type KdaStat = { k: number; d: number; a: number };

export type TimelineCombatSummary = {
    kda: KdaStat[];
    teamKills: { team100: number; team200: number };
    objectives: {
        towers: { team100: number; team200: number };
        dragons: { team100: number; team200: number };
        barons: { team100: number; team200: number };
        grubs: { team100: number; team200: number };
        heralds: { team100: number; team200: number };
    };
};

export type TimelineCombatRefs = {
    kdaRefs: Array<HTMLElement | null>;
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
};

function findLastEventIndex(events: GameEvent[], currentTimeMs: number): number {
    let endIndex = -1;
    let low = 0;
    let high = events.length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid].timestamp <= currentTimeMs) {
            endIndex = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return endIndex;
}

function resolveEliteTeamId(event: Extract<GameEvent, { EliteMonsterKill: any }>, participantsById: Map<number, Participant>): 100 | 200 | 0 {
    const killer = participantsById.get(event.EliteMonsterKill.killer_id);
    if (killer && (killer.teamId === 100 || killer.teamId === 200)) {
        return killer.teamId;
    }
    const assists = event.EliteMonsterKill.assisting_participant_ids;
    for (const aid of assists) {
        const assister = participantsById.get(aid);
        if (assister && (assister.teamId === 100 || assister.teamId === 200)) {
            return assister.teamId;
        }
    }
    return 0;
}

export function buildTimelineCombatSummary(
    events: GameEvent[],
    participants: Participant[],
    currentTimeMs: number,
): TimelineCombatSummary {
    const kda = new Array(10).fill(0).map(() => ({ k: 0, d: 0, a: 0 }));
    const teamKills = { team100: 0, team200: 0 };
    const objectives = {
        towers: { team100: 0, team200: 0 },
        dragons: { team100: 0, team200: 0 },
        barons: { team100: 0, team200: 0 },
        grubs: { team100: 0, team200: 0 },
        heralds: { team100: 0, team200: 0 },
    };

    const participantsById = new Map<number, Participant>();
    participants.forEach((p) => participantsById.set(p.participantId, p));

    const endIndex = findLastEventIndex(events, currentTimeMs);
    if (endIndex === -1) {
        return { kda, teamKills, objectives };
    }

    for (let i = 0; i <= endIndex; i++) {
        const e = events[i];
        if ("ChampionKill" in e) {
            const ck = e.ChampionKill;
            const kId = ck.killer_id;
            const vId = ck.victim_id;

            if (kId >= 1 && kId <= 10) {
                kda[kId - 1].k++;
            }
            const killer = participantsById.get(kId);
            if (killer) {
                if (killer.teamId === 100) teamKills.team100++;
                else if (killer.teamId === 200) teamKills.team200++;
            }

            if (vId >= 1 && vId <= 10) {
                kda[vId - 1].d++;
            }
            ck.assisting_participant_ids.forEach((aid) => {
                if (aid >= 1 && aid <= 10) {
                    kda[aid - 1].a++;
                }
            });
            continue;
        }

        if ("BuildingKill" in e && e.BuildingKill.building_type.buildingType === "TOWER_BUILDING") {
            const teamId = e.BuildingKill.team_id as unknown as number;
            if (teamId === 100) objectives.towers.team200++;
            else objectives.towers.team100++;
            continue;
        }

        if ("EliteMonsterKill" in e) {
            const teamId = resolveEliteTeamId(e, participantsById);
            if (teamId === 0) continue;
            const type = e.EliteMonsterKill.monster_type.monsterType;
            if (type === "DRAGON") {
                if (teamId === 100) objectives.dragons.team100++;
                else objectives.dragons.team200++;
            } else if (type === "BARON_NASHOR") {
                if (teamId === 100) objectives.barons.team100++;
                else objectives.barons.team200++;
            } else if (type === "HORDE") {
                if (teamId === 100) objectives.grubs.team100++;
                else objectives.grubs.team200++;
            } else if (type === "RIFTHERALD") {
                if (teamId === 100) objectives.heralds.team100++;
                else objectives.heralds.team200++;
            }
        }
    }

    return { kda, teamKills, objectives };
}

export function applyTimelineCombatSummaryToRefs(
    summary: TimelineCombatSummary,
    participants: Participant[],
    refs: TimelineCombatRefs,
): void {
    participants.forEach((participant, index) => {
        const kdaEl = refs.kdaRefs[index];
        const stats = summary.kda[participant.participantId - 1];
        if (kdaEl && stats) {
            kdaEl.textContent = `${stats.k} / ${stats.d} / ${stats.a}`;
        }
    });

    if (refs.team100KillsText) refs.team100KillsText.textContent = `${summary.teamKills.team100}`;
    if (refs.team200KillsText) refs.team200KillsText.textContent = `${summary.teamKills.team200}`;

    if (refs.team100TowerText) refs.team100TowerText.textContent = `${summary.objectives.towers.team100}`;
    if (refs.team200TowerText) refs.team200TowerText.textContent = `${summary.objectives.towers.team200}`;
    if (refs.team100DragonText) refs.team100DragonText.textContent = `${summary.objectives.dragons.team100}`;
    if (refs.team200DragonText) refs.team200DragonText.textContent = `${summary.objectives.dragons.team200}`;
    if (refs.team100BaronText) refs.team100BaronText.textContent = `${summary.objectives.barons.team100}`;
    if (refs.team200BaronText) refs.team200BaronText.textContent = `${summary.objectives.barons.team200}`;
    if (refs.team100VoidgrubText) refs.team100VoidgrubText.textContent = `${summary.objectives.grubs.team100}`;
    if (refs.team200VoidgrubText) refs.team200VoidgrubText.textContent = `${summary.objectives.grubs.team200}`;
    if (refs.team100HeraldText) refs.team100HeraldText.textContent = `${summary.objectives.heralds.team100}`;
    if (refs.team200HeraldText) refs.team200HeraldText.textContent = `${summary.objectives.heralds.team200}`;
}
