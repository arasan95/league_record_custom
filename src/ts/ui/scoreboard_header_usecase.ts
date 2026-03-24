export type Side = "blue" | "red";

export type HeaderRefs = {
    team100GoldText: HTMLElement | null;
    team200GoldText: HTMLElement | null;
    team100LeadText: HTMLElement | null;
    team200LeadText: HTMLElement | null;
    team100KillsText: HTMLElement | null;
    team200KillsText: HTMLElement | null;
    team100TowerText: HTMLElement | null;
    team200TowerText: HTMLElement | null;
    team100DragonText: HTMLElement | null;
    team200DragonText: HTMLElement | null;
    team100BaronText: HTMLElement | null;
    team200BaronText: HTMLElement | null;
    team100VoidgrubText: HTMLElement | null;
    team200VoidgrubText: HTMLElement | null;
    team100HeraldText: HTMLElement | null;
    team200HeraldText: HTMLElement | null;
    headerTimeText: HTMLElement | null;
    baronTimerText: HTMLElement | null;
    baronTimerIcon: HTMLImageElement | null;
    baronTimerGroup2: HTMLElement | null;
    baronTimerText2: HTMLElement | null;
    baronTimerIcon2: HTMLImageElement | null;
    dragonTimerText: HTMLElement | null;
    dragonTimerIcon: HTMLImageElement | null;
};

type BuildHeaderInput = {
    createEl: (...args: any[]) => any;
    spectatorHeader: HTMLElement;
    monoTower: string;
    monoVoidgrub: string;
    monoDrake: string;
    stats: {
        t100Kills: number;
        t200Kills: number;
        t100Gold: number;
        t200Gold: number;
        t100Towers: number;
        t200Towers: number;
        t100Dragons: number;
        t200Dragons: number;
        t100Barons: number;
        t200Barons: number;
        t100Grubs: number;
        t200Grubs: number;
        t100Heralds: number;
        t200Heralds: number;
    };
    isSR: boolean;
    isTFT: boolean;
};

type TimerParts = {
    container: HTMLElement;
    text: HTMLElement;
    icon: HTMLImageElement;
    group2: HTMLElement;
    text2: HTMLElement;
    icon2: HTMLImageElement;
};

function formatGold(g: number): string {
    return `${(g / 1000).toFixed(1)}k`;
}

