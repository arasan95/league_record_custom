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
            } else if ("ScoreboardSwap" in event) {
                // This is a custom/hypothetical event to handle user swapping rows in-game.
                // However, the event log provided does NOT show any swap events.
                // The issue description says "途中から手動でゲーム内のスコアボードを入れ替えた".
                // If the game client sends us swap info, we need to handle it.
                // But standard Riot API doesn't usually stream this in match-v5 timeline directly?
                // Wait, if the user swapped rows IN-GAME, does that change participantId? NO.
                // But maybe the `participant_id` in events effectively points to a "Slot"?
                // NO, `participant_id` 1-10 is fixed to the player.
                
                // HYPOTHESIS: The user means *they* swapped rows in *our* tool? 
                // NO, "ゲーム内のスコアボードを入れ替えた" (swapped *in-game* scoreboard).
                // If they swap in-game, it only changes visual order in the LoL client.
                // The API Data (Match V5) usually keeps IDs 1-10 fixed to the players.
                // So ID 1 is ALWAYS Player A, regardless of where they are on the scoreboard.
                
                // SO WHY is the data showing swapped items?
                // Maybe the "Slot" data in `ItemPurchased` events is somehow relative to something else? 
                // Unlikely.
                
                // Let's look at the LOG again.
                // ID Map: 0:[1,1], 1:[2,2]... It's 1:1.
                // If ID 4 (Zed) buys item X. Timeline records "ID 4 bought X".
                // UI renders "Zed (ID 4)". UpdateTimeline fetches state for ID 4. 
                // It SHOULD match.
                
                // UNLESS... The `idMap` logic I added earlier is WRONG?
                // No, I added the map but logic seems standard.
                
                // Wait, check `this.idMap` usage in `timeline.ts`.
                // `if (this.idMap && this.idMap.has(pid)) pid = this.idMap.get(pid)!;`
                
                // The `idMap` maps [Index(0-9) + 1] -> [participantId].
                // If `data.participants` is sorted 1-10, map is 1->1, 2->2.
                // But what if `data.participants` is NOT sorted by ID?
                // `data.participants` comes from `MatchV5`. The array order IS the ID order usually (0=ID1, 1=ID2).
                // BUT, sometimes participantId can be arbitrary? 
                
                // The LOG says: `DEBUG: Metadata Participants: 1:86,2:517,3:143,4:238,5:51...`
                // 1 -> 86 (Garen?)
                // 4 -> 238 (Zed)
                // 5 -> 51 (Caitlyn)
                
                // If the Timeline Event says "participant_id: 4" (Zed) bought Item X.
                // Code: `pid = 4`. `idMap.get(4)` -> 4. `history.get(4)`. Pushes Item X.
                // UI: Zed has `p.participantId = 4`. `scoreboardRefs.get(4)`. 
                // `timeline.getStateAt(4)`. Returns state with Item X.
                // Zed's row (ID 4) displays Item X.
                
                // THIS should be correct.
                
                // User says: "Caitlyn's item displayed on Zed".
                // Caitlyn is ID 5. Zed is ID 4.
                // So, Zed (ID 4) row is showing data from ID 5?
                // If Zed row calls `getStateAt(4)`, it gets ID 4 data.
                // If ID 4 data contains Caitlyn's items...
                // Then the EVENT LOG must say "participant_id: 4" (Zed) bought Caitlyn's items?
                // That would mean the Riot API / Replay data is swapping IDs?
                // OR `participant_id` in events refers to *Slot Index* (which swaps) not *original ID*?
                // Replay files (.rofl) sometimes use "Slot ID" checking.
                
                // IF the game allows swapping scoreboard slots, and that changes the "participant_id" in the event stream
                // (e.g. Zed moves to Slot 5, now events for Zed come as ID 5??)
                // That would be insane behavior for an API, but possible in Replay/Spectator internal protocols.
                
                // If this is happening, we need a "Swap" event to update our mapping.
                // BUT we don't see a swap event in "GameEvent" types.
                
                // LET'S ASSUME the provided log file `2026-02-04_09-04.json` contains clues.
                // I will search for weird item purchases in the log file given earlier.
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
