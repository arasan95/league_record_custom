export type ReplayDeepLink = {
    youtubeVideoId: string;
    inviteCode: string;
};

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const INVITE_CODE = /^[0-9a-f]{48}$/u;
const REPLAY_SHARE_PAGE = "https://leaguerecord.web.app/replay/";

export function buildReplayDeepLink(youtubeVideoId: string, inviteCode: string): string {
    if (!YOUTUBE_VIDEO_ID.test(youtubeVideoId)) throw new Error("YouTube動画IDが不正です。");
    const normalizedInvite = inviteCode.trim().toLowerCase();
    if (!INVITE_CODE.test(normalizedInvite)) throw new Error("招待コードが不正です。");
    const url = new URL("leaguerecord://replay");
    url.searchParams.set("v", youtubeVideoId);
    url.searchParams.set("invite", normalizedInvite);
    return url.toString();
}

export function buildReplayShareLink(youtubeVideoId: string, inviteCode: string): string {
    const appLink = new URL(buildReplayDeepLink(youtubeVideoId, inviteCode));
    const url = new URL(REPLAY_SHARE_PAGE);
    url.searchParams.set("v", appLink.searchParams.get("v")!);
    url.searchParams.set("invite", appLink.searchParams.get("invite")!);
    return url.toString();
}

export function parseReplayDeepLink(value: string): ReplayDeepLink {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("共有リンクが不正です。");
    }
    const keys = [...url.searchParams.keys()];
    const youtubeVideoId = url.searchParams.get("v") ?? "";
    const inviteCode = (url.searchParams.get("invite") ?? "").toLowerCase();
    if (url.protocol !== "leaguerecord:" || url.hostname !== "replay"
        || (url.pathname !== "" && url.pathname !== "/") || url.username || url.password || url.port || url.hash
        || keys.length !== 2 || !keys.includes("v") || !keys.includes("invite")
        || !YOUTUBE_VIDEO_ID.test(youtubeVideoId) || !INVITE_CODE.test(inviteCode)) {
        throw new Error("共有リンクが不正です。");
    }
    return { youtubeVideoId, inviteCode };
}
