export function applyCompactLabelsClass(thresholdPhysicalWidth = 1200): void {
    const dpr = window.devicePixelRatio || 1;
    const physicalWidth = window.innerWidth * dpr;
    if (physicalWidth < thresholdPhysicalWidth) {
        document.body.classList.add("compact-labels");
    } else {
        document.body.classList.remove("compact-labels");
    }
}

