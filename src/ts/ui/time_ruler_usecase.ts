export function renderTimeRuler(duration: number): void {
    const progressControl = document.querySelector(".vjs-progress-holder");
    if (!progressControl) return;

    const existingRuler = progressControl.querySelector(".vjs-ruler-container");
    if (existingRuler) existingRuler.remove();

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

        if (currentSeconds % 60 === 0) {
            tick.classList.add("large");
            const number = document.createElement("div");
            number.className = "vjs-ruler-number";
            number.innerText = `${currentSeconds / 60}`;
            tick.appendChild(number);
        } else {
            tick.classList.add("medium");
        }
        container.appendChild(tick);
    }

    progressControl.appendChild(container);
}

