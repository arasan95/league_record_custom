export const COMMUNITY_PUBLIC_ID_LENGTH = 10;
export const COMMUNITY_ACCOUNT_NAME_MAX_LENGTH = 32;

export interface CommunityAccountProfile {
    uid: string;
    publicId: string;
    accountName: string | null;
    createdAtMs: number;
    updatedAtMs: number;
}

const PUBLIC_ID = new RegExp(`^[A-Za-z0-9]{${COMMUNITY_PUBLIC_ID_LENGTH}}$`, "u");
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

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

export function communityDisplayName(profile: Pick<CommunityAccountProfile, "publicId" | "accountName">): string {
    return profile.accountName || profile.publicId;
}
