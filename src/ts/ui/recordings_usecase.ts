import type { Recording } from "../bindings";

export type StorageUsageState = {
    clipPct: number;
    starPct: number;
    normPct: number;
    totalPct: number;
    totalText: string;
    maxText: string;
};

export type SidebarStatsSummary = {
    winRateText: string;
    recent20Text: string;
    blueWinRateText: string;
    redWinRateText: string;
    kdaText: string;
    kdaRatioText: string;
};

export function buildStorageUsageState(
    recordings: ReadonlyArray<Recording>,
    recordingsSizeGb: number,
    maxStorageGb: number,
    isFavorite: (metadata: Recording["metadata"]) => boolean,
): StorageUsageState {
    let clipCount = 0;
    let starCount = 0;
    let normCount = 0;
    let totalFiles = recordings.length;

    recordings.forEach((r) => {
        if (r.videoId.includes("_clip")) {
            clipCount++;
        } else if (isFavorite(r.metadata)) {
            starCount++;
        } else {
            normCount++;
        }
    });

    if (totalFiles === 0) totalFiles = 1;

    const clipGb = (clipCount / totalFiles) * recordingsSizeGb;
    const starGb = (starCount / totalFiles) * recordingsSizeGb;
    const normGb = (normCount / totalFiles) * recordingsSizeGb;

    let maxRef = maxStorageGb > 0 ? maxStorageGb : recordingsSizeGb * 1.2;
    if (recordingsSizeGb > maxRef) maxRef = recordingsSizeGb;

    const clipPct = (clipGb / maxRef) * 100;
    const starPct = (starGb / maxRef) * 100;
    const normPct = (normGb / maxRef) * 100;
    const totalPct = Math.min(100, clipPct + starPct + normPct);

    return {
        clipPct,
        starPct,
        normPct,
        totalPct,
        totalText: recordingsSizeGb.toFixed(0),
        maxText: maxStorageGb > 0 ? maxStorageGb.toString() : "∞",
    };
}

export function buildSidebarStatsSummary(
    totalGames: number,
    totalWins: number,
    recent20Wins: boolean[],
    blueGames: number,
    blueWins: number,
    redGames: number,
    redWins: number,
    totalKills: number,
    totalDeaths: number,
    totalAssists: number,
): SidebarStatsSummary {
    if (totalGames <= 0) {
        return {
            winRateText: "0.0% (0W 0L)",
            recent20Text: "0.0% (0W 0L)",
            blueWinRateText: "-%",
            redWinRateText: "-%",
            kdaText: "0.0 / 0.0 / 0.0",
            kdaRatioText: "0.00:1 KDA",
        };
    }

    const winRate = ((totalWins / totalGames) * 100).toFixed(1);
    const recentWins = recent20Wins.filter((w) => w).length;
    const recentRate = ((recentWins / recent20Wins.length) * 100).toFixed(1);
    const blueRate = blueGames > 0 ? `${((blueWins / blueGames) * 100).toFixed(1)}%` : "-%";
    const redRate = redGames > 0 ? `${((redWins / redGames) * 100).toFixed(1)}%` : "-%";
    const avgK = (totalKills / totalGames).toFixed(1);
    const avgD = (totalDeaths / totalGames).toFixed(1);
    const avgA = (totalAssists / totalGames).toFixed(1);
    const kdaRatio = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(2) : "Perfect";

    return {
        winRateText: `${winRate}% (${totalWins}W ${totalGames - totalWins}L)`,
        recent20Text: `${recentRate}% (${recentWins}W ${recent20Wins.length - recentWins}L)`,
        blueWinRateText: blueRate,
        redWinRateText: redRate,
        kdaText: `${avgK} / ${avgD} / ${avgA}`,
        kdaRatioText: `${kdaRatio}:1 KDA`,
    };
}
