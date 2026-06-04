import type { ClipFilterMode, ServerFilter } from "./recording_filters_usecase";

export function bindRecordingFilterControls(params: {
    navFilterAllBtn: HTMLButtonElement;
    navFilterLolBtn: HTMLButtonElement;
    navFilterSrBtn: HTMLButtonElement;
    navFilterAramBtn: HTMLButtonElement;
    navFilterOtherBtn: HTMLButtonElement;
    navFilterTftBtn: HTMLButtonElement;
    roleFiltersContainer: HTMLDivElement | null;
    roleFilterBtns: HTMLButtonElement[] | null;
    filterStarBtn: HTMLButtonElement;
    filterClipBtn: HTMLButtonElement;
    filterRankedBtn: HTMLButtonElement;
    filterSearchBtn: HTMLButtonElement;
    searchBarContainer: HTMLDivElement;
    searchInput: HTMLInputElement;
    searchAllyInput: HTMLInputElement;
    searchEnemyInput: HTMLInputElement;
    searchUserInput: HTMLInputElement;
    searchQueueInput: HTMLInputElement;
    state: {
        getFilterServer: () => ServerFilter;
        setFilterServer: (value: ServerFilter) => void;
        getFilterRole: () => string | null;
        setFilterRole: (value: string | null) => void;
        getFilterStar: () => boolean;
        setFilterStar: (value: boolean) => void;
        getClipFilterMode: () => ClipFilterMode;
        setClipFilterMode: (value: ClipFilterMode) => void;
        getFilterRanked: () => boolean;
        setFilterRanked: (value: boolean) => void;
        getFilterSearch: () => boolean;
        setFilterSearch: (value: boolean) => void;
        setSearchQuery: (value: string) => void;
        setSearchAllyQuery: (value: string) => void;
        setSearchEnemyQuery: (value: string) => void;
        setSearchUserQuery: (value: string) => void;
        setSearchQueueQuery: (value: string) => void;
    };
    onFiltersChanged: () => void;
}): void {
    const {
        navFilterAllBtn,
        navFilterLolBtn,
        navFilterSrBtn,
        navFilterAramBtn,
        navFilterOtherBtn,
        navFilterTftBtn,
        roleFiltersContainer,
        roleFilterBtns,
        filterStarBtn,
        filterClipBtn,
        filterRankedBtn,
        filterSearchBtn,
        searchBarContainer,
        searchInput,
        searchAllyInput,
        searchEnemyInput,
        searchUserInput,
        searchQueueInput,
        state,
        onFiltersChanged,
    } = params;

    const updateServerNavActiveState = () => {
        navFilterAllBtn?.classList.remove("active");
        navFilterLolBtn?.classList.remove("active");
        navFilterSrBtn?.classList.remove("active");
        navFilterAramBtn?.classList.remove("active");
        navFilterOtherBtn?.classList.remove("active");
        navFilterTftBtn?.classList.remove("active");

        const filterServer = state.getFilterServer();
        if (filterServer === "ALL") navFilterAllBtn?.classList.add("active");
        if (filterServer === "LOL" || filterServer === "SR" || filterServer === "ARAM" || filterServer === "OTHER") {
            navFilterLolBtn?.classList.add("active");
        }
        if (filterServer === "SR") navFilterSrBtn?.classList.add("active");
        if (filterServer === "ARAM") navFilterAramBtn?.classList.add("active");
        if (filterServer === "OTHER") navFilterOtherBtn?.classList.add("active");
        if (filterServer === "TFT") navFilterTftBtn?.classList.add("active");

        if (roleFiltersContainer) {
            if (filterServer === "SR") {
                roleFiltersContainer.classList.remove("hidden");
            } else {
                roleFiltersContainer.classList.add("hidden");
                state.setFilterRole(null);
            }
        }

        if (roleFilterBtns) {
            const filterRole = state.getFilterRole();
            roleFilterBtns.forEach((btn) => {
                const r = btn.getAttribute("data-role");
                if (filterRole && r === filterRole) {
                    btn.classList.add("active");
                } else {
                    btn.classList.remove("active");
                }
            });
        }
    };

    navFilterAllBtn?.addEventListener("click", () => {
        state.setFilterServer("ALL");
        updateServerNavActiveState();
        onFiltersChanged();
    });
    navFilterLolBtn?.addEventListener("click", () => {
        state.setFilterServer(state.getFilterServer() === "LOL" ? "ALL" : "LOL");
        updateServerNavActiveState();
        onFiltersChanged();
    });
    navFilterSrBtn?.addEventListener("click", () => {
        state.setFilterServer(state.getFilterServer() === "SR" ? "LOL" : "SR");
        updateServerNavActiveState();
        onFiltersChanged();
    });
    navFilterAramBtn?.addEventListener("click", () => {
        state.setFilterServer(state.getFilterServer() === "ARAM" ? "LOL" : "ARAM");
        updateServerNavActiveState();
        onFiltersChanged();
    });
    navFilterOtherBtn?.addEventListener("click", () => {
        state.setFilterServer(state.getFilterServer() === "OTHER" ? "LOL" : "OTHER");
        updateServerNavActiveState();
        onFiltersChanged();
    });
    navFilterTftBtn?.addEventListener("click", () => {
        state.setFilterServer(state.getFilterServer() === "TFT" ? "ALL" : "TFT");
        updateServerNavActiveState();
        onFiltersChanged();
    });

    roleFilterBtns?.forEach((btn) => {
        btn.addEventListener("click", () => {
            const role = btn.getAttribute("data-role");
            if (state.getFilterRole() === role) {
                state.setFilterRole(null);
            } else {
                state.setFilterRole(role);
            }
            updateServerNavActiveState();
            onFiltersChanged();
        });
    });

    filterStarBtn?.addEventListener("click", () => {
        const next = !state.getFilterStar();
        state.setFilterStar(next);
        filterStarBtn.classList.toggle("active", next);
        filterStarBtn.style.color = next ? "gold" : "";
        onFiltersChanged();
    });

    const applyClipFilterVisual = (mode: ClipFilterMode) => {
        filterClipBtn.classList.remove("exclude");
        if (mode === "only") {
            filterClipBtn.classList.add("active");
            filterClipBtn.style.color = "#00d2ff";
            return;
        }
        if (mode === "exclude") {
            filterClipBtn.classList.remove("active");
            filterClipBtn.classList.add("exclude");
            filterClipBtn.style.color = "";
            return;
        }
        filterClipBtn.classList.remove("active");
        filterClipBtn.style.color = "";
    };

    filterClipBtn?.addEventListener("click", () => {
        const current = state.getClipFilterMode();
        const next: ClipFilterMode = current === "all" ? "only" : current === "only" ? "exclude" : "all";
        state.setClipFilterMode(next);
        applyClipFilterVisual(next);
        onFiltersChanged();
    });

    filterRankedBtn?.addEventListener("click", () => {
        const next = !state.getFilterRanked();
        state.setFilterRanked(next);
        filterRankedBtn.classList.toggle("active", next);
        filterRankedBtn.style.color = next ? "#2de09e" : "";
        onFiltersChanged();
    });

    filterSearchBtn?.addEventListener("click", () => {
        const next = !state.getFilterSearch();
        state.setFilterSearch(next);
        filterSearchBtn.classList.toggle("active", next);
        filterSearchBtn.style.color = next ? "#ffaa00" : "";

        if (next) {
            searchBarContainer.classList.remove("hidden");
            searchBarContainer.style.display = "";
            searchInput.focus();
        } else {
            searchBarContainer.classList.add("hidden");
            searchInput.value = "";
            searchAllyInput.value = "";
            searchEnemyInput.value = "";
            searchUserInput.value = "";
            searchQueueInput.value = "";
            state.setSearchQuery("");
            state.setSearchAllyQuery("");
            state.setSearchEnemyQuery("");
            state.setSearchUserQuery("");
            state.setSearchQueueQuery("");
        }
        onFiltersChanged();
    });

    searchInput?.addEventListener("input", (e) => {
        state.setSearchQuery((e.target as HTMLInputElement).value.toLowerCase());
        onFiltersChanged();
    });
    searchAllyInput?.addEventListener("input", (e) => {
        state.setSearchAllyQuery((e.target as HTMLInputElement).value.toLowerCase());
        onFiltersChanged();
    });
    searchEnemyInput?.addEventListener("input", (e) => {
        state.setSearchEnemyQuery((e.target as HTMLInputElement).value.toLowerCase());
        onFiltersChanged();
    });
    searchUserInput?.addEventListener("input", (e) => {
        state.setSearchUserQuery((e.target as HTMLInputElement).value.toLowerCase());
        onFiltersChanged();
    });
    searchQueueInput?.addEventListener("input", (e) => {
        state.setSearchQueueQuery((e.target as HTMLInputElement).value.toLowerCase());
        onFiltersChanged();
    });

    applyClipFilterVisual(state.getClipFilterMode());
    updateServerNavActiveState();
}
