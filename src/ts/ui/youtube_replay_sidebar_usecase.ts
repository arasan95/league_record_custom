import type { LoadedReplayShare } from "../replay_share";

export function updateYouTubeReplayStatus(message: string, isError = false): void {
    const status = document.querySelector<HTMLElement>("#youtube-replay-status");
    if (!status) return;
    status.classList.toggle("is-error", isError);
    status.textContent = message;
}

export function bindYouTubeReplaySidebar(input: {
    loadReplay: (url: string) => Promise<LoadedReplayShare>;
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

    const setReplayMode = (enabled: boolean) => {
        sidebar.classList.toggle("replay-mode", enabled);
        if (enabled) {
            document.querySelectorAll<HTMLElement>("#server-nav .server-icon").forEach((button) => button.classList.remove("active"));
            replayButton.classList.add("active");
            requestAnimationFrame(() => urlInput.focus());
        } else {
            replayButton.classList.remove("active");
        }
    };

    replayButton.addEventListener("click", () => setReplayMode(true));
    document.querySelectorAll<HTMLElement>("#server-nav .server-icon:not(#nav-youtube-replay)").forEach((button) => {
        button.addEventListener("click", () => setReplayMode(false));
    });

    const submit = async () => {
        updateYouTubeReplayStatus("Firestoreから試合データを取得しています…");
        summary.hidden = true;
        loadButton.disabled = true;
        loadButton.textContent = "読み込んでいます…";
        try {
            console.info("[youtube-replay] loading Firestore share", { url: urlInput.value.trim() });
            const loaded = await input.loadReplay(urlInput.value);
            console.info("[youtube-replay] share loaded", { videoId: loaded.youtubeVideoId });
            summaryTitle.textContent = "";
            summaryId.textContent = "";
            summary.hidden = true;
            updateYouTubeReplayStatus("試合データを読み込み、YouTube動画をプレイヤーに表示しました。");
            urlInput.blur();
            document.querySelector<HTMLElement>("#video_player")?.focus({ preventScroll: true });
        } catch (error) {
            console.error("[youtube-replay] failed to load shared replay", error);
            updateYouTubeReplayStatus(error instanceof Error ? error.message : String(error), true);
        } finally {
            loadButton.disabled = false;
            loadButton.textContent = "試合データを読み込む";
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
