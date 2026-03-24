import type { GameMetadata, Participant } from "../bindings";
import { matchesQueueSearchTerm } from "./queue_helpers";

type ChampionNameResolver = (championId: number) => string | undefined;

export type SearchFilterQueries = {
    selfQuery: string;
    allyQuery: string;
    enemyQuery: string;
    userQuery: string;
    queueQuery: string;
};

export type SearchFilterDeps = {
    getChampionEnglishNameByIdSync: ChampionNameResolver;
    getChampionLocalizedNameByIdSync: ChampionNameResolver;
};

function splitTerms(input: string): string[] {
    return input
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}

function participantMatchesChampionTerm(
    participant: Participant,
    term: string,
    deps: SearchFilterDeps,
): boolean {
    if (!participant.championId) return false;
    const enName = deps.getChampionEnglishNameByIdSync(participant.championId);
    const locName = deps.getChampionLocalizedNameByIdSync(participant.championId);
    return Boolean(
        (enName && enName.toLowerCase().includes(term)) ||
        (locName && locName.toLowerCase().includes(term)),
    );
}

function allTermsMatchParticipants(
    participants: Participant[],
    terms: string[],
    predicate: (p: Participant, term: string) => boolean,
): boolean {
    for (const term of terms) {
        let matched = false;
        for (const p of participants) {
            if (predicate(p, term)) {
                matched = true;
                break;
            }
        }
        if (!matched) {
            return false;
        }
    }
    return true;
}

export function shouldHideBySearchFilters(
    metadata: GameMetadata,
    queries: SearchFilterQueries,
    deps: SearchFilterDeps,
): boolean {
    if (queries.selfQuery) {
        let matchedSelf = false;
        const champNameLoc = metadata.championName;
        if (champNameLoc && champNameLoc.toLowerCase().includes(queries.selfQuery)) {
            matchedSelf = true;
        } else if (metadata.participantId !== undefined) {
            const myPar = metadata.participants?.find((p) => p.participantId === metadata.participantId);
            if (myPar) {
                matchedSelf = participantMatchesChampionTerm(myPar, queries.selfQuery, deps);
            }
        }
        if (!matchedSelf) {
            return true;
        }
    }

    const myPar = metadata.participants?.find((p) => p.participantId === metadata.participantId);
    const myTeamId = myPar ? myPar.teamId : undefined;

    if (queries.allyQuery) {
        const terms = splitTerms(queries.allyQuery);
        if (
            terms.length > 0 &&
            (!Array.isArray(metadata.participants) ||
                myTeamId === undefined ||
                !allTermsMatchParticipants(
                    metadata.participants,
                    terms,
                    (p, term) =>
                        p.participantId !== metadata.participantId &&
                        p.teamId === myTeamId &&
                        participantMatchesChampionTerm(p, term, deps),
                ))
        ) {
            return true;
        }
    }

    if (queries.enemyQuery) {
        const terms = splitTerms(queries.enemyQuery);
        if (
            terms.length > 0 &&
            (!Array.isArray(metadata.participants) ||
                myTeamId === undefined ||
                !allTermsMatchParticipants(
                    metadata.participants,
                    terms,
                    (p, term) =>
                        p.participantId !== metadata.participantId &&
                        p.teamId !== myTeamId &&
                        participantMatchesChampionTerm(p, term, deps),
                ))
        ) {
            return true;
        }
    }

    if (queries.userQuery) {
        const terms = splitTerms(queries.userQuery);
        if (
            terms.length > 0 &&
            (!Array.isArray(metadata.participants) ||
                !allTermsMatchParticipants(metadata.participants, terms, (p, term) => {
                    const pAny = p as any;
                    const riotId = pAny.riotIdGameName
                        ? `${pAny.riotIdGameName}#${pAny.riotIdTagline}`.toLowerCase()
                        : "";
                    const gameName = pAny.riotIdGameName ? pAny.riotIdGameName.toLowerCase() : "";
                    const summName = p.summonerName ? p.summonerName.toLowerCase() : "";
                    return riotId.includes(term) || gameName.includes(term) || summName.includes(term);
                }))
        ) {
            return true;
        }
    }

    if (queries.queueQuery) {
        const terms = splitTerms(queries.queueQuery);
        if (terms.length > 0) {
            for (const term of terms) {
                if (!matchesQueueSearchTerm(metadata.queue?.id, metadata.queue?.name, term)) {
                    return true;
                }
            }
        }
    }

    return false;
}
