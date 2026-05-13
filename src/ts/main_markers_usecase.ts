import type { GameEvent, MarkerFlags, Participant, TftRoundMarker } from "./bindings";
import type { MarkerOptions } from "@fffffffxxxxxxx/videojs-markers";

export type RecordingEvents = {
    participantId: number;
    recordingOffset: number;
    events: Array<GameEvent>;
    participants?: Array<Participant>;
};

export type HighlightEvents = {
    recordingOffset: number;
    events: Array<number>;
};

export type TftRoundEvents = {
    recordingOffset: number;
    events: Array<TftRoundMarker>;
};

export type EventType =
    | "Kill"
    | "Death"
    | "Assist"
    | "Turret"
    | "Inhibitor"
    | "Voidgrub"
    | "Herald"
    | "Baron"
    | "Infernal-Dragon"
    | "Ocean-Dragon"
    | "Mountain-Dragon"
    | "Cloud-Dragon"
    | "Hextech-Dragon"
    | "Chemtech-Dragon"
    | "Elder-Dragon"
    | "Highlight"
    | "TFT-Round";

type MarkerLane = "blue" | "red" | "self";
type ChampionKillMarkerType = "Kill" | "Death" | "Assist";
type OtherMarkerType = Exclude<EventType, ChampionKillMarkerType> | "Highlight";
type TeamId = 100 | 200;

export type MarkerDetail =
    | {
        id: number;
        kind: "ChampionKill";
        markerType: ChampionKillMarkerType;
        lane: MarkerLane;
        timestampMs: number;
        killerParticipantId: number;
        victimParticipantId: number;
        assistingParticipantIds: number[];
    }
    | {
        id: number;
        kind: "Other";
        markerType: OtherMarkerType;
        lane: MarkerLane;
        timestampMs: number;
        label: string;
    };

export type BuiltMarkers = {
    markers: MarkerOptions[];
    details: Array<MarkerDetail | undefined>;
};

export function markerEventName(
    gameEvent: GameEvent,
    participantId: number,
    checkbox: MarkerFlags | null,
): EventType | null {
    if ("ChampionKill" in gameEvent) {
        if ((checkbox?.kill ?? true) && gameEvent.ChampionKill.killer_id === participantId) return "Kill";
        if ((checkbox?.assist ?? true) && gameEvent.ChampionKill.assisting_participant_ids.includes(participantId)) {
            return "Assist";
        }
        if ((checkbox?.death ?? true) && gameEvent.ChampionKill.victim_id === participantId) return "Death";
    }
    return null;
}

function normalizeTeamId(teamId: number | string | null | undefined): TeamId | 0 {
    if (teamId === null || teamId === undefined) return 0;
    if (typeof teamId === "number") {
        if (teamId === 100) return 100;
        if (teamId === 200) return 200;
        return 0;
    }
    const normalized = teamId.toUpperCase().trim();
    if (normalized === "100" || normalized === "BLUE" || normalized === "ORDER") return 100;
    if (normalized === "200" || normalized === "RED" || normalized === "CHAOS") return 200;
    return 0;
}

function inferTeamIdFromParticipantId(participantId: number): TeamId | 0 {
    if (participantId >= 1 && participantId <= 5) return 100;
    if (participantId >= 6 && participantId <= 10) return 200;
    return 0;
}

function buildParticipantTeamMap(participants?: Array<Pick<Participant, "participantId" | "teamId">>): Map<number, TeamId> {
    const map = new Map<number, TeamId>();
    if (!participants) return map;
    for (const participant of participants) {
        const teamId = normalizeTeamId(participant.teamId);
        if (teamId !== 0) {
            map.set(participant.participantId, teamId);
        }
    }
    return map;
}

function resolveParticipantTeamId(participantId: number, participantTeamMap: Map<number, TeamId>): TeamId | 0 {
    return participantTeamMap.get(participantId) ?? inferTeamIdFromParticipantId(participantId);
}

