export type GoldDiffRowState = {
    className: string;
    html: string;
};

export type TeamLeadState = {
    team100GoldText: string;
    team200GoldText: string;
    team100LeadText: string;
    team200LeadText: string;
    team100LeadColor: string;
    team200LeadColor: string;
};

export function formatGoldText(gold: number): string {
    return gold >= 1000 ? `${(gold / 1000).toFixed(1)}k` : `${gold}`;
}

export function buildGoldDiffRowState(diff: number): GoldDiffRowState {
    if (diff > 0) {
        const diffStr = formatGoldText(diff);
        return {
            className: "center-diff-row blue-win",
            html: `<span class="diff-val"><span class="arrow arrow-left">\u25C0</span>${diffStr}</span>`,
        };
    }
    if (diff < 0) {
        const diffStr = formatGoldText(Math.abs(diff));
        return {
            className: "center-diff-row red-win",
            html: `<span class="diff-val">${diffStr}<span class="arrow arrow-right">\u25B6</span></span>`,
        };
    }
    return {
        className: "center-diff-row",
        html: `<span class="diff-val">-</span>`,
    };
}

export function buildTeamLeadState(team100Gold: number, team200Gold: number): TeamLeadState {
    const lead = team100Gold - team200Gold;
    const leadAbs = Math.abs(lead);
    const leadStr = leadAbs >= 1000 ? `${(leadAbs / 1000).toFixed(1)}k` : `${Math.round(leadAbs)}`;
    return {
        team100GoldText: `${(team100Gold / 1000).toFixed(1)}k`,
        team200GoldText: `${(team200Gold / 1000).toFixed(1)}k`,
        team100LeadText: lead > 0 ? `+${leadStr}` : "",
        team200LeadText: lead < 0 ? `+${leadStr}` : "",
        team100LeadColor: lead > 0 ? "gold" : "transparent",
        team200LeadColor: lead < 0 ? "gold" : "transparent",
    };
}
