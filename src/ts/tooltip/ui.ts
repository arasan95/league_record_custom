let globalTooltip: HTMLDivElement | null = null;
let currentTooltipTarget: HTMLElement | null = null;
let globalTooltipObserver: MutationObserver | null = null;
let globalTooltipMoveListener: ((e: MouseEvent) => void) | null = null;
let globalTooltipWheelListener: ((e: WheelEvent) => void) | null = null;
let globalTooltipMouseDownListener: ((e: MouseEvent) => void) | null = null;

export function showGlobalTooltip(target: HTMLElement, html: string) {
    if (!globalTooltip) {
        globalTooltip = document.createElement("div");
        globalTooltip.className = "league-tooltip";
        globalTooltip.style.position = "fixed";
        globalTooltip.style.background = "rgba(10, 20, 30, 0.95)";
        globalTooltip.style.color = "#eee";
        globalTooltip.style.padding = "10px";
        globalTooltip.style.borderRadius = "4px";
        globalTooltip.style.border = "1px solid #c8aa6e";
        globalTooltip.style.zIndex = "999999";
        globalTooltip.style.width = "max-content"; // 画面端での極端な幅縮小を防ぐ
        globalTooltip.style.maxWidth = "min(800px, 90vw)"; // 画面幅に応じて可変
        globalTooltip.style.maxHeight = "80vh";
        globalTooltip.style.fontSize = "16px";
        globalTooltip.style.lineHeight = "1.4";
        globalTooltip.style.overflowY = "auto";
        (globalTooltip.style as any).overscrollBehavior = "contain";
        // Keep tooltip non-interactive so hover ownership stays on icon elements.
        globalTooltip.style.pointerEvents = "none";
        document.body.appendChild(globalTooltip);
    }
    currentTooltipTarget = target;
    globalTooltip.innerHTML = html;
    globalTooltip.style.display = "block";

    const rect = target.getBoundingClientRect();
    const viewportMargin = 10;
    const verticalGap = 10;
    const maxTooltipHeight = Math.max(120, window.innerHeight - viewportMargin * 2);

    // Always allow tooltip to use full viewport height before enabling internal scroll.
    globalTooltip.style.bottom = "";
    globalTooltip.style.overflowY = "auto";
    globalTooltip.style.maxHeight = `${maxTooltipHeight}px`;
    globalTooltip.style.transform = "none";

    // Start centered on target, then clamp.
    globalTooltip.style.left = `${rect.left + rect.width / 2}px`;
    globalTooltip.style.top = `${rect.top}px`;

    requestAnimationFrame(() => {
        if (!globalTooltip) return;
        const tooltipRect = globalTooltip.getBoundingClientRect();

        // Prefer above the cursor/target. If not enough room, pin to top edge and keep max height.
        const preferredTop = rect.top - verticalGap - tooltipRect.height;
        let top = Math.max(viewportMargin, preferredTop);
        const maxTop = window.innerHeight - viewportMargin - tooltipRect.height;
        if (top > maxTop) top = Math.max(viewportMargin, maxTop);

        // Center horizontally; clamp within viewport.
        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        left = Math.max(viewportMargin, Math.min(left, window.innerWidth - viewportMargin - tooltipRect.width));

        globalTooltip.style.left = `${left}px`;
        globalTooltip.style.top = `${top}px`;
    });

    if (globalTooltipObserver) globalTooltipObserver.disconnect();
    const observeRoot = target.parentElement ?? document.body;
    globalTooltipObserver = new MutationObserver(() => {
        if (currentTooltipTarget && !document.contains(currentTooltipTarget)) {
            hideGlobalTooltip();
        }
    });
    globalTooltipObserver.observe(observeRoot, { childList: true, subtree: true });
    if (!globalTooltipMouseDownListener) {
        globalTooltipMouseDownListener = (e: MouseEvent) => {
            if (!currentTooltipTarget) return;
            const targetEl = e.target as HTMLElement | null;
            if (!targetEl) {
                hideGlobalTooltip();
                return;
            }
            if (targetEl === currentTooltipTarget || targetEl.closest?.(".champ-icon") === currentTooltipTarget) {
                return;
            }
            hideGlobalTooltip();
        };
        document.addEventListener("mousedown", globalTooltipMouseDownListener, { capture: true });
    }
    if (!globalTooltipWheelListener) {
        globalTooltipWheelListener = (e: WheelEvent) => {
            if (!globalTooltip || globalTooltip.style.display === "none" || !currentTooltipTarget) return;
            const hovered = (currentTooltipTarget as any).matches?.(":hover");
            if (!hovered) return;
            if (globalTooltip.scrollHeight <= globalTooltip.clientHeight) return;
            globalTooltip.scrollTop += e.deltaY;
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener("wheel", globalTooltipWheelListener, { capture: true, passive: false });
    }
}

export function hideGlobalTooltip() {
    if (globalTooltip) {
        globalTooltip.style.display = "none";
        currentTooltipTarget = null;

        if (globalTooltipObserver) {
            globalTooltipObserver.disconnect();
            globalTooltipObserver = null;
        }
        if (globalTooltipMoveListener) {
            document.removeEventListener("mousemove", globalTooltipMoveListener);
            globalTooltipMoveListener = null;
        }
        if (globalTooltipWheelListener) {
            document.removeEventListener("wheel", globalTooltipWheelListener, true);
            globalTooltipWheelListener = null;
        }
        if (globalTooltipMouseDownListener) {
            document.removeEventListener("mousedown", globalTooltipMouseDownListener, true);
            globalTooltipMouseDownListener = null;
        }
    }
}

export function buildSummonerSpellTooltipHtml(spellData: any): string {
    return `<b style="color:#c8aa6e; font-size: 13px;">${spellData.name}</b><br>
    <span style="color:#aaa; font-size: 13px;">Cooldown: ${spellData.cooldownBurn}s</span><hr style="border-color:#333; margin:5px 0;">
    <div style="font-size: 13px; color:#ddd;">${spellData.description}</div>`;
}

export function buildItemTooltipHtml(itemData: any): string {
    return `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>
    <div style="color:#aaa; font-size: 13px; margin-bottom: 5px;">Cost: <span style="color:#e8d154">${itemData.gold?.total || 0}g</span></div>
    <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;
}

export function buildTrinketTooltipHtml(itemData: any): string {
    return `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>
    <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;
}

export function buildRuneTooltipHtml(runeData: any): string {
    if (!runeData) return "";
    
    // Some runes use shortDesc, some use longDesc. longDesc is preferred if full detail needed.
    let desc = runeData.longDesc || runeData.shortDesc || "";
    
    // Clean up Riot's specific tags
    // e.g. <lol-uikit-tooltipped-keyword key='LinkTooltip_Description_AdaptiveDmg'>Adaptive Damage</lol-uikit-tooltipped-keyword>
    desc = desc.replace(/<lol-uikit-tooltipped-keyword[^>]*>/gi, '<span style="color:#00bcd4; font-weight:bold; border-bottom: 1px dotted #00bcd4;">');
    desc = desc.replace(/<\/lol-uikit-tooltipped-keyword>/gi, '</span>');
    
    // Sometimes there are nested <font> tags or color attributes
    desc = desc.replace(/<font color='([^']*)'>/gi, '<span style="color:$1;">');
    desc = desc.replace(/<\/font>/gi, '</span>');
    desc = normalizeTooltipTextSafe(desc, "rune");

    return `
    <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <img src="https://ddragon.leagueoflegends.com/cdn/img/${runeData.icon}" style="width: 32px; height: 32px; margin-right: 10px; border-radius: 50%;">
        <b style="color:#c8aa6e; font-size: 15px;">${runeData.name}</b>
    </div>
    <div style="font-size: 13px; color:#ddd; max-width: 300px; line-height: 1.4;">${desc}</div>
    `;
}

