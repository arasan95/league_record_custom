import type { Participant } from "./bindings";
import { getChampionIconUrlById } from "./datadragon";
import type { MarkerDetail } from "./main_markers_usecase";

type Input = {
    playerElement: HTMLElement | null;
    getMarkerDetails: () => Array<MarkerDetail | undefined>;
    getParticipants: () => Array<Participant> | undefined;
    getSelfParticipantId: () => number;
};

function formatGameTime(timestampMs: number): string {
    const gameSeconds = Math.max(0, Math.floor(timestampMs / 1000));
    const mins = Math.floor(gameSeconds / 60);
    const secs = gameSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function extractDetailIdFromMarkerEl(markerEl: HTMLElement): number | null {
    const className = markerEl.className ?? "";
    const match = className.match(/(?:^|\s)lr-ev-(\d+)(?=\s|$)/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isFinite(id) ? id : null;
}

function buildParticipantMap(participants: Array<Participant> | undefined): Map<number, Participant> {
    const map = new Map<number, Participant>();
    if (!participants) return map;
    for (const participant of participants) {
        map.set(participant.participantId, participant);
    }
    return map;
}

function buildChampionIconPromiseCache() {
    const cache = new Map<number, Promise<string>>();
    return (championId: number): Promise<string> => {
        if (championId <= 0) return Promise.resolve("");
        const existing = cache.get(championId);
        if (existing) return existing;
        const p = getChampionIconUrlById(championId).catch(() => "");
        cache.set(championId, p);
        return p;
    };
}

function positionTooltipAboveSeekbar(playerElement: HTMLElement, tooltipEl: HTMLElement, anchorClientX: number) {
    const progressControl = document.querySelector(".vjs-progress-control") as HTMLElement | null;
    if (!progressControl) return;
    const playerRect = playerElement.getBoundingClientRect();
    const progressRect = progressControl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const pointerHeight = 10;
    const tooltipGap = 8;
    const relX = anchorClientX - playerRect.left;
    const top = progressRect.top - playerRect.top - tooltipRect.height - pointerHeight - tooltipGap;
    tooltipEl.style.left = `${relX}px`;
    tooltipEl.style.top = `${Math.max(0, top)}px`;
}

function positionMarkerTooltipAboveSeekbar(playerElement: HTMLElement, tooltipEl: HTMLElement, anchorClientX: number) {
    const progressControl = document.querySelector(".vjs-progress-control") as HTMLElement | null;
    if (!progressControl) return;
    const playerRect = playerElement.getBoundingClientRect();
    const progressRect = progressControl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const pointerHeight = 10;
    const tooltipGap = 30; // keep marker tooltip above the time tooltip
    const relX = anchorClientX - playerRect.left;
    const top = progressRect.top - playerRect.top - tooltipRect.height - pointerHeight - tooltipGap;
    tooltipEl.style.left = `${relX}px`;
    tooltipEl.style.top = `${Math.max(0, top)}px`;
}

function ensureOverlayContainer(progressHolder: HTMLElement): HTMLElement {
    let el = progressHolder.querySelector("#custom-marker-overlays") as HTMLElement | null;
    if (el) return el;
    el = document.createElement("div");
    el.id = "custom-marker-overlays";
    progressHolder.appendChild(el);
    return el;
}

function clearEl(el: HTMLElement) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function createChampChip(participant: Participant | undefined, selfParticipantId: number): HTMLElement {
    const chip = document.createElement("div");
    chip.className = "lr-marker-champ";
    if (participant && participant.participantId === selfParticipantId) chip.classList.add("is-self");

    const img = document.createElement("img");
    img.className = "lr-marker-champ-icon";
    img.alt = "";
    img.decoding = "async";
    img.loading = "eager";
    chip.appendChild(img);

    return chip;
}

function setChampChipIcon(chip: HTMLElement, iconUrl: string) {
    const img = chip.querySelector("img.lr-marker-champ-icon") as HTMLImageElement | null;
    if (!img) return;
    if (!iconUrl) {
        img.removeAttribute("src");
        return;
    }
    if (img.src !== iconUrl) img.src = iconUrl;
}

export function initializeMarkerHoverTooltips(input: Input): void {
    const { playerElement, getMarkerDetails, getParticipants, getSelfParticipantId } = input;
    if (!playerElement) return;

    const progressHolder = document.querySelector(".vjs-progress-holder") as HTMLElement | null;
    if (!progressHolder) return;

    let tooltip = document.getElementById("custom-marker-tooltip") as HTMLElement | null;
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "custom-marker-tooltip";
        playerElement.appendChild(tooltip);
    }

    const overlayContainer = ensureOverlayContainer(progressHolder);

    const getChampionIconUrlCached = buildChampionIconPromiseCache();
    let renderToken = 0;
    let activeMarkerEls: HTMLElement[] = [];
    let activeDetailIds: number[] = [];

    const renderOverlays = (markerEls: HTMLElement[]) => {
        clearEl(overlayContainer);
        if (markerEls.length === 0) return;

        const holderRect = progressHolder.getBoundingClientRect();
        for (const markerEl of markerEls) {
            const rect = markerEl.getBoundingClientRect();
            const overlay = document.createElement("div");
            overlay.className = "lr-marker-overlay";
            overlay.style.left = `${rect.left - holderRect.left}px`;
            overlay.style.top = `${rect.top - holderRect.top}px`;
            overlay.style.width = `${rect.width}px`;
            overlay.style.height = `${rect.height}px`;
            overlay.style.borderColor = getComputedStyle(markerEl).color;
            overlayContainer.appendChild(overlay);
        }
    };

    const renderTooltipStack = async (
        matches: Array<{ detail: MarkerDetail; markerEl: HTMLElement; detailId: number }>,
        anchorClientX: number,
        token: number,
    ) => {
        const participants = getParticipants();
        const participantMap = buildParticipantMap(participants);
        const selfParticipantId = getSelfParticipantId();

        clearEl(tooltip!);

        const stack = document.createElement("div");
        stack.className = "lr-marker-tooltip-stack";
        tooltip!.appendChild(stack);

        const pendingIconTasks: Array<Promise<void>> = [];

        for (const { detail, markerEl } of matches) {
            const card = document.createElement("div");
            card.className = "lr-marker-tooltip-card";
            stack.appendChild(card);

            if (detail.kind === "ChampionKill") {
                const mainRow = document.createElement("div");
                mainRow.className = "lr-marker-tooltip-main";

                const killer = participantMap.get(detail.killerParticipantId);
                const victim = participantMap.get(detail.victimParticipantId);

                // Use the marker's color for border accents.
                const markerColor = getComputedStyle(markerEl).color;
                card.style.borderColor = markerColor;

                const killerChip = createChampChip(killer, selfParticipantId);
                const victimChip = createChampChip(victim, selfParticipantId);

                mainRow.appendChild(killerChip);
                const arrow = document.createElement("span");
                arrow.className = "lr-marker-tooltip-arrow";
                arrow.textContent = "→";
                mainRow.appendChild(arrow);
                mainRow.appendChild(victimChip);
                card.appendChild(mainRow);

                const assists = detail.assistingParticipantIds
                    .map((id) => participantMap.get(id))
                    .filter((p): p is Participant => !!p);

                if (assists.length > 0) {
                    const assistsRow = document.createElement("div");
                    assistsRow.className = "lr-marker-tooltip-assists";
                    for (const assistant of assists) {
                        const chip = document.createElement("img");
                        chip.className = "lr-marker-assist-icon";
                        if (assistant.participantId === selfParticipantId) chip.classList.add("is-self");
                        chip.alt = "";
                        chip.decoding = "async";
                        chip.loading = "eager";
                        assistsRow.appendChild(chip);
                    }
                    card.appendChild(assistsRow);
                }

                const timeRow = document.createElement("div");
                timeRow.className = "lr-marker-tooltip-time";
                timeRow.textContent = formatGameTime(detail.timestampMs);
                card.appendChild(timeRow);

                const killerChampionId = killer?.championId ?? 0;
                const victimChampionId = victim?.championId ?? 0;
                pendingIconTasks.push(
                    Promise.all([getChampionIconUrlCached(killerChampionId), getChampionIconUrlCached(victimChampionId)])
                        .then(([killerIcon, victimIcon]) => {
                            if (token !== renderToken) return;
                            setChampChipIcon(killerChip, killerIcon);
                            setChampChipIcon(victimChip, victimIcon);
                        })
                        .catch(() => {}),
                );

                const assistEls = [...card.querySelectorAll("img.lr-marker-assist-icon")] as HTMLImageElement[];
                pendingIconTasks.push(
                    Promise.all(
                        assistEls.map(async (imgEl, idx) => {
                            const assistant = assists[idx];
                            const url = await getChampionIconUrlCached(assistant?.championId ?? 0);
                            if (token !== renderToken) return;
                            if (url) imgEl.src = url;
                        }),
                    ).then(() => {}).catch(() => {}),
                );

                continue;
            }

            // Non-ChampionKill marker fallback: show label + time only.
            const markerColor = getComputedStyle(markerEl).color;
            card.style.borderColor = markerColor;

            const labelRow = document.createElement("div");
            labelRow.className = "lr-marker-tooltip-type";
            const typeText = document.createElement("span");
            typeText.textContent = detail.label;
            labelRow.appendChild(typeText);
            card.appendChild(labelRow);

            const timeRow = document.createElement("div");
            timeRow.className = "lr-marker-tooltip-time";
            timeRow.textContent = formatGameTime(detail.timestampMs);
            card.appendChild(timeRow);
        }

        tooltip!.style.display = "block";
        positionMarkerTooltipAboveSeekbar(playerElement, tooltip!, anchorClientX);

        await Promise.all(pendingIconTasks);
    };

    const showForMatches = (matches: Array<{ markerEl: HTMLElement; detailId: number }>, anchorClientX: number) => {
        const details = getMarkerDetails();
        const expanded = matches
            .map(({ markerEl, detailId }) => {
                const detail = details[detailId];
                if (!detail) return null;
                return { markerEl, detailId, detail };
            })
            .filter((m): m is { markerEl: HTMLElement; detailId: number; detail: MarkerDetail } => !!m);
        if (expanded.length === 0) return;

        activeMarkerEls = expanded.map((m) => m.markerEl);
        activeDetailIds = expanded.map((m) => m.detailId).sort((a, b) => a - b);
        renderToken++;
        renderOverlays(activeMarkerEls);
        void renderTooltipStack(expanded, anchorClientX, renderToken).catch(() => {});
    };

    const hideTooltip = () => {
        renderToken++;
        activeMarkerEls = [];
        activeDetailIds = [];
        clearEl(overlayContainer);
        if (tooltip) tooltip.style.display = "none";
    };

    let rafScheduled = false;
    let lastClientX = 0;
    let lastClientY = 0;

    const updateHover = () => {
        rafScheduled = false;

        const rHolder = progressHolder.getBoundingClientRect();
        if (lastClientY < rHolder.top || lastClientY > rHolder.bottom) {
            hideTooltip();
            return;
        }

        const markerEls = progressHolder.querySelectorAll(".vjs-marker") as NodeListOf<HTMLElement>;
        const matches: Array<{ markerEl: HTMLElement; detailId: number; dist: number }> = [];

        for (const markerEl of markerEls) {
            const detailId = extractDetailIdFromMarkerEl(markerEl);
            if (detailId === null) continue;
            const r = markerEl.getBoundingClientRect();
            // Use the rendered marker width as the hit-test area.
            if (lastClientX < r.left || lastClientX > r.right) continue;
            // Also require Y-axis hit-testing so Blue/Red/Self lanes can be distinguished.
            if (lastClientY < r.top || lastClientY > r.bottom) continue;
            const center = r.left + r.width / 2;
            const dist = Math.abs(lastClientX - center);
            matches.push({ markerEl, detailId, dist });
        }

        if (matches.length === 0) {
            hideTooltip();
            return;
        }

        matches.sort((a, b) => a.dist - b.dist);
        const next = matches.map((m) => ({ markerEl: m.markerEl, detailId: m.detailId }));
        const nextIdsSorted = next.map((m) => m.detailId).sort((a, b) => a - b);
        const idsChanged =
            nextIdsSorted.length !== activeDetailIds.length ||
            nextIdsSorted.some((id, i) => id !== activeDetailIds[i]);

        if (idsChanged) {
            showForMatches(next, lastClientX);
        } else if (tooltip && tooltip.style.display !== "none") {
            positionMarkerTooltipAboveSeekbar(playerElement, tooltip, lastClientX);
            renderOverlays(activeMarkerEls);
        }
    };

    progressHolder.addEventListener("pointermove", (e) => {
        lastClientX = (e as PointerEvent).clientX;
        lastClientY = (e as PointerEvent).clientY;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(updateHover);
    });

    progressHolder.addEventListener("mouseleave", () => hideTooltip());
    progressHolder.addEventListener("pointerdown", () => hideTooltip());
}
