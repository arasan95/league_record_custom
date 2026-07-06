import { getBridge } from "./bridge";

export async function check(): Promise<any> {
    const bridge = getBridge();
    if (!bridge) return (await import("@tauri-apps/plugin-updater")).check();
    return bridge.updater.check();
}
