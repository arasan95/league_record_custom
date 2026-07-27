const http = require("node:http");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { Transform, Readable } = require("node:stream");
const { getYouTubeOAuthConfig } = require("./config.cjs");
const { generateThumbnail } = require("./thumbnail-generator.cjs");

// Firebase needs a Google identity token, but LeagueRecord does not use the
// user's display name or profile image. Avoid the unnecessary profile scope.
const GOOGLE_IDENTITY_SCOPES = ["openid", "email"];
const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const GOOGLE_OAUTH_SCOPES = [...GOOGLE_IDENTITY_SCOPES, YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READ_SCOPE].join(" ");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const RESUMABLE_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const VIDEOS_LIST_URL = "https://www.googleapis.com/youtube/v3/videos";
const CHANNELS_LIST_URL = "https://www.googleapis.com/youtube/v3/channels";
const MAX_FILE_BYTES = 256 * 1024 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function callbackLanguage(acceptLanguage) {
  const preferred = String(acceptLanguage || "")
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim().match(/^q=([01](?:\.\d+)?)$/i))
        .find(Boolean);
      return { tag: tag.toLowerCase(), quality: quality ? Number(quality[1]) : 1, index };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)[0]?.tag;
  return preferred === "ja" || preferred?.startsWith("ja-") ? "ja" : "en";
}

