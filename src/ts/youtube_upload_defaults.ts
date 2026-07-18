import type { GameEvent, GameMetadata, Participant } from "./bindings";

export type YouTubeUploadDefaults = {
    title: string;
    description: string;
};

type ChampionNameResolver = (championId: number) => Promise<string | null>;

const TEAM_POSITION_FALLBACKS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;

function fallbackTeamPosition(participant: Participant, participants: Participant[]): string | null {
    const team = participants
        .filter((candidate) => candidate.teamId === participant.teamId)
        .sort((left, right) => left.participantId - right.participantId);
    const index = team.findIndex((candidate) => candidate.participantId === participant.participantId);
    return index >= 0 && index < TEAM_POSITION_FALLBACKS.length ? TEAM_POSITION_FALLBACKS[index] : null;
}

function normalizedLane(participant: Participant, participants: Participant[]): string {
    const lane = String(participant.lane || "").toUpperCase();
    const role = String(participant.role || "").toUpperCase();
    if (lane === "BOTTOM" && role === "CARRY") return "ADC";
    if ((lane === "BOTTOM" && role === "SUPPORT") || lane === "UTILITY") return "SUPPORT";
    if (lane === "MIDDLE") return "MID";
    if (lane === "JUNGLE") return "JUNGLE";
    if (lane === "TOP") return "TOP";
    // Older League client payloads can report every participant as
    // NONE/SUPPORT. Participant order still follows the five team positions.
    if (!lane || lane === "NONE") return fallbackTeamPosition(participant, participants) || "UNKNOWN ROLE";
    return [lane, role].filter(Boolean).join(" ") || "UNKNOWN ROLE";
}

function findOpponent(self: Participant, participants: Participant[]): Participant | null {
    const enemies = participants.filter((participant) => participant.teamId !== self.teamId);
    const lane = String(self.lane || "").toUpperCase();
    const role = String(self.role || "").toUpperCase();
    return enemies.find((participant) => (
        String(participant.lane || "").toUpperCase() === lane
        && String(participant.role || "").toUpperCase() === role
        && lane !== "NONE"
    )) ?? enemies.find((participant) => normalizedLane(participant, participants) === normalizedLane(self, participants))
        ?? enemies.find((participant) => String(participant.lane || "").toUpperCase() === lane)
        ?? null;
}

function shortPatch(version: string | undefined): string {
    const parts = String(version || "").split(".").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(version || "Unknown");
}

function formatChapterTime(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
        : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function selfEventLabel(event: GameEvent, participantId: number): string | null {
    if ("ChampionKill" in event) {
        if (event.ChampionKill.killer_id === participantId) return "Kill";
        if (event.ChampionKill.victim_id === participantId) return "Death";
        if (event.ChampionKill.assisting_participant_ids.includes(participantId)) return "Assist";
        return null;
    }
    if ("BuildingKill" in event) {
        const involved = event.BuildingKill.killer_id === participantId
            || event.BuildingKill.assisting_participant_ids.includes(participantId);
        return involved && event.BuildingKill.building_type.buildingType === "TOWER_BUILDING" ? "Turret" : null;
    }
    if (!("EliteMonsterKill" in event)) return null;
    const involved = event.EliteMonsterKill.killer_id === participantId
        || event.EliteMonsterKill.assisting_participant_ids.includes(participantId);
    if (!involved) return null;
    const monster = event.EliteMonsterKill.monster_type;
    if (monster.monsterType === "HORDE") return "Voidgrub";
    if (monster.monsterType === "RIFTHERALD") return "Herald";
    if (monster.monsterType === "BARON_NASHOR") return "Baron";
    if (monster.monsterType === "DRAGON") return monster.monsterSubType === "ELDER_DRAGON" ? "Elder Dragon" : "Dragon";
    return null;
}

function buildChapters(metadata: GameMetadata): string[] {
    const chapters = [{ seconds: 0, label: "Start" }];
    const offset = Number(metadata.ingameTimeRecStartOffset || 0);
    for (const event of metadata.events) {
        const label = selfEventLabel(event, metadata.participantId);
        if (!label) continue;
        const seconds = Math.max(0, Math.floor(event.timestamp / 1000 - offset));
        const previous = chapters.at(-1)!;
        // YouTube requires chapters to be at least ten seconds long. Keeping
        // the first event in each interval also avoids unreadable timestamp spam.
        if (seconds < previous.seconds + 10) continue;
        chapters.push({ seconds, label });
    }
    return chapters.map((chapter) => `${formatChapterTime(chapter.seconds)} ${chapter.label}`);
}

export async function buildYouTubeUploadDefaults(
    metadata: GameMetadata,
    resolveChampionName: ChampionNameResolver,
): Promise<YouTubeUploadDefaults> {
    const self = metadata.participants.find((participant) => participant.participantId === metadata.participantId) ?? null;
    if (!self) {
        return { title: metadata.championName.slice(0, 100), description: "" };
    }
    const opponent = findOpponent(self, metadata.participants);
    const names = new Map<number, string>();
    await Promise.all(metadata.participants.map(async (participant) => {
        const resolved = await resolveChampionName(participant.championId).catch(() => null);
        names.set(participant.participantId, resolved || `Champion ${participant.championId}`);
    }));

    const selfChampion = names.get(self.participantId) || metadata.championName || `Champion ${self.championId}`;
    const opponentChampion = opponent ? names.get(opponent.participantId) || `Champion ${opponent.championId}` : "Unknown Opponent";
    const role = normalizedLane(self, metadata.participants);
    const rank = String(self.rank || "Unranked");
    const patch = shortPatch(metadata.gameVersion);
    const title = `${selfChampion} ${role} vs ${opponentChampion} | ${rank} | Patch ${patch}`.slice(0, 100);

    const teamLine = (teamId: number, label: string): string => {
        const champions = metadata.participants
            .filter((participant) => participant.teamId === teamId)
            .sort((left, right) => left.participantId - right.participantId)
            .map((participant) => names.get(participant.participantId) || `Champion ${participant.championId}`);
        return `${label}: ${champions.join(" / ")}`;
    };
    const side = self.teamId === 100 ? "Blue Side" : self.teamId === 200 ? "Red Side" : `Team ${self.teamId}`;
    const description = [
        `Side: ${side}`,
        teamLine(100, "Blue Team"),
        teamLine(200, "Red Team"),
        "",
        "LeagueRecord Electron",
        "#LeagueOfLegends #LoL #LeagueRecord",
        "",
        "Chapters",
        ...buildChapters(metadata),
    ].join("\n").slice(0, 5000);
    return { title, description };
}
