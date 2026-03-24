import type { GameEvent, MarkerFlags } from "./bindings";
import type { MarkerOptions } from "@fffffffxxxxxxx/videojs-markers";
import { UnreachableError } from "./util";

export type RecordingEvents = {
    participantId: number;
    recordingOffset: number;
    events: Array<GameEvent>;
};

export type HighlightEvents = {
    recordingOffset: number;
    events: Array<number>;
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
    | "Highlight";

export function markerEventName(
    gameEvent: GameEvent,
    participantId: number,
    checkbox: MarkerFlags | null,
): EventType | null {
    if ("ChampionKill" in gameEvent) {
        if ((checkbox?.kill ?? true) && gameEvent.ChampionKill.killer_id === participantId) return "Kill";
        if ((checkbox?.assist ?? true) && gameEvent.ChampionKill.assisting_participant_ids.includes(participantId))
            return "Assist";
        if ((checkbox?.death ?? true) && gameEvent.ChampionKill.victim_id === participantId) return "Death";
    } else if ("BuildingKill" in gameEvent) {
        if ((checkbox?.structure ?? true) && gameEvent.BuildingKill.building_type.buildingType === "TOWER_BUILDING")
            return "Turret";
        if ((checkbox?.structure ?? true) && gameEvent.BuildingKill.building_type.buildingType === "INHIBITOR_BUILDING")
            return "Inhibitor";
    } else if ("EliteMonsterKill" in gameEvent) {
        const monsterType = gameEvent.EliteMonsterKill.monster_type;
        if ((checkbox?.voidgrub ?? true) && monsterType.monsterType === "HORDE" && gameEvent.EliteMonsterKill.killer_id > 0)
            return "Voidgrub";
        if ((checkbox?.herald ?? true) && monsterType.monsterType === "RIFTHERALD") return "Herald";
        if ((checkbox?.baron ?? true) && monsterType.monsterType === "BARON_NASHOR") return "Baron";
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
                    throw new UnreachableError(monsterType.monsterSubType);
            }
        }
    }
    return null;
}

function createMarker(timestamp: number, recordingOffset: number, eventType: EventType, eventDelay: number): MarkerOptions {
    return {
        time: timestamp / 1000 - recordingOffset - eventDelay,
        text: eventType,
        class: eventType.toLowerCase(),
        duration: 2 * eventDelay,
    };
}

export function buildMarkers(
    currentEvents: RecordingEvents | null,
    highlightEvents: HighlightEvents | null,
    markerFlags: MarkerFlags | null,
    eventDelay: number,
): MarkerOptions[] {
    const markers: MarkerOptions[] = [];
    if (highlightEvents !== null) {
        for (const event of highlightEvents.events) {
            markers.push(createMarker(event, highlightEvents.recordingOffset, "Highlight", eventDelay));
        }
    }
    if (currentEvents !== null) {
        const { participantId, recordingOffset } = currentEvents;
        for (const event of currentEvents.events) {
            const name = markerEventName(event, participantId, markerFlags);
            if (name !== null) {
                markers.push(createMarker(event.timestamp, recordingOffset, name, eventDelay));
            }
        }
    }
    return markers;
}
