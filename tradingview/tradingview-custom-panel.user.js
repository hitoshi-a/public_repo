// ==UserScript==
// @name         TradingView Custom Panel
// @namespace    https://github.com/hitoshi-a/public_repo
// @version      0.4.0
// @description  Show a local markdown file in a left-side panel on TradingView. v0.4 resizable panel version.
// @match        https://tradingview.com/*
// @match        https://www.tradingview.com/*
// @match        https://*.tradingview.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tradingview/tradingview-custom-panel.user.js
// @downloadURL  https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tradingview/tradingview-custom-panel.user.js
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    markdownBaseUrl: "http://127.0.0.1:8765/md",

    panelId: "tv-md-panel",
    headerId: "tv-md-panel-header",
    bodyId: "tv-md-panel-body",
    refreshButtonId: "tv-md-refresh",
    closeButtonId: "tv-md-close",
    floatingButtonId: "tv-md-floating-button",
    titleId: "tv-md-title",
    resizerId: "tv-md-panel-resizer",

    userHiddenStorageKey: "tvCustomPanelUserHidden",
    panelWidthStorageKey: "tvCustomPanelWidth",

    defaultPanelWidth: 480,
    minPanelWidth: 320,
    maxPanelWidth: 900,

    panelTitle: "TV Custom Panel v0.4",
    titlePollIntervalMs: 1000,
  };

  let lastTicker = null;
  let currentTarget = null;
  let titleWatcherId = null;
  let userHidden = false;
  let resizerInitialized = false;

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    injectStyle();
    createPanel();
    createFloatingButton();

    applyPanelWidth(loadPanelWidth());
    setupPanelResizer();

    userHidden = loadUserHidden();

    hidePanel();

    if (!userHidden) {
      loadCurrentTickerMarkdown({
        forceReload: true,
        showErrorPanel: false,
      });
    }

    startTitleWatcher();
  }

  function injectStyle() {
    if (document.getElementById("tv-md-panel-style")) return;

    const style = document.createElement("style");
    style.id = "tv-md-panel-style";
    style.textContent = `
      #${CONFIG.panelId} {
        position: fixed;
        top: 56px;
        left: 0;
        bottom: 24px;
        width: ${CONFIG.defaultPanelWidth}px;
        min-width: ${CONFIG.minPanelWidth}px;
        max-width: ${CONFIG.maxPanelWidth}px;
        z-index: 999999;
        background: rgba(20, 20, 24, 0.97);
        color: #ddd;
        border-right: 1px solid #555;
        box-sizing: border-box;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 2px 0 8px rgba(0, 0, 0, 0.35);
        display: none;
      }

      #${CONFIG.headerId} {
        height: 38px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        border-bottom: 1px solid #444;
        box-sizing: border-box;
        background: rgba(28, 28, 32, 0.98);
        color: #eee;
        font-size: 12px;
        user-select: none;
      }

      #${CONFIG.refreshButtonId},
      #${CONFIG.closeButtonId} {
        width: 28px;
        height: 24px;
        border: 1px solid #666;
        border-radius: 4px;
        background: #2b2b31;
        color: #ddd;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        flex: 0 0 auto;
      }

      #${CONFIG.refreshButtonId}:hover,
      #${CONFIG.closeButtonId}:hover {
        background: #3a3a42;
      }

      #${CONFIG.titleId} {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        flex: 1;
        font-weight: 600;
      }

      #${CONFIG.bodyId} {
        height: calc(100% - 38px);
        overflow-y: auto;
        padding: 12px;
        box-sizing: border-box;
        white-space: pre-wrap;
        font-family: ui-monospace, Consolas, "Yu Gothic", "Meiryo", monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #ddd;
      }

      #${CONFIG.bodyId}.tv-md-loading {
        color: #bbb;
      }

      #${CONFIG.bodyId}.tv-md-error {
        color: #f0c0c0;
      }

      #${CONFIG.bodyId}.tv-md-success {
        color: #ddd;
      }

      #${CONFIG.bodyId}::-webkit-scrollbar {
        width: 10px;
      }

      #${CONFIG.bodyId}::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.04);
      }

      #${CONFIG.bodyId}::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.22);
        border-radius: 6px;
      }

      #${CONFIG.bodyId}::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.32);
      }

      #${CONFIG.floatingButtonId} {
        position: fixed;
        left: 8px;
        bottom: 32px;
        z-index: 999999;
        width: 46px;
        height: 28px;
        border: 1px solid #666;
        border-radius: 4px;
        background: rgba(28, 28, 32, 0.95);
        color: #ddd;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        display: block;
      }

      #${CONFIG.floatingButtonId}:hover {
        background: rgba(58, 58, 66, 0.98);
      }

      #${CONFIG.resizerId} {
        position: absolute;
        top: 0;
        right: 0;
        width: 6px;
        height: 100%;
        cursor: ew-resize;
        background: transparent;
        z-index: 1;
      }

      #${CONFIG.resizerId}:hover {
        background: rgba(255, 255, 255, 0.12);
      }
    `;

    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.getElementById(CONFIG.panelId)) return;

    const panel = document.createElement("div");
    panel.id = CONFIG.panelId;

    const header = document.createElement("div");
    header.id = CONFIG.headerId;

    const refreshButton = document.createElement("button");
    refreshButton.id = CONFIG.refreshButtonId;
    refreshButton.type = "button";
    refreshButton.title = "Reload current ticker markdown";
    refreshButton.textContent = "↻";
    refreshButton.addEventListener("click", function () {
      setUserHidden(false);
      loadCurrentTickerMarkdown({
        forceReload: true,
        showErrorPanel: true,
      });
    });

    const title = document.createElement("span");
    title.id = CONFIG.titleId;
    title.textContent = CONFIG.panelTitle;

    const closeButton = document.createElement("button");
    closeButton.id = CONFIG.closeButtonId;
    closeButton.type = "button";
    closeButton.title = "Close panel";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", function () {
      setUserHidden(true);
      hidePanel();
    });

    const body = document.createElement("div");
    body.id = CONFIG.bodyId;

    const resizer = document.createElement("div");
    resizer.id = CONFIG.resizerId;

    header.appendChild(refreshButton);
    header.appendChild(title);
    header.appendChild(closeButton);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(resizer);

    document.body.appendChild(panel);
  }

  function createFloatingButton() {
    if (document.getElementById(CONFIG.floatingButtonId)) return;

    const button = document.createElement("button");
    button.id = CONFIG.floatingButtonId;
    button.type = "button";
    button.title = "Show markdown panel";
    button.textContent = "MD";

    button.addEventListener("click", function () {
      setUserHidden(false);
      loadCurrentTickerMarkdown({
        forceReload: true,
        showErrorPanel: true,
      });
    });

    document.body.appendChild(button);
  }

  function startTitleWatcher() {
    if (titleWatcherId !== null) return;

    titleWatcherId = window.setInterval(function () {
      loadCurrentTickerMarkdown({
        forceReload: false,
        showErrorPanel: false,
      });
    }, CONFIG.titlePollIntervalMs);
  }

  function loadCurrentTickerMarkdown(options) {
    const forceReload = Boolean(options && options.forceReload);
    const showErrorPanel = Boolean(options && options.showErrorPanel);
    const target = buildTargetFromCurrentTitle();

    if (!target) {
      if (forceReload || lastTicker !== "__NO_TICKER__") {
        lastTicker = "__NO_TICKER__";
        currentTarget = null;

        if (showErrorPanel && !userHidden) {
          showPanel();
          showTickerExtractionError(document.title);
        } else {
          hidePanel();
        }
      }
      return;
    }

    if (!forceReload && target.ticker === lastTicker) {
      return;
    }

    lastTicker = target.ticker;
    currentTarget = target;

    if (userHidden && !showErrorPanel) {
      hidePanel();
      return;
    }

    loadMarkdown(target, {
      showErrorPanel: showErrorPanel,
    });
  }

  function buildTargetFromCurrentTitle() {
    const ticker = extractTickerFromTitle(document.title);
    if (!ticker) return null;

    const filename = tickerToMdFilename(ticker);
    const url = buildMarkdownUrl(filename);

    return {
      ticker: ticker,
      filename: filename,
      url: url,
    };
  }

  function extractTickerFromTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return null;

    const token = raw.split(/\s+/)[0];
    if (!token) return null;

    const normalized = token.trim().toUpperCase();

    if (normalized === "TRADINGVIEW") return null;
    if (normalized === "チャート") return null;

    return normalized;
  }

  function tickerToMdFilename(ticker) {
    const t = String(ticker || "").trim().toUpperCase();

    if (/^[0-9]{3}[0-9A-Z]$/.test(t)) {
      return `TSE_${t}.md`;
    }

    return `${t.replace(/[\\/:*?"<>|]/g, "_")}.md`;
  }

  function buildMarkdownUrl(filename) {
    const base = CONFIG.markdownBaseUrl.replace(/\/+$/, "");
    return `${base}/${encodeURIComponent(filename)}`;
  }

  function loadMarkdown(target, options) {
    const showErrorPanel = Boolean(options && options.showErrorPanel);
    const title = document.getElementById(CONFIG.titleId);
    const body = document.getElementById(CONFIG.bodyId);

    if (!title || !body) return;

    const requestUrl = withCacheBuster(target.url);

    if (showErrorPanel) {
      showPanel();
      title.textContent = `${CONFIG.panelTitle} / ${target.filename} / loading`;
      setBodyText(
        [
          "Markdownを取得しています。",
          "",
          "Ticker:",
          target.ticker,
          "",
          "Expected file:",
          target.filename,
          "",
          "URL:",
          target.url,
        ].join("\n"),
        "tv-md-loading"
      );
    } else {
      hidePanel();
    }

    if (typeof GM_xmlhttpRequest !== "function") {
      if (showErrorPanel) {
        showError(
          [
            "GM_xmlhttpRequest が利用できません。",
            "",
            "Ticker:",
            target.ticker,
            "",
            "Expected file:",
            target.filename,
            "",
            "URL:",
            target.url,
            "",
            "確認点:",
            "- Tampermonkeyで実行されているか",
            "- メタ情報に @grant GM_xmlhttpRequest があるか",
            "- スクリプトを保存後にTradingViewを再読み込みしたか",
          ].join("\n"),
          target
        );
      } else {
        hidePanel();
      }
      return;
    }

    GM_xmlhttpRequest({
      method: "GET",
      url: requestUrl,
      timeout: 15000,

      onload: function (response) {
        if (isStaleTarget(target)) return;
        if (userHidden) return;

        handleResponse(response, target, {
          showErrorPanel: showErrorPanel,
        });
      },

      onerror: function (error) {
        if (isStaleTarget(target)) return;
        if (userHidden) return;

        const message = [
          "mdファイルを取得できません。",
          "",
          "理由:",
          "通信失敗、ローカルサーバー未起動、またはTampermonkeyの @connect 設定不足の可能性があります。",
          "",
          "Ticker:",
          target.ticker,
          "",
          "Expected file:",
          target.filename,
          "",
          "URL:",
          target.url,
          "",
          "確認点:",
          "- start_server.bat または py -3 -m http.server を起動しているか",
          `- ${target.url} をブラウザで直接開けるか`,
          "- Pythonサーバーを --bind 127.0.0.1 で起動しているか",
          "- ポート番号が 8765 か",
          "- Tampermonkeyメタ情報に @connect 127.0.0.1 があるか",
          "",
          "Error object:",
          safeStringify(error),
        ].join("\n");

        if (showErrorPanel) {
          showError(message, target);
        } else {
          hidePanel();
        }
      },

      ontimeout: function () {
        if (isStaleTarget(target)) return;
        if (userHidden) return;

        const message = [
          "mdファイルの取得がタイムアウトしました。",
          "",
          "Ticker:",
          target.ticker,
          "",
          "Expected file:",
          target.filename,
          "",
          "URL:",
          target.url,
          "",
          "確認点:",
          "- ローカルサーバーが応答しているか",
          "- ポート番号が 8765 か",
          "- セキュリティソフト等で遮断されていないか",
        ].join("\n");

        if (showErrorPanel) {
          showError(message, target);
        } else {
          hidePanel();
        }
      },
    });
  }

  function handleResponse(response, target, options) {
    const showErrorPanel = Boolean(options && options.showErrorPanel);
    const status = response.status;
    const statusText = response.statusText || "";

    if (status >= 200 && status < 300) {
      showPanel();
      showMarkdown(response.responseText || "", target, status);
      return;
    }

    if (!showErrorPanel) {
      hidePanel();
      return;
    }

    if (status === 404) {
      showError(
        [
          "mdファイルが見つかりません。",
          "",
          "HTTP Status:",
          `${status} ${statusText}`,
          "",
          "Ticker:",
          target.ticker,
          "",
          "Expected file:",
          target.filename,
          "",
          "URL:",
          target.url,
          "",
          "確認点:",
          "- mdファイルを作成したか",
          "- ファイル名が一致しているか",
          "- ローカルサーバーのルート直下に md フォルダがあるか",
          "- 起動ディレクトリが正しいか",
        ].join("\n"),
        target
      );
      return;
    }

    if (status === 403) {
      showError(
        [
          "mdファイルへのアクセスが拒否されました。",
          "",
          "HTTP Status:",
          `${status} ${statusText}`,
          "",
          "Ticker:",
          target.ticker,
          "",
          "Expected file:",
          target.filename,
          "",
          "URL:",
          target.url,
          "",
          "確認点:",
          "- ローカルサーバーの公開ディレクトリが正しいか",
          "- OSやセキュリティソフトのアクセス制限がないか",
        ].join("\n"),
        target
      );
      return;
    }

    showError(
      [
        "mdファイルの取得でHTTPエラーが発生しました。",
        "",
        "HTTP Status:",
        `${status} ${statusText}`,
        "",
        "Ticker:",
        target.ticker,
        "",
        "Expected file:",
        target.filename,
        "",
        "URL:",
        target.url,
        "",
        "Response preview:",
        previewText(response.responseText || ""),
      ].join("\n"),
      target
    );
  }

  function showMarkdown(markdown, target, status) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / ${target.filename} / loaded ${status}`;
    }

    if (!markdown.trim()) {
      setBodyText(
        [
          "mdファイルは取得できましたが、内容が空です。",
          "",
          "Ticker:",
          target.ticker,
          "",
          "Expected file:",
          target.filename,
          "",
          "URL:",
          target.url,
        ].join("\n"),
        "tv-md-error"
      );
      return;
    }

    setBodyText(markdown, "tv-md-success");
  }

  function showTickerExtractionError(titleText) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / ticker error`;
    }

    setBodyText(
      [
        "TradingViewのタブタイトルからtickerを取得できません。",
        "",
        "現在の document.title:",
        String(titleText || ""),
        "",
        "想定:",
        "タブタイトルの先頭にtickerがあり、その次に空白が来る形式。",
        "",
        "例:",
        "TSLA 440.36 ...",
        "4028 2,344 ...",
      ].join("\n"),
      "tv-md-error"
    );
  }

  function showError(message, target) {
    const title = document.getElementById(CONFIG.titleId);

    showPanel();

    if (title) {
      if (target && target.filename) {
        title.textContent = `${CONFIG.panelTitle} / ${target.filename} / error`;
      } else {
        title.textContent = `${CONFIG.panelTitle} / error`;
      }
    }

    setBodyText(message, "tv-md-error");
  }

  function showPanel() {
    const panel = document.getElementById(CONFIG.panelId);
    if (panel) {
      panel.style.display = "block";
    }
    updateFloatingButtonVisibility();
  }

  function hidePanel() {
    const panel = document.getElementById(CONFIG.panelId);
    if (panel) {
      panel.style.display = "none";
    }
    updateFloatingButtonVisibility();
  }

  function setUserHidden(value) {
    userHidden = Boolean(value);

    try {
      localStorage.setItem(CONFIG.userHiddenStorageKey, userHidden ? "1" : "0");
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to save userHidden:", error);
    }

    updateFloatingButtonVisibility();
  }

  function loadUserHidden() {
    try {
      return localStorage.getItem(CONFIG.userHiddenStorageKey) === "1";
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to load userHidden:", error);
      return false;
    }
  }

  function updateFloatingButtonVisibility() {
    const panel = document.getElementById(CONFIG.panelId);
    const button = document.getElementById(CONFIG.floatingButtonId);
    if (!button) return;

    const panelVisible = panel && panel.style.display !== "none";
    button.style.display = panelVisible ? "none" : "block";
  }

  function setupPanelResizer() {
    if (resizerInitialized) return;

    const panel = document.getElementById(CONFIG.panelId);
    const resizer = document.getElementById(CONFIG.resizerId);
    if (!panel || !resizer) return;

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener("mousedown", function (event) {
      isDragging = true;
      startX = event.clientX;
      startWidth = panel.getBoundingClientRect().width;

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      event.preventDefault();
      event.stopPropagation();
    });

    window.addEventListener("mousemove", function (event) {
      if (!isDragging) return;

      const delta = event.clientX - startX;
      const newWidth = clamp(
        startWidth + delta,
        CONFIG.minPanelWidth,
        CONFIG.maxPanelWidth
      );

      panel.style.width = `${newWidth}px`;
    });

    window.addEventListener("mouseup", function () {
      if (!isDragging) return;

      isDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const finalWidth = Math.round(panel.getBoundingClientRect().width);
      savePanelWidth(finalWidth);
    });

    resizerInitialized = true;
  }

  function applyPanelWidth(width) {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;

    const clamped = clamp(width, CONFIG.minPanelWidth, CONFIG.maxPanelWidth);
    panel.style.width = `${clamped}px`;
  }

  function loadPanelWidth() {
    try {
      const raw = localStorage.getItem(CONFIG.panelWidthStorageKey);
      const width = Number(raw);

      if (!Number.isFinite(width)) {
        return CONFIG.defaultPanelWidth;
      }

      return clamp(width, CONFIG.minPanelWidth, CONFIG.maxPanelWidth);
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to load panel width:", error);
      return CONFIG.defaultPanelWidth;
    }
  }

  function savePanelWidth(width) {
    try {
      const clamped = clamp(width, CONFIG.minPanelWidth, CONFIG.maxPanelWidth);
      localStorage.setItem(CONFIG.panelWidthStorageKey, String(clamped));
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to save panel width:", error);
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function isStaleTarget(target) {
    return !currentTarget || currentTarget.ticker !== target.ticker;
  }

  function setBodyText(text, className) {
    const body = document.getElementById(CONFIG.bodyId);
    if (!body) return;

    body.className = className || "";
    body.textContent = text;
  }

  function withCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}_tvmd=${Date.now()}`;
  }

  function previewText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "(empty response)";
    return normalized.length > 500 ? normalized.slice(0, 500) + "..." : normalized;
  }

  function safeStringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  init();
})();