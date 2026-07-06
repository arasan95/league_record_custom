import { getBridge, type BaseDir } from "./bridge";

export const BaseDirectory = {
    AppLocalData: "AppLocalData",
    AppData: "AppData",
} as const;

type Options = { baseDir?: BaseDir; recursive?: boolean };

async function toTauriOptions(options?: Options): Promise<any> {
    if (!options?.baseDir) return options;
    const { BaseDirectory: TauriBaseDirectory } = await import("@tauri-apps/plugin-fs");
    const baseDir = options.baseDir === BaseDirectory.AppLocalData
        ? TauriBaseDirectory.AppLocalData
        : TauriBaseDirectory.AppData;
    return { ...options, baseDir };
}

export async function exists(path: string, options?: Options): Promise<boolean> {
    const bridge = getBridge();
    if (!bridge) return (await import("@tauri-apps/plugin-fs")).exists(path, await toTauriOptions(options));
    return bridge.fs.exists(path, options);
}

export async function mkdir(path: string, options?: Options): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@tauri-apps/plugin-fs")).mkdir(path, await toTauriOptions(options));
        return;
    }
    await bridge.fs.mkdir(path, options);
}

export async function readFile(path: string, options?: Options): Promise<Uint8Array> {
    const bridge = getBridge();
    if (!bridge) return (await import("@tauri-apps/plugin-fs")).readFile(path, await toTauriOptions(options));
    return bridge.fs.readFile(path, options);
}

export async function writeFile(path: string, data: Uint8Array, options?: Options): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        await (await import("@tauri-apps/plugin-fs")).writeFile(path, data, await toTauriOptions(options));
        return;
    }
    await bridge.fs.writeFile(path, data, options);
}
