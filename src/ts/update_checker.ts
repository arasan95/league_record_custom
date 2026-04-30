type GitHubRelease = {
    tag_name?: string;
    body?: string | null;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
    published_at?: string | null;
};

export type AvailableUpdate = {
    version: string;
    body: string;
    url: string;
    prerelease: boolean;
    publishedAt: string | null;
};

type ParsedVersion = {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    normalized: string;
};

const RELEASES_API_URL = "https://api.github.com/repos/arasan95/league_record_custom/releases?per_page=20";

function parseVersion(input: string): ParsedVersion | null {
    const trimmed = input.trim().replace(/^v/i, "");
    if (!trimmed) return null;

    const [coreAndPre] = trimmed.split("+", 1);
    const [core, pre = ""] = coreAndPre.split("-", 2);
    const coreParts = core.split(".");
    if (coreParts.length === 0 || coreParts.length > 3) return null;

    const numeric = [0, 0, 0];
    for (let i = 0; i < coreParts.length; i += 1) {
        const num = Number(coreParts[i]);
        if (!Number.isInteger(num) || num < 0) return null;
        numeric[i] = num;
    }

    const prerelease = pre ? pre.split(".").filter((part) => part.length > 0) : [];
    const normalized = `${numeric[0]}.${numeric[1]}.${numeric[2]}${prerelease.length > 0 ? `-${prerelease.join(".")}` : ""}`;
    return {
        major: numeric[0],
        minor: numeric[1],
        patch: numeric[2],
        prerelease,
        normalized,
    };
}

function compareIdentifiers(left: string, right: string): number {
    const leftNum = Number(left);
    const rightNum = Number(right);
    const leftIsNum = Number.isInteger(leftNum) && String(leftNum) === left;
    const rightIsNum = Number.isInteger(rightNum) && String(rightNum) === right;

    if (leftIsNum && rightIsNum) {
        return leftNum - rightNum;
    }
    if (leftIsNum && !rightIsNum) {
        return -1;
    }
    if (!leftIsNum && rightIsNum) {
        return 1;
    }
    return left.localeCompare(right);
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
    if (left.major !== right.major) return left.major - right.major;
    if (left.minor !== right.minor) return left.minor - right.minor;
    if (left.patch !== right.patch) return left.patch - right.patch;

    const leftPre = left.prerelease;
    const rightPre = right.prerelease;

    if (leftPre.length === 0 && rightPre.length === 0) return 0;
    if (leftPre.length === 0) return 1;
    if (rightPre.length === 0) return -1;

    const length = Math.max(leftPre.length, rightPre.length);
    for (let i = 0; i < length; i += 1) {
        const leftPart = leftPre[i];
        const rightPart = rightPre[i];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        const diff = compareIdentifiers(leftPart, rightPart);
        if (diff !== 0) return diff;
    }

    return 0;
}

function normalizeVersionString(input: string): string {
    const parsed = parseVersion(input);
    return parsed ? parsed.normalized : input.trim().replace(/^v/i, "");
}

export async function checkForAppUpdate(currentVersion: string): Promise<AvailableUpdate | null> {
    const includePrerelease = currentVersion.includes("-");
    const current = parseVersion(currentVersion);
    const normalizedCurrent = normalizeVersionString(currentVersion);

    const response = await fetch(RELEASES_API_URL, {
        headers: {
            Accept: "application/vnd.github+json",
        },
    });
    if (!response.ok) {
        throw new Error(`Update API request failed (${response.status})`);
    }

    const releases = (await response.json()) as GitHubRelease[];
    for (const release of releases) {
        if (release.draft) continue;
        if (!includePrerelease && release.prerelease) continue;
        if (!release.tag_name || !release.html_url) continue;

        const next = parseVersion(release.tag_name);
        let hasUpdate = false;
        if (current && next) {
            hasUpdate = compareVersions(next, current) > 0;
        } else {
            hasUpdate = normalizeVersionString(release.tag_name) !== normalizedCurrent;
        }

        if (hasUpdate) {
            return {
                version: normalizeVersionString(release.tag_name),
                body: release.body ?? "No release notes provided.",
                url: release.html_url,
                prerelease: Boolean(release.prerelease),
                publishedAt: release.published_at ?? null,
            };
        }
    }

    return null;
}
