import {
    connectReplayShareGoogle,
    ensureCommunityAccountProfile,
    getCommunityAccountProfile,
    getReplayShareAuthStatus,
    saveCommunityAccountName,
    saveCommunityRiotAccount,
    signOutReplayShareAuth,
    unlinkCommunityRiotAccount,
} from "../platform/firebase";
import {
    getYouTubeAuthStatus,
    getYouTubeChannelCapabilities,
    getYouTubeFirebaseIdToken,
    reopenYouTubeSignIn,
    signInToYouTube,
    signOutFromYouTube,
    YOUTUBE_AUTH_CHANGED_EVENT,
    YOUTUBE_AUTH_CONNECTED_EVENT,
} from "../platform/youtube";
import type { YouTubeChannelCapabilities } from "../platform/youtube";
import { open } from "../platform/shell";
import { getCurrentLolAccountForLink } from "../platform/lol_account";
import type { Language } from "../i18n";
import { COMMUNITY_ACCOUNT_NAME_MAX_LENGTH } from "../community_identity";
import type { UiCreateEl } from "./settings_primitives";

function dispatchAuthChanged(connected: boolean): void {
    window.dispatchEvent(new Event(YOUTUBE_AUTH_CHANGED_EVENT));
    if (connected) window.dispatchEvent(new Event(YOUTUBE_AUTH_CONNECTED_EVENT));
}

