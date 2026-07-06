import { getBridge } from "./bridge";

export type Event<T> = { payload: T };
export type EventCallback<T> = (event: Event<T>) => void;
export type UnlistenFn = () => void;
export const TauriEvent = {
    WINDOW_CLOSE_REQUESTED: "WINDOW_CLOSE_REQUESTED",
} as const;
export type TauriEvent = typeof TauriEvent[keyof typeof TauriEvent];

export async function listen<T>(event: string, callback: EventCallback<T>): Promise<UnlistenFn> {
    const bridge = getBridge();
    if (!bridge) {
        return (await import("@tauri-apps/api/event")).listen(event, callback as any);
    }
    return bridge.event.listen(event, callback as any);
}

export async function once<T>(event: string, callback: EventCallback<T>): Promise<UnlistenFn> {
    const bridge = getBridge();
    if (!bridge) {
        return (await import("@tauri-apps/api/event")).once(event, callback as any);
    }
    return bridge.event.once(event, callback as any);
}

export async function emit<T>(event: string, payload?: T): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@tauri-apps/api/event")).emit(event, payload);
        return;
    }
    await bridge.event.emit(event, payload);
}
