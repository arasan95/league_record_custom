export type BaseDir = "AppLocalData" | "AppData";

export type LeagueRecordBridge = {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<any>;
    event: {
        listen: (name: string, cb: (event: { payload: any }) => void) => Promise<() => void>;
        once: (name: string, cb: (event: { payload: any }) => void) => Promise<() => void>;
        emit: (name: string, payload?: any) => Promise<void>;
    };
    window: {
        minimize: () => void;
        maximize: () => void;
        unmaximize: () => void;
        isMaximized: () => Promise<boolean>;
        close: () => void;
        show: () => void;
        setFocus: () => void;
        unminimize: () => void;
        setFullscreen: (value: boolean) => void;
    };
    path: {
        join: (...parts: string[]) => Promise<string>;
        appLocalDataDir: () => Promise<string>;
        sep: string;
    };
    fs: {
        exists: (path: string, options?: { baseDir?: BaseDir }) => Promise<boolean>;
        mkdir: (path: string, options?: { baseDir?: BaseDir; recursive?: boolean }) => Promise<void>;
        readFile: (path: string, options?: { baseDir?: BaseDir }) => Promise<Uint8Array>;
        writeFile: (path: string, data: Uint8Array, options?: { baseDir?: BaseDir }) => Promise<void>;
    };
    shell: {
        open: (url: string) => Promise<void>;
    };
    drag: {
        startDrag: (options: { item: string[]; icon?: string; mode?: "copy" | "move" | "link" }) => Promise<void>;
    };
    clipboard: {
        writeText: (text: string) => Promise<void>;
    };
    app: {
        getVersion: () => Promise<string>;
    };
    updater: {
        check: () => Promise<any>;
    };
    process: {
        relaunch: () => Promise<void>;
    };
};

declare global {
    interface Window {
        leagueRecord?: LeagueRecordBridge;
    }
}

export function getBridge(): LeagueRecordBridge | null {
    if (typeof window === "undefined") return null;
    return window.leagueRecord ?? null;
}