export function createSettingsAccountTabContent(input: {
    createEl: UiCreateEl;
    lang: Language;
}): HTMLDivElement {
    const { createEl, lang } = input;
    const ja = lang === "ja";
    const tab = createEl("div", {}, { class: "settings-tab-content settings-scroll-container hidden settings-account-tab" }) as HTMLDivElement;
    const wrapper = createEl("div", {}, { class: "settings-account-wrapper" });
    const title = createEl("h3", {}, {}, ja ? "Googleアカウント" : "Google Account");
    const description = createEl("p", {}, { class: "settings-account-description" }, ja
        ? "YouTubeへのアップロード、共有リプレイ、招待コメントで使用するGoogleアカウントを管理します。"
        : "Manage the Google account used for YouTube uploads, shared replays, and invited comments.");
    const card = createEl("section", {}, { class: "settings-account-card" });
    const avatar = createEl("div", {}, { class: "settings-account-avatar", "aria-hidden": "true" }, "G") as HTMLDivElement;
    const identity = createEl("div", {}, { class: "settings-account-identity" });
    const name = createEl("strong", {}, {}, ja ? "接続状態を確認中…" : "Checking connection…");
    const email = createEl("span", {}, {}, "") as HTMLSpanElement;
    const state = createEl("span", {}, { class: "settings-account-state" }, "") as HTMLSpanElement;
    const publicId = createEl("code", {}, { class: "settings-account-public-id" }, "") as HTMLElement;
    identity.append(name, email, state, publicId);
    const status = createEl("div", {}, { class: "settings-account-message", role: "status", "aria-live": "polite" }, "") as HTMLDivElement;
    const actions = createEl("div", {}, { class: "settings-account-actions" });
    const connect = createEl("button", {}, { class: "settings-account-connect", type: "button" }, ja ? "Googleアカウントを接続" : "Connect Google Account") as HTMLButtonElement;
    const disconnect = createEl("button", {}, { class: "settings-account-disconnect", type: "button" }, ja ? "接続を解除" : "Disconnect") as HTMLButtonElement;
    actions.append(connect, disconnect);
    const profileEditor = createEl("section", {}, { class: "settings-account-profile-editor" }) as HTMLElement;
    const riotSection = createEl("section", {}, { class: "settings-riot-account" }) as HTMLElement;
    const riotHeader = createEl("div", {}, { class: "settings-riot-account-header" });
    const riotHeading = createEl("strong", {}, {}, ja ? "League of Legendsアカウント" : "League of Legends Account");
    const riotState = createEl("span", {}, { class: "settings-riot-account-state" }, ja ? "未連携" : "Not linked") as HTMLSpanElement;
    riotHeader.append(riotHeading, riotState);
    const riotIdentity = createEl("div", {}, { class: "settings-riot-account-identity" }) as HTMLDivElement;
    const riotRanks = createEl("div", {}, { class: "settings-riot-account-ranks" }) as HTMLDivElement;
    const riotHint = createEl("p", {}, {}, ja
        ? "起動中のLoLクライアントからRiot IDとランクを確認します。ランク限定コメントへの投稿に使用されます。"
        : "Verifies your Riot ID and ranks from the running LoL client. Used for rank-verified comment access.");
    const riotActions = createEl("div", {}, { class: "settings-riot-account-actions" });
    const linkRiot = createEl("button", {}, { type: "button" }, ja ? "起動中のLoLアカウントを連携" : "Link Running LoL Account") as HTMLButtonElement;
    const unlinkRiot = createEl("button", {}, { type: "button", class: "settings-riot-account-unlink" }, ja ? "LoL連携を解除" : "Unlink LoL Account") as HTMLButtonElement;
    riotActions.append(linkRiot, unlinkRiot);
    riotSection.append(riotHeader, riotIdentity, riotRanks, riotHint, riotActions);
    const capabilitySection = createEl("section", {}, { class: "settings-youtube-capabilities" }) as HTMLElement;
    const capabilityHeader = createEl("div", {}, { class: "settings-youtube-capabilities-header" });
    const capabilityTitle = createEl("div", {}, {}, ja ? "YouTubeチャンネルの利用機能" : "YouTube channel features");
    const studioButton = createEl("button", {}, { type: "button" }, ja ? "YouTube Studioで確認" : "Check in YouTube Studio") as HTMLButtonElement;
    studioButton.addEventListener("click", () => void open("https://studio.youtube.com/"));
    capabilityHeader.append(capabilityTitle, studioButton);
    const capabilityHint = createEl("p", {}, {}, ja
        ? "YouTube APIで確認できる項目と、このアプリでの設定実績を表示します。"
        : "Shows information available from the YouTube API and results observed by this app.");
    const capabilityList = createEl("div", {}, { class: "settings-youtube-capability-list" });
    capabilitySection.append(capabilityHeader, capabilityHint, capabilityList);
    const accountNameLabel = createEl("label", {}, { for: "settings-community-account-name" }, ja ? "コメントに表示するアカウント名" : "Account name shown on comments");
    const accountNameHint = createEl("p", {}, {}, ja
        ? "未設定の場合は固定IDが表示されます。空欄で保存するとID表示に戻ります。"
        : "Your fixed ID is shown when this is blank. Save an empty value to return to the ID.");
    const accountNameRow = createEl("div", {}, { class: "settings-account-name-row" });
    const accountNameInput = createEl("input", {}, {
        id: "settings-community-account-name",
        type: "text",
        maxlength: String(COMMUNITY_ACCOUNT_NAME_MAX_LENGTH),
        autocomplete: "off",
        spellcheck: "false",
        placeholder: ja ? "未設定（固定IDを表示）" : "Not set (show fixed ID)",
    }) as HTMLInputElement;
    const saveAccountName = createEl("button", {}, { type: "button" }, ja ? "名前を保存" : "Save name") as HTMLButtonElement;
    accountNameRow.append(accountNameInput, saveAccountName);
    profileEditor.append(accountNameLabel, accountNameHint, accountNameRow);
    card.append(avatar, identity);
    wrapper.append(title, description, card, profileEditor, riotSection, capabilitySection, status, actions);
    tab.append(wrapper);

    let busy = false;
    const setBusy = (value: boolean): void => {
        busy = value;
        connect.disabled = value;
        disconnect.disabled = value;
        saveAccountName.disabled = value;
        linkRiot.disabled = value;
        unlinkRiot.disabled = value;
    };
    const refresh = async (): Promise<void> => {
        if (busy) return;
        try {
            status.classList.remove("is-error");
            const [youtube, firebase] = await Promise.all([getYouTubeAuthStatus(), getReplayShareAuthStatus()]);
            const fullyConnected = youtube.connected && firebase.google;
            const profile = fullyConnected
                ? await getCommunityAccountProfile() || await ensureCommunityAccountProfile()
                : null;
            name.textContent = fullyConnected
                ? profile?.accountName || profile?.publicId || (ja ? "Googleユーザー" : "Google user")
                : youtube.connected ? (ja ? "Google接続の同期が必要です" : "Google connection needs syncing")
                    : (ja ? "接続されていません" : "Not connected");
            email.textContent = fullyConnected ? firebase.email || "" : "";
            state.textContent = fullyConnected
                ? (ja ? "YouTube・共有リプレイに接続済み" : "Connected to YouTube and shared replays")
                : youtube.connected ? (ja ? "YouTubeには接続済みです" : "Connected to YouTube") : "";
            publicId.textContent = profile ? `ID: ${profile.publicId}` : "";
            accountNameInput.value = profile?.accountName || "";
            profileEditor.hidden = !fullyConnected;
            riotSection.hidden = !fullyConnected;
            const riotAccount = profile?.riotAccount ?? null;
            riotState.textContent = riotAccount ? (ja ? "連携済み" : "Linked") : (ja ? "未連携" : "Not linked");
            riotState.classList.toggle("is-linked", Boolean(riotAccount));
            riotIdentity.textContent = riotAccount
                ? `${riotAccount.gameName}${riotAccount.tagLine ? `#${riotAccount.tagLine}` : ""} · ${riotAccount.platformId}`
                : (ja ? "LoLクライアントを起動して連携してください。" : "Start the LoL client to link your account.");
            riotRanks.replaceChildren();
            if (riotAccount) {
                riotRanks.append(
                    createEl("span", {}, {}, `Solo/Duo: ${riotAccount.soloRank}`),
                    createEl("span", {}, {}, `Flex: ${riotAccount.flexRank}`),
                );
            }
            linkRiot.textContent = riotAccount
                ? (ja ? "ランク情報を更新" : "Refresh Rank Information")
                : (ja ? "起動中のLoLアカウントを連携" : "Link Running LoL Account");
            unlinkRiot.hidden = !riotAccount;
            capabilitySection.hidden = !youtube.connected;
            capabilityList.replaceChildren();
            if (youtube.connected) {
                let capabilities: YouTubeChannelCapabilities | null = null;
                try {
                    capabilities = await getYouTubeChannelCapabilities();
                } catch (error) {
                    const item = createEl("div", {}, { class: "settings-youtube-capability is-warning" });
                    item.append(
                        createEl("span", {}, { class: "settings-youtube-capability-name" }, ja ? "利用資格の取得" : "Feature eligibility"),
                        createEl("strong", {}, {}, ja ? "取得できませんでした" : "Could not load"),
                        createEl("small", {}, {}, error instanceof Error ? error.message : String(error)),
                    );
                    capabilityList.append(item);
                }
                if (capabilities) renderCapabilities(capabilities);
            }
            avatar.textContent = fullyConnected ? (firebase.displayName || firebase.email || "G").trim().charAt(0).toUpperCase() || "G" : "G";
            if (fullyConnected && firebase.photoURL) {
                avatar.style.backgroundImage = `url("${firebase.photoURL.replaceAll(/["\\]/gu, "")}")`;
                avatar.classList.add("has-image");
            } else {
                avatar.style.removeProperty("background-image");
                avatar.classList.remove("has-image");
            }
            connect.hidden = fullyConnected;
            connect.textContent = youtube.connected
                ? (ja ? "Google接続を同期" : "Sync Google connection")
                : (ja ? "Googleアカウントを接続" : "Connect Google Account");
            connect.disabled = !youtube.configured;
            disconnect.hidden = !youtube.connected && !firebase.authenticated;
            disconnect.disabled = youtube.uploading;
            status.textContent = youtube.configured
                ? youtube.uploading ? (ja ? "アップロード中は接続を解除できません。" : "You cannot disconnect while uploading.") : ""
                : (ja ? "YouTube OAuth Client IDが設定されていません。" : "YouTube OAuth Client ID is not configured.");
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
            status.classList.add("is-error");
        }
    };

    const renderCapabilities = (capabilities: YouTubeChannelCapabilities): void => {
        const addRow = (label: string, value: string, detail: string, tone: "available" | "warning" | "unknown") => {
            const row = createEl("div", {}, { class: `settings-youtube-capability is-${tone}` });
            row.append(
                createEl("span", {}, { class: "settings-youtube-capability-name" }, label),
                createEl("strong", {}, {}, value),
                createEl("small", {}, {}, detail),
            );
            capabilityList.append(row);
        };
        addRow(
            ja ? "標準機能" : "Standard features",
            capabilities.standardFeatures === "available" ? (ja ? "利用可能" : "Available") : (ja ? "利用不可" : "Unavailable"),
            capabilities.channelTitle || (ja ? "YouTubeチャンネルが見つかりません" : "YouTube channel not found"),
            capabilities.standardFeatures === "available" ? "available" : "warning",
        );
        const longUpload = capabilities.longUploadsStatus === "allowed"
            ? [ja ? "利用可能" : "Available", ja ? "15分を超える動画をアップロードできます。" : "Videos longer than 15 minutes can be uploaded.", "available"] as const
            : capabilities.longUploadsStatus === "eligible"
                ? [ja ? "有効化が必要" : "Activation required", ja ? "利用資格はありますが、YouTube側での確認が必要です。" : "Eligible, but verification is required on YouTube.", "warning"] as const
                : capabilities.longUploadsStatus === "disallowed"
                    ? [ja ? "利用不可" : "Unavailable", ja ? "現在このチャンネルでは利用できません。" : "Currently unavailable for this channel.", "warning"] as const
                    : [ja ? "確認できません" : "Cannot determine", ja ? "YouTube APIから状態を取得できません。" : "The status was not returned by the YouTube API.", "unknown"] as const;
        addRow(ja ? "15分を超える動画" : "Videos over 15 minutes", ...longUpload);
        const thumbnailCheckedAt = capabilities.customThumbnailsCheckedAt
            ? new Date(capabilities.customThumbnailsCheckedAt).toLocaleString(ja ? "ja-JP" : "en-US")
            : null;
        const thumbnail = capabilities.customThumbnails === "available"
            ? [ja ? "利用可能" : "Available", ja ? `このアプリで設定に成功しました（${thumbnailCheckedAt}）。` : `Successfully set by this app (${thumbnailCheckedAt}).`, "available"] as const
            : capabilities.customThumbnails === "unavailable"
                ? [ja ? "利用不可" : "Unavailable", ja ? `YouTubeから資格エラーが返されました（${thumbnailCheckedAt}）。` : `YouTube returned an eligibility error (${thumbnailCheckedAt}).`, "warning"] as const
                : [ja ? "未確認" : "Not verified", ja ? "事前確認APIがないため、初回の設定結果で判定します。" : "YouTube has no preflight API; this is determined after the first attempt.", "unknown"] as const;
        addRow(ja ? "カスタムサムネイル" : "Custom thumbnails", ...thumbnail);
    };

    let googleAuthorizationPending = false;
    connect.addEventListener("click", async () => {
        if (googleAuthorizationPending) {
            status.classList.remove("is-error");
            status.textContent = ja ? "Google認証画面をもう一度開いています…" : "Opening Google authorization again…";
            try {
                await reopenYouTubeSignIn();
                status.textContent = ja
                    ? "ブラウザでGoogleアカウントを確認してください…"
                    : "Confirm your Google account in the browser…";
            } catch (error) {
                status.classList.add("is-error");
                status.textContent = error instanceof Error ? error.message : String(error);
            }
            return;
        }
        googleAuthorizationPending = true;
        setBusy(true);
        connect.disabled = false;
        connect.textContent = ja ? "Google認証画面をもう一度開く" : "Open Google Authorization Again";
        status.classList.remove("is-error");
        status.textContent = ja ? "ブラウザでGoogleアカウントを確認してください…" : "Confirm your Google account in the browser…";
        try {
            const youtube = await getYouTubeAuthStatus();
            const firebaseIdToken = youtube.connected
                ? await getYouTubeFirebaseIdToken()
                : (await signInToYouTube()).firebaseIdToken;
            if (!firebaseIdToken) throw new Error(ja ? "Google本人確認情報を取得できませんでした。" : "Could not obtain Google identity information.");
            await connectReplayShareGoogle(firebaseIdToken);
            dispatchAuthChanged(true);
            status.textContent = ja ? "Googleアカウントを接続しました。" : "Google account connected.";
        } catch (error) {
            status.classList.add("is-error");
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            googleAuthorizationPending = false;
            setBusy(false);
            await refresh();
        }
    });

    disconnect.addEventListener("click", async () => {
        setBusy(true);
        status.classList.remove("is-error");
        status.textContent = ja ? "Google接続を解除しています…" : "Disconnecting Google account…";
        try {
            await signOutReplayShareAuth();
            await signOutFromYouTube();
            dispatchAuthChanged(false);
            status.textContent = ja ? "Google接続を解除しました。" : "Google account disconnected.";
        } catch (error) {
            status.classList.add("is-error");
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            setBusy(false);
            await refresh();
        }
    });

    saveAccountName.addEventListener("click", async () => {
        setBusy(true);
        status.classList.remove("is-error");
        status.textContent = ja ? "アカウント名を保存しています…" : "Saving account name…";
        try {
            await saveCommunityAccountName(accountNameInput.value);
            setBusy(false);
            await refresh();
            status.textContent = ja ? "アカウント名を保存しました。" : "Account name saved.";
        } catch (error) {
            status.classList.add("is-error");
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            setBusy(false);
        }
    });

    linkRiot.addEventListener("click", async () => {
        setBusy(true);
        status.classList.remove("is-error");
        status.textContent = ja ? "起動中のLoLアカウントを確認しています…" : "Checking the running LoL account…";
        try {
            const riotAccount = await getCurrentLolAccountForLink();
            await saveCommunityRiotAccount(riotAccount);
            setBusy(false);
            await refresh();
            status.textContent = ja ? "LoLアカウントとランクを連携しました。" : "LoL account and ranks linked.";
        } catch (error) {
            status.classList.add("is-error");
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            setBusy(false);
        }
    });

    unlinkRiot.addEventListener("click", async () => {
        setBusy(true);
        status.classList.remove("is-error");
        status.textContent = ja ? "LoLアカウント連携を解除しています…" : "Unlinking LoL account…";
        try {
            await unlinkCommunityRiotAccount();
            setBusy(false);
            await refresh();
            status.textContent = ja ? "LoLアカウント連携を解除しました。" : "LoL account unlinked.";
        } catch (error) {
            status.classList.add("is-error");
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            setBusy(false);
        }
    });

    void refresh();
    return tab;
}
