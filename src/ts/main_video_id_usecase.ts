export function normalizeVideoId(videoId: string): string {
    return videoId
        .replace(/\.(mp4|webm|json)$/i, "")
        .replace(/\\/g, "/")
        .toLowerCase();
}

export function getVideoBaseName(videoId: string): string {
    const normalized = normalizeVideoId(videoId);
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? normalized;
}

export function videoIdsMatch(a: string, b: string): boolean {
    const na = normalizeVideoId(a);
    const nb = normalizeVideoId(b);
    return na === nb || getVideoBaseName(na) === getVideoBaseName(nb);
}

export function toAssetPath(path: string): string {
    // Tauri asset protocol matching is more reliable with forward slashes on Windows.
    return path.replace(/\\/g, "/");
}

export function buildMetadataCandidates(videoId: string): string[] {
    const raw = videoId.trim();
    if (raw.length === 0) return [];
    const noExt = raw.replace(/\.(mp4|json|webm)$/i, "");
    const slash = noExt.replace(/\\/g, "/");
    const backslash = noExt.replace(/\//g, "\\");
    const list = [noExt, slash, backslash, `${noExt}.mp4`, `${slash}.mp4`, `${backslash}.mp4`];
    return [...new Set(list)];
}
