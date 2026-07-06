import { getBridge } from "./bridge";

export const sep = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows") ? "\\" : "/";

export async function join(...parts: string[]): Promise<string> {
    const bridge = getBridge();
    if (bridge) return bridge.path.join(...parts);
    return (await import("@tauri-apps/api/path")).join(...parts);
}

export async function appLocalDataDir(): Promise<string> {
    const bridge = getBridge();
    if (bridge) return bridge.path.appLocalDataDir();
    return (await import("@tauri-apps/api/path")).appLocalDataDir();
}