function resolveBuildingKillerTeamId(
    gameEvent: Extract<GameEvent, { BuildingKill: any }>,
    participantTeamMap: Map<number, TeamId>,
): TeamId | 0 {
    const killerTeamId = resolveParticipantTeamId(gameEvent.BuildingKill.killer_id, participantTeamMap);
    if (killerTeamId !== 0) return killerTeamId;

    for (const assistantId of gameEvent.BuildingKill.assisting_participant_ids) {
        const assistTeamId = resolveParticipantTeamId(assistantId, participantTeamMap);
        if (assistTeamId !== 0) return assistTeamId;
    }

    const victimTeamId = normalizeTeamId(gameEvent.BuildingKill.team_id as unknown as number | string);
    if (victimTeamId === 100) return 200;
    if (victimTeamId === 200) return 100;
    return 0;
}

function resolveEliteKillerTeamId(
    gameEvent: Extract<GameEvent, { EliteMonsterKill: any }>,
    participantTeamMap: Map<number, TeamId>,
): TeamId | 0 {
    const killerTeamId = resolveParticipantTeamId(gameEvent.EliteMonsterKill.killer_id, participantTeamMap);
    if (killerTeamId !== 0) return killerTeamId;
    for (const assistantId of gameEvent.EliteMonsterKill.assisting_participant_ids) {
        const assistTeamId = resolveParticipantTeamId(assistantId, participantTeamMap);
        if (assistTeamId !== 0) return assistTeamId;
    }
    return 0;
}

function teamLaneById(teamId: TeamId): Exclude<MarkerLane, "self"> {
    return teamId === 100 ? "blue" : "red";
}

function resolveTeamLaneMarker(
    gameEvent: GameEvent,
    checkbox: MarkerFlags | null,
    participantTeamMap: Map<number, TeamId>,
): { lane: Exclude<MarkerLane, "self">; type: ChampionKillMarkerType | OtherMarkerType } | null {
    if ("ChampionKill" in gameEvent) {
        if (!(checkbox?.kill ?? true)) return null;
        const teamId = resolveParticipantTeamId(gameEvent.ChampionKill.killer_id, participantTeamMap);
        if (teamId === 0) return null;
        return { lane: teamLaneById(teamId), type: "Kill" };
    }

    if ("BuildingKill" in gameEvent) {
        if (!(checkbox?.structure ?? true)) return null;
        if (gameEvent.BuildingKill.building_type.buildingType !== "TOWER_BUILDING") return null;

        const teamId = resolveBuildingKillerTeamId(gameEvent, participantTeamMap);
        if (teamId === 0) return null;
        return { lane: teamLaneById(teamId), type: "Turret" };
    }

    if (!("EliteMonsterKill" in gameEvent)) {
        return null;
    }

    const teamId = resolveEliteKillerTeamId(gameEvent, participantTeamMap);
    if (teamId === 0) return null;

    const monsterType = gameEvent.EliteMonsterKill.monster_type;
    if ((checkbox?.voidgrub ?? true) && monsterType.monsterType === "HORDE" && gameEvent.EliteMonsterKill.killer_id > 0) {
        return { lane: teamLaneById(teamId), type: "Voidgrub" };
    }
    if ((checkbox?.herald ?? true) && monsterType.monsterType === "RIFTHERALD") {
        return { lane: teamLaneById(teamId), type: "Herald" };
    }
    if ((checkbox?.baron ?? true) && monsterType.monsterType === "BARON_NASHOR") {
        return { lane: teamLaneById(teamId), type: "Baron" };
    }
    if ((checkbox?.dragon ?? true) && monsterType.monsterType === "DRAGON") {
        switch (monsterType.monsterSubType) {
            case "FIRE_DRAGON":
                return { lane: teamLaneById(teamId), type: "Infernal-Dragon" };
            case "EARTH_DRAGON":
                return { lane: teamLaneById(teamId), type: "Mountain-Dragon" };
            case "WATER_DRAGON":
                return { lane: teamLaneById(teamId), type: "Ocean-Dragon" };
            case "AIR_DRAGON":
                return { lane: teamLaneById(teamId), type: "Cloud-Dragon" };
            case "HEXTECH_DRAGON":
                return { lane: teamLaneById(teamId), type: "Hextech-Dragon" };
            case "CHEMTECH_DRAGON":
                return { lane: teamLaneById(teamId), type: "Chemtech-Dragon" };
            case "ELDER_DRAGON":
                return { lane: teamLaneById(teamId), type: "Elder-Dragon" };
            default:
                return null;
        }
    }

    return null;
}

