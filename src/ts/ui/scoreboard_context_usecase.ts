import type { GameMetadata, Participant } from "../bindings";
import { getGameModeByQueueId, getItemPrice } from "../datadragon";
import { SR_QUEUES } from "../queues";
import {
    calcTeamItemGold,
    calcTeamKills,
    countTeamObjectives,
    sortParticipantsForScoreboard,
} from "./scoreboard_metadata_usecase";

export type ScoreboardContext = {
    team100: any;
    team200: any;
    participants100: Participant[];
    participants200: Participant[];
    sorted100: Participant[];
    sorted200: Participant[];
    isSR: boolean;
    isTFT: boolean;
    headerStats: {
        t100Kills: number;
        t200Kills: number;
        t100Gold: number;
        t200Gold: number;
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
};

export function buildScoreboardContext(input: {
    metadata: GameMetadata;
    events: any[];
    participants: Participant[];
    gameVersion: string;
}): ScoreboardContext {
    const { metadata, events, participants, gameVersion } = input;
    const team100 = metadata.teams.find((t) => t.teamId === 100);
    const team200 = metadata.teams.find((t) => t.teamId === 200);
    const participants100 = metadata.participants.filter((p) => p.teamId === 100);
    const participants200 = metadata.participants.filter((p) => p.teamId === 200);

    const queueName = metadata.queue?.name || "";
    const qId = metadata.queue?.id || 0;
    const sorted100 = sortParticipantsForScoreboard(participants100, events, queueName, qId);
    const sorted200 = sortParticipantsForScoreboard(participants200, events, queueName, qId);

    const t100Kills = calcTeamKills(participants100);
    const t200Kills = calcTeamKills(participants200);
    const t100Gold = calcTeamItemGold(participants100, gameVersion, (itemId, version) => getItemPrice(itemId, version ?? gameVersion));
    const t200Gold = calcTeamItemGold(participants200, gameVersion, (itemId, version) => getItemPrice(itemId, version ?? gameVersion));
    const objectives = countTeamObjectives(events as any, participants);

    const isPractice = metadata.queue?.name?.toLowerCase().includes("practice") ?? false;
    const isSR = SR_QUEUES.includes(metadata.queue.id as any) || isPractice;
    const isTftByQueue = getGameModeByQueueId(metadata.queue?.id ?? 0, metadata.queue?.name ?? "") === "TFT";
    const hasTftParticipantData = metadata.participants.some((p) =>
        p.placement != null
        || p.playersEliminated != null
        || p.level != null
        || (p.traits?.length ?? 0) > 0
        || (p.units?.length ?? 0) > 0
        || p.companion != null
    );
    const isTFT = isTftByQueue || hasTftParticipantData;

    return {
        team100,
        team200,
        participants100,
        participants200,
        sorted100,
        sorted200,
        isSR,
        isTFT,
        headerStats: {
            t100Kills,
            t200Kills,
            t100Gold,
            t200Gold,
            t100Towers: objectives.t100Towers,
            t200Towers: objectives.t200Towers,
            t100Dragons: objectives.t100Dragons,
            t200Dragons: objectives.t200Dragons,
            t100Barons: objectives.t100Barons,
            t200Barons: objectives.t200Barons,
            t100Grubs: objectives.t100Grubs,
            t200Grubs: objectives.t200Grubs,
            t100Heralds: objectives.t100Heralds,
            t200Heralds: objectives.t200Heralds,
        },
    };
}
