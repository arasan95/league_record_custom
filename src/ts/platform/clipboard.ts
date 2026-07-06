import { getBridge } from "./bridge";

export async function writeText(text: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@tauri-apps/plugin-clipboard-manager")).writeText(text);
        return;
    }
    await bridge.clipboard.writeText(text);
}
