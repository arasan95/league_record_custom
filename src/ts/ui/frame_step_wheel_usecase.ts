export function bindFrameStepWheelHandler(params: {
    player: any;
    getScrollFrameStepModifier: () => string;
    getFrameDuration: () => number;
    getSeekTarget: () => number | null;
    setSeekTarget: (value: number | null) => void;
    getSeekDebounce: () => any;
    setSeekDebounce: (value: any) => void;
    getSeekRaf: () => number | null;
    setSeekRaf: (value: number | null) => void;
}): void {
    const {
        player,
        getScrollFrameStepModifier,
        getFrameDuration,
        getSeekTarget,
        setSeekTarget,
        getSeekDebounce,
        setSeekDebounce,
        getSeekRaf,
        setSeekRaf,
    } = params;

    if (!player) return;

    player.ready(() => {
        const el = player.el();
        if (!el) return;

        el.addEventListener(
            "wheel",
            (e: WheelEvent) => {
                const tooltipEl = document.querySelector(".league-tooltip") as HTMLElement | null;
                if (tooltipEl && tooltipEl.style.display !== "none") {
                    const r = tooltipEl.getBoundingClientRect();
                    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                        return;
                    }
                }

                const modifier = getScrollFrameStepModifier();
                let isModifierPressed = false;
                if (modifier === "Shift") isModifierPressed = e.shiftKey;
                else if (modifier === "Ctrl") isModifierPressed = e.ctrlKey;
                else if (modifier === "Alt") isModifierPressed = e.altKey;
                else if (modifier === "Meta") isModifierPressed = e.metaKey;
                else if (modifier === "None") isModifierPressed = true;

                if (!isModifierPressed) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                const step = getFrameDuration();
                const direction = e.deltaY > 0 ? -1 : 1;

                if (getSeekTarget() === null) {
                    if (!player.paused()) {
                        player.pause();
                    }
                    setSeekTarget(player.currentTime());
                }

                const currentSeekTarget = getSeekTarget() ?? 0;
                let nextSeekTarget = currentSeekTarget + step * direction;
                if (nextSeekTarget < 0) nextSeekTarget = 0;
                const duration = player.duration();
                if (duration && nextSeekTarget > duration) nextSeekTarget = duration;
                setSeekTarget(nextSeekTarget);

                const seekDebounce = getSeekDebounce();
                if (seekDebounce) clearTimeout(seekDebounce);
                setSeekDebounce(
                    setTimeout(() => {
                        setSeekTarget(null);
                    }, 200),
                );

                if (!getSeekRaf()) {
                    setSeekRaf(
                        requestAnimationFrame(() => {
                            const target = getSeekTarget();
                            if (target !== null) {
                                player.currentTime(target);
                            }
                            setSeekRaf(null);
                        }),
                    );
                }
            },
            { passive: false },
        );
    });
}
