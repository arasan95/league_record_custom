import {
    connectReplayShareGoogle,
    ensureCommunityAccountProfile,
    getCommunityAccountProfile,
    getReplayShareAuthStatus,
    saveCommunityAccountName,
    signOutReplayShareAuth,
} from "../platform/firebase";
import {
    getYouTubeAuthStatus,
    getYouTubeFirebaseIdToken,
    signInToYouTube,
    signOutFromYouTube,
    YOUTUBE_AUTH_CHANGED_EVENT,
    YOUTUBE_AUTH_CONNECTED_EVENT,
} from "../platform/youtube";
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
    wrapper.append(title, description, card, profileEditor, status, actions);
    tab.append(wrapper);

    let busy = false;
    const setBusy = (value: boolean): void => {
        busy = value;
        connect.disabled = value;
        disconnect.disabled = value;
        saveAccountName.disabled = value;
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

    connect.addEventListener("click", async () => {
        setBusy(true);
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

    void refresh();
    return tab;
}
