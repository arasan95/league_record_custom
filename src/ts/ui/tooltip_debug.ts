export const isTooltipPerfDebugEnabled = (): boolean => {
    try {
        return localStorage.getItem("tooltipPerfDebug") === "1";
    } catch {
        return false;
    }
};
