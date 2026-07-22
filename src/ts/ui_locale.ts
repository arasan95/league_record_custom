export const UI_LANGUAGE_CHANGED_EVENT = "league-record-ui-language-changed";

type UiLanguage = "ja" | "en";

let currentUiLanguage: UiLanguage = typeof document !== "undefined" && document.documentElement.lang === "ja" ? "ja" : "en";

const STATIC_TEXT: Record<string, { ja: string; en: string }> = {
    youtubeSharedReplay: { ja: "YouTube共有リプレイ", en: "YouTube Shared Replays" },
    youtubePlayTitle: { ja: "YouTubeから再生", en: "Play from YouTube" },
    sharedReplayView: { ja: "共有リプレイの表示", en: "Shared replay views" },
    loadHistory: { ja: "読み込み履歴", en: "Load History" },
    myUploads: { ja: "自分の投稿", en: "My Uploads" },
    youtubeUrlHelp: { ja: "LeagueRecordで共有されたYouTube URLを入力してください。", en: "Enter a YouTube URL shared with LeagueRecord." },
    loadMatchData: { ja: "試合データを読み込む", en: "Load Match Data" },
    hideYoutubeUi: { ja: "YouTube UIを隠す", en: "Hide YouTube UI" },
    loaded: { ja: "読み込み済み", en: "Loaded" },
    clearAll: { ja: "すべてクリア", en: "Clear All" },
    loadedSharedReplays: { ja: "読み込み済みの共有リプレイ", en: "Loaded shared replays" },
    ownedInitial: { ja: "Googleアカウントから取得します。", en: "Load uploads from your Google account." },
    refresh: { ja: "更新", en: "Refresh" },
    ownedSharedReplays: { ja: "自分が投稿した共有リプレイ", en: "Shared replays uploaded by me" },
    collapseComments: { ja: "コメント欄を格納", en: "Collapse comments" },
    expandComments: { ja: "コメント欄を展開", en: "Expand comments" },
    reviewComments: { ja: "コメント", en: "Comments" },
    reviewCommentsAria: { ja: "復習コメント", en: "Review comments" },
    resizeComments: { ja: "コメント欄の幅を変更", en: "Resize comments sidebar" },
    filterComments: { ja: "コメント評価で絞り込み", en: "Filter comments by rating" },
    all: { ja: "すべて", en: "All" },
    flowComments: { ja: "コメントを動画上に流す", en: "Show scrolling comments over video" },
    hideComments: { ja: "◉ コメント非表示", en: "◉ Hide Comments" },
    sharedComments: { ja: "共有コメント", en: "Shared Comments" },
    checking: { ja: "確認中…", en: "Checking…" },
    connectGoogle: { ja: "Googleアカウントを接続", en: "Connect Google Account" },
    posting: { ja: "投稿", en: "Posting" },
    viewing: { ja: "閲覧", en: "Viewing" },
    allSignedInUsers: { ja: "ログインユーザー全員", en: "All signed-in users" },
    invitedUsersOnly: { ja: "招待ユーザーのみ", en: "Invited users only" },
    everyone: { ja: "全員", en: "Everyone" },
    saveSettings: { ja: "設定を保存", en: "Save Settings" },
    createInvite: { ja: "招待コードを発行", en: "Create Invite Code" },
    issuedInvite: { ja: "発行した招待コード", en: "Issued invite code" },
    inviteCode: { ja: "招待コード", en: "Invite code" },
    join: { ja: "参加", en: "Join" },
    displayGroup: { ja: "表示グループ", en: "Display Group" },
    chooseVideoComments: { ja: "動画を選ぶと、その動画のコメントが表示されます。", en: "Select a video to show its comments." },
    addAtCurrentTime: { ja: "現在の時刻にコメントを追加…", en: "Add a comment at the current time…" },
    rating: { ja: "評価", en: "Rating" },
    textColor: { ja: "文字色", en: "Text color" },
    color: { ja: "色", en: "Color" },
    size: { ja: "大きさ", en: "Size" },
    small: { ja: "小", en: "Small" },
    medium: { ja: "中", en: "Medium" },
    large: { ja: "大", en: "Large" },
    duration: { ja: "秒数", en: "Duration" },
    seconds3: { ja: "3秒", en: "3 sec" },
    seconds5: { ja: "5秒", en: "5 sec" },
    seconds8: { ja: "8秒", en: "8 sec" },
    seconds12: { ja: "12秒", en: "12 sec" },
    privateComment: { ja: "自分だけに表示", en: "Only show to me" },
    postCurrentTime: { ja: "現在時刻に投稿", en: "Post at Current Time" },
    dragHint: { ja: "コメントを動画へドラッグすると、その位置に固定表示できます。", en: "Drag a comment onto the video to pin it at that position." },
};

export function isJapaneseUi(): boolean {
    return currentUiLanguage === "ja";
}

export function normalizeUiLanguage(language: string): UiLanguage {
    return language === "ja" ? "ja" : "en";
}

export function uiText(japanese: string, english: string): string {
    return isJapaneseUi() ? japanese : english;
}

export function applyStaticUiLanguage(): void {
    document.querySelectorAll<HTMLElement>("[data-ui-text]").forEach((element) => {
        const copy = STATIC_TEXT[element.dataset.uiText ?? ""];
        if (copy) element.textContent = copy[currentUiLanguage];
    });
    document.querySelectorAll<HTMLElement>("[data-ui-title]").forEach((element) => {
        const copy = STATIC_TEXT[element.dataset.uiTitle ?? ""];
        if (copy) element.title = copy[currentUiLanguage];
    });
    document.querySelectorAll<HTMLElement>("[data-ui-aria-label]").forEach((element) => {
        const copy = STATIC_TEXT[element.dataset.uiAriaLabel ?? ""];
        if (copy) element.setAttribute("aria-label", copy[currentUiLanguage]);
    });
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-ui-placeholder]").forEach((element) => {
        const copy = STATIC_TEXT[element.dataset.uiPlaceholder ?? ""];
        if (copy) element.placeholder = copy[currentUiLanguage];
    });
}

export function setUiLanguage(language: string): void {
    currentUiLanguage = normalizeUiLanguage(language);
    document.documentElement.lang = currentUiLanguage;
    applyStaticUiLanguage();
    window.dispatchEvent(new CustomEvent(UI_LANGUAGE_CHANGED_EVENT, { detail: { language: currentUiLanguage } }));
}
