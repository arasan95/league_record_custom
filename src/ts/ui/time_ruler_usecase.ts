const TWO_MINUTE_LABEL_WIDTH_THRESHOLD = 1020;
const THREE_MINUTE_LABEL_WIDTH_THRESHOLD = 620;

export function getTimeRulerLabelIntervalMinutes(width: number): number {
    if (width <= THREE_MINUTE_LABEL_WIDTH_THRESHOLD) return 3;
    if (width <= TWO_MINUTE_LABEL_WIDTH_THRESHOLD) return 2;
    return 1;
}

function renderRuler(progressControl: HTMLElement, duration: number): void {
    const existingRuler = progressControl.querySelector(".vjs-ruler-container");
    if (existingRuler) existingRuler.remove();

    const labelIntervalSeconds = getTimeRulerLabelIntervalMinutes(progressControl.clientWidth) * 60;
    const container = document.createElement("div");
    container.className = "vjs-ruler-container";

    const stepSeconds = 30;
    const steps = Math.floor(duration / stepSeconds);
    for (let i = 0; i <= steps; i++) {
        if (i === 0) continue;
        const tick = document.createElement("div");
        tick.className = "vjs-ruler-tick";
        const currentSeconds = i * stepSeconds;
        const percent = currentSeconds / duration;
        tick.style.left = `${percent * 100}%`;

        if (currentSeconds % labelIntervalSeconds === 0) {
            tick.classList.add("large");
            const number = document.createElement("div");
            number.className = "vjs-ruler-number";
            number.innerText = `${currentSeconds / 60}`;
            tick.appendChild(number);
        } else if (currentSeconds % 60 === 0) {
            tick.classList.add("medium");
        } else {
            tick.classList.add("small");
        }
        container.appendChild(tick);
    }

    progressControl.appendChild(container);
}

export function renderTimeRuler(duration: number): void {
    const progressControl = document.querySelector(".vjs-progress-holder");
    if (!(progressControl instanceof HTMLElement)) return;

    renderRuler(progressControl, duration);

    const previousObserver = (progressControl as typeof progressControl & { lrTimeRulerObserver?: ResizeObserver }).lrTimeRulerObserver;
    previousObserver?.disconnect();

    let animationFrame: number | null = null;
    const observer = new ResizeObserver(() => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(() => {
            animationFrame = null;
            renderRuler(progressControl, duration);
        });
    });
    observer.observe(progressControl);
    (progressControl as typeof progressControl & { lrTimeRulerObserver?: ResizeObserver }).lrTimeRulerObserver = observer;
}
