type TimelineState = {
    items: number[];
    trinket: number;
};

type ScoreboardRef = {
    items: HTMLImageElement[];
    trinket: HTMLImageElement;
    goldText: HTMLElement;
};

type UpdateItemsInput = {
    scoreboardRefs: Map<number, ScoreboardRef>;
    currentTimeMs: number;
    gameVersion: string;
    getTimelineStateAt: (participantId: number, timestampMs: number) => TimelineState | null;
    getItemPrice: (itemId: number, gameVersion?: string) => number;
    getItemIconUrl: (itemId: number) => Promise<string>;
};

export function updateScoreboardItemsAndGold(input: UpdateItemsInput): Map<number, number> {
    const { scoreboardRefs, currentTimeMs, gameVersion, getTimelineStateAt, getItemPrice, getItemIconUrl } = input;
    const itemGoldMap = new Map<number, number>();

    scoreboardRefs.forEach((refs, pid) => {
        const state = getTimelineStateAt(pid, currentTimeMs);
        let currentGold = 0;

        if (!state) {
            itemGoldMap.set(pid, 0);
            return;
        }

        for (let i = 0; i < 6; i++) {
            const itemId = state.items.length > i ? state.items[i] || 0 : 0;
            if (itemId !== 0) {
                currentGold += getItemPrice(itemId, gameVersion);
            }

            const img = refs.items[i];
            if (!img) continue;

            const currentId = parseInt(img.dataset.itemId || "0", 10);
            if (currentId !== itemId) {
                img.dataset.itemId = itemId.toString();
                getItemIconUrl(itemId).then((url) => {
                    if (img.dataset.itemId === itemId.toString()) {
                        img.src = url;
                        img.style.visibility = itemId === 0 ? "hidden" : "visible";
                    }
                });
            }
        }

        const trinketId = state.trinket || 0;
        if (trinketId !== 0) {
            currentGold += getItemPrice(trinketId, gameVersion);
        }
        const tImg = refs.trinket;
        const currentTrinketId = parseInt(tImg.dataset.itemId || "0", 10);
        if (currentTrinketId !== trinketId) {
            tImg.dataset.itemId = trinketId.toString();
            getItemIconUrl(trinketId).then((url) => {
                if (tImg.dataset.itemId === trinketId.toString()) {
                    tImg.src = url;
                    tImg.style.visibility = trinketId === 0 ? "hidden" : "visible";
                }
            });
        }

        if (refs.goldText) {
            refs.goldText.textContent = currentGold >= 1000 ? `${(currentGold / 1000).toFixed(1)}k` : `${currentGold}`;
        }

        itemGoldMap.set(pid, currentGold);
    });

    return itemGoldMap;
}
