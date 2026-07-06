import { getBridge } from "./bridge";

export function getCurrentWindow() {
    return {
        minimize: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.minimize();
            else await (await import("@tauri-apps/api/window")).getCurrentWindow().minimize();
        },
        maximize: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.maximize();
            else await (await import("@tauri-apps/api/window")).getCurrentWindow().maximize();
        },
        unmaximize: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.unmaximize();
            else await (await import("@tauri-apps/api/window")).getCurrentWindow().unmaximize();
        },
        isMaximized: async () => {
            const bridge = getBridge();
            return bridge ? bridge.window.isMaximized() : (await import("@tauri-apps/api/window")).getCurrentWindow().isMaximized();
        },
        close: async () => {
            const bridge = getBridge();
            if (bridge) bridge.window.close();
            else await (await import("@tauri-apps/api/window")).getCurrentWindow().close();
        },
    };
}
