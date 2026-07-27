export const COMMUNITY_PUBLIC_ID_LENGTH = 10;
export const COMMUNITY_ACCOUNT_NAME_MAX_LENGTH = 32;

export interface CommunityRiotAccount {
    puuid: string;
    gameName: string;
    tagLine: string;
    platformId: string;
    soloRank: string;
    flexRank: string;
    primaryRank: string;
    verifiedAtMs: number;
}

export interface CommunityAccountProfile {
    uid: string;
    publicId: string;
    accountName: string | null;
    riotAccount: CommunityRiotAccount | null;
    createdAtMs: number;
    updatedAtMs: number;
}

const PUBLIC_ID = new RegExp(`^[A-Za-z0-9]{${COMMUNITY_PUBLIC_ID_LENGTH}}$`, "u");
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const RIOT_PUUID = /^[A-Za-z0-9_-]{20,128}$/u;
const RIOT_PLATFORM = /^[A-Z0-9]{2,12}$/u;
const RIOT_RANK = /^(?:UNRANKED|IRON|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|MASTER|GRANDMASTER|CHALLENGER)(?: (?:I|II|III|IV))?$/u;

export function isCommunityPublicId(value: unknown): value is string {
    return typeof value === "string" && PUBLIC_ID.test(value);
}

export function normalizeCommunityAccountName(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new Error("アカウント名が不正です。");
    const normalized = value.trim();
    if (!normalized) return null;
    const hasControlCharacter = Array.from(normalized).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 31 || code === 127;
    });
    if (normalized.length > COMMUNITY_ACCOUNT_NAME_MAX_LENGTH || BIDI_CONTROL.test(normalized) || hasControlCharacter) {
        throw new Error(`アカウント名は${COMMUNITY_ACCOUNT_NAME_MAX_LENGTH}文字以内で入力してください。`);
    }
    return normalized;
}

export function createCommunityPublicId(): string {
    const random = crypto.getRandomValues(new Uint8Array(COMMUNITY_PUBLIC_ID_LENGTH));
    return Array.from(random, (value) => ID_ALPHABET[value % ID_ALPHABET.length]).join("");
}

export function normalizeCommunityRiotAccount(value: unknown): CommunityRiotAccount | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("LoLアカウント情報が不正です。");
    const data = value as Record<string, unknown>;
    const puuid = typeof data.puuid === "string" ? data.puuid.trim() : "";
    const gameName = typeof data.gameName === "string" ? data.gameName.trim() : "";
    const tagLine = typeof data.tagLine === "string" ? data.tagLine.trim() : "";
    const platformId = typeof data.platformId === "string" ? data.platformId.trim().toUpperCase() : "";
    const soloRank = typeof data.soloRank === "string" ? data.soloRank.trim().toUpperCase() : "";
    const flexRank = typeof data.flexRank === "string" ? data.flexRank.trim().toUpperCase() : "";
    const primaryRank = typeof data.primaryRank === "string" ? data.primaryRank.trim().toUpperCase() : "";
    const verifiedAtMs = typeof data.verifiedAtMs === "number"
        ? data.verifiedAtMs
        : (data.verifiedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    if (!RIOT_PUUID.test(puuid)
        || !gameName || gameName.length > 32
        || tagLine.length > 16
        || !RIOT_PLATFORM.test(platformId)
        || !RIOT_RANK.test(soloRank)
        || !RIOT_RANK.test(flexRank)
        || !RIOT_RANK.test(primaryRank)
        || !Number.isFinite(verifiedAtMs) || verifiedAtMs <= 0) {
        throw new Error("LoLアカウント情報が不正です。");
    }
    return { puuid, gameName, tagLine, platformId, soloRank, flexRank, primaryRank, verifiedAtMs };
}

export function communityDisplayName(profile: Pick<CommunityAccountProfile, "publicId" | "accountName">): string {
    return profile.accountName || profile.publicId;
}
