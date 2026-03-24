import type { MarkerFlags } from "../bindings";

export function setBigPlayButtonVisibility(show: boolean): void {
    const bpb = document.querySelector<HTMLButtonElement>(".vjs-big-play-button");
    if (bpb !== null) {
        bpb.style.display = show ? "block !important" : "none !important";
    }
}

export function applyMarkerFlags(
    settings: MarkerFlags,
    refs: {
        kill: HTMLInputElement;
        death: HTMLInputElement;
        assist: HTMLInputElement;
        structure: HTMLInputElement;
        dragon: HTMLInputElement;
        voidgrub: HTMLInputElement;
        herald: HTMLInputElement;
        baron: HTMLInputElement;
    },
): void {
    refs.kill.checked = settings.kill;
    refs.death.checked = settings.death;
    refs.assist.checked = settings.assist;
    refs.structure.checked = settings.structure;
    refs.dragon.checked = settings.dragon;
    refs.voidgrub.checked = settings.voidgrub;
    refs.herald.checked = settings.herald;
    refs.baron.checked = settings.baron;
}

export function readMarkerFlags(refs: {
    kill: HTMLInputElement;
    death: HTMLInputElement;
    assist: HTMLInputElement;
    structure: HTMLInputElement;
    dragon: HTMLInputElement;
    voidgrub: HTMLInputElement;
    herald: HTMLInputElement;
    baron: HTMLInputElement;
}): MarkerFlags {
    return {
        kill: refs.kill.checked,
        death: refs.death.checked,
        assist: refs.assist.checked,
        structure: refs.structure.checked,
        dragon: refs.dragon.checked,
        voidgrub: refs.voidgrub.checked,
        herald: refs.herald.checked,
        baron: refs.baron.checked,
    };
}

export function setToggleChecked(ref: HTMLInputElement, enabled: boolean): void {
    ref.checked = enabled;
}

export function bindChangeHandler(ref: HTMLInputElement, handler: (e: Event) => void): void {
    ref.addEventListener("change", handler);
}
