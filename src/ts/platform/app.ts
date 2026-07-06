import { getBridge } from "./bridge";

export async function getVersion(): Promise<string> {
    const bridge = getBridge();
    if (!bridge) return (await import("@tauri-apps/api/app")).getVersion();
    return bridge.app.getVersion();
}
