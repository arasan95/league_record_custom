import { emit, listen, once, type EventCallback, type UnlistenFn } from "./event";
import { getBridge } from "./bridge";

export type WebviewWindow = {
    listen: <T>(name: string, cb: EventCallback<T>) => Promise<UnlistenFn>;
    once: <T>(name: string, cb: EventCallback<T>) => Promise<UnlistenFn>;
    emit: <T>(name: string, payload?: T) => Promise<void>;
    isMaximized: () => Promise<boolean>;
    show: () => Promise<void>;
    setFocus: () => Promise<void>;
    unminimize: () => Promise<void>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
};

export function getCurrentWebviewWindow(): WebviewWindow {
    return {
        listen: <T>(name: string, cb: EventCallback<T>) => listen(name, cb),
        once: <T>(name: string, cb: EventCallback<T>) => once(name, cb),
        emit: <T>(name: string, payload?: T) => emit(name, payload),
        isMaximized: async () => {
            const bridge = getBridge();
            return bridge ? bridge.window.isMaximized() : (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().isMaximized();
        },
        show: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.show();
            else await (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().show();
        },
        setFocus: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.setFocus();
            else await (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().setFocus();
        },
        unminimize: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.unminimize();
            else await (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().unminimize();
        },
        setFullscreen: async (fullscreen: boolean) => {
            const bridge = getBridge();
            if (bridge) bridge.window.setFullscreen(fullscreen);
            else await (await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow().setFullscreen(fullscreen);
        },
    };
}
