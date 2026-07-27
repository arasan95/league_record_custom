import { invoke } from "./core";

export interface CurrentLolAccount {
    puuid: string;
    gameName: string;
    tagLine: string;
    platformId: string;
    soloRank: string;
    flexRank: string;
    primaryRank: string;
    verifiedAtMs: number;
}

export function getCurrentLolAccountForLink(): Promise<CurrentLolAccount> {
    return invoke("get_current_lol_account_for_link");
}
