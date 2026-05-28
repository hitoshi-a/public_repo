// ==UserScript==
// @name         TradingView Custom Panel
// @namespace    https://github.com/hitoshi-a/public_repo
// @version      0.2.0
// @description  Show a local markdown file in a left-side panel on TradingView. v0.2 ticker-linked version.
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
    titleId: "tv-md-title",

    panelTitle: "TV Custom Panel v0.2",
    titlePollIntervalMs: 1000,
  };

  let lastTicker = null;
  let currentTarget = null;
  let titleWatcherId = null;

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    injectStyle();
    createPanel();
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
        width: 480px;
        min-width: 320px;
        max-width: 900px;
        z-index: 999999;
        background: rgba(20, 20, 24, 0.97);
        color: #ddd;
        border-right: 1px solid #555;
        box-sizing: border-box;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 2px 0 8px rgba(0, 0, 0, 0.35);
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

      #${CONFIG.refreshButtonId} {
        width: 28px;
        height: 24px;
        border: 1px solid #666;
        border-radius: 4px;
        background: #2b2b31;
        color: #ddd;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
      }

      #${CONFIG.refreshButtonId}:hover {
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
      loadCurrentTickerMarkdown({ force: true });
    });

    const title = document.createElement("span");
    title.id = CONFIG.titleId;
    title.textContent = CONFIG.panelTitle;

    const body = document.createElement("div");
    body.id = CONFIG.bodyId;

    header.appendChild(refreshButton);
    header.appendChild(title);

    panel.appendChild(header);
    panel.appendChild(body);

    document.body.appendChild(panel);
  }

  function startTitleWatcher() {
    if (titleWatcherId !== null) return;

    loadCurrentTickerMarkdown({ force: true });

    titleWatcherId = window.setInterval(function () {
      loadCurrentTickerMarkdown({ force: false });
    }, CONFIG.titlePollIntervalMs);
  }

  function loadCurrentTickerMarkdown(options) {
    const force = Boolean(options && options.force);
    const target = buildTargetFromCurrentTitle();

    if (!target) {
      if (force || lastTicker !== "__NO_TICKER__") {
        lastTicker = "__NO_TICKER__";
        currentTarget = null;
        showTickerExtractionError(document.title);
      }
      return;
    }

    if (!force && target.ticker === lastTicker) {
      return;
    }

    lastTicker = target.ticker;
    currentTarget = target;
    loadMarkdown(target);
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

    // TradingViewの汎用タイトルなどをtickerとして誤認しないための最低限の除外。
    if (normalized === "TRADINGVIEW") return null;
    if (normalized === "チャート") return null;

    return normalized;
  }

  function tickerToMdFilename(ticker) {
    const t = String(ticker || "").trim().toUpperCase();

    // 日本株コード。通常の4桁コードに加えて、130Aのような英字入りコードも想定。
    if (/^[0-9]{3}[0-9A-Z]$/.test(t)) {
      return `TSE_${t}.md`;
    }

    // 米国株など。Windowsファイル名に使えない文字だけ置換。
    return `${t.replace(/[\\/:*?"<>|]/g, "_")}.md`;
  }

  function buildMarkdownUrl(filename) {
    const base = CONFIG.markdownBaseUrl.replace(/\/+$/, "");
    return `${base}/${encodeURIComponent(filename)}`;
  }

  function loadMarkdown(target) {
    const title = document.getElementById(CONFIG.titleId);
    const body = document.getElementById(CONFIG.bodyId);

    if (!title || !body) return;

    const requestUrl = withCacheBuster(target.url);

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

    if (typeof GM_xmlhttpRequest !== "function") {
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
      return;
    }

    GM_xmlhttpRequest({
      method: "GET",
      url: requestUrl,
      timeout: 15000,

      onload: function (response) {
        handleResponse(response, target);
      },

      onerror: function (error) {
        showError(
          [
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
          ].join("\n"),
          target
        );
      },

      ontimeout: function () {
        showError(
          [
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
          ].join("\n"),
          target
        );
      },
    });
  }

  function handleResponse(response, target) {
    const status = response.status;
    const statusText = response.statusText || "";

    if (status >= 200 && status < 300) {
      showMarkdown(response.responseText || "", target, status);
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

    if (title) {
      if (target && target.filename) {
        title.textContent = `${CONFIG.panelTitle} / ${target.filename} / error`;
      } else {
        title.textContent = `${CONFIG.panelTitle} / error`;
      }
    }

    setBodyText(message, "tv-md-error");
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