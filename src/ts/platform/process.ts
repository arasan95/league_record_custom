import { getBridge } from "./bridge";

export async function relaunch(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@tauri-apps/plugin-process")).relaunch();
        return;
    }
    await bridge.process.relaunch();
}