function oauthCallbackHtml({ success, acceptLanguage }) {
  const language = callbackLanguage(acceptLanguage);
  const copy = language === "ja"
    ? success
      ? {
        title: "Googleアカウントを接続しました",
        detail: "LeagueRecord Customへ戻ります。",
        close: "このタブを閉じる（ブラウザが許可する場合）",
        closeHelp: "ブラウザの制限により、このタブは自動で閉じられません。LeagueRecord Customへ戻ってから、このタブを閉じてください。",
      }
      : {
        title: "Googleアカウントを接続できませんでした",
        detail: "LeagueRecord Customへ戻り、もう一度お試しください。",
        close: "このタブを閉じる（ブラウザが許可する場合）",
        closeHelp: "ブラウザの制限により、このタブは自動で閉じられません。LeagueRecord Customへ戻ってから、このタブを閉じてください。",
      }
    : success
      ? {
        title: "Google Account Connected",
        detail: "Returning to LeagueRecord Custom.",
        close: "Close This Tab (if allowed)",
        closeHelp: "Your browser prevented this tab from closing automatically. Return to LeagueRecord Custom, then close this tab.",
      }
      : {
        title: "Google Account Connection Failed",
        detail: "Return to LeagueRecord Custom and try again.",
        close: "Close This Tab (if allowed)",
        closeHelp: "Your browser prevented this tab from closing automatically. Return to LeagueRecord Custom, then close this tab.",
      };
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${copy.title}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0b1220; color: #f8fafc; }
    main { max-width: 34rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
    p { color: #cbd5e1; line-height: 1.6; }
    button { margin-top: 1rem; padding: 0.7rem 1rem; border: 0; border-radius: 0.5rem; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>${copy.title}</h1>
    <p>${copy.detail}</p>
    <button type="button" onclick="closeTab()">${copy.close}</button>
    <p id="close-help" hidden>${copy.closeHelp}</p>
  </main>
  <script>
    function showCloseHelp() {
      document.getElementById("close-help").hidden = false;
    }
    function closeTab() {
      window.close();
      setTimeout(showCloseHelp, 250);
    }
    setTimeout(closeTab, 1200);
  </script>
</body>
</html>`;
}

function makeError(message, code = "youtube_error") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeApiDetail(value, maximum = 220) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function youtubeApiErrorInfo(response, data) {
  const apiError = data && typeof data === "object" ? data.error : null;
  const firstError = Array.isArray(apiError?.errors) ? apiError.errors[0] : null;
  const rawReason = firstError?.reason || apiError?.status || data?.error || "unknown";
  const reason = sanitizeApiDetail(rawReason, 64).replace(/[^a-z0-9_.-]/gi, "") || "unknown";
  const detail = sanitizeApiDetail(apiError?.message || firstError?.message || data?.error_description);
  return { httpStatus: Number(response?.status || 0), reason, detail };
}

function youtubeApiUserMessage(phase, info) {
  const prefix = phase === "preparing"
    ? "YouTubeのアップロード準備に失敗しました"
    : phase === "checking"
      ? "YouTube動画の存在確認に失敗しました"
      : "YouTubeへの動画送信に失敗しました";
  const reason = info.reason.toLowerCase();
  if (reason.includes("accessnotconfigured") || reason.includes("servicedisabled")) {
    return `${prefix}。OAuthクライアントを作成したGoogle CloudプロジェクトでYouTube Data API v3を有効にしてください。`;
  }
  if (reason.includes("insufficientpermission") || reason.includes("autherror") || info.httpStatus === 401) {
    return `${prefix}。Google接続を一度解除し、YouTubeへのアップロード権限を許可して再接続してください。`;
  }
  if (reason.includes("quotaexceeded") || reason.includes("dailylimitexceeded")) {
    return `${prefix}。Google CloudプロジェクトのYouTube API割り当てを使い切っています。割り当て画面を確認してください。`;
  }
  if (reason.includes("uploadlimitexceeded")) {
    return `${prefix}。YouTubeチャンネル側の動画アップロード上限に達しています。時間をおいて再試行してください。`;
  }
  if (reason.includes("youtubesignuprequired")) {
    return `${prefix}。接続したGoogleアカウントにYouTubeチャンネルがありません。チャンネルを作成してから再接続してください。`;
  }
  if (reason.includes("invalidprivacystatus")) {
    return `${prefix}。現在のAPIプロジェクトでは指定した公開範囲を利用できません。公開設定を「非公開」にして再試行してください。`;
  }
  const diagnostic = `HTTP ${info.httpStatus || "?"}, ${info.reason}`;
  return `${prefix}（${diagnostic}${info.detail ? `: ${info.detail}` : ""}）。`;
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function responseHasScope(response, requiredScope) {
  if (typeof response?.scope !== "string") return null;
  return new Set(response.scope.split(/\s+/).filter(Boolean)).has(requiredScope);
}

function missingYouTubeScopeError() {
  return makeError(
    "Google認証でYouTubeアップロード権限が付与されませんでした。Google Auth Platformの「データアクセス」でyoutube.uploadスコープを追加し、接続画面でYouTubeへのアップロードを許可してください。",
    "auth_missing_youtube_scope",
  );
}

function missingYouTubeReadScopeError() {
  return makeError(
    "削除済み動画を安全に確認するためのYouTube読み取り権限がありません。Google接続を一度解除し、再接続してください。",
    "auth_missing_youtube_read_scope",
  );
}

function createYouTubeService({ app, shell, safeStorage, fs, fsNode, getSettings, getImageCacheRoots, isRecording, emit, log }) {
  let activeJob = null;
  let authInProgress = false;
  let activeAuthorizationUrl = null;
  let activeSignInPromise = null;

  const tokenPath = () => path.join(app.getPath("userData"), "youtube", "token.bin");
  const oauthConfig = () => getYouTubeOAuthConfig();
  const clientId = () => oauthConfig().clientId;

  async function loadTokens() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const encrypted = await fs.readFile(tokenPath());
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch {
      return null;
    }
  }

  async function saveTokens(tokens) {
    if (!safeStorage.isEncryptionAvailable()) throw makeError("Windowsの暗号化ストレージを利用できないため、Google接続を保存できません。", "secure_storage_unavailable");
    await fs.mkdir(path.dirname(tokenPath()), { recursive: true });
    await fs.writeFile(tokenPath(), safeStorage.encryptString(JSON.stringify(tokens)));
  }

  async function clearTokens() {
    await fs.rm(tokenPath(), { force: true }).catch(() => {});
  }

  async function requestRefreshToken(tokens) {
    const config = oauthConfig();
    if (!config.clientSecret) throw makeError("GoogleデスクトップOAuth Client Secretが設定されていません。", "oauth_client_secret_missing");
    return requestToken({
      client_id: clientId(),
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      // A refresh grant cannot add scopes. Omitting scope preserves the grant
      // selected during the interactive authorization flow.
    }).catch(async (error) => {
      // Only a revoked/expired refresh token proves that the saved credential
      // is unusable. Keep it for invalid_scope and temporary failures so a
      // background cleanup cannot disconnect an otherwise working account.
      if (error?.code === "auth_invalid_grant") await clearTokens();
      throw error;
    });
  }

  async function signOut() {
    const tokens = await loadTokens();
    if (tokens?.refreshToken) {
      // Revoke the long-lived credential at Google first. Local deletion still
      // succeeds when the user is offline or Google already revoked it.
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refreshToken }),
      }).catch(() => {});
    }
    await clearTokens();
    return getAuthStatus();
  }

  async function requestToken(params) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      const reason = String(data.error || "unknown_error").replace(/[^a-z_]/gi, "").slice(0, 64) || "unknown_error";
      // Google error descriptions contain request diagnostics, not tokens. Keep
      // only a short single-line message so it is useful without logging URLs.
      const detail = String(data.error_description || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/[<>]/g, "")
        .slice(0, 180);
      await log(`youtube token exchange failed http=${response.status} reason=${reason}${detail ? ` detail=${detail}` : ""}`);
      const missingCredentialPattern = new RegExp(`${["client", "secret"].join("_")}\\s+is\\s+missing`, "i");
      if (reason === "invalid_request" && missingCredentialPattern.test(detail)) {
        throw makeError(
          "現在のOAuth Client IDはGoogle側でClient Secret必須として登録されています。Google Cloud Consoleで種類「デスクトップ アプリ」の新しいOAuthクライアントを作成し、そのClient IDへ差し替えてください。Client Secretはアプリへ設定しないでください。",
          "auth_incompatible_client",
        );
      }
      throw makeError(`Google認証に失敗しました（${reason}${detail ? `: ${detail}` : ""}）。`, `auth_${reason}`);
    }
    return data;
  }

  async function getAccessToken(requiredScope = YOUTUBE_UPLOAD_SCOPE) {
    const tokens = await loadTokens();
    if (!tokens?.refreshToken) throw makeError("Googleアカウントを接続してください。", "not_connected");
    const storedScopeGranted = requiredScope === YOUTUBE_READ_SCOPE
      ? tokens.readScopeGranted === true
      : tokens.uploadScopeGranted === true;
    if (!storedScopeGranted) {
      if (requiredScope === YOUTUBE_READ_SCOPE) throw missingYouTubeReadScopeError();
      throw missingYouTubeScopeError();
    }
    if (tokens.accessToken && storedScopeGranted && Number(tokens.expiresAt) > Date.now() + 60_000) return tokens.accessToken;
    const refreshed = await requestRefreshToken(tokens);
    const uploadScopeGranted = responseHasScope(refreshed, YOUTUBE_UPLOAD_SCOPE);
    const readScopeGranted = responseHasScope(refreshed, YOUTUBE_READ_SCOPE);
    if (uploadScopeGranted === false) {
      await log("youtube oauth scope missing required=youtube.upload during=refresh");
      await clearTokens();
      throw missingYouTubeScopeError();
    }
    const next = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      identityEnabled: tokens.identityEnabled === true,
      uploadScopeGranted: uploadScopeGranted ?? tokens.uploadScopeGranted === true,
      readScopeGranted: readScopeGranted ?? tokens.readScopeGranted === true,
      customThumbnailCapability: tokens.customThumbnailCapability,
      customThumbnailCapabilityCheckedAt: tokens.customThumbnailCapabilityCheckedAt,
    };
    await saveTokens(next);
    if (requiredScope === YOUTUBE_READ_SCOPE && next.readScopeGranted !== true) {
      throw missingYouTubeReadScopeError();
    }
    return next.accessToken;
  }

  async function getAuthStatus() {
    const config = oauthConfig();
    const configured = Boolean(config.clientId && config.clientSecret);
    const tokens = await loadTokens();
    return {
      configured,
      connected: Boolean(tokens?.refreshToken && tokens?.uploadScopeGranted === true && tokens?.readScopeGranted === true),
      identityEnabled: tokens?.identityEnabled === true,
      cleanupEnabled: tokens?.readScopeGranted === true,
      uploading: Boolean(activeJob && ["thumbnail_preparing", "preparing", "uploading", "thumbnail_uploading", "processing"].includes(activeJob.state)),
    };
  }

  async function getFirebaseIdToken() {
    const tokens = await loadTokens();
    if (!tokens?.refreshToken || tokens.identityEnabled !== true) {
      throw makeError("Google認証を更新してください。", "identity_reconnect_required");
    }
    const refreshed = await requestRefreshToken(tokens);
    const next = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      identityEnabled: true,
      uploadScopeGranted: responseHasScope(refreshed, YOUTUBE_UPLOAD_SCOPE) ?? tokens.uploadScopeGranted === true,
      readScopeGranted: responseHasScope(refreshed, YOUTUBE_READ_SCOPE) ?? tokens.readScopeGranted === true,
      customThumbnailCapability: tokens.customThumbnailCapability,
      customThumbnailCapabilityCheckedAt: tokens.customThumbnailCapabilityCheckedAt,
    };
    await saveTokens(next);
    if (!refreshed.id_token) {
      throw makeError("Google本人確認情報を更新できませんでした。Googleアカウントをもう一度接続してください。", "identity_token_missing");
    }
    // This short-lived token is returned only when Firebase needs to establish
    // its own session. Access and refresh tokens never leave the main process.
    return String(refreshed.id_token);
  }

  async function performSignIn() {
    const config = oauthConfig();
    if (!config.clientId) throw makeError("YouTubeの開発用Client IDが設定されていません。", "not_configured");
    if (!config.clientSecret) throw makeError("GoogleデスクトップOAuth Client Secretが設定されていません。", "oauth_client_secret_missing");
    authInProgress = true;
    const verifier = base64Url(randomBytes(48));
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = base64Url(randomBytes(24));
    let server;
    try {
      const callback = await new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");
          const oauthError = url.searchParams.get("error");
          if (!code || returnedState !== state || oauthError) {
            res.writeHead(400, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
              "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
            });
            res.end(oauthCallbackHtml({
              success: false,
              acceptLanguage: req.headers["accept-language"],
            }));
            reject(makeError("Google接続がキャンセルされたか、確認に失敗しました。", "auth_cancelled"));
            return;
          }
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
          });
          res.end(oauthCallbackHtml({
            success: true,
            acceptLanguage: req.headers["accept-language"],
          }));
          resolve({ code, redirectUri: `http://127.0.0.1:${server.address().port}` });
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", async () => {
          const redirectUri = `http://127.0.0.1:${server.address().port}`;
          const url = new URL(AUTH_URL);
          url.searchParams.set("client_id", clientId());
          url.searchParams.set("redirect_uri", redirectUri);
          url.searchParams.set("response_type", "code");
          url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
          url.searchParams.set("code_challenge", challenge);
          url.searchParams.set("code_challenge_method", "S256");
          url.searchParams.set("state", state);
          url.searchParams.set("access_type", "offline");
          url.searchParams.set("prompt", "consent");
          url.searchParams.set("include_granted_scopes", "true");
          url.searchParams.set("enable_granular_consent", "true");
          url.searchParams.set("hl", "en");
          activeAuthorizationUrl = url.toString();
          try { await shell.openExternal(activeAuthorizationUrl); } catch (error) { reject(error); }
        });
      });
      const response = await requestToken({
        client_id: clientId(),
        client_secret: config.clientSecret,
        code: callback.code,
        code_verifier: verifier,
        redirect_uri: callback.redirectUri,
        grant_type: "authorization_code",
      });
      if (!response.refresh_token) throw makeError("Googleの再接続用トークンを取得できませんでした。もう一度接続してください。", "missing_refresh_token");
      if (!response.id_token) throw makeError("Google本人確認情報を取得できませんでした。", "identity_token_missing");
      const uploadScopeGranted = responseHasScope(response, YOUTUBE_UPLOAD_SCOPE);
      const readScopeGranted = responseHasScope(response, YOUTUBE_READ_SCOPE);
      if (uploadScopeGranted !== true) {
        await log(`youtube oauth scope missing required=youtube.upload during=authorization response_scope=${typeof response.scope === "string" ? "present" : "absent"}`);
        await clearTokens();
        throw missingYouTubeScopeError();
      }
      if (readScopeGranted !== true) {
        await log(`youtube oauth scope missing required=youtube.readonly during=authorization response_scope=${typeof response.scope === "string" ? "present" : "absent"}`);
        await clearTokens();
        throw missingYouTubeReadScopeError();
      }
      await saveTokens({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
        identityEnabled: true,
        uploadScopeGranted: true,
        readScopeGranted: true,
      });
      return { ...(await getAuthStatus()), firebaseIdToken: String(response.id_token) };
    } finally {
      authInProgress = false;
      activeAuthorizationUrl = null;
      if (server) server.close();
    }
  }

  function signIn() {
    if (activeSignInPromise) {
      if (activeAuthorizationUrl) {
        void shell.openExternal(activeAuthorizationUrl).catch(() => {});
      }
      return activeSignInPromise;
    }
    const promise = performSignIn();
    activeSignInPromise = promise;
    void promise.then(
      () => {
        if (activeSignInPromise === promise) activeSignInPromise = null;
      },
      () => {
        if (activeSignInPromise === promise) activeSignInPromise = null;
      },
    );
    return promise;
  }

  async function reopenSignIn() {
    if (!authInProgress || !activeAuthorizationUrl) {
      throw makeError("進行中のGoogle接続がありません。接続をもう一度開始してください。", "auth_not_in_progress");
    }
    await shell.openExternal(activeAuthorizationUrl);
    return { opened: true };
  }

  async function resolveVideo(videoId) {
    const settings = await getSettings();
    const requested = String(videoId || "");
    if (!requested) throw makeError("録画が指定されていません。", "validation");
    const candidates = /\.(mp4|webm)$/i.test(requested) ? [requested] : [`${requested}.mp4`, `${requested}.webm`];
    let filePath = null;
    for (const candidate of candidates) {
      try { filePath = await fs.realpath(candidate); break; } catch {}
    }
    if (!filePath) throw makeError("録画ファイルが見つかりません。", "file_unavailable");
    const roots = await Promise.all([settings.recordingsFolder, settings.clipsFolder].filter(Boolean).map((root) => fs.realpath(root).catch(() => null)));
    if (!roots.some((root) => root && isPathInside(filePath, root))) throw makeError("録画・クリップフォルダー外のファイルはアップロードできません。", "validation");
    if (!/\.(mp4|webm)$/i.test(filePath)) throw makeError("MP4またはWebMの録画だけをアップロードできます。", "validation");
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) throw makeError("空または通常ファイルではない録画はアップロードできません。", "validation");
    if (stat.size > MAX_FILE_BYTES) throw makeError("YouTubeの256GB上限を超えています。", "validation");
    return { filePath, stat };
  }

  async function getChannelCapabilities() {
    const accessToken = await getAccessToken(YOUTUBE_READ_SCOPE);
    const url = new URL(CHANNELS_LIST_URL);
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "1");
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const info = youtubeApiErrorInfo(response, result);
      await log(`youtube channel capability check failed http=${info.httpStatus} reason=${info.reason}`);
      throw makeError(youtubeApiUserMessage("checking", info), `youtube_channel_${info.reason}`);
    }
    const channel = result?.items?.[0];
    const tokens = await loadTokens();
    const savedThumbnailCapability = new Set(["available", "unavailable"]).has(tokens?.customThumbnailCapability)
      ? tokens.customThumbnailCapability
      : "unknown";
    const longUploadsStatus = new Set(["allowed", "eligible", "disallowed"]).has(channel?.status?.longUploadsStatus)
      ? channel.status.longUploadsStatus
      : "unknown";
    return {
      channelFound: Boolean(channel),
      channelId: channel?.id || null,
      channelTitle: channel?.snippet?.title || null,
      standardFeatures: channel ? "available" : "unavailable",
      longUploadsStatus,
      customThumbnails: savedThumbnailCapability,
      customThumbnailsCheckedAt: Number(tokens?.customThumbnailCapabilityCheckedAt) || null,
    };
  }

  async function rememberCustomThumbnailCapability(value) {
    const tokens = await loadTokens();
    if (!tokens?.refreshToken) return;
    await saveTokens({
      ...tokens,
      customThumbnailCapability: value,
      customThumbnailCapabilityCheckedAt: Date.now(),
    });
  }

  function validateMetadata(metadata, filePath) {
    const title = String(metadata?.title || path.basename(filePath, path.extname(filePath))).trim();
    const description = String(metadata?.description || "");
    if (!title || title.length > 100 || /[\x00-\x1F\x7F]/.test(title)) throw makeError("タイトルは制御文字を含まない1〜100文字にしてください。", "validation");
    if (description.length > 5000 || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(description)) throw makeError("説明は5,000文字以内にしてください。", "validation");
    if (typeof metadata?.madeForKids !== "boolean") throw makeError("子ども向けかどうかを選択してください。", "validation");
    const privacyStatus = String(metadata?.privacyStatus || "");
    if (!new Set(["private", "unlisted", "public"]).has(privacyStatus)) throw makeError("公開設定を選択してください。", "validation");
    if (metadata?.policyAccepted !== true) throw makeError("プライバシーポリシーと利用規約への同意を確認してください。", "validation");
    if (metadata?.communityGuidelinesConfirmed !== true) throw makeError("YouTubeコミュニティガイドライン遵守を確認してください。", "validation");
    return { title, description, madeForKids: metadata.madeForKids, privacyStatus };
  }

  function publish() {
    if (activeJob) emit("YoutubeUploadProgress", { ...activeJob });
  }

  async function makeYouTubeApiError(response, data, phase) {
    const info = youtubeApiErrorInfo(response, data);
    await log(`youtube api rejected phase=${phase} http=${info.httpStatus} reason=${info.reason}${info.detail ? ` detail=${info.detail}` : ""}`);
    return makeError(youtubeApiUserMessage(phase, info), `youtube_${info.reason.toLowerCase()}`);
  }

  async function startUpload({ videoId, metadata, thumbnail }) {
    if (activeJob && ["thumbnail_preparing", "preparing", "uploading", "thumbnail_uploading", "processing"].includes(activeJob.state)) throw makeError("別のアップロードが進行中です。", "upload_in_progress");
    if (isRecording()) throw makeError("録画中のファイルはアップロードできません。録画を停止してから実行してください。", "recording_active");
    const { filePath, stat } = await resolveVideo(videoId);
    const data = validateMetadata(metadata, filePath);
    const controller = new AbortController();
    activeJob = { state: "thumbnail_preparing", sourceVideoId: videoId, fileName: path.basename(filePath), totalBytes: stat.size, sentBytes: 0, youtubeVideoId: null, youtubeUrl: null, error: null, thumbnailStatus: "pending", thumbnailError: null, controller };
    publish();
    try {
      const preparedThumbnail = await createThumbnail(thumbnail?.metadata, {
        isClip: Boolean(thumbnail?.isClip),
        customThumbnailPath: thumbnail?.customThumbnailPath,
      });
      activeJob.state = "preparing";
      publish();
      const accessToken = await getAccessToken();
      const start = await fetch(RESUMABLE_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(stat.size),
          "x-upload-content-type": filePath.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4",
        },
        body: JSON.stringify({ snippet: { title: data.title, description: data.description, categoryId: "20" }, status: { privacyStatus: data.privacyStatus, selfDeclaredMadeForKids: data.madeForKids } }),
      });
      const sessionUrl = start.headers.get("location");
      if (!start.ok || !sessionUrl) {
        const startResult = await start.json().catch(() => ({}));
        if (start.ok && !sessionUrl && !startResult.error) {
          startResult.error = { status: "missingUploadLocation", message: "The resumable upload URL was not returned." };
        }
        throw await makeYouTubeApiError(start, startResult, "preparing");
      }
      activeJob.state = "uploading";
      publish();
      const meter = new Transform({ transform(chunk, _encoding, done) { activeJob.sentBytes += chunk.length; publish(); done(null, chunk); } });
      // Send the original recording/clip bytes. Never transcode or resize at
      // upload time; YouTube can therefore create every quality rendition the
      // source resolution supports (720p, 1080p, and higher).
      const source = fsNode.createReadStream(filePath);
      source.on("error", (error) => meter.destroy(error));
      source.pipe(meter);
      const uploaded = await fetch(sessionUrl, {
        method: "PUT",
        signal: controller.signal,
        headers: { "content-length": String(stat.size), "content-type": filePath.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4" },
        body: Readable.toWeb(meter),
        duplex: "half",
      });
      const result = await uploaded.json().catch(() => ({}));
      if (!uploaded.ok || !result.id) throw await makeYouTubeApiError(uploaded, result, "uploading");
      activeJob.sentBytes = stat.size;
      activeJob.youtubeVideoId = result.id;
      activeJob.youtubeUrl = `https://youtu.be/${result.id}`;
      activeJob.state = "thumbnail_uploading";
      publish();
      try {
        await uploadThumbnailData(result.id, preparedThumbnail, accessToken, controller.signal);
        activeJob.thumbnailStatus = "succeeded";
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        activeJob.thumbnailStatus = "failed";
        activeJob.thumbnailError = error?.message || "サムネイルを設定できませんでした。";
        await log(`youtube thumbnail warning video=${result.id} code=${error?.code || "unknown"}`);
      }
      activeJob.state = "processing";
      activeJob.processingStatus = "pending";
      publish();
      const processingCompleted = await waitForYouTubeProcessing(result.id, accessToken, controller.signal);
      activeJob.state = "completed";
      activeJob.processingStatus = processingCompleted ? "succeeded" : "pending";
      publish();
      return { ...activeJob, controller: undefined };
    } catch (error) {
      activeJob.state = error?.name === "AbortError" ? "cancelled" : "failed";
      activeJob.error = error?.message || "アップロードに失敗しました。";
      publish();
      await log(`youtube upload failed code=${error?.code || "unknown"} status=${activeJob.state}`);
      throw error;
    }
  }

  function getUploadJob() {
    if (!activeJob) return { state: "idle" };
    const { controller: _controller, ...job } = activeJob;
    return job;
  }

  function cancelUpload() {
    if (activeJob?.controller && ["thumbnail_preparing", "preparing", "uploading", "thumbnail_uploading", "processing"].includes(activeJob.state)) activeJob.controller.abort();
    return getUploadJob();
  }

  async function findMissingVideos(videoIds) {
    const ids = [...new Set(Array.isArray(videoIds) ? videoIds.map(String) : [])];
    if (ids.length < 1 || ids.length > 50 || ids.some((id) => !YOUTUBE_VIDEO_ID.test(id))) {
      throw makeError("確認するYouTube動画IDが不正です。", "validation");
    }
    const accessToken = await getAccessToken(YOUTUBE_READ_SCOPE);
    const url = new URL(VIDEOS_LIST_URL);
    url.searchParams.set("part", "id,status");
    url.searchParams.set("id", ids.join(","));
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.items)) {
      throw await makeYouTubeApiError(response, result, "checking");
    }
    const existing = new Set(result.items
      .filter((item) => item?.status?.uploadStatus !== "deleted")
      .map((item) => String(item?.id || ""))
      .filter((id) => YOUTUBE_VIDEO_ID.test(id)));
    return ids.filter((id) => !existing.has(id));
  }

  async function getVideoPublishedDates(videoIds) {
    const ids = [...new Set(Array.isArray(videoIds) ? videoIds.map(String) : [])];
    if (ids.length < 1 || ids.length > 50 || ids.some((id) => !YOUTUBE_VIDEO_ID.test(id))) {
      throw makeError("確認するYouTube動画IDが不正です。", "validation");
    }
    const accessToken = await getAccessToken(YOUTUBE_READ_SCOPE);
    const url = new URL(VIDEOS_LIST_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", ids.join(","));
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.items)) {
      throw await makeYouTubeApiError(response, result, "checking");
    }
    return Object.fromEntries(result.items.flatMap((item) => {
      const id = String(item?.id || "");
      const publishedAtMs = Date.parse(String(item?.snippet?.publishedAt || ""));
      return YOUTUBE_VIDEO_ID.test(id) && Number.isFinite(publishedAtMs) ? [[id, publishedAtMs]] : [];
    }));
  }

  async function isPublicVideoAvailable(videoId) {
    const id = String(videoId || "");
    if (!YOUTUBE_VIDEO_ID.test(id)) throw makeError("確認するYouTube動画IDが不正です。", "validation");
    // Shared replays must be viewable by people who only have the URL. oEmbed
    // is deliberately unauthenticated, so private/deleted/blocked videos are
    // all treated as unavailable instead of rendering a broken player.
    const url = new URL("https://www.youtube.com/oembed");
    url.searchParams.set("url", `https://www.youtube.com/watch?v=${id}`);
    url.searchParams.set("format", "json");
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.ok) return true;
    if ([400, 401, 403, 404].includes(response.status)) return false;
    throw makeError("YouTube動画の公開状態を確認できませんでした。インターネット接続を確認してもう一度お試しください。", "youtube_public_check_failed");
  }

  /**
   * Set a custom thumbnail for a YouTube video.
   *
   * Generates a thumbnail from game metadata and uploads it to YouTube.
   *
   * @param {object} options
   * @param {string} options.videoId - The YouTube video ID
   * @param {object} options.metadata - Game metadata (Metadata or Deferred format)
   * @returns {Promise<object>} Thumbnail result from YouTube API
   */
  async function uploadThumbnailData(videoId, thumbnail, accessToken, signal) {
    const thumbUrl = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
    thumbUrl.searchParams.set("videoId", videoId);
    thumbUrl.searchParams.set("uploadType", "media");
    const response = await fetch(thumbUrl.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": thumbnail.mimeType,
        "content-length": String(thumbnail.buffer.length),
      },
      body: thumbnail.buffer,
      signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const info = youtubeApiErrorInfo(response, result);
      await log(`youtube thumbnail set failed video=${videoId} http=${info.httpStatus} reason=${info.reason}`);
      const reason = info.reason.toLowerCase();
      if (info.httpStatus === 403 && reason.includes("forbidden")) {
        await rememberCustomThumbnailCapability("unavailable");
      }
      const message = info.httpStatus === 403
        ? "サムネイルを設定できませんでした。YouTubeチャンネルでカスタムサムネイルが有効か確認してください。"
        : info.httpStatus === 429
          ? "サムネイルの設定回数が上限に達しました。時間をおいて再試行してください。"
          : `サムネイルの設定に失敗しました（${info.reason}${info.detail ? `: ${info.detail}` : ""}）。`;
      throw makeError(message, `youtube_thumbnail_${reason}`);
    }
    await rememberCustomThumbnailCapability("available");
    await log(`youtube thumbnail set success video=${videoId}`);
    return result;
  }

  async function waitForYouTubeProcessing(videoId, accessToken, signal) {
    const deadline = Date.now() + 15 * 60 * 1000;
    let checkFailures = 0;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const url = new URL(VIDEOS_LIST_URL);
      url.searchParams.set("part", "status,processingDetails");
      url.searchParams.set("id", videoId);
      const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal });
      const result = await response.json().catch(() => ({}));
      const video = result?.items?.[0];
      if (response.ok && video) {
        checkFailures = 0;
        const processing = String(video.processingDetails?.processingStatus || "");
        const uploadStatus = String(video.status?.uploadStatus || "");
        const progress = video.processingDetails?.processingProgress;
        if (progress?.partsTotal > 0) {
          activeJob.processingPercent = Math.min(100, Math.floor(progress.partsProcessed / progress.partsTotal * 100));
        }
        activeJob.processingStatus = processing || uploadStatus || "pending";
        publish();
        if (processing === "succeeded" || uploadStatus === "processed") return true;
        if (["failed", "terminated", "rejected", "deleted"].includes(processing) || ["failed", "rejected", "deleted"].includes(uploadStatus)) {
          throw makeError("動画は送信されましたが、YouTube側の処理に失敗しました。YouTube Studioを確認してください。", "youtube_processing_failed");
        }
      } else {
        checkFailures += 1;
        await log(`youtube processing check failed video=${videoId} http=${response.status} attempt=${checkFailures}`);
        if (checkFailures >= 3) {
          activeJob.processingStatus = "pending";
          publish();
          return false;
        }
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 3000);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    }
    activeJob.processingStatus = "pending";
    await log(`youtube processing wait timed out video=${videoId}`);
    return false;
  }

  async function setThumbnail({ videoId, metadata, options }) {
    const id = String(videoId || "");
    if (!YOUTUBE_VIDEO_ID.test(id)) throw makeError("YouTube動画IDが不正です。", "validation");
    if (!metadata && !options?.customThumbnailPath) throw makeError("サムネイル生成に必要なゲームデータがありません。", "validation");

    const accessToken = await getAccessToken();
    await log(`youtube thumbnail generating for video=${id}`);
    const thumbnail = await createThumbnail(metadata, options);
    const { buffer, mimeType } = thumbnail;
    await log(`youtube thumbnail generated size=${buffer.length} bytes mime=${mimeType}`);

    return uploadThumbnailData(id, thumbnail, accessToken);
  }

  async function createThumbnail(metadata, options = {}) {
    if (options.customThumbnailPath) {
      const customPath = await fs.realpath(String(options.customThumbnailPath)).catch(() => null);
      if (!customPath) throw makeError("選択したサムネイル画像が見つかりません。", "youtube_thumbnail_file_unavailable");
      const stat = await fs.stat(customPath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_THUMBNAIL_BYTES) {
        throw makeError("サムネイル画像は2MB以下のPNGまたはJPEGにしてください。", "youtube_thumbnail_invalid_file");
      }
      const buffer = await fs.readFile(customPath);
      const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
      if (!isPng && !isJpeg) throw makeError("サムネイルにはPNGまたはJPEG画像を選択してください。", "youtube_thumbnail_invalid_file");
      return { buffer, mimeType: isPng ? "image/png" : "image/jpeg" };
    }
    const appPath = app.getAppPath();
    const localImageCacheRoots = getImageCacheRoots();
    let thumbnail;
    try {
      thumbnail = await generateThumbnail(metadata, appPath, localImageCacheRoots, { isClip: Boolean(options.isClip) });
    } catch (error) {
      await log(`youtube thumbnail generation failed code=${error?.code || "unknown"} error=${String(error?.message || error)}`);
      if (error?.code === "thumbnail_metadata_unavailable") {
        throw makeError("サムネイルを作成できる試合データがありません。", "youtube_thumbnail_metadata_unavailable");
      }
      throw makeError("サムネイル画像の作成に失敗しました。", "youtube_thumbnail_generation_failed");
    }
    return thumbnail;
  }

  async function previewThumbnail(metadata, options = {}) {
    await log("youtube thumbnail preview generating");
    const { buffer, mimeType } = await createThumbnail(metadata, options);
    await log(`youtube thumbnail preview generated size=${buffer.length} bytes mime=${mimeType}`);
    return { dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`, mimeType, bytes: buffer.length };
  }

  return { getAuthStatus, getChannelCapabilities, getFirebaseIdToken, signIn, reopenSignIn, signOut, startUpload, setThumbnail, previewThumbnail, getUploadJob, cancelUpload, findMissingVideos, getVideoPublishedDates, isPublicVideoAvailable };
}

module.exports = { callbackLanguage, createYouTubeService, oauthCallbackHtml };
