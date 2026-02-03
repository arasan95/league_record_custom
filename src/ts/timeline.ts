import { GameEvent } from "./bindings";

const TRINKET_IDS = new Set([
    3340, 3364, 3363, 3513, // Warding Totem, Oracle Lens, Farsight Alteration, Eye of the Herald...
    2055, // Control Ward (Not trinket, but consumable) - Wait, Control Ward is normal item.
    // Need a better list or fetch it. For now, standard trinkets.
    3330 // Scarecrow Effigy (Fiddlesticks)
]);

export interface InventoryState {
    items: number[]; // 0-5
    trinket: number; // 6
}

export class InventoryTimeline {
    private participantTimelines: Map<number, { timestamp: number, state: InventoryState }[]> = new Map();
    private idMap?: Map<number, number>;

    constructor(events: GameEvent[], participants: number[], idMap?: Map<number, number>) {
        this.idMap = idMap;
        // Initialize timelines for all participants
        participants.forEach(pid => {
            this.participantTimelines.set(pid, [{ 
                timestamp: 0, 
                state: { items: [], trinket: 0 } 
            }]);
        });

        // Filter item events
        const itemEvents = events.filter(e => 
            "ItemPurchased" in e || "ItemSold" in e || "ItemUndo" in e
        ).sort((a, b) => a.timestamp - b.timestamp);

        // Process events
        for (const event of itemEvents) {
            let pid = 0;
            if ("ItemPurchased" in event) pid = event.ItemPurchased.participant_id;
            else if ("ItemSold" in event) pid = event.ItemSold.participant_id;
            else if ("ItemUndo" in event) pid = event.ItemUndo.participant_id;

            if (!pid) continue;

            if (this.idMap && this.idMap.has(pid)) {
                pid = this.idMap.get(pid)!;
            }

            const history = this.participantTimelines.get(pid);
            if (!history) continue;

            const lastState = history[history.length - 1].state;
            const newState = this.cloneState(lastState);

            if ("ItemPurchased" in event) {
                // @ts-ignore - slot added but types might not be regenerated yet
                const slot = event.ItemPurchased.slot; 
                this.handlePurchase(newState, event.ItemPurchased.item_id, slot);
            } else if ("ItemSold" in event) {
                // @ts-ignore
                const slot = event.ItemSold.slot;
                this.handleSell(newState, event.ItemSold.item_id, slot);
            } else if ("ItemUndo" in event) {
                this.handleUndo(newState, event.ItemUndo.before_id, event.ItemUndo.after_id);
            }

            // Only add if time changed, else update last entry? 
            // Better to push new entry to be safe with ordering.
            history.push({ timestamp: event.timestamp, state: newState });
        }
    }

    private cloneState(state: InventoryState): InventoryState {
        // items might contain 0s now
        return { items: [...state.items], trinket: state.trinket };
    }

    private handlePurchase(state: InventoryState, itemId: number, slot?: number | null) {
        if (TRINKET_IDS.has(itemId) && itemId !== 2055) {
            state.trinket = itemId;
        } else {
            if (slot !== undefined && slot !== null) {
                // Use specific slot (0-6). 6 might be trinket in some contexts, but usually 0-5 is items.
                // If slot is 6, treat as trinket?
                // Exception: Control Ward (2055) should NEVER be trinket, even if slot 6 is claimed.
                if (slot === 6 && itemId !== 2055) {
                    state.trinket = itemId;
                } else if (slot >= 0 && slot < 6) {
                    // Ensure items array has enough size
                    while (state.items.length <= slot) {
                        state.items.push(0);
                    }
                    state.items[slot] = itemId;
                } else if (itemId === 2055 && slot === 6) {
                    // Force Control Ward in slot 6 into items array if possible
                    const emptyIdx = state.items.indexOf(0);
                    if (emptyIdx !== -1) {
                        state.items[emptyIdx] = itemId;
                    } else if (state.items.length < 6) {
                        state.items.push(itemId);
                    }
                }
            } else {
                // Fallback to old behavior: Add to first empty slot
                // Find first 0 or append
                const emptyIdx = state.items.indexOf(0);
                if (emptyIdx !== -1) {
                    state.items[emptyIdx] = itemId;
                } else if (state.items.length < 6) {
                    state.items.push(itemId);
                }
            }
        }
    }

    private handleSell(state: InventoryState, itemId: number, slot?: number | null) {
        if (state.trinket === itemId) {
            state.trinket = 0;
        } else {
            if (slot !== undefined && slot !== null && slot >= 0 && slot < 6) {
                 if (state.items[slot] === itemId) {
                     state.items[slot] = 0;
                 }
            } else {
                const idx = state.items.indexOf(itemId);
                if (idx !== -1) {
                    state.items[idx] = 0; // Set to 0 instead of splice to keep slots stable
                }
            }
        }
    }

    private handleUndo(state: InventoryState, beforeId: number, afterId: number) {
        // Undo is complex. "Before" is what it WAS, "After" is what it IS NOW (which is usually 0 if undone purchase).
        // Actually, ItemUndo usually means: "Item changed from After to Before"? 
        // No, `after_id` is the Item ID *after* the undo? Or *before* the undo?
        // Let's assume standard logic: Undo reverses the last action.
        // But the event gives explicit IDs.
        
        // If we bought X (After=X, Before=0). Undo means we go back to Before=0.
        // So effectively, we set the slot that had After to Before.
        
        if (beforeId === 0 && afterId !== 0) {
            // We are removing 'afterId' (Undoing a buy)
            this.handleSell(state, afterId);
        } else if (beforeId !== 0 && afterId === 0) {
            // We are adding 'beforeId' (Undoing a sell)
            this.handlePurchase(state, beforeId);
        } else if (beforeId !== 0 && afterId !== 0) {
            // Swapping? (Undoing a generic transform? e.g. Tear stacking? or just invalid?)
            // Treat as sell After, buy Before.
            this.handleSell(state, afterId);
            this.handlePurchase(state, beforeId);
        }
    }

    public getStateAt(participantId: number, timestamp: number): InventoryState | null {
        const history = this.participantTimelines.get(participantId);
        if (!history) return null;

        // Binary search or linear scan (dataset is small enough for linear usually, <100 items/game)
        // Find last entry where entry.timestamp <= timestamp
        let best = history[0];
        for (let i = 1; i < history.length; i++) {
            if (history[i].timestamp > timestamp) break;
            best = history[i];
        }
        return best.state;
    }
}