export function buildSpectatorHeader(input: BuildHeaderInput): { refs: HeaderRefs; blueHeader: HTMLElement; redHeader: HTMLElement } {
    const { createEl, spectatorHeader, monoTower, monoVoidgrub, monoDrake, stats, isSR, isTFT } = input;

    const refs: HeaderRefs = {
        team100GoldText: null,
        team200GoldText: null,
        team100LeadText: null,
        team200LeadText: null,
        team100KillsText: null,
        team200KillsText: null,
        team100TowerText: null,
        team200TowerText: null,
        team100DragonText: null,
        team200DragonText: null,
        team100BaronText: null,
        team200BaronText: null,
        team100VoidgrubText: null,
        team200VoidgrubText: null,
        team100HeraldText: null,
        team200HeraldText: null,
        headerTimeText: null,
        baronTimerText: null,
        baronTimerIcon: null,
        baronTimerGroup2: null,
        baronTimerText2: null,
        baronTimerIcon2: null,
        dragonTimerText: null,
        dragonTimerIcon: null,
    };

    const assignRef = (side: Side, sub: string, valDiv: HTMLElement, leadDiv: HTMLElement | null = null) => {
        if (sub === "Gold") {
            if (side === "blue") {
                refs.team100GoldText = valDiv;
                refs.team100LeadText = leadDiv;
            } else {
                refs.team200GoldText = valDiv;
                refs.team200LeadText = leadDiv;
            }
        } else if (sub === "Kills") {
            if (side === "blue") refs.team100KillsText = valDiv;
            else refs.team200KillsText = valDiv;
        } else if (sub === "Towers") {
            if (side === "blue") refs.team100TowerText = valDiv;
            else refs.team200TowerText = valDiv;
        } else if (sub === "Dragons") {
            if (side === "blue") refs.team100DragonText = valDiv;
            else refs.team200DragonText = valDiv;
        } else if (sub === "Barons") {
            if (side === "blue") refs.team100BaronText = valDiv;
            else refs.team200BaronText = valDiv;
        } else if (sub === "Grubs") {
            if (side === "blue") refs.team100VoidgrubText = valDiv;
            else refs.team200VoidgrubText = valDiv;
        } else if (sub === "Heralds") {
            if (side === "blue") refs.team100HeraldText = valDiv;
            else refs.team200HeraldText = valDiv;
        }
    };

    const createStat = (val: string | number, sub: string, side: Side, iconUrl?: string, isGold = false): HTMLElement => {
        const el = createEl("div", {}, { class: "spec-stat" }) as HTMLElement;
        if (iconUrl) {
            el.append(createEl("img", { src: iconUrl }, { class: "spec-icon" }));
        }
        const contentDiv = createEl("div", {}, { style: "display: flex; flex-direction: column; align-items: center;" }) as HTMLElement;
        const valDiv = createEl("div", {}, { class: "spec-val" }, `${val}`) as HTMLElement;
        contentDiv.append(valDiv);

        let leadDiv: HTMLElement | null = null;
        if (isGold) {
            leadDiv = createEl(
                "div",
                {},
                { class: "gold-lead", style: "font-size: 12px; height: 12px; line-height: 12px; font-weight: bold;" },
                "",
            ) as HTMLElement;
            contentDiv.append(leadDiv);
        }
        assignRef(side, sub, valDiv, leadDiv);
        el.append(contentDiv);
        return el;
    };

    const createTeamHeader = (side: Side): HTMLElement => {
        const isBlue = side === "blue";
        const kills = isBlue ? stats.t100Kills : stats.t200Kills;
        const gold = isBlue ? stats.t100Gold : stats.t200Gold;
        const towers = isBlue ? stats.t100Towers : stats.t200Towers;
        const dragons = isBlue ? stats.t100Dragons : stats.t200Dragons;
        const barons = isBlue ? stats.t100Barons : stats.t200Barons;
        const grubs = isBlue ? stats.t100Grubs : stats.t200Grubs;
        const heralds = isBlue ? stats.t100Heralds : stats.t200Heralds;

        const container = createEl("div", {}, { class: `spec-team ${side}` }) as HTMLElement;
        const towersStat = createStat(towers, "Towers", side, monoTower, false);
        const grubsStat = createStat(grubs, "Grubs", side, monoVoidgrub, false);
        const dragonsStat = createStat(dragons, "Dragons", side, monoDrake, false);
        // Keep baron/herald values in refs for live updates even if hidden in UI.
        createStat(barons, "Barons", side);
        createStat(heralds, "Heralds", side);

        const objList = [towersStat, grubsStat, dragonsStat];
        if (isBlue) objList.reverse();
        const objectivesDiv = createEl("div", {}, { class: "spec-obj-group" }, objList) as HTMLElement;

        const goldDiv = createStat(formatGold(gold), "Gold", side, undefined, true);
        goldDiv.classList.add("gold-stat");
        const killsDiv = createStat(kills, "Kills", side);
        killsDiv.classList.add("kill-stat");

        if (isBlue) {
            container.append(objectivesDiv, goldDiv, killsDiv);
            container.style.justifyContent = "flex-end";
        } else {
            container.append(killsDiv, goldDiv, objectivesDiv);
            container.style.justifyContent = "flex-start";
        }
        return container;
    };

    const createTimer = (className: string): TimerParts => {
        const container = createEl("div", {}, { class: `spec-timer-container ${className}` }) as HTMLElement;
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.gap = "5px";
        container.style.minWidth = "90px";
        container.style.justifyContent = "center";

        const primaryGroup = createEl("div", {}, { class: "timer-group primary" }) as HTMLElement;
        primaryGroup.style.display = "flex";
        primaryGroup.style.alignItems = "center";
        primaryGroup.style.gap = "5px";

        const icon = createEl("img", {}, { class: "spec-timer-icon" }) as HTMLImageElement;
        icon.style.width = "40px";
        icon.style.height = "40px";
        icon.style.objectFit = "contain";

        const text = createEl("div", {}, { class: "spec-timer-text" }, "05:00") as HTMLElement;
        text.style.fontSize = "1.2rem";
        text.style.fontWeight = "bold";
        text.style.textAlign = "center";

        if (className.includes("baron")) primaryGroup.append(icon, text);
        else primaryGroup.append(text, icon);

        const secondaryGroup = createEl("div", {}, { class: "timer-group secondary" }) as HTMLElement;
        secondaryGroup.style.display = "none";
        secondaryGroup.style.alignItems = "center";
        secondaryGroup.style.gap = "5px";
        secondaryGroup.style.marginLeft = "10px";

        const icon2 = createEl("img", {}, { class: "spec-timer-icon" }) as HTMLImageElement;
        icon2.style.width = "32px";
        icon2.style.height = "32px";
        icon2.style.objectFit = "contain";
        icon2.style.opacity = "0.8";

        const text2 = createEl("div", {}, { class: "spec-timer-text" }, "00:00") as HTMLElement;
        text2.style.fontSize = "1.0rem";
        text2.style.fontWeight = "bold";
        text2.style.color = "#ccc";

        secondaryGroup.append(icon2, text2);
        container.append(primaryGroup, secondaryGroup);
        return { container, text, icon, group2: secondaryGroup, text2, icon2 };
    };

    const bTimer = createTimer("baron-timer");
    refs.baronTimerText = bTimer.text;
    refs.baronTimerIcon = bTimer.icon;
    refs.baronTimerGroup2 = bTimer.group2;
    refs.baronTimerText2 = bTimer.text2;
    refs.baronTimerIcon2 = bTimer.icon2;
    refs.baronTimerIcon.src = monoVoidgrub;

    const dTimer = createTimer("dragon-timer");
    refs.dragonTimerText = dTimer.text;
    refs.dragonTimerIcon = dTimer.icon;
    refs.dragonTimerIcon.src = monoDrake;

    if (!isSR) {
        bTimer.container.style.display = "none";
        dTimer.container.style.display = "none";
    }

    spectatorHeader.append(bTimer.container);
    const blueHeader = createTeamHeader("blue");
    spectatorHeader.append(blueHeader);

    const centerParams = createEl("div", {}, { class: "spec-center" }, "00:00") as HTMLElement;
    refs.headerTimeText = centerParams;
    spectatorHeader.append(centerParams);

    const redHeader = createTeamHeader("red");
    spectatorHeader.append(redHeader);
    spectatorHeader.append(dTimer.container);

    if (isTFT) {
        blueHeader.style.display = "none";
        redHeader.style.display = "none";
    }

    spectatorHeader.style.display = "flex";
    return { refs, blueHeader, redHeader };
}

