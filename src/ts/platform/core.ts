import { getBridge } from "./bridge";

export class Channel<T = unknown> {
    readonly id = "";
    onmessage?: (message: T) => void;
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const bridge = getBridge();
    if (!bridge) return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
    try {
        return await bridge.invoke(command, args) as T;
    } catch (error) {
        if (error instanceof Error) throw error.message;
        throw error;
    }
}

export function convertFileSrc(filePath: string): string {
    if (!filePath) return filePath;
    if (/^https?:/i.test(filePath) || /^file:/i.test(filePath) || /^lr-file:/i.test(filePath)) return filePath;
    if (!getBridge() && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        return (window as any).__TAURI_INTERNALS__.convertFileSrc(filePath);
    }
    if (getBridge()) {
        return toFileUrl(filePath);
    }
    const normalized = filePath.replace(/\\/g, "/");
    const trimmed = normalized.replace(/^\/+/, "");
    return `lr-file:///${encodeURI(trimmed)}`;
}

function encodePathSegments(path: string): string {
    return path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
}

function toFileUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    if (/^\/\//.test(normalized)) {
        const withoutPrefix = normalized.slice(2);
        const slashIndex = withoutPrefix.indexOf("/");
        if (slashIndex === -1) return `file://${encodeURIComponent(withoutPrefix)}`;
        const host = withoutPrefix.slice(0, slashIndex);
        const path = withoutPrefix.slice(slashIndex + 1);
        return `file://${host}/${encodePathSegments(path)}`;
    }
    if (/^[a-zA-Z]:\//.test(normalized)) {
        const drive = normalized.slice(0, 2);
        const rest = normalized.slice(3);
        return `file:///${drive}/${encodePathSegments(rest)}`;
    }
    const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return `file://${encodePathSegments(absolutePath)}`;
}
