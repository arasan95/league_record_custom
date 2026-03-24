type RowLayoutElements = {
    champIconWrap: HTMLElement;
    csDiv: HTMLElement;
    kdaDiv: HTMLElement;
    itemsGrid: HTMLElement;
    trinketDiv: HTMLElement;
    spells: HTMLElement;
    runesDiv: HTMLElement;
    goldDiv: HTMLElement;
    metaDiv: HTMLElement;
    name: HTMLElement;
};

export function applyScoreboardRowLayout(teamId: number, el: RowLayoutElements): void {
    if (teamId === 200) {
        el.champIconWrap.style.order = "1";
        el.csDiv.style.order = "2";
        el.kdaDiv.style.order = "3";
        el.itemsGrid.style.order = "4";
        el.trinketDiv.style.order = "5";
        el.spells.style.order = "6";
        el.runesDiv.style.order = "7";
        el.goldDiv.style.order = "8";
        el.metaDiv.style.order = "9";
        el.name.style.order = "10";

        el.metaDiv.style.textAlign = "center";
        el.metaDiv.style.marginRight = "0px";
        el.metaDiv.style.marginLeft = "0px";
        el.itemsGrid.style.flexDirection = "row";
        el.itemsGrid.style.justifyContent = "flex-start";
        return;
    }

    el.name.style.order = "1";
    el.metaDiv.style.order = "2";
    el.goldDiv.style.order = "3";
    el.runesDiv.style.order = "4";
    el.spells.style.order = "5";
    el.trinketDiv.style.order = "6";
    el.itemsGrid.style.order = "7";
    el.kdaDiv.style.order = "8";
    el.csDiv.style.order = "9";
    el.champIconWrap.style.order = "10";

    el.metaDiv.style.textAlign = "center";
    el.metaDiv.style.marginLeft = "0px";
    el.metaDiv.style.marginRight = "0px";
    el.itemsGrid.style.flexDirection = "row-reverse";
    el.itemsGrid.style.justifyContent = "flex-end";
}