export function assignScoreboardHeaderRefs(target: HeaderRefs, refs: HeaderRefs): void {
    target.team100GoldText = refs.team100GoldText;
    target.team200GoldText = refs.team200GoldText;
    target.team100LeadText = refs.team100LeadText;
    target.team200LeadText = refs.team200LeadText;
    target.team100KillsText = refs.team100KillsText;
    target.team200KillsText = refs.team200KillsText;
    target.team100TowerText = refs.team100TowerText;
    target.team200TowerText = refs.team200TowerText;
    target.team100DragonText = refs.team100DragonText;
    target.team200DragonText = refs.team200DragonText;
    target.team100BaronText = refs.team100BaronText;
    target.team200BaronText = refs.team200BaronText;
    target.team100VoidgrubText = refs.team100VoidgrubText;
    target.team200VoidgrubText = refs.team200VoidgrubText;
    target.team100HeraldText = refs.team100HeraldText;
    target.team200HeraldText = refs.team200HeraldText;
    target.headerTimeText = refs.headerTimeText;
    target.baronTimerText = refs.baronTimerText;
    target.baronTimerIcon = refs.baronTimerIcon;
    target.baronTimerGroup2 = refs.baronTimerGroup2;
    target.baronTimerText2 = refs.baronTimerText2;
    target.baronTimerIcon2 = refs.baronTimerIcon2;
    target.dragonTimerText = refs.dragonTimerText;
    target.dragonTimerIcon = refs.dragonTimerIcon;
}
