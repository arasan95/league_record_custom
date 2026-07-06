import { getBridge } from "./bridge";

export async function open(url: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@tauri-apps/plugin-shell")).open(url);
        return;
    }
    await bridge.shell.open(url);
}
