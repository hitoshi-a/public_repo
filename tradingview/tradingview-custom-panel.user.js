// ==UserScript==
// @name         TradingView Custom Panel
// @namespace    https://github.com/your-name/your-repo
// @version      0.1.0
// @description  Show a local markdown file in a left-side panel on TradingView. v0.1 connectivity test.
// @match        https://www.tradingview.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    // v0.1では固定URL。v0.2で document.title からシンボルを取得して動的化する。
    markdownUrl: "http://127.0.0.1:8765/md/TSE_4028.md",

    panelId: "tv-md-panel",
    headerId: "tv-md-panel-header",
    bodyId: "tv-md-panel-body",
    refreshButtonId: "tv-md-refresh",
    titleId: "tv-md-title",

    panelTitle: "TV Markdown Panel v0.1",
  };

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    injectStyle();
    createPanel();
    loadMarkdown();
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
    refreshButton.title = "Reload markdown";
    refreshButton.textContent = "↻";
    refreshButton.addEventListener("click", loadMarkdown);

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

  function loadMarkdown() {
    const panel = document.getElementById(CONFIG.panelId);
    const title = document.getElementById(CONFIG.titleId);
    const body = document.getElementById(CONFIG.bodyId);

    if (!panel || !title || !body) return;

    const url = withCacheBuster(CONFIG.markdownUrl);

    title.textContent = CONFIG.panelTitle;
    setBodyText(
      [
        "Markdownを取得しています。",
        "",
        "URL:",
        CONFIG.markdownUrl,
      ].join("\n"),
      "tv-md-loading"
    );

    if (typeof GM_xmlhttpRequest !== "function") {
      showError([
        "GM_xmlhttpRequest が利用できません。",
        "",
        "確認点:",
        "- Tampermonkeyで実行されているか",
        "- メタ情報に @grant GM_xmlhttpRequest があるか",
        "- スクリプトを保存後にTradingViewを再読み込みしたか",
      ].join("\n"));
      return;
    }

    GM_xmlhttpRequest({
      method: "GET",
      url: url,
      timeout: 15000,

      onload: function (response) {
        handleResponse(response, CONFIG.markdownUrl);
      },

      onerror: function (error) {
        showError([
          "mdファイルを取得できません。",
          "",
          "理由:",
          "通信失敗、ローカルサーバー未起動、またはTampermonkeyの @connect 設定不足の可能性があります。",
          "",
          "URL:",
          CONFIG.markdownUrl,
          "",
          "確認点:",
          "- start_server.bat または python -m http.server を起動しているか",
          "- http://127.0.0.1:8765/md/TSE_4028.md をブラウザで直接開けるか",
          "- Pythonサーバーを --bind 127.0.0.1 で起動しているか",
          "- ポート番号が 8765 か",
          "- Tampermonkeyメタ情報に @connect 127.0.0.1 があるか",
          "",
          "Error object:",
          safeStringify(error),
        ].join("\n"));
      },

      ontimeout: function () {
        showError([
          "mdファイルの取得がタイムアウトしました。",
          "",
          "URL:",
          CONFIG.markdownUrl,
          "",
          "確認点:",
          "- ローカルサーバーが応答しているか",
          "- ポート番号が 8765 か",
          "- セキュリティソフト等で遮断されていないか",
        ].join("\n"));
      },
    });
  }

  function handleResponse(response, originalUrl) {
    const status = response.status;
    const statusText = response.statusText || "";

    if (status >= 200 && status < 300) {
      showMarkdown(response.responseText || "", originalUrl, status);
      return;
    }

    if (status === 404) {
      showError([
        "mdファイルが見つかりません。",
        "",
        "HTTP Status:",
        `${status} ${statusText}`,
        "",
        "Expected URL:",
        originalUrl,
        "",
        "Expected file:",
        "md/TSE_4028.md",
        "",
        "確認点:",
        "- mdファイルを作成したか",
        "- ファイル名が TSE_4028.md になっているか",
        "- ローカルサーバーのルート直下に md フォルダがあるか",
        "- 起動ディレクトリが正しいか",
      ].join("\n"));
      return;
    }

    if (status === 403) {
      showError([
        "mdファイルへのアクセスが拒否されました。",
        "",
        "HTTP Status:",
        `${status} ${statusText}`,
        "",
        "URL:",
        originalUrl,
        "",
        "確認点:",
        "- ローカルサーバーの公開ディレクトリが正しいか",
        "- OSやセキュリティソフトのアクセス制限がないか",
      ].join("\n"));
      return;
    }

    showError([
      "mdファイルの取得でHTTPエラーが発生しました。",
      "",
      "HTTP Status:",
      `${status} ${statusText}`,
      "",
      "URL:",
      originalUrl,
      "",
      "Response preview:",
      previewText(response.responseText || ""),
    ].join("\n"));
  }

  function showMarkdown(markdown, originalUrl, status) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / loaded ${status}`;
    }

    if (!markdown.trim()) {
      setBodyText(
        [
          "mdファイルは取得できましたが、内容が空です。",
          "",
          "URL:",
          originalUrl,
        ].join("\n"),
        "tv-md-error"
      );
      return;
    }

    setBodyText(markdown, "tv-md-success");
  }

  function showError(message) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / error`;
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