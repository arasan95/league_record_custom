import { commands, type GameMetadata, type Participant } from "../bindings";
import {
    getChampionEnglishNameByIdSync,
    getChampionNameById,
    getDetailedChampionData,
    getItemData,
    getItemIconUrl,
    getLocalChampionTooltips,
    getRuneData,
    getRuneIconUrl,
    getSpellIconUrl,
    getSummonerSpellData,
} from "../datadragon";
import { getCurrentPatchVersion } from "../version";
import { open } from "@tauri-apps/plugin-shell";
import {
    buildItemTooltipHtml,
    buildLocalChampionTooltipHtml,
    buildLocalChampionTooltipHtmlLite,
    buildRuneTooltipHtml,
    buildSummonerSpellTooltipHtml,
    buildTrinketTooltipHtml,
    hideGlobalTooltip,
    showGlobalTooltip,
} from "../tooltip";
import { isTooltipPerfDebugEnabled } from "./tooltip_debug";
import { applyScoreboardRowLayout } from "./scoreboard_row_layout_usecase";

let globalTooltipRenderTicket = 0;
const timeoutTooltipKeys = new Set<string>();

export type ScoreboardRefsMap = Map<
    number,
    { items: HTMLImageElement[]; trinket: HTMLImageElement; goldText: HTMLElement; champLevelText: HTMLElement; participantId: number }
>;

