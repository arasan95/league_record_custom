export type KeyCombo = {
    key: string;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
};

export type ActionName = 
    | "playPause"
    | "seekForward"
    | "seekBackward"
    | "nextEvent"
    | "prevEvent"
    | "volUp"
    | "volDown"
    | "fullscreen"
    | "mute"
    | "speedUp"
    | "speedDown"
    | "setLoopA"
    | "setLoopB"
    | "toggleLoop"
    | "exitFullscreen"
    | "stepForward"
    | "stepBackward"
    | "resetSpeed"
    | "nextVideo"
    | "prevVideo";

export type KeybindMap = Record<ActionName, KeyCombo | null>;

export const DEFAULT_KEYBINDS: KeybindMap = {
    playPause: { key: " ", shift: false, ctrl: false, alt: false, meta: false }, // Space
    seekForward: { key: "ArrowRight", shift: false, ctrl: false, alt: false, meta: false },
    seekBackward: { key: "ArrowLeft", shift: false, ctrl: false, alt: false, meta: false },
    nextEvent: { key: "ArrowRight", shift: true, ctrl: false, alt: false, meta: false },
    prevEvent: { key: "ArrowLeft", shift: true, ctrl: false, alt: false, meta: false },
    volUp: { key: "ArrowUp", shift: false, ctrl: false, alt: false, meta: false },
    volDown: { key: "ArrowDown", shift: false, ctrl: false, alt: false, meta: false },
    fullscreen: { key: "f", shift: false, ctrl: false, alt: false, meta: false },
    mute: { key: "m", shift: false, ctrl: false, alt: false, meta: false },
    speedUp: { key: ">", shift: false, ctrl: false, alt: false, meta: false },
    speedDown: { key: "<", shift: false, ctrl: false, alt: false, meta: false },
    setLoopA: { key: "a", shift: false, ctrl: false, alt: false, meta: false },
    setLoopB: { key: "b", shift: false, ctrl: false, alt: false, meta: false },
    toggleLoop: { key: "l", shift: false, ctrl: false, alt: false, meta: false },
    exitFullscreen: { key: "Escape", shift: false, ctrl: false, alt: false, meta: false },
    stepForward: { key: ".", shift: false, ctrl: false, alt: false, meta: false },
    stepBackward: { key: ",", shift: false, ctrl: false, alt: false, meta: false },
    resetSpeed: { key: "Backspace", shift: false, ctrl: false, alt: false, meta: false },
    nextVideo: { key: "n", shift: true, ctrl: false, alt: false, meta: false },
    prevVideo: { key: "p", shift: true, ctrl: false, alt: false, meta: false },
};

const STORAGE_KEY = "app_keybinds";

export function loadKeybinds(): KeybindMap {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            // Merge usage: if new actions are added in future, defaults cover them
            // Note: explicit nulls from storage should NOT be overwritten by defaults if we want to persist unbinds.
            // But standard merge { ...default, ...stored } works: if stored has "key": null, it overrides default.
            return { ...DEFAULT_KEYBINDS, ...JSON.parse(stored) };
        } catch (e) {
            console.error("Failed to parse keybinds", e);
        }
    }
    return { ...DEFAULT_KEYBINDS };
}

export function saveKeybinds(binds: KeybindMap) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(binds));
}

export function isAction(event: KeyboardEvent, action: ActionName, currentBinds: KeybindMap): boolean {
    const bind = currentBinds[action];
    if (!bind) return false;
    
    // Special handling for "Space" usually showing as " "
    const eventKey = event.key === "Spacebar" ? " " : event.key;
    const bindKey = bind.key === "Spacebar" ? " " : bind.key;

    // Case insensitive for letters
    const keysMatch = eventKey.length === 1 && bindKey.length === 1 
        ? eventKey.toLowerCase() === bindKey.toLowerCase()
        : eventKey === bindKey;

    return keysMatch &&
           event.shiftKey === bind.shift &&
           event.ctrlKey === bind.ctrl &&
           event.altKey === bind.alt &&
           event.metaKey === bind.meta;
}

export function formatKeyCombo(combo: KeyCombo | null | undefined): string {
    if (!combo) return "None";

    const parts = [];
    if (combo.ctrl) parts.push("Ctrl");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");
    if (combo.meta) parts.push("Meta");
    
    let keyDisplay = combo.key;
    if (keyDisplay === " ") keyDisplay = "Space";
    
    parts.push(keyDisplay);
    return parts.join(" + ");
}

export function keyComboToBackendString(combo: KeyCombo | null | undefined): string | null {
    if (!combo) return null;

    const parts = [];
    if (combo.ctrl) parts.push("Ctrl");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");
    if (combo.meta) parts.push("Meta");
    
    let key = combo.key;
    if (key === " ") key = "Space";
    // Uppercase single letters for consistency
    if (key.length === 1) key = key.toUpperCase();
    
    parts.push(key);
    return parts.join("+");
}

export type MouseConfig = {
    wheelAction: "speed" | "none";
    middleClickAction: "resetSpeed" | "none";
    sideButtonSeek: boolean;
};

export const DEFAULT_MOUSE_CONFIG: MouseConfig = {
    wheelAction: "none",
    middleClickAction: "none",
    sideButtonSeek: true
};

const MOUSE_STORAGE_KEY = "app_mouse_config";

export function loadMouseConfig(): MouseConfig {
    const stored = localStorage.getItem(MOUSE_STORAGE_KEY);
    if (stored) {
        try {
            return { ...DEFAULT_MOUSE_CONFIG, ...JSON.parse(stored) };
        } catch (e) {
            console.error("Failed to parse mouse config", e);
        }
    }
    return { ...DEFAULT_MOUSE_CONFIG };
}

export function saveMouseConfig(config: MouseConfig) {
    localStorage.setItem(MOUSE_STORAGE_KEY, JSON.stringify(config));
}