function resolveSelfObjectiveMarker(
    gameEvent: GameEvent,
    participantId: number,
    checkbox: MarkerFlags | null,
): OtherMarkerType | null {
    if ("BuildingKill" in gameEvent) {
        if (!(checkbox?.structure ?? true)) return null;
        if (gameEvent.BuildingKill.building_type.buildingType !== "TOWER_BUILDING") return null;

        const involved = gameEvent.BuildingKill.killer_id === participantId ||
            gameEvent.BuildingKill.assisting_participant_ids.includes(participantId);
        return involved ? "Turret" : null;
    }

    if (!("EliteMonsterKill" in gameEvent)) {
        return null;
    }

    const involved = gameEvent.EliteMonsterKill.killer_id === participantId ||
        gameEvent.EliteMonsterKill.assisting_participant_ids.includes(participantId);
    if (!involved) return null;

    const monsterType = gameEvent.EliteMonsterKill.monster_type;
    if ((checkbox?.voidgrub ?? true) && monsterType.monsterType === "HORDE" && gameEvent.EliteMonsterKill.killer_id > 0) {
        return "Voidgrub";
    }
    if ((checkbox?.herald ?? true) && monsterType.monsterType === "RIFTHERALD") {
        return "Herald";
    }
    if ((checkbox?.baron ?? true) && monsterType.monsterType === "BARON_NASHOR") {
        return "Baron";
    }
    if ((checkbox?.dragon ?? true) && monsterType.monsterType === "DRAGON") {
        switch (monsterType.monsterSubType) {
            case "FIRE_DRAGON":
                return "Infernal-Dragon";
            case "EARTH_DRAGON":
                return "Mountain-Dragon";
            case "WATER_DRAGON":
                return "Ocean-Dragon";
            case "AIR_DRAGON":
                return "Cloud-Dragon";
            case "HEXTECH_DRAGON":
                return "Hextech-Dragon";
            case "CHEMTECH_DRAGON":
                return "Chemtech-Dragon";
            case "ELDER_DRAGON":
                return "Elder-Dragon";
            default:
                return null;
        }
    }

    return null;
}

function createMarker(
    timestamp: number,
    recordingOffset: number,
    eventType: EventType,
    lane: MarkerLane,
    eventDelay: number,
    detailId?: number,
): MarkerOptions {
    const laneLabel = lane === "self" ? "" : lane === "blue" ? "Blue " : "Red ";
    const detailClass = typeof detailId === "number" ? ` lr-ev-${detailId}` : "";
    return {
        time: timestamp / 1000 - recordingOffset - eventDelay,
        text: `${laneLabel}${eventType}`,
        class: `${eventType.toLowerCase()} lane-${lane} ${lane === "self" ? "self-marker" : "team-marker"}${detailClass}`,
        duration: 2 * eventDelay,
    };
}

