import type { Participant, Recording } from "../bindings";
import {
    getChampionIconUrl,
    getChampionIconUrlById,
    getTftItemIconUrl,
    getTftTraitIconUrl,
    getTftUnitIconUrl,
} from "../datadragon";
import { getText } from "../i18n";
import { isFavorite, toVideoName } from "../util";
import { getShortQueueLabel } from "./queue_helpers";
import {
    calcCsPerMin,
    createClipIconElement,
    formatDurationMmSs,
    formatSidebarDate,
    getMatchResultMeta,
    isRedSideMeta,
    resolveDurationSeconds,
    resolveTftTraitStyleClass,
    resolveTftUnitCost,
} from "./recording_item_usecase";

export function createRecordingSidebarItem(input: {
    recording: Recording;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    currentLanguage: string;
    onVideo: (videoId: string) => void;
    onFavorite: (videoId: string) => Promise<boolean | null>;
    onRename: (videoId: string) => void;
    onDelete: (videoId: string, isFavorite: boolean) => void;
    onDeleteVideoOnly?: (videoId: string, isFavorite: boolean) => void;
    filterStar: boolean;
    onRefreshForStarUnfavorite?: () => void;
}): HTMLElement {
    const {
        recording,
        createEl,
        currentLanguage,
        onVideo,
        onFavorite,
        onRename,
        onDelete,
        onDeleteVideoOnly,
        filterStar,
        onRefreshForStarUnfavorite,
    } = input;

    const videoName = toVideoName(recording.videoId);
    const isClipRecording = recording.videoId.includes("_clip");
    const favorite = isFavorite(recording.metadata);
    let displayContent: HTMLElement[] = [createEl("span", {}, { class: "video-name" }, videoName) as HTMLElement];
    let liClass = "recording-item";
    if (isClipRecording) liClass += " recording-clip";
    if (!recording.videoExists) liClass += " video-deleted";

    const mainContent = document.createElement("div");
    mainContent.className = "recording-content";

    if (recording.metadata && "Metadata" in recording.metadata) {
        liClass += " has-metadata";
        const meta = recording.metadata.Metadata;
        const dateStr = formatSidebarDate(videoName);
        const champion = meta.championName;
        const kda = `${meta.stats.kills}/${meta.stats.deaths}/${meta.stats.assists}`;
        const { result, resultClass } = getMatchResultMeta(meta);
        const queueName = getShortQueueLabel(meta.queue?.id, meta.queue?.name ?? "Custom");
        const isRedSide = isRedSideMeta(meta);
        const selfPart = meta.participants.find((p) => p.participantId === meta.participantId);
        liClass += isRedSide ? " side-red" : " side-blue";

        const mainCol = createEl("div", {}, { class: "sidebar-main" });
        const rightCol = createEl("div", {}, { class: "sidebar-right" });
        const headerRow = createEl("div", {}, { class: "sidebar-header-row" });
        const durationSec = resolveDurationSeconds(meta);
        const timeStr = formatDurationMmSs(durationSec);
        const timeSpan = createEl("span", {}, { class: "sidebar-time" }, timeStr);
        const modeSpan = createEl("span", {}, { class: "sidebar-mode" }, queueName);
        const dateSpan = createEl("div", {}, { class: "sidebar-date" }, dateStr);
        headerRow.append(timeSpan, modeSpan);

        const bodyRow = createEl("div", {}, { class: "sidebar-body-row" });
        const mainIconImg = createEl("img", {}, { class: "main-champ-img" }) as HTMLImageElement;
        const participantsContainer = createEl("div", {}, { class: "sidebar-participants" });
        const team1Row = createEl("div", {}, { class: "participant-row" }) as HTMLElement;
        const team2Row = createEl("div", {}, { class: "participant-row" }) as HTMLElement;
        participantsContainer.append(team1Row, team2Row);

        if (queueName === "TFT") {
            liClass += " tft-match";
            const statsCol = createEl("div", {}, { class: "sidebar-stats tft-stats" });
            const placementClass = selfPart?.placement === 1 ? "tft-1st" : selfPart?.placement && selfPart.placement <= 4 ? "tft-top4" : "tft-bot4";
            const placementStr = selfPart?.placement ? `#${selfPart.placement}` : "-";
            const placementSpan = createEl("span", {}, { class: `sidebar-placement ${placementClass}` }, placementStr);
            headerRow.append(placementSpan, dateSpan);

            const tftTraits = createEl("div", {}, { class: "sidebar-tft-traits" });
            if (selfPart?.traits) {
                const activeTraits = [...selfPart.traits]
                    .filter((t) => t.tierCurrent > 0)
                    .sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits)
                    .slice(0, 7);
                for (const trait of activeTraits) {
                    const styleClass = resolveTftTraitStyleClass(trait.tierCurrent, trait.tierTotal);
                    const trWrapper = createEl("div", { title: trait.name.replace(/^TFT\d+_/, "") }, { class: `tft-trait-wrapper ${styleClass}` });
                    const trImg = createEl("div", {}, { class: "tft-trait" }) as HTMLElement;
                    const trNum = createEl("span", {}, { class: "tft-trait-num" }, `${trait.numUnits}`);
                    trWrapper.append(trImg, trNum);
                    tftTraits.append(trWrapper);
                }
            }

            const tftUnits = createEl("div", {}, { class: "sidebar-tft-units" });
            if (selfPart?.units) {
                const activeUnits = [...selfPart.units].slice(0, 10);
                for (const unit of activeUnits) {
                    const costClass = `tft-cost-${resolveTftUnitCost(unit.rarity)}`;
                    const unitContainer = createEl("div", {}, { class: `tft-unit-wrapper ${costClass}` });
                    const unitImg = createEl("img", { title: unit.characterId.replace(/^TFT\d+_/, "") }, { class: "tft-unit-img" }) as HTMLImageElement;
                    unitContainer.append(unitImg);
                    if (unit.tier > 1) {
                        const starClass = unit.tier === 3 ? "star-gold" : "star-silver";
                        unitContainer.append(createEl("span", {}, { class: `tft-unit-stars ${starClass}` }, "\u2605".repeat(unit.tier)));
                    }
                    const itemsContainer = createEl("div", {}, { class: "tft-unit-items" });
                    if (unit.itemNames && unit.itemNames.length > 0) {
                        for (const itemName of unit.itemNames) {
                            itemsContainer.append(createEl("img", { title: itemName.replace(/^TFT\d+_Item_/, "") }, { class: "tft-unit-item-img" }) as HTMLImageElement);
                        }
                    }
                    unitContainer.append(itemsContainer);
                    tftUnits.append(unitContainer);
                }
            }

            statsCol.append(tftTraits, tftUnits);
            bodyRow.append(statsCol);
        } else {
            const totalCS = meta.stats.totalMinionsKilled + meta.stats.neutralMinionsKilled;
            const csPerMin = calcCsPerMin(totalCS, durationSec);
            const statsCol = createEl("div", {}, { class: "sidebar-stats" });
            statsCol.append(
                createEl("span", {}, { class: "sidebar-kda" }, kda),
                createEl("span", {}, { class: "sidebar-cs" }, `${totalCS} CS (${csPerMin}/m)`),
                createEl("span", {}, { class: `sidebar-result ${resultClass}` }, result),
            );
            if (meta.lpDiff !== undefined && meta.lpDiff !== null && meta.queue?.isRanked) {
                const diffStr = meta.lpDiff >= 0 ? `+${meta.lpDiff} LP` : `${meta.lpDiff} LP`;
                statsCol.append(createEl("span", {}, { class: `sidebar-lp ${resultClass}` }, diffStr));
            }
            bodyRow.append(mainIconImg, statsCol);
        }

        mainCol.append(headerRow, bodyRow);
        const sidebarBadges = createEl("div", {}, { class: "sidebar-badges" });
        if (isClipRecording) {
            const clipBadge = createEl("span", {}, { class: "sidebar-clip-badge", title: "Clip" });
            clipBadge.append(createClipIconElement());
            sidebarBadges.append(clipBadge);
        }
        if (favorite) {
            sidebarBadges.append(createEl("span", {}, { class: "sidebar-favorite-badge", title: "Favorite" }, "\u2605"));
        }

        if (queueName === "TFT") {
            mainCol.append(sidebarBadges);
            mainContent.append(mainCol);
        } else {
            participantsContainer.append(team1Row, team2Row);
            rightCol.append(dateSpan, participantsContainer, sidebarBadges);
            mainContent.append(mainCol, rightCol);
        }

        void (async () => {
            try {
                const selfParticipant = meta.participants.find((p) => p.participantId === meta.participantId);
                if (queueName === "TFT" && selfParticipant) {
                    if (selfParticipant.companion) {
                        const url = await getTftUnitIconUrl(selfParticipant.units?.[0]?.characterId || "");
                        if (url) mainIconImg.src = url;
                    }
                    const tftStatsCol = bodyRow.querySelector(".sidebar-stats.tft-stats");
                    const unitWrappers = tftStatsCol?.querySelectorAll(".tft-unit-wrapper");
                    const traitImgs = tftStatsCol?.querySelectorAll(".tft-trait");
                    if (unitWrappers && selfParticipant.units) {
                        const maxLen = Math.min(unitWrappers.length, selfParticipant.units.length);
                        for (let i = 0; i < maxLen; i++) {
                            const unit = selfParticipant.units[i];
                            const wrapper = unitWrappers[i];
                            const img = wrapper.querySelector(".tft-unit-img") as HTMLImageElement;
                            if (img) {
                                getTftUnitIconUrl(unit.characterId).then((url) => {
                                    if (url) {
                                        img.src = url;
                                        img.onerror = () => { img.style.opacity = "0"; };
                                    }
                                }).catch(console.error);
                            }
                            const itemImgs = wrapper.querySelectorAll(".tft-unit-item-img");
                            if (itemImgs && unit.itemNames) {
                                for (let j = 0; j < Math.min(itemImgs.length, unit.itemNames.length); j++) {
                                    const itemImg = itemImgs[j] as HTMLImageElement;
                                    getTftItemIconUrl(unit.itemNames[j]).then((itemUrl) => {
                                        if (itemUrl) {
                                            itemImg.src = itemUrl;
                                            itemImg.onerror = () => { itemImg.style.display = "none"; };
                                        }
                                    }).catch(console.error);
                                }
                            }
                        }
                    }
                    if (traitImgs && selfParticipant.traits) {
                        const activeTraits = [...selfParticipant.traits]
                            .filter((t) => t.tierCurrent > 0)
                            .sort((a, b) => b.tierCurrent - a.tierCurrent || b.numUnits - a.numUnits)
                            .slice(0, 7);
                        for (let i = 0; i < Math.min(traitImgs.length, activeTraits.length); i++) {
                            const el = traitImgs[i] as HTMLElement;
                            getTftTraitIconUrl(activeTraits[i].name).then((url) => {
                                if (url) {
                                    el.style.webkitMaskImage = `url("${url}")`;
                                    el.style.webkitMaskSize = "contain";
                                    el.style.webkitMaskRepeat = "no-repeat";
                                    el.style.webkitMaskPosition = "center";
                                    el.style.backgroundColor = "currentColor";
                                }
                            }).catch(console.error);
                        }
                    }
                } else {
                    if (selfParticipant) {
                        const url = await getChampionIconUrlById(selfParticipant.championId);
                        mainIconImg.src = url;
                        mainIconImg.onerror = () => { console.error("Failed to load main icon:", url); };
                    } else {
                        const url = await getChampionIconUrl(champion);
                        mainIconImg.src = url;
                    }
                }

                const p100 = meta.participants.filter((p) => {
                    if ("teamId" in p && p.teamId === 200) return false;
                    if ("teamId" in p && p.teamId === 100) return true;
                    return p.participantId <= 5;
                });
                const p200 = meta.participants.filter((p) => {
                    if ("teamId" in p && p.teamId === 200) return true;
                    if ("teamId" in p && p.teamId === 100) return false;
                    return p.participantId > 5;
                });

                const appendIcon = async (p: Participant, row: HTMLElement) => {
                    const img = createEl("img", { src: "" }, { class: "sub-champ-icon" }) as HTMLImageElement;
                    row.append(img);
                    try {
                        const url = await getChampionIconUrlById(p.championId);
                        img.src = url;
                        img.onerror = () => { img.style.display = "none"; };
                    } catch {
                        img.style.display = "none";
                    }
                };
                for (const p of p100) void appendIcon(p, team1Row);
                for (const p of p200) void appendIcon(p, team2Row);
            } catch (e) {
                console.error("Error loading icons in sidebar:", e);
            }
        })();

        displayContent = [mainContent];
    } else if (isClipRecording) {
        const clipName = createEl("span", {}, { class: "video-name" }) as HTMLSpanElement;
        clipName.append(createClipIconElement(), document.createTextNode(` ${videoName}`));
        displayContent = [clipName];
    }

    const li = createEl("li", {
        onclick: () => {
            if (recording.videoExists) onVideo(recording.videoId);
            else console.log("Video file no longer exists for this recording.");
        },
    }, { id: recording.videoId, class: liClass }) as HTMLElement;
    li.dataset.videoId = recording.videoId;

    const favoriteBtn = createEl("span", {
        onclick: (e: MouseEvent) => {
            e.stopPropagation();
            onFavorite(recording.videoId).then((fav) => {
                if (fav === null) return;
                favoriteBtn.innerHTML = fav ? "\u2605" : "\u2606";
                favoriteBtn.style.color = fav ? "gold" : "";
                if (recording.metadata) {
                    if ("Metadata" in recording.metadata) recording.metadata.Metadata.favorite = fav;
                    else if ("Deferred" in recording.metadata) recording.metadata.Deferred.favorite = fav;
                    else if ("NoData" in recording.metadata) recording.metadata.NoData.favorite = fav;
                }
                const badgeContainer = li.querySelector(".sidebar-badges");
                if (badgeContainer) {
                    const existingFavoriteBadge = badgeContainer.querySelector(".sidebar-favorite-badge");
                    if (fav && !existingFavoriteBadge) {
                        badgeContainer.append(createEl("span", {}, { class: "sidebar-favorite-badge", title: "Favorite" }, "\u2605"));
                    } else if (!fav && existingFavoriteBadge) {
                        existingFavoriteBadge.remove();
                    }
                }
                if (filterStar && !fav && onRefreshForStarUnfavorite) onRefreshForStarUnfavorite();
            });
        },
    }, { class: "favorite", ...(favorite ? { style: "color: gold" } : {}) }, favorite ? "\u2605" : "\u2606") as HTMLSpanElement;

    const renameBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); onRename(recording.videoId); } }, { class: "rename" }, "\u270E");
    const deleteBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); onDelete(recording.videoId, isFavorite(recording.metadata)); } }, { class: "delete", title: getText(currentLanguage as any, "delete" as any) || "Delete" }, "\u2716");
    const deleteVideoOnlyBtn = createEl("span", { onclick: (e: MouseEvent) => { e.stopPropagation(); if (onDeleteVideoOnly) onDeleteVideoOnly(recording.videoId, isFavorite(recording.metadata)); } }, { class: "delete-video-only", title: getText(currentLanguage as any, "deleteVideoOnly" as any) || "Delete Video Only" }, "\uD83D\uDDD1");
    const actionsDiv = createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, renameBtn, deleteVideoOnlyBtn, deleteBtn]);

    if (recording.metadata && "Metadata" in recording.metadata) {
        li.dataset.hasMetadata = recording.metadata.Metadata.queue.name !== "Unknown Queue" ? "true" : "false";
        li.append(mainContent);
    } else {
        li.dataset.hasMetadata = "false";
        li.append(...displayContent);
    }
    li.append(actionsDiv);
    return li;
}

