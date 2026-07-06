import { getBridge } from "./bridge";

export async function startDrag(options: { item: string[]; icon?: string; mode?: "copy" | "move" | "link" }): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@crabnebula/tauri-plugin-drag")).startDrag(options as any);
        return;
    }
    await bridge.drag.startDrag(options);
}