export function buildMarkers(
    currentEvents: RecordingEvents | null,
    highlightEvents: HighlightEvents | null,
    tftRoundEvents: TftRoundEvents | null,
    markerFlags: MarkerFlags | null,
    eventDelay: number,
): BuiltMarkers {
    const markers: MarkerOptions[] = [];
    const details: Array<MarkerDetail | undefined> = [];
    let nextDetailId = 0;

    const pushChampionKillMarker = (
        event: Extract<GameEvent, { ChampionKill: any }>,
        recordingOffset: number,
        markerType: ChampionKillMarkerType,
        lane: MarkerLane,
    ) => {
        const id = nextDetailId++;
        markers.push(createMarker(event.timestamp, recordingOffset, markerType, lane, eventDelay, id));
        details[id] = {
            id,
            kind: "ChampionKill",
            markerType,
            lane,
            timestampMs: event.timestamp,
            killerParticipantId: event.ChampionKill.killer_id,
            victimParticipantId: event.ChampionKill.victim_id,
            assistingParticipantIds: event.ChampionKill.assisting_participant_ids,
        };
    };

    const pushOtherMarker = (
        timestampMs: number,
        recordingOffset: number,
        markerType: OtherMarkerType,
        lane: MarkerLane,
        label: string,
    ) => {
        const id = nextDetailId++;
        markers.push(createMarker(timestampMs, recordingOffset, markerType as EventType, lane, eventDelay, id));
        details[id] = {
            id,
            kind: "Other",
            markerType,
            lane,
            timestampMs,
            label,
        };
    };

    const formatLane = (laneType: any): string => {
        switch (laneType) {
            case "TOP_LANE":
                return "Top";
            case "MID_LANE":
                return "Mid";
            case "BOT_LANE":
                return "Bot";
            default:
                return "Unknown";
        }
    };

    const formatTeam = (teamIdRaw: any): string => {
        const teamId = normalizeTeamId(teamIdRaw as any);
        if (teamId === 100) return "Blue";
        if (teamId === 200) return "Red";
        return "";
    };

    const formatTowerType = (towerType: any): string => {
        switch (towerType) {
            case "OUTER_TURRET":
                return "Outer";
            case "INNER_TURRET":
                return "Inner";
            case "BASE_TURRET":
                return "Base";
            case "NEXUS_TURRET":
                return "Nexus";
            default:
                return "Tower";
        }
    };

    const buildTowerLabel = (event: Extract<GameEvent, { BuildingKill: any }>): string => {
        const team = formatTeam(event.BuildingKill.team_id);
        const bt: any = event.BuildingKill.building_type as any;
        const lane = formatLane(bt?.lane_type ?? bt?.laneType);
        const tier = formatTowerType(bt?.tower_type ?? bt?.towerType);
        const parts = [team, lane, tier, "Tower"].filter(Boolean);
        return parts.join(" ");
    };

    if (highlightEvents !== null) {
        for (const event of highlightEvents.events) {
            pushOtherMarker(event, highlightEvents.recordingOffset, "Highlight", "self", "Highlight");
        }
    }
    if (tftRoundEvents !== null) {
        for (const event of tftRoundEvents.events) {
            pushOtherMarker(event.timestamp, tftRoundEvents.recordingOffset, "TFT-Round", "self", event.round);
        }
    }
    if (currentEvents !== null) {
        const { participantId, recordingOffset } = currentEvents;
        const participantTeamMap = buildParticipantTeamMap(currentEvents.participants);

        for (const event of currentEvents.events) {
            const name = markerEventName(event, participantId, markerFlags);
            if (name !== null && "ChampionKill" in event) {
                pushChampionKillMarker(event, recordingOffset, name as ChampionKillMarkerType, "self");
            } else if (name !== null) {
                // Defensive fallback: markerEventName currently only returns K/D/A (ChampionKill).
                pushOtherMarker(event.timestamp, recordingOffset, name as any, "self", name);
            }

            const selfObjective = resolveSelfObjectiveMarker(event, participantId, markerFlags);
            if (selfObjective !== null) {
                if ("BuildingKill" in event && selfObjective === "Turret") {
                    pushOtherMarker(event.timestamp, recordingOffset, selfObjective, "self", buildTowerLabel(event));
                } else {
                    pushOtherMarker(event.timestamp, recordingOffset, selfObjective, "self", selfObjective);
                }
            }

            const teamLaneMarker = resolveTeamLaneMarker(event, markerFlags, participantTeamMap);
            if (teamLaneMarker !== null) {
                if ("ChampionKill" in event && teamLaneMarker.type === "Kill") {
                    pushChampionKillMarker(event, recordingOffset, "Kill", teamLaneMarker.lane);
                } else {
                    if ("BuildingKill" in event && teamLaneMarker.type === "Turret") {
                        pushOtherMarker(event.timestamp, recordingOffset, teamLaneMarker.type, teamLaneMarker.lane, buildTowerLabel(event));
                    } else {
                        const markerType = teamLaneMarker.type as OtherMarkerType;
                        pushOtherMarker(event.timestamp, recordingOffset, markerType, teamLaneMarker.lane, markerType);
                    }
                }
            }
        }
    }
    return { markers, details };
}