export async function renderScoreboardTeam(params: {
    teamId: number;
    participants: Participant[];
    data: GameMetadata;
    currentGameVersion: string;
    currentRenderId: number;
    isRenderValid: () => boolean;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => HTMLElement;
    csRefs: HTMLElement[];
    kdaRefs: HTMLElement[];
    scoreboardRefs: ScoreboardRefsMap;
}): Promise<HTMLElement | null> {
    const {
        teamId,
        participants,
        data,
        currentGameVersion,
        currentRenderId,
        isRenderValid,
        createEl,
        csRefs,
        kdaRefs,
        scoreboardRefs,
    } = params;

    if (!isRenderValid()) return null;

    const settings = await commands.getSettings();
    if (!isRenderValid()) return null;

    const teamDiv = createEl("div", {}, { class: `team team-${teamId}` });
    let draggedRow: HTMLElement | null = null;
    let hoveredRow: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let draggingActive = false;

    const DRAG_START_THRESHOLD_PX = 4;
    const isSameTeamRow = (row: HTMLElement | null): row is HTMLElement =>
        !!row && row.classList.contains("player-row") && row.parentElement === teamDiv;
    const clearDropIndicators = () => {
        teamDiv.querySelectorAll(".dnd-drop-target").forEach((el) => {
            el.classList.remove("dnd-drop-target");
        });
    };
    const clearDraggingState = () => {
        if (draggedRow) {
            draggedRow.classList.remove("dragging");
        }
        clearDropIndicators();
        draggedRow = null;
        hoveredRow = null;
        draggingActive = false;
    };
    const swapRows = (rowA: HTMLElement, rowB: HTMLElement) => {
        if (rowA === rowB) return;
        const parent = rowA.parentNode;
        if (!parent || parent !== rowB.parentNode) return;

        const placeholder = document.createComment("swap-placeholder");
        parent.replaceChild(placeholder, rowA);
        parent.replaceChild(rowA, rowB);
        parent.replaceChild(rowB, placeholder);
    };
    const onPointerMove = (e: PointerEvent) => {
        if (!isSameTeamRow(draggedRow)) return;

        const movedEnough = Math.abs(e.clientX - startX) > DRAG_START_THRESHOLD_PX
            || Math.abs(e.clientY - startY) > DRAG_START_THRESHOLD_PX;
        if (!draggingActive && !movedEnough) return;

        draggingActive = true;
        draggedRow.classList.add("dragging");

        clearDropIndicators();
        hoveredRow = null;

        const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".player-row") as
            | HTMLElement
            | null;
        if (!isSameTeamRow(target) || target === draggedRow) {
            return;
        }

        hoveredRow = target;
        target.classList.add("dnd-drop-target");
        e.preventDefault();
    };
    const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);

        if (isSameTeamRow(draggedRow) && isSameTeamRow(hoveredRow) && hoveredRow !== draggedRow) {
            swapRows(draggedRow, hoveredRow);
        }

        clearDraggingState();
    };

    const rowPromises = participants.slice(0, 5).map(async (p) => {
        const cDragonUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${p.championId}.png`;

        const cachedChampIcon = await import("../assets").then((m) =>
            m.getCachedAssetUrl(cDragonUrl, "champion", `${p.championId}.png`),
        );

        const spell1Url = await getSpellIconUrl(p.spell1Id);
        const spell2Url = await getSpellIconUrl(p.spell2Id);
        const runeUrl = await getRuneIconUrl(p.stats.perk0 ?? 0);

        const itemUrls = await Promise.all(
            [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5, p.stats.item6].map((id) =>
                getItemIconUrl(id),
            ),
        );

        if (!isRenderValid()) return null;

        const row = createEl("div", {}, { class: "player-row" }) as HTMLElement;
        const isMe = p.participantId === data.participantId;
        const img = createEl("img", { src: cachedChampIcon }, { class: "champ-icon" }) as HTMLImageElement;
        let triedChampionRemote = false;
        img.style.visibility = "hidden";
        img.onload = () => {
            img.style.visibility = "visible";
        };
        const initialChampLevel = typeof p.champLevel === "number" && p.champLevel > 0 ? p.champLevel : 1;
        const champLevelEl = createEl("div", {}, { class: "champ-level-overlay" }, `${initialChampLevel}`) as HTMLElement;
        const champIconWrap = createEl("div", {}, { class: "champ-icon-wrap" }, [img, champLevelEl]) as HTMLElement;
        let hideTooltipTimer: number | null = null;
        const cancelHideTooltip = () => {
            if (hideTooltipTimer !== null) {
                window.clearTimeout(hideTooltipTimer);
                hideTooltipTimer = null;
            }
        };
        const scheduleHideTooltip = () => {
            cancelHideTooltip();
            hideTooltipTimer = window.setTimeout(() => {
                hideGlobalTooltip();
                hideTooltipTimer = null;
            }, 30);
        };
        img.onerror = () => {
            if (!triedChampionRemote && img.src !== cDragonUrl) {
                triedChampionRemote = true;
                console.warn(`Local cache failed for champion ${p.championId}, retrying remote: ${cDragonUrl}`);
                img.src = cDragonUrl;
                return;
            }
            img.style.visibility = "hidden";
            img.removeAttribute("src");
        };

        let isHovered = false;
        let hoverRequestId = 0;
        const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
            return await Promise.race<T | null>([
                promise,
                new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
            ]);
        };
        img.addEventListener("mouseenter", async () => {
            cancelHideTooltip();
            isHovered = true;
            const requestId = ++hoverRequestId;
            const ticket = ++globalTooltipRenderTicket;
            const lang = settings.language || "ja";
            const perfEnabled = isTooltipPerfDebugEnabled();
            const perfStart = perfEnabled ? performance.now() : 0;
            try {
                const fetchStart = perfEnabled ? performance.now() : 0;
                const tooltips = await getLocalChampionTooltips(p.championId, lang);
                const fetchEnd = perfEnabled ? performance.now() : 0;
                if (!isHovered || requestId !== hoverRequestId || ticket !== globalTooltipRenderTicket) return;

                if (tooltips) {
                    const championEn = (getChampionEnglishNameByIdSync(p.championId) || "").toLowerCase();
                    const tooltipKey = `${championEn || p.championId}:${lang}`;
                    if (timeoutTooltipKeys.has(tooltipKey)) {
                        return;
                    }
                    let fallbackChampionData: any = null;
                    try {
                        const slotsText = ["Passive", "Q", "W", "E", "R"]
                            .map((k) => String((tooltips as any)?.[k] || ""))
                            .join("\n");
                        const hasUnresolvedSpellKey = /\{\{\s*Spell_[^}]+\}\}/i.test(slotsText);
                        const hasLocalHeaderStats =
                            typeof (tooltips as any)?.champion_stats?.movespeed === "number" &&
                            typeof (tooltips as any)?.champion_stats?.attackrange === "number";
                        if (lang !== "ja" || hasUnresolvedSpellKey || !hasLocalHeaderStats) {
                            const version = currentGameVersion || getCurrentPatchVersion();
                            fallbackChampionData = await withTimeout(getDetailedChampionData(p.championId, version, lang), 1800);
                        }
                    } catch {}
                    let html = "";
                    try {
                        const renderStart = perfEnabled ? performance.now() : 0;
                        html = await buildLocalChampionTooltipHtml(tooltips, lang, fallbackChampionData, {
                            isCancelled: () =>
                                !isHovered || requestId !== hoverRequestId || ticket !== globalTooltipRenderTicket || !img.isConnected,
                            timeoutMs: 1700,
                        });
                        const renderEnd = perfEnabled ? performance.now() : 0;
                        if (perfEnabled) {
                            const totalNow = performance.now();
                            console.log(
                                `[tooltip-perf] ${championEn || p.championId}(${lang}) fetch=${(fetchEnd - fetchStart).toFixed(1)}ms render=${(renderEnd - renderStart).toFixed(1)}ms total=${(totalNow - perfStart).toFixed(1)}ms`,
                            );
                        }
                    } catch (e) {
                        const msg = String((e as any)?.message || "");
                        if (msg.includes("tooltip_render_cancelled")) {
                            return;
                        }
                        if (msg.includes("tooltip_render_timeout")) {
                            timeoutTooltipKeys.add(tooltipKey);
                            console.warn(`[tooltip] render timeout >1700ms, skip display key=${tooltipKey}`);
                            return;
                        }
                        console.warn(`[tooltip-lite] fallback after render exception key=${tooltipKey}`, e);
                        const liteStart = perfEnabled ? performance.now() : 0;
                        html = buildLocalChampionTooltipHtmlLite(tooltips, lang);
                        if (perfEnabled) {
                            const liteEnd = performance.now();
                            const totalNow = performance.now();
                            console.log(
                                `[tooltip-perf] ${championEn || p.championId}(${lang}) fetch=${(fetchEnd - fetchStart).toFixed(1)}ms lite=${(liteEnd - liteStart).toFixed(1)}ms total=${(totalNow - perfStart).toFixed(1)}ms fallback=1`,
                            );
                        }
                    }
                    if (html && isHovered && requestId === hoverRequestId && ticket === globalTooltipRenderTicket && img.isConnected) {
                        showGlobalTooltip(img, html);
                    }
                }
            } catch (e) {
                console.error("Champion tooltip hover failed:", e);
            }
        });
        img.addEventListener("mouseleave", () => {
            isHovered = false;
            hoverRequestId++;
            globalTooltipRenderTicket++;
            scheduleHideTooltip();
        });

        if (settings.championWikiBaseUrl) {
            img.style.cursor = "pointer";
            img.title = "Open Wiki";
            img.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!settings.championWikiBaseUrl) return;

                const champName = await getChampionNameById(p.championId);
                if (!champName) {
                    console.warn(`Could not resolve champion name for ID ${p.championId}`);
                    return;
                }

                const champEng = getChampionEnglishNameByIdSync(p.championId) || champName;
                let url = settings.championWikiBaseUrl;
                if (url.includes("{")) {
                    url = url
                        .replace(/{id}/g, champName)
                        .replace(/{name}/g, champEng)
                        .replace(/{name_}/g, champEng.replace(/\s+/g, "_"))
                        .replace(/{nameEsc}/g, encodeURIComponent(champEng))
                        .replace(/{Q}/g, champName)
                        .replace(/{q}/g, champName.toLowerCase());
                } else {
                    url = `${url}${champName}`;
                }

                try {
                    await open(url);
                } catch (err) {
                    console.error("Failed to open Wiki URL:", err);
                }
            });
        }

        const spell1El = createEl("img", { src: spell1Url }, { class: "spell-icon" }) as HTMLImageElement;
        const spell2El = createEl("img", { src: spell2Url }, { class: "spell-icon" }) as HTMLImageElement;

        [
            { el: spell1El, id: p.spell1Id },
            { el: spell2El, id: p.spell2Id },
        ].forEach(({ el, id }) => {
            let spellHoverRequestId = 0;
            el.addEventListener("mouseenter", async () => {
                cancelHideTooltip();
                const requestId = ++spellHoverRequestId;
                const spellData = await getSummonerSpellData(id, getCurrentPatchVersion(), settings.language);
                if (requestId !== spellHoverRequestId) return;
                if (spellData) {
                    showGlobalTooltip(el, buildSummonerSpellTooltipHtml(spellData));
                }
            });
            el.addEventListener("mouseleave", () => {
                spellHoverRequestId++;
                scheduleHideTooltip();
            });
        });

        const spells = createEl("div", {}, { class: "spells" }, [spell1El, spell2El]) as HTMLElement;

        const runeIconEl = createEl("img", { src: runeUrl }, { class: "rune-icon" }) as HTMLImageElement;

        let runeHoverRequestId = 0;
        runeIconEl.addEventListener("mouseenter", async () => {
            cancelHideTooltip();
            const requestId = ++runeHoverRequestId;
            if (p.stats.perk0 && p.stats.perk0 !== 0) {
                const runeData = await getRuneData(p.stats.perk0, settings.language || "ja");
                if (requestId !== runeHoverRequestId) return;
                if (runeData) {
                    showGlobalTooltip(runeIconEl, buildRuneTooltipHtml(runeData));
                }
            }
        });
        runeIconEl.addEventListener("mouseleave", () => {
            runeHoverRequestId++;
            scheduleHideTooltip();
        });

        const runesDiv = createEl("div", {}, { class: "runes" }, [runeIconEl]) as HTMLElement;

        const csDiv = createEl("div", {}, { class: "cs-stat" }, `${p.stats.totalMinionsKilled}`) as HTMLElement;
        const kdaDiv = createEl("div", {}, { class: "kda" }, `${p.stats.kills} / ${p.stats.deaths} / ${p.stats.assists}`) as HTMLElement;

        const coreItemUrls = itemUrls.slice(0, 6);
        const trinketUrl = itemUrls[6];

        const itemsGrid = createEl("div", {}, { class: "items-grid" }) as HTMLElement;

        if (settings.championBuildUrl) {
            itemsGrid.style.cursor = "pointer";
            itemsGrid.title = "Open Champion Build";
            itemsGrid.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!settings.championBuildUrl) return;

                const champName = await getChampionNameById(p.championId);
                if (!champName) {
                    console.warn(`Could not resolve champion name for ID ${p.championId}`);
                    return;
                }

                const champEng = getChampionEnglishNameByIdSync(p.championId) || champName;
                let url = settings.championBuildUrl;
                if (url.includes("{")) {
                    url = url
                        .replace(/{id}/g, champName)
                        .replace(/{name}/g, champEng)
                        .replace(/{name_}/g, champEng.replace(/\s+/g, "_"))
                        .replace(/{nameEsc}/g, encodeURIComponent(champEng))
                        .replace(/{Q}/g, champName)
                        .replace(/{q}/g, champName.toLowerCase());
                } else {
                    url = `${url}${champName}`;
                }

                try {
                    await open(url);
                } catch (err) {
                    console.error("Failed to open Build URL:", err);
                }
            });
        }

        const itemImgs: HTMLImageElement[] = [];
        coreItemUrls.forEach((url, idx) => {
            const itemId = [p.stats.item0, p.stats.item1, p.stats.item2, p.stats.item3, p.stats.item4, p.stats.item5][idx];

            const slotDiv = createEl("div", {}, { class: "item-slot" });

            const i = createEl("img", { src: url }, { class: "item-icon" }) as HTMLImageElement;
            i.dataset.itemId = itemId.toString();

            i.onerror = () => {
                i.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            };

            if (itemId === 0) {
                i.style.visibility = "hidden";
            }
            let itemHoverRequestId = 0;
            i.addEventListener("mouseenter", async (e) => {
                cancelHideTooltip();
                const requestId = ++itemHoverRequestId;
                const target = e.target as HTMLElement;
                const currentId = parseInt(target.dataset.itemId || "0", 10);
                if (currentId === 0) return;
                const itemData = await getItemData(currentId, settings.language || "ja");
                if (requestId !== itemHoverRequestId) return;
                if (itemData) {
                    showGlobalTooltip(target, buildItemTooltipHtml(itemData));
                }
            });
            i.addEventListener("mouseleave", () => {
                itemHoverRequestId++;
                scheduleHideTooltip();
            });

            slotDiv.append(i);
            itemsGrid.append(slotDiv);
            itemImgs.push(i);
        });

        const trinketSlotDiv = createEl("div", {}, { class: "item-slot trinket-slot-frame" });

        const trinketImg = createEl("img", { src: trinketUrl }, { class: "item-icon trinket-icon" }) as HTMLImageElement;
        trinketImg.dataset.itemId = p.stats.item6.toString();
        if (p.stats.item6 === 0) {
            trinketImg.style.visibility = "hidden";
        }

        let trinketHoverRequestId = 0;
        trinketImg.addEventListener("mouseenter", async (e) => {
            cancelHideTooltip();
            const requestId = ++trinketHoverRequestId;
            const target = e.target as HTMLElement;
            const currentId = parseInt(target.dataset.itemId || "0", 10);
            if (currentId === 0) return;
            const itemData = await getItemData(currentId, settings.language || "ja");
            if (requestId !== trinketHoverRequestId) return;
            if (itemData) {
                showGlobalTooltip(target, buildTrinketTooltipHtml(itemData));
            }
        });
        trinketImg.addEventListener("mouseleave", () => {
            trinketHoverRequestId++;
            scheduleHideTooltip();
        });

        trinketImg.onerror = () => {
            trinketImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        };

        trinketSlotDiv.append(trinketImg);
        const trinketDiv = createEl("div", {}, { class: "trinket-container" }, [trinketSlotDiv]) as HTMLElement;

        const goldDiv = createEl("div", {}, { class: "total-gold" }, "0") as HTMLElement;
        row.dataset.pid = p.participantId.toString();
        const nameStr = p.summonerName || (isMe ? `${data.player.gameName}#${data.player.tagLine}` : `P${p.participantId}`);
        const name = createEl("div", {}, { class: "player-name" }, nameStr) as HTMLElement;

        if (settings.matchHistoryBaseUrl) {
            name.style.cursor = "pointer";
            name.title = `Open Match History for ${nameStr}`;
            name.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!settings.matchHistoryBaseUrl) return;
                const targetId = nameStr.replace("#", "-");
                const encodedId = encodeURIComponent(targetId);

                let url = "";
                if (settings.matchHistoryBaseUrl.includes("{q}")) {
                    url = settings.matchHistoryBaseUrl.replace("{q}", encodedId);
                } else {
                    url = `${settings.matchHistoryBaseUrl}${encodedId}`;
                }

                try {
                    await open(url);
                } catch (err) {
                    console.error("Failed to open URL:", err);
                }
            });
        } else {
            name.style.cursor = "default";
        }

        row.style.display = "flex";
        row.style.flexDirection = "row";

        row.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (!isSameTeamRow(row)) return;
            // Ignore resize handle drags and right-side controls.
            const target = e.target as HTMLElement | null;
            if (target?.closest(".scoreboard-resize-handle")) return;

            draggedRow = row;
            hoveredRow = null;
            draggingActive = false;
            startX = e.clientX;
            startY = e.clientY;

            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
            window.addEventListener("pointercancel", onPointerUp);
        });

        const metaDiv = createEl("div", {}, { class: "player-meta" }) as HTMLElement;

        if (p.rank && p.rank !== "Unranked" && p.rank !== "UNRANKED") {
            const formatRank = (r: string) => {
                const parts = r.split(" ");
                if (parts.length < 1) return r;

                const tier = parts[0].toUpperCase();
                const division = parts.length > 1 ? parts[1] : "";

                let shortTier = tier[0];

                if (tier === "GRANDMASTER") shortTier = "GM";
                if (tier === "CHALLENGER") shortTier = "C";

                let shortDiv = division;
                if (division === "1" || division === "I") shortDiv = "1";
                if (division === "2" || division === "II") shortDiv = "2";
                if (division === "3" || division === "III") shortDiv = "3";
                if (division === "4" || division === "IV" || division === "IIII") shortDiv = "4";

                return `${shortTier}${shortDiv}`;
            };

            const rankStr = formatRank(p.rank as string);
            const rankEl = createEl("div", {}, { class: "player-rank" }, rankStr);

            try {
                const parts = (p.rank as string).split(" ");
                if (parts.length > 0) {
                    const tier = parts[0].toLowerCase();
                    rankEl.classList.add(`rank-${tier}`);
                }
            } catch {}

            metaDiv.append(rankEl);
        }

        const sLevel = p.summonerLevel || 0;
        if (sLevel > 0) {
            const lvlEl = createEl("div", {}, { class: "player-level" }, `Lv.${sLevel}`);
            metaDiv.append(lvlEl);
        }

        applyScoreboardRowLayout(teamId, {
            champIconWrap,
            csDiv,
            kdaDiv,
            itemsGrid,
            trinketDiv,
            spells,
            runesDiv,
            goldDiv,
            metaDiv,
            name,
        });

        row.append(metaDiv, champIconWrap, csDiv, kdaDiv, itemsGrid, trinketDiv, spells, runesDiv, goldDiv, name);

        return {
            row,
            csDiv,
            kdaDiv,
            itemImgs,
            trinketImg,
            goldDiv,
            champLevelEl,
            participantId: p.participantId,
        };
    });

    const results = await Promise.all(rowPromises);

    if (!isRenderValid()) return null;
    for (const res of results) {
        if (!res) continue;
        teamDiv.append(res.row);
        csRefs.push(res.csDiv);
        kdaRefs.push(res.kdaDiv);
        scoreboardRefs.set(res.participantId, {
            items: res.itemImgs,
            trinket: res.trinketImg,
            goldText: res.goldDiv,
            champLevelText: res.champLevelEl,
            participantId: res.participantId,
        });
    }
    return teamDiv;
}
