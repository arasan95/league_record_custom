(() => {
  "use strict";

  const RELEASES_API = "https://api.github.com/repos/arasan95/league_record_custom/releases?per_page=30";
  const RELEASES_PAGE = "https://github.com/arasan95/league_record_custom/releases";
  const CACHE_KEY = "league-record-releases-v3";
  const PAGE_CACHE_VERSION = "20260728-5";
  const isJapanese = document.documentElement.lang === "ja";
  const text = {
    stableDate: (date) => isJapanese ? `${date}公開 · Windows x64` : `Published ${date} · Windows x64`,
    noInstaller: isJapanese ? "ダウンロードファイルはGitHub Releasesで確認できます" : "Download files are available on GitHub Releases",
    previewDate: (date) => isJapanese ? `${date}公開 · 開発中のテスト版` : `Published ${date} · Test build`,
    noPreview: isJapanese ? "現在公開中のテスト版はありません" : "No test build is currently available",
    noPreviewDetail: isJapanese
      ? "新しいプレリリースが公開されると、ここからダウンロードできます。"
      : "A download will appear here when a new pre-release is published.",
    latest: isJapanese ? "最新版" : "Latest",
    latestRelease: isJapanese ? "最新の正式リリース" : "Latest stable release",
    changes: isJapanese ? "主な変更点" : "Changes",
    previewChanges: isJapanese ? "テスト版の変更点" : "Test build changes",
    previewLabel: isJapanese ? "テスト版" : "Pre-release",
    loadingPreviewNotes: isJapanese ? "最新のテスト版の内容を取得しています。" : "Loading changes from the latest test build.",
    noDetails: isJapanese
      ? "このバージョンの詳細はGitHub Releasesで確認できます。"
      : "Details for this version are available on GitHub Releases.",
    viewRelease: isJapanese ? "GitHubでリリースを見る →" : "View release on GitHub →",
    fetchFailed: isJapanese ? "更新履歴を取得できませんでした。" : "The release notes could not be loaded. ",
    viewGithub: isJapanese ? "GitHub Releasesで確認する" : "View GitHub Releases",
    checkGithub: isJapanese ? "GitHub Releasesで最新版を確認できます" : "Check GitHub Releases for the latest version",
  };

  document.querySelectorAll('a[href^="/"]').forEach((link) => {
    const url = new URL(link.getAttribute("href"), window.location.origin);
    url.searchParams.set("v", PAGE_CACHE_VERSION);
    link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
  });

  document.querySelectorAll("[data-language-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const currentPath = window.location.pathname;
      if (select.value === "ja") {
        const relative = currentPath === "/" ? "" : currentPath.replace(/^\//, "");
        window.location.assign(`/ja/${relative}?v=${PAGE_CACHE_VERSION}`);
      } else {
        const englishPath = currentPath.replace(/^\/ja(?:\/|$)/, "/");
        window.location.assign(`${englishPath || "/"}?v=${PAGE_CACHE_VERSION}`);
      }
    });
  });

  const setText = (selector, value) => {
    document.querySelectorAll(selector).forEach((element) => { element.textContent = value; });
  };

  const setLink = (selector, href) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.setAttribute("href", href);
      element.setAttribute("rel", "noopener");
    });
  };

  const releaseVersion = (release) => String(release.name || release.tag_name || "Release");

  const isElectronRelease = (release) => {
    if (/^electron-v/i.test(String(release?.tag_name || ""))) return true;
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    return assets.some((asset) => /^LeagueRecordElectron[-_. ]/i.test(String(asset?.name || "")));
  };

  const selectWindowsInstaller = (release) => {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const installers = assets.filter((asset) => /\.exe$/i.test(asset.name) && !/updater/i.test(asset.name));
    const preferred = installers.find((asset) => /(?:x64[-_.]?setup|electron[-_.]?setup|setup[-_.]?\d)/i.test(asset.name));
    return preferred || installers[0] || null;
  };

  const localizedNotes = (body) => {
    const normalized = String(body || "").replace(/\r/g, "");
    const localized = isJapanese
      ? normalized.match(/\[日本語\]([\s\S]*?)(?:\[English\]|$)/i)?.[1]
      : normalized.match(/\[English\]([\s\S]*)$/i)?.[1];
    return (localized || normalized)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, ""))
      .slice(0, 12);
  };

  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(isJapanese ? "ja-JP" : "en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).format(date);
  };

  const readCache = () => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Array.isArray(cached.releases)) {
        return cached.releases;
      }
    } catch {}
    return null;
  };

  const fetchReleases = async () => {
    const cached = readCache();
    try {
      const response = await fetch(RELEASES_API, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
      const releases = await response.json();
      if (!Array.isArray(releases)) throw new Error("GitHub API returned an invalid response");
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), releases })); } catch {}
      return releases;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  };

  const updateDownloadLinks = (releases) => {
    const published = releases.filter((release) => !release.draft);
    const stable = published.find((release) => !release.prerelease);
    const preview = published.find((release) => release.prerelease && isElectronRelease(release))
      || published.find((release) => release.prerelease);

    if (stable) {
      const installer = selectWindowsInstaller(stable);
      const href = installer?.browser_download_url || stable.html_url || RELEASES_PAGE;
      setLink("[data-stable-download]", href);
      setText("[data-stable-version]", releaseVersion(stable));
      setText("[data-release-status]", installer
        ? text.stableDate(formatDate(stable.published_at))
        : text.noInstaller);
    }

    if (preview) {
      const installer = selectWindowsInstaller(preview);
      setLink("[data-preview-download]", installer?.browser_download_url || preview.html_url || RELEASES_PAGE);
      setText("[data-preview-name]", releaseVersion(preview));
      setText("[data-preview-meta]", text.previewDate(formatDate(preview.published_at)));
    } else {
      setText("[data-preview-name]", text.noPreview);
      setText("[data-preview-meta]", text.noPreviewDetail);
    }
    return { stable, preview };
  };

  const renderPreviewNotes = (preview) => {
    const target = document.querySelector("[data-preview-notes]");
    if (!target) return;
    target.replaceChildren();
    const notes = preview ? localizedNotes(preview.body) : [];
    if (!notes.length) {
      const article = document.createElement("article");
      const number = document.createElement("span");
      number.textContent = "—";
      const content = document.createElement("div");
      const description = document.createElement("p");
      description.textContent = preview ? text.noDetails : text.noPreviewDetail;
      content.append(description);
      article.append(number, content);
      target.append(article);
      return;
    }
    notes.forEach((note, index) => {
      const article = document.createElement("article");
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      const content = document.createElement("div");
      const description = document.createElement("p");
      description.textContent = note;
      content.append(description);
      article.append(number, content);
      target.append(article);
    });
  };

  const renderReleaseHistory = (releases) => {
    const target = document.querySelector("#release-list");
    if (!target) return;
    const publishedReleases = releases.filter((release) => !release.draft);
    target.replaceChildren();

    let stableIndex = 0;
    publishedReleases.forEach((release) => {
      const article = document.createElement("article");
      article.className = "release-card";
      const header = document.createElement("div");
      header.className = "release-card-header";
      const meta = document.createElement("div");
      const version = document.createElement("p");
      version.className = "release-version";
      const isLatestStable = !release.prerelease && stableIndex === 0;
      version.textContent = release.prerelease
        ? `${releaseVersion(release)} · ${text.previewLabel}`
        : isLatestStable ? `${releaseVersion(release)} · ${text.latest}` : releaseVersion(release);
      const title = document.createElement("h2");
      title.textContent = release.prerelease
        ? text.previewChanges
        : isLatestStable ? text.latestRelease : text.changes;
      if (!release.prerelease) stableIndex += 1;
      meta.append(version, title);
      const date = document.createElement("time");
      date.dateTime = release.published_at || "";
      date.textContent = formatDate(release.published_at);
      header.append(meta, date);
      article.append(header);

      const notes = localizedNotes(release.body);
      if (notes.length) {
        const list = document.createElement("ul");
        notes.forEach((note) => {
          const item = document.createElement("li");
          item.textContent = note;
          list.append(item);
        });
        article.append(list);
      } else {
        const empty = document.createElement("p");
        empty.textContent = text.noDetails;
        article.append(empty);
      }

      const link = document.createElement("a");
      link.className = "text-link";
      link.href = release.html_url || RELEASES_PAGE;
      link.rel = "noopener";
      link.textContent = text.viewRelease;
      article.append(link);
      target.append(article);
    });
  };

  fetchReleases().then((releases) => {
    const selected = updateDownloadLinks(releases);
    renderPreviewNotes(selected.preview);
    renderReleaseHistory(releases);
  }).catch(() => {
    setText("[data-release-status]", text.checkGithub);
    const target = document.querySelector("#release-list");
    if (target) {
      target.replaceChildren();
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.append(text.fetchFailed, Object.assign(document.createElement("a"), {
        href: RELEASES_PAGE, textContent: text.viewGithub,
      }));
      target.append(notice);
    }
  });
})();
