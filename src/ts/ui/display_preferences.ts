import type { MarkerColors, MarkerOpacities, Settings } from "../bindings";

export const defaultMarkerColors: MarkerColors = {
    kill: "#2bff00",
    death: "#ff0000",
    assist: "#fbff00",
    structure: "#ffffff",
    dragon: "#00eaff",
    voidgrub: "#ff1493",
    herald: "#ea00ff",
    baron: "#7b00ff",
};

export const defaultMarkerOpacities: MarkerOpacities = {
    // These values match the marker appearance before display settings were
    // introduced: standard markers inherited 40% from `.vjs-marker`.
    kill: 0.4,
    death: 0.4,
    assist: 0.4,
    structure: 0.4,
    dragon: 0.7,
    voidgrub: 0.4,
    herald: 0.4,
    baron: 0.7,
};

export function getMarkerColors(settings: Partial<Settings>): MarkerColors {
    return { ...defaultMarkerColors, ...(settings.markerColors ?? {}) };
}

export function getMarkerOpacities(settings: Partial<Settings>): MarkerOpacities {
    return { ...defaultMarkerOpacities, ...(settings.markerOpacities ?? {}) };
}

export function applyDisplayPreferences(settings: Partial<Settings>): void {
    const colors = getMarkerColors(settings);
    const opacities = getMarkerOpacities(settings);
    const root = document.documentElement;
    for (const [name, color] of Object.entries(colors)) {
        root.style.setProperty(`--marker-color-${name}`, color);
    }
    for (const [name, opacity] of Object.entries(opacities)) {
        root.style.setProperty(`--marker-opacity-${name}`, String(opacity));
    }
    document.body.classList.toggle("hide-honor-votes", settings.showHonorVotes === false);
}
