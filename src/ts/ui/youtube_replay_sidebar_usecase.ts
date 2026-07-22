import type { LoadedReplayShare } from "../replay_share";
import { uiText } from "../ui_locale";

export function updateYouTubeReplayStatus(message: string, isError = false): void {
    const status = document.querySelector<HTMLElement>("#youtube-replay-status");
    if (!status) return;
    status.classList.toggle("is-error", isError);
    status.textContent = message;
}

export function bindYouTubeReplaySidebar(input: {
    loadReplay: (url: string) => Promise<LoadedReplayShare>;
    refreshOwnedReplays: () => Promise<void>;
}): void {
    const sidebar = document.querySelector<HTMLElement>("#sidebar");
    const replayButton = document.querySelector<HTMLButtonElement>("#nav-youtube-replay");
    const urlInput = document.querySelector<HTMLTextAreaElement>("#youtube-replay-url");
    const loadButton = document.querySelector<HTMLButtonElement>("#youtube-replay-load");
    const status = document.querySelector<HTMLElement>("#youtube-replay-status");
    const summary = document.querySelector<HTMLElement>("#youtube-replay-summary");
    const summaryTitle = document.querySelector<HTMLElement>("#youtube-replay-summary-title");
    const summaryId = document.querySelector<HTMLElement>("#youtube-replay-summary-id");
    if (!sidebar || !replayButton || !urlInput || !loadButton || !status || !summary || !summaryTitle || !summaryId) return;

    const historyTab = document.querySelector<HTMLButtonElement>("#youtube-replay-history-tab");
    const ownedTab = document.querySelector<HTMLButtonElement>("#youtube-replay-owned-tab");
    const historyPanel = document.querySelector<HTMLElement>("#youtube-replay-history-panel");
    const ownedPanel = document.querySelector<HTMLElement>("#youtube-replay-owned-panel");
    const ownedRefresh = document.querySelector<HTMLButtonElement>("#youtube-replay-owned-refresh");
    let ownedLoaded = false;
    let ownedLoading = false;
    const refreshOwned = async () => {
        if (ownedLoading) return;
        ownedLoading = true;
        if (ownedRefresh) ownedRefresh.disabled = true;
        try {
            await input.refreshOwnedReplays();
            ownedLoaded = true;
        } finally {
            ownedLoading = false;
            if (ownedRefresh) ownedRefresh.disabled = false;
        }
    };
    const selectTab = (tab: "history" | "owned") => {
        const showOwned = tab === "owned";
        historyTab?.setAttribute("aria-selected", String(!showOwned));
        ownedTab?.setAttribute("aria-selected", String(showOwned));
        if (historyPanel) historyPanel.hidden = showOwned;
        if (ownedPanel) ownedPanel.hidden = !showOwned;
        if (showOwned && !ownedLoaded && !ownedLoading) void refreshOwned();
        if (!showOwned) requestAnimationFrame(() => urlInput.focus());
    };
    historyTab?.addEventListener("click", () => selectTab("history"));
    ownedTab?.addEventListener("click", () => selectTab("owned"));
    ownedRefresh?.addEventListener("click", () => void refreshOwned());

    const setReplayMode = (enabled: boolean) => {
        sidebar.classList.toggle("replay-mode", enabled);
        if (enabled) {
            document.querySelectorAll<HTMLElement>("#server-nav .server-icon").forEach((button) => button.classList.remove("active"));
            replayButton.classList.add("active");
            if (historyTab?.getAttribute("aria-selected") !== "false") requestAnimationFrame(() => urlInput.focus());
        } else {
            replayButton.classList.remove("active");
        }
    };

    replayButton.addEventListener("click", () => setReplayMode(true));
    document.querySelectorAll<HTMLElement>("#server-nav .server-icon:not(#nav-youtube-replay)").forEach((button) => {
        button.addEventListener("click", () => setReplayMode(false));
    });

    const submit = async () => {
        updateYouTubeReplayStatus(uiText("Firestoreから試合データを取得しています…", "Loading match data from Firestore…"));
        summary.hidden = true;
        loadButton.disabled = true;
        loadButton.textContent = uiText("読み込んでいます…", "Loading…");
        try {
            console.info("[youtube-replay] loading Firestore share", { url: urlInput.value.trim() });
            const loaded = await input.loadReplay(urlInput.value);
            console.info("[youtube-replay] share loaded", { videoId: loaded.youtubeVideoId });
            summaryTitle.textContent = "";
            summaryId.textContent = "";
            summary.hidden = true;
            updateYouTubeReplayStatus(uiText(
                "試合データを読み込み、YouTube動画をプレイヤーに表示しました。",
                "Match data loaded and the YouTube video is now displayed in the player.",
            ));
            urlInput.blur();
            document.querySelector<HTMLElement>("#video_player")?.focus({ preventScroll: true });
        } catch (error) {
            console.error("[youtube-replay] failed to load shared replay", error);
            updateYouTubeReplayStatus(error instanceof Error ? error.message : String(error), true);
        } finally {
            loadButton.disabled = false;
            loadButton.textContent = uiText("試合データを読み込む", "Load Match Data");
        }
    };

    loadButton.addEventListener("click", () => void submit());
    urlInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
        }
    });
}
