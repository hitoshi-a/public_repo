// ==UserScript==
// @name         TradingView Custom Panel
// @namespace    https://github.com/hitoshi-a/public_repo
// @version      0.7.17
// @description  Show local earnings markdown or fallback company summary in a floating TradingView panel. v0.7.17 adds company summary fallback.
// @match        https://tradingview.com/*
// @match        https://www.tradingview.com/*
// @match        https://*.tradingview.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tradingview/tradingview-custom-panel.user.js
// @downloadURL  https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tradingview/tradingview-custom-panel.user.js
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    markdownBaseUrl: "http://127.0.0.1:8765/earnings-signal-analysis/md",
    companySummaryUrl: "http://127.0.0.1:8765/company-summary/company_summary.json",

    panelId: "tv-md-panel",
    headerId: "tv-md-panel-header",
    bodyId: "tv-md-panel-body",
    refreshButtonId: "tv-md-refresh",
    settingsButtonId: "tv-md-settings",
    renderModeButtonId: "tv-md-render-mode",
    tocButtonId: "tv-md-toc-button",
    analyzeButtonId: "tv-md-analyze-button",
    closeButtonId: "tv-md-close",
    floatingButtonId: "tv-md-floating-button",
    floatingAnalyzeButtonId: "tv-md-floating-analyze-button",
    titleId: "tv-md-title",
    settingsMenuId: "tv-md-settings-menu",
    tocMenuId: "tv-md-toc-menu",
    resetLayoutButtonId: "tv-md-reset-layout",
    opacityRangeId: "tv-md-opacity-range",
    opacityValueId: "tv-md-opacity-value",

    leftResizerId: "tv-md-resizer-left",
    topResizerId: "tv-md-resizer-top",
    topLeftResizerId: "tv-md-resizer-top-left",
    rightResizerId: "tv-md-resizer-right",
    bottomResizerId: "tv-md-resizer-bottom",
    cornerResizerId: "tv-md-resizer-corner",

    userHiddenStorageKey: "tvCustomPanelUserHidden",
    panelRectStorageKey: "tvCustomPanelRect",
    renderModeStorageKey: "tvCustomPanelRenderMode",
    panelOpacityStorageKey: "tvCustomPanelOpacity",

    defaultRenderMode: "markdown",
    defaultPanelOpacity: 0.97,
    minPanelOpacity: 0.55,
    maxPanelOpacity: 1.0,

    defaultPanelLeft: 0,
    defaultPanelTop: 56,
    defaultPanelWidth: 480,
    minPanelWidth: 320,
    maxPanelWidth: 1200,
    minPanelHeight: 240,

    panelTitle: "TV Custom Panel v0.7.17",
    titlePollIntervalMs: 1000,
  };

  let lastTicker = null;
  let currentTarget = null;
  let titleWatcherId = null;
  let userHidden = false;
  let moveInitialized = false;
  let resizeInitialized = false;
  let currentMarkdownText = "";
  let currentRenderMode = CONFIG.defaultRenderMode;
  let currentPanelOpacity = CONFIG.defaultPanelOpacity;
  let currentHeadings = [];
  let companySummaryCache = null;
  let companySummaryLoadPromise = null;

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    injectStyle();
    createPanel();
    createFloatingButton();
    createFloatingAnalyzeButton();

    currentRenderMode = loadRenderMode();
    currentPanelOpacity = loadPanelOpacity();
    syncRenderModeButton();
    applyPanelOpacity(currentPanelOpacity);

    applyPanelRect(loadPanelRect());
    setupPanelMove();
    setupPanelResize();

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
        top: ${CONFIG.defaultPanelTop}px;
        left: ${CONFIG.defaultPanelLeft}px;
        width: ${CONFIG.defaultPanelWidth}px;
        height: 720px;
        min-width: ${CONFIG.minPanelWidth}px;
        min-height: ${CONFIG.minPanelHeight}px;
        z-index: 999999;
        --tv-md-panel-alpha: 0.97;
        --tv-md-header-alpha: 0.98;
        background: rgba(20, 20, 24, var(--tv-md-panel-alpha));
        color: #ddd;
        border: 1px solid #555;
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
        background: rgba(28, 28, 32, var(--tv-md-header-alpha));
        color: #eee;
        font-size: 12px;
        user-select: none;
      }

      #${CONFIG.refreshButtonId},
      #${CONFIG.settingsButtonId},
      #${CONFIG.renderModeButtonId},
      #${CONFIG.tocButtonId},
      #${CONFIG.analyzeButtonId},
      #${CONFIG.closeButtonId} {
        height: 24px;
        border: 1px solid #666;
        border-radius: 4px;
        background: #2b2b31;
        color: #ddd;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        flex: 0 0 auto;
      }

      #${CONFIG.settingsButtonId} {
        width: 28px;
        font-size: 14px;
      }

      #${CONFIG.closeButtonId} {
        min-width: 58px;
        padding: 0 8px;
        font-size: 12px;
        font-weight: 600;
      }

      #${CONFIG.renderModeButtonId},
      #${CONFIG.tocButtonId} {
        min-width: 42px;
        padding: 0 6px;
        font-weight: 600;
      }

      #${CONFIG.analyzeButtonId} {
        min-width: 58px;
        padding: 0 8px;
        font-weight: 600;
      }

      #${CONFIG.refreshButtonId}:hover,
      #${CONFIG.settingsButtonId}:hover,
      #${CONFIG.renderModeButtonId}:hover,
      #${CONFIG.tocButtonId}:hover,
      #${CONFIG.analyzeButtonId}:hover,
      #${CONFIG.closeButtonId}:hover {
        background: #3a3a42;
      }

      #${CONFIG.titleId} {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        flex: 1;
        font-weight: 600;
        cursor: move;
        padding: 3px 4px;
        border-radius: 3px;
      }

      #${CONFIG.titleId}:hover {
        background: rgba(255, 255, 255, 0.06);
      }

      #${CONFIG.bodyId} {
        height: calc(100% - 38px);
        overflow-y: auto;
        padding: 12px;
        box-sizing: border-box;
        color: #ddd;
      }

      #${CONFIG.bodyId}.tv-md-loading {
        white-space: pre-wrap;
        font-family: ui-monospace, Consolas, "Yu Gothic", "Meiryo", monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #bbb;
      }

      #${CONFIG.bodyId}.tv-md-error {
        white-space: pre-wrap;
        font-family: ui-monospace, Consolas, "Yu Gothic", "Meiryo", monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #f0c0c0;
      }

      #${CONFIG.bodyId}.tv-md-success.tv-md-raw {
        white-space: pre-wrap;
        font-family: ui-monospace, Consolas, "Yu Gothic", "Meiryo", monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #ddd;
      }

      #${CONFIG.bodyId}.tv-md-success.tv-md-rendered {
        white-space: normal;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic", "Meiryo", sans-serif;
        font-size: 13px;
        line-height: 1.55;
        color: #ddd;
      }

      #${CONFIG.bodyId}.tv-md-rendered h1 {
        font-size: 17px;
        margin: 0 0 10px;
        line-height: 1.35;
      }

      #${CONFIG.bodyId}.tv-md-rendered h2 {
        font-size: 15px;
        margin: 16px 0 8px;
        border-bottom: 1px solid #555;
        padding-bottom: 4px;
        line-height: 1.35;
      }

      #${CONFIG.bodyId}.tv-md-rendered h3 {
        font-size: 14px;
        margin: 12px 0 6px;
        line-height: 1.35;
      }

      #${CONFIG.bodyId}.tv-md-rendered p {
        margin: 6px 0;
      }

      #${CONFIG.bodyId}.tv-md-rendered ul,
      #${CONFIG.bodyId}.tv-md-rendered ol {
        margin: 6px 0 8px;
        padding-left: 22px;
      }

      #${CONFIG.bodyId}.tv-md-rendered li {
        margin: 2px 0;
      }

      #${CONFIG.bodyId}.tv-md-rendered table {
        width: 100%;
        border-collapse: collapse;
        margin: 8px 0 12px;
        font-size: 12px;
        table-layout: auto;
      }

      #${CONFIG.bodyId}.tv-md-rendered th,
      #${CONFIG.bodyId}.tv-md-rendered td {
        border: 1px solid #555;
        padding: 4px 6px;
        vertical-align: top;
        word-break: break-word;
      }

      #${CONFIG.bodyId}.tv-md-rendered th {
        background: rgba(255, 255, 255, 0.08);
        font-weight: 600;
      }

      #${CONFIG.bodyId}.tv-md-rendered pre {
        white-space: pre-wrap;
        overflow-x: auto;
        padding: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid #555;
        border-radius: 4px;
        font-family: ui-monospace, Consolas, "Yu Gothic", "Meiryo", monospace;
        font-size: 12px;
        line-height: 1.45;
      }

      #${CONFIG.bodyId}.tv-md-rendered code {
        font-family: ui-monospace, Consolas, "Yu Gothic", "Meiryo", monospace;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 3px;
        padding: 1px 3px;
      }

      #${CONFIG.bodyId}.tv-md-rendered pre code {
        background: transparent;
        border-radius: 0;
        padding: 0;
      }

      #${CONFIG.bodyId}.tv-md-rendered a {
        color: #8ab4f8;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      #${CONFIG.bodyId}.tv-md-rendered a:hover {
        color: #adc8ff;
      }

      #${CONFIG.bodyId}.tv-md-rendered hr {
        border: 0;
        border-top: 1px solid #555;
        margin: 14px 0;
      }

      #${CONFIG.bodyId}::-webkit-scrollbar,
      #${CONFIG.tocMenuId}::-webkit-scrollbar {
        width: 10px;
      }

      #${CONFIG.bodyId}::-webkit-scrollbar-track,
      #${CONFIG.tocMenuId}::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.04);
      }

      #${CONFIG.bodyId}::-webkit-scrollbar-thumb,
      #${CONFIG.tocMenuId}::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.22);
        border-radius: 6px;
      }

      #${CONFIG.bodyId}::-webkit-scrollbar-thumb:hover,
      #${CONFIG.tocMenuId}::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.32);
      }

      #${CONFIG.floatingButtonId},
      #${CONFIG.floatingAnalyzeButtonId} {
        position: fixed;
        top: 58px;
        z-index: 999999;
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

      #${CONFIG.floatingButtonId} {
        left: 12px;
        min-width: 58px;
        padding: 0 8px;
      }

      #${CONFIG.floatingAnalyzeButtonId} {
        left: 78px;
        min-width: 74px;
        padding: 0 8px;
      }

      #${CONFIG.floatingButtonId}:hover,
      #${CONFIG.floatingAnalyzeButtonId}:hover {
        background: rgba(58, 58, 66, 0.98);
      }

      #${CONFIG.leftResizerId} {
        position: absolute;
        top: 0;
        left: 0;
        width: 7px;
        height: 100%;
        cursor: ew-resize;
        background: transparent;
        z-index: 2;
      }

      #${CONFIG.topResizerId} {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 7px;
        cursor: ns-resize;
        background: transparent;
        z-index: 2;
      }

      #${CONFIG.topLeftResizerId} {
        position: absolute;
        top: 0;
        left: 0;
        width: 14px;
        height: 14px;
        cursor: nwse-resize;
        background: rgba(255, 255, 255, 0.08);
        z-index: 3;
      }

      #${CONFIG.rightResizerId} {
        position: absolute;
        top: 0;
        right: 0;
        width: 7px;
        height: 100%;
        cursor: ew-resize;
        background: transparent;
        z-index: 2;
      }

      #${CONFIG.bottomResizerId} {
        position: absolute;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 7px;
        cursor: ns-resize;
        background: transparent;
        z-index: 2;
      }

      #${CONFIG.cornerResizerId} {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 14px;
        height: 14px;
        cursor: nwse-resize;
        background: rgba(255, 255, 255, 0.08);
        z-index: 3;
      }

      #${CONFIG.leftResizerId}:hover,
      #${CONFIG.topResizerId}:hover,
      #${CONFIG.topLeftResizerId}:hover,
      #${CONFIG.rightResizerId}:hover,
      #${CONFIG.bottomResizerId}:hover,
      #${CONFIG.cornerResizerId}:hover {
        background: rgba(255, 255, 255, 0.14);
      }

      #${CONFIG.settingsMenuId},
      #${CONFIG.tocMenuId} {
        position: absolute;
        top: 38px;
        z-index: 4;
        box-sizing: border-box;
        border: 1px solid #555;
        border-radius: 6px;
        background: rgba(28, 28, 32, var(--tv-md-header-alpha));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
        display: none;
      }

      #${CONFIG.settingsMenuId}.is-open,
      #${CONFIG.tocMenuId}.is-open {
        display: block;
      }

      #${CONFIG.settingsMenuId} {
        right: 10px;
        min-width: 180px;
        padding: 8px;
      }

      #${CONFIG.tocMenuId} {
        left: 54px;
        min-width: 220px;
        max-width: 460px;
        max-height: 360px;
        overflow-y: auto;
        padding: 8px;
      }

      .tv-md-setting-row {
        margin: 0 0 8px;
      }

      .tv-md-setting-label {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 5px;
        font-size: 12px;
        color: #ddd;
      }

      #${CONFIG.opacityRangeId} {
        width: 100%;
      }

      .tv-md-setting-section-label {
        margin: 8px 0 5px;
        font-size: 11px;
        color: #aaa;
      }

      .tv-md-settings-action {
        width: 100%;
        height: 28px;
        border: 1px solid #666;
        border-radius: 4px;
        background: #2b2b31;
        color: #ddd;
        cursor: pointer;
        font-size: 12px;
        margin: 0 0 6px;
      }

      .tv-md-settings-action:hover {
        background: #3a3a42;
      }

      .tv-md-settings-action.is-active {
        background: #4a5568;
        border-color: #8aa4d6;
        color: #fff;
      }

      .tv-md-settings-action.is-active:hover {
        background: #536179;
      }

      #${CONFIG.renderModeButtonId}.is-active {
        background: #2563eb !important;
        border-color: #93c5fd !important;
        color: #ffffff !important;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
      }

      #${CONFIG.renderModeButtonId}.is-active:hover {
        background: #1d4ed8 !important;
      }

      #${CONFIG.resetLayoutButtonId} {
        width: 100%;
        height: 28px;
        border: 1px solid #666;
        border-radius: 4px;
        background: #2b2b31;
        color: #ddd;
        cursor: pointer;
        font-size: 12px;
      }

      #${CONFIG.resetLayoutButtonId}:hover {
        background: #3a3a42;
      }

      .tv-md-toc-title {
        font-size: 12px;
        font-weight: 700;
        color: #eee;
        margin: 0 0 6px;
      }

      .tv-md-toc-empty {
        font-size: 12px;
        color: #bbb;
        line-height: 1.5;
        padding: 4px 0;
      }

      .tv-md-toc-item {
        display: block;
        width: 100%;
        text-align: left;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: #ddd;
        cursor: pointer;
        font-size: 12px;
        line-height: 1.35;
        padding: 5px 6px;
        box-sizing: border-box;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tv-md-toc-item:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      .tv-md-toc-item.level-3 {
        padding-left: 18px;
        opacity: 0.9;
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
    refreshButton.className = "tv-md-settings-action";
    refreshButton.title = "Reload current ticker markdown or company summary";
    refreshButton.textContent = "Reload";
    refreshButton.addEventListener("click", function () {
      setUserHidden(false);
      clearCompanySummaryCache();
      loadCurrentTickerMarkdown({
        forceReload: true,
        showErrorPanel: true,
      });
    });

    const settingsButton = document.createElement("button");
    settingsButton.id = CONFIG.settingsButtonId;
    settingsButton.type = "button";
    settingsButton.title = "Panel settings";
    settingsButton.textContent = "⚙";
    settingsButton.addEventListener("click", function (event) {
      closeTocMenu();
      toggleSettingsMenu();
      event.stopPropagation();
    });

    const renderModeButton = document.createElement("button");
    renderModeButton.id = CONFIG.renderModeButtonId;
    renderModeButton.type = "button";
    renderModeButton.className = "tv-md-settings-action";
    renderModeButton.title = "Toggle markdown/raw view";
    renderModeButton.addEventListener("click", function () {
      toggleRenderMode();
    });

    const tocButton = document.createElement("button");
    tocButton.id = CONFIG.tocButtonId;
    tocButton.type = "button";
    tocButton.title = "Show heading navigation";
    tocButton.textContent = "TOC";
    tocButton.addEventListener("click", function (event) {
      closeSettingsMenu();
      toggleTocMenu();
      event.stopPropagation();
    });

    const analyzeButton = document.createElement("button");
    analyzeButton.id = CONFIG.analyzeButtonId;
    analyzeButton.type = "button";
    analyzeButton.title = "Copy earnings analysis prompt for current ticker";
    analyzeButton.textContent = "Analyze";
    analyzeButton.addEventListener("click", function () {
      copyEarningsAnalysisPrompt(analyzeButton);
    });

    const title = document.createElement("span");
    title.id = CONFIG.titleId;
    title.textContent = CONFIG.panelTitle;
    title.title = "Drag here to move panel";

    const closeButton = document.createElement("button");
    closeButton.id = CONFIG.closeButtonId;
    closeButton.type = "button";
    closeButton.title = "Toggle panel";
    closeButton.textContent = "Panel";
    closeButton.addEventListener("click", function () {
      setUserHidden(true);
      hidePanel();
    });

    const body = document.createElement("div");
    body.id = CONFIG.bodyId;
    body.addEventListener("click", function (event) {
      handleBodyClickForToc(event);
    });

    const leftResizer = document.createElement("div");
    leftResizer.id = CONFIG.leftResizerId;

    const topResizer = document.createElement("div");
    topResizer.id = CONFIG.topResizerId;

    const topLeftResizer = document.createElement("div");
    topLeftResizer.id = CONFIG.topLeftResizerId;

    const rightResizer = document.createElement("div");
    rightResizer.id = CONFIG.rightResizerId;

    const bottomResizer = document.createElement("div");
    bottomResizer.id = CONFIG.bottomResizerId;

    const cornerResizer = document.createElement("div");
    cornerResizer.id = CONFIG.cornerResizerId;

    const settingsMenu = document.createElement("div");
    settingsMenu.id = CONFIG.settingsMenuId;

    const opacityRow = document.createElement("div");
    opacityRow.className = "tv-md-setting-row";

    const opacityLabel = document.createElement("div");
    opacityLabel.className = "tv-md-setting-label";

    const opacityLabelText = document.createElement("span");
    opacityLabelText.textContent = "透明度";

    const opacityValue = document.createElement("span");
    opacityValue.id = CONFIG.opacityValueId;

    opacityLabel.appendChild(opacityLabelText);
    opacityLabel.appendChild(opacityValue);

    const opacityRange = document.createElement("input");
    opacityRange.id = CONFIG.opacityRangeId;
    opacityRange.type = "range";
    opacityRange.min = String(Math.round(CONFIG.minPanelOpacity * 100));
    opacityRange.max = String(Math.round(CONFIG.maxPanelOpacity * 100));
    opacityRange.step = "1";
    opacityRange.value = String(Math.round(currentPanelOpacity * 100));
    opacityRange.addEventListener("input", function () {
      const opacity = normalizePanelOpacity(Number(opacityRange.value) / 100);
      currentPanelOpacity = opacity;
      applyPanelOpacity(opacity);
      savePanelOpacity(opacity);
    });

    opacityRow.appendChild(opacityLabel);
    opacityRow.appendChild(opacityRange);

    const resetButton = document.createElement("button");
    resetButton.id = CONFIG.resetLayoutButtonId;
    resetButton.type = "button";
    resetButton.className = "tv-md-settings-action";
    resetButton.textContent = "位置とサイズをリセット";
    resetButton.addEventListener("click", function () {
      const rect = getDefaultPanelRect();
      applyPanelRect(rect);
      savePanelRect(rect);
      closeSettingsMenu();
    });

    const viewLabel = document.createElement("div");
    viewLabel.className = "tv-md-setting-section-label";
    viewLabel.textContent = "表示";

    const layoutLabel = document.createElement("div");
    layoutLabel.className = "tv-md-setting-section-label";
    layoutLabel.textContent = "レイアウト";

    settingsMenu.appendChild(refreshButton);
    settingsMenu.appendChild(viewLabel);
    settingsMenu.appendChild(renderModeButton);
    settingsMenu.appendChild(opacityRow);
    settingsMenu.appendChild(layoutLabel);
    settingsMenu.appendChild(resetButton);
    updateOpacityControl();

    const tocMenu = document.createElement("div");
    tocMenu.id = CONFIG.tocMenuId;

    header.appendChild(title);
    header.appendChild(closeButton);
    header.appendChild(analyzeButton);
    header.appendChild(settingsButton);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(leftResizer);
    panel.appendChild(topResizer);
    panel.appendChild(topLeftResizer);
    panel.appendChild(rightResizer);
    panel.appendChild(bottomResizer);
    panel.appendChild(cornerResizer);
    panel.appendChild(settingsMenu);
    panel.appendChild(tocMenu);

    document.body.appendChild(panel);

    syncRenderModeButton();

    window.addEventListener("click", function (event) {
      const settingsMenuElement = document.getElementById(CONFIG.settingsMenuId);
      const settingsButtonElement = document.getElementById(CONFIG.settingsButtonId);
      const tocMenuElement = document.getElementById(CONFIG.tocMenuId);

      if (
        settingsMenuElement &&
        settingsButtonElement &&
        !settingsMenuElement.contains(event.target) &&
        !settingsButtonElement.contains(event.target)
      ) {
        closeSettingsMenu();
      }

      if (tocMenuElement && !tocMenuElement.contains(event.target)) {
        closeTocMenu();
      }
    });
  }

  function createFloatingButton() {
    if (document.getElementById(CONFIG.floatingButtonId)) return;

    const button = document.createElement("button");
    button.id = CONFIG.floatingButtonId;
    button.type = "button";
    button.title = "Show markdown panel";
    button.textContent = "Panel";

    button.addEventListener("click", function () {
      setUserHidden(false);
      loadCurrentTickerMarkdown({
        forceReload: true,
        showErrorPanel: true,
      });
    });

    document.body.appendChild(button);
  }

  function createFloatingAnalyzeButton() {
    if (document.getElementById(CONFIG.floatingAnalyzeButtonId)) return;

    const button = document.createElement("button");
    button.id = CONFIG.floatingAnalyzeButtonId;
    button.type = "button";
    button.title = "Copy earnings analysis prompt for current ticker";
    button.textContent = "Analyze";

    button.addEventListener("click", function () {
      copyEarningsAnalysisPrompt(button);
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
      title.textContent = `${CONFIG.panelTitle} / ${target.ticker} / loading`;
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
      showMarkdown(response.responseText || "", target);
      return;
    }

    if (status === 404) {
      showCompanySummaryFallback(target, {
        showErrorPanel: showErrorPanel,
      });
      return;
    }

    if (!showErrorPanel) {
      hidePanel();
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

  function clearCompanySummaryCache() {
    companySummaryCache = null;
    companySummaryLoadPromise = null;
  }

  function loadCompanySummaryJson() {
    if (companySummaryCache) {
      return Promise.resolve(companySummaryCache);
    }

    if (companySummaryLoadPromise) {
      return companySummaryLoadPromise;
    }

    if (typeof GM_xmlhttpRequest !== "function") {
      return Promise.reject(new Error("GM_xmlhttpRequest is not available"));
    }

    const requestUrl = withCacheBuster(CONFIG.companySummaryUrl);

    companySummaryLoadPromise = new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: "GET",
        url: requestUrl,
        timeout: 20000,

        onload: function (response) {
          try {
            if (response.status < 200 || response.status >= 300) {
              reject(
                new Error(
                  `company_summary.json HTTP ${response.status}: ${String(response.responseText || "").slice(0, 200)}`
                )
              );
              return;
            }

            const parsed = JSON.parse(response.responseText || "{}");
            companySummaryCache = parsed;
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        },

        onerror: function (error) {
          reject(error);
        },

        ontimeout: function () {
          reject(new Error("company_summary.json request timed out"));
        },
      });
    }).catch(function (error) {
      companySummaryLoadPromise = null;
      throw error;
    });

    return companySummaryLoadPromise;
  }

  function showCompanySummaryFallback(target, options) {
    const showErrorPanel = Boolean(options && options.showErrorPanel);
    const title = document.getElementById(CONFIG.titleId);

    showPanel();

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / ${target.ticker} / company summary loading`;
    }

    if (showErrorPanel) {
      setBodyText(
        [
          "mdファイルが見つからないため、簡易会社概要を取得しています。",
          "",
          "Ticker:",
          target.ticker,
          "",
          "Company summary URL:",
          CONFIG.companySummaryUrl,
        ].join("\n"),
        "tv-md-loading"
      );
    }

    loadCompanySummaryJson()
      .then(function (data) {
        if (isStaleTarget(target)) return;
        if (userHidden) return;

        const profile = findCompanyProfile(data, target.ticker);
        if (profile) {
          showCompanySummary(profile, target);
        } else {
          showNoCompanySummary(target);
        }
      })
      .catch(function (error) {
        if (isStaleTarget(target)) return;
        if (userHidden) return;

        showError(
          [
            "mdファイルが見つからず、company_summary.json の取得にも失敗しました。",
            "",
            "Ticker:",
            target.ticker,
            "",
            "Expected md:",
            target.filename,
            "",
            "Company summary URL:",
            CONFIG.companySummaryUrl,
            "",
            "確認点:",
            "- company_summary.json を生成したか",
            "- ローカルサーバーのルートが public_repo になっているか",
            "- http://127.0.0.1:8765/company-summary/company_summary.json をブラウザで開けるか",
            "",
            "Error:",
            String(error && error.message ? error.message : error),
          ].join("\n"),
          target
        );
      });
  }

  function findCompanyProfile(data, ticker) {
    const symbols = data && data.symbols ? data.symbols : null;
    if (!symbols) return null;

    const key = String(ticker || "").trim().toUpperCase();
    if (!key) return null;

    return symbols[key] || symbols[key.replace(/\./g, "-")] || null;
  }

  function showCompanySummary(profile, target) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / ${target.ticker} / company summary`;
    }

    const markdown = buildCompanySummaryMarkdown(profile, target);
    currentMarkdownText = markdown;
    renderMarkdownContent(markdown);
  }

  function showNoCompanySummary(target) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / ${target.ticker} / no data`;
    }

    currentMarkdownText = "";
    currentHeadings = [];
    updateTocMenu();

    setBodyText(
      [
        "mdファイルが見つからず、会社概要データにも該当tickerがありません。",
        "",
        "Ticker:",
        target.ticker,
        "",
        "Expected md:",
        target.filename,
        "",
        "Company summary URL:",
        CONFIG.companySummaryUrl,
      ].join("\n"),
      "tv-md-error"
    );
  }

  function buildCompanySummaryMarkdown(profile, target) {
    const ticker = String(profile.ticker || target.ticker || "").trim().toUpperCase();
    const country = String(profile.country || "").trim();
    const displayName = buildCompanyDisplayName(profile);
    const rows = [];

    addSummaryRow(rows, "会社名", displayName);
    addSummaryRow(rows, "Exchange", profile.exchange);
    addSummaryRow(rows, "市場", profile.market);
    addSummaryRow(rows, "国", profile.country);
    addSummaryRow(rows, "Industry", profile.industry);
    addSummaryRow(rows, "Sector", profile.sector);

    if (country === "Japan") {
      addSummaryRow(rows, "JPX 33業種", profile.sector33);
    }

    if (profile.website) {
      addSummaryRow(rows, "Website", `[${profile.website}](${profile.website})`);
    }

    addSummaryRow(rows, "Source", profile.source);
    addSummaryRow(rows, "Updated", profile.updated_at);
    addSummaryRow(rows, "Status", profile.status);

    const lines = [];
    lines.push(`# ${ticker}${displayName ? " " + displayName : ""}`);
    lines.push("");
    lines.push("簡易会社概要");
    lines.push("");

    if (rows.length > 0) {
      lines.push("| 項目 | 内容 |");
      lines.push("|---|---|");
      rows.forEach(function (row) {
        lines.push(`| ${escapeMarkdownTableCell(row.label)} | ${escapeMarkdownTableCell(row.value)} |`);
      });
      lines.push("");
    }

    const summary = String(profile.business_summary || "").trim();
    if (summary) {
      lines.push(summary);
    } else {
      lines.push("**会社概要データ未取得：business_summary が空です。**");
      if (profile.status) {
        lines.push("");
        lines.push(`status: ${profile.status}`);
      }
      if (profile.error) {
        lines.push("");
        lines.push(`error: ${profile.error}`);
      }
    }

    return lines.join("\n");
  }

  function buildCompanyDisplayName(profile) {
    const country = String(profile && profile.country ? profile.country : "").trim();
    const name = String(profile && profile.name ? profile.name : "").trim();
    const universeName = String(profile && profile.name_from_universe ? profile.name_from_universe : "").trim();

    if (country === "Japan") {
      if (universeName && name && universeName !== name) {
        return `${universeName} / ${name}`;
      }
      return universeName || name;
    }

    return name || universeName;
  }

  function addSummaryRow(rows, label, value) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    if (!text) return;

    rows.push({
      label: label,
      value: text,
    });
  }

  function escapeMarkdownTableCell(value) {
    return String(value || "")
      .replace(/\r?\n/g, " ")
      .replace(/\|/g, "&#124;");
  }

  function showMarkdown(markdown, target) {
    const title = document.getElementById(CONFIG.titleId);

    if (title) {
      title.textContent = `${CONFIG.panelTitle} / ${target.ticker} / earnings signal`;
    }

    currentMarkdownText = String(markdown || "");

    if (!currentMarkdownText.trim()) {
      currentHeadings = [];
      updateTocMenu();
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

    renderMarkdownContent(currentMarkdownText);
  }

  function renderMarkdownContent(markdown) {
    currentMarkdownText = String(markdown || "");

    if (currentRenderMode === "raw") {
      setBodyText(currentMarkdownText, "tv-md-success tv-md-raw");
      updateTocMenu();
      return;
    }

    setBodyHtml(simpleMarkdownToHtml(currentMarkdownText), "tv-md-success tv-md-rendered");
    updateTocMenu();
  }

  function toggleRenderMode() {
    currentRenderMode = currentRenderMode === "markdown" ? "raw" : "markdown";
    saveRenderMode(currentRenderMode);
    syncRenderModeButton();
    closeTocMenu();

    if (currentMarkdownText) {
      renderMarkdownContent(currentMarkdownText);
    }
  }

  function syncRenderModeButton() {
    const button = document.getElementById(CONFIG.renderModeButtonId);
    if (!button) return;

    const isRaw = currentRenderMode === "raw";
    button.textContent = "Raw";
    button.title = isRaw ? "Raw view is on. Click to switch to rendered markdown view." : "Raw view is off. Click to switch to raw markdown view.";
    button.classList.toggle("is-active", isRaw);
  }

  function loadRenderMode() {
    try {
      const value = localStorage.getItem(CONFIG.renderModeStorageKey);
      if (value === "raw" || value === "markdown") {
        return value;
      }
      return CONFIG.defaultRenderMode;
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to load render mode:", error);
      return CONFIG.defaultRenderMode;
    }
  }

  function saveRenderMode(mode) {
    try {
      const normalized = mode === "raw" ? "raw" : "markdown";
      localStorage.setItem(CONFIG.renderModeStorageKey, normalized);
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to save render mode:", error);
    }
  }

  function simpleMarkdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const html = [];

    currentHeadings = [];

    let headingIdCounter = 0;
    let i = 0;
    let inCodeBlock = false;
    let codeLines = [];
    let paragraphLines = [];
    let listType = null;
    let listItems = [];

    function flushParagraph() {
      if (!paragraphLines.length) return;
      html.push(`<p>${paragraphLines.map(formatInline).join("<br>")}</p>`);
      paragraphLines = [];
    }

    function flushList() {
      if (!listType || !listItems.length) return;
      const tag = listType;
      html.push(`<${tag}>${listItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</${tag}>`);
      listType = null;
      listItems = [];
    }

    function flushCodeBlock() {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
    }

    function createHeading(level, text, addToToc) {
      const headingText = String(text || "").trim();
      const headingId = `tv-md-heading-${headingIdCounter}`;
      headingIdCounter += 1;

      if (addToToc) {
        currentHeadings.push({
          id: headingId,
          level: level,
          text: headingText,
        });
      }

      html.push(`<h${level} id="${headingId}">${formatInline(headingText)}</h${level}>`);
    }

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (inCodeBlock) {
        if (/^```/.test(trimmed)) {
          inCodeBlock = false;
          flushCodeBlock();
        } else {
          codeLines.push(line);
        }
        i += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeLines = [];
        i += 1;
        continue;
      }

      if (trimmed === "") {
        flushParagraph();
        flushList();
        i += 1;
        continue;
      }

      if (isMarkdownTableStart(lines, i)) {
        flushParagraph();
        flushList();

        const tableResult = parseMarkdownTable(lines, i);
        html.push(tableResult.html);
        i = tableResult.nextIndex;
        continue;
      }

      if (/^-{3,}$/.test(trimmed)) {
        flushParagraph();
        flushList();
        html.push("<hr>");
        i += 1;
        continue;
      }

      const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
      if (headingMatch) {
        flushParagraph();
        flushList();

        const level = headingMatch[1].length;
        createHeading(level, headingMatch[2], level === 2);
        i += 1;
        continue;
      }

      const blockHeadingMatch = /^■\s*(.+)$/.exec(line);
      if (blockHeadingMatch) {
        flushParagraph();
        flushList();

        createHeading(2, blockHeadingMatch[1], true);
        i += 1;
        continue;
      }

      const subBlockHeadingMatch = /^□\s*(.+)$/.exec(line);
      if (subBlockHeadingMatch) {
        flushParagraph();
        flushList();

        createHeading(3, subBlockHeadingMatch[1], false);
        i += 1;
        continue;
      }

      const unorderedMatch = /^[-*]\s+(.+)$/.exec(line);
      if (unorderedMatch) {
        flushParagraph();

        if (listType && listType !== "ul") {
          flushList();
        }

        listType = "ul";
        listItems.push(unorderedMatch[1].trim());
        i += 1;
        continue;
      }

      const orderedMatch = /^\d+\.\s+(.+)$/.exec(line);
      if (orderedMatch) {
        flushParagraph();

        if (listType && listType !== "ol") {
          flushList();
        }

        listType = "ol";
        listItems.push(orderedMatch[1].trim());
        i += 1;
        continue;
      }

      flushList();
      paragraphLines.push(line.trim());
      i += 1;
    }

    if (inCodeBlock) {
      flushCodeBlock();
    }

    flushParagraph();
    flushList();

    return html.join("\n");
  }

  function isMarkdownTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;

    const header = lines[index].trim();
    const separator = lines[index + 1].trim();

    if (!isMarkdownTableRow(header)) return false;
    if (!isMarkdownTableRow(separator)) return false;

    const separatorCells = parseMarkdownTableRow(separator);

    if (!separatorCells.length) return false;

    return separatorCells.every(function (cell) {
      return /^:?-{3,}:?$/.test(cell.trim());
    });
  }

  function parseMarkdownTable(lines, startIndex) {
    const headerCells = parseMarkdownTableRow(lines[startIndex]);
    const bodyRows = [];
    let index = startIndex + 2;

    while (index < lines.length && isMarkdownTableRow(lines[index].trim())) {
      bodyRows.push(parseMarkdownTableRow(lines[index]));
      index += 1;
    }

    const thead = `<thead><tr>${headerCells
      .map((cell) => `<th>${formatInline(cell.trim())}</th>`)
      .join("")}</tr></thead>`;

    const tbody = `<tbody>${bodyRows
      .map(function (row) {
        return `<tr>${row.map((cell) => `<td>${formatInline(cell.trim())}</td>`).join("")}</tr>`;
      })
      .join("")}</tbody>`;

    return {
      html: `<table>${thead}${tbody}</table>`,
      nextIndex: index,
    };
  }

  function isMarkdownTableRow(line) {
    const text = String(line || "").trim();
    return text.startsWith("|") && text.endsWith("|") && text.includes("|");
  }

  function parseMarkdownTableRow(line) {
    const text = String(line || "").trim();
    const withoutOuterPipes = text.replace(/^\|/, "").replace(/\|$/, "");
    return withoutOuterPipes.split("|").map((cell) => cell.trim());
  }

  function formatInline(text) {
    let raw = String(text || "");
    const placeholders = [];

    function stashHtml(html) {
      const index = placeholders.length;
      placeholders.push(html);
      return `\uE000${index}\uE001`;
    }

    raw = raw.replace(/`([^`]+)`/g, function (_match, codeText) {
      return stashHtml(`<code>${escapeHtml(codeText)}</code>`);
    });

    raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_match, label, url) {
      return stashHtml(buildAnchorHtml(url, escapeHtml(label)));
    });

    let escaped = escapeHtml(raw);

    escaped = escaped.replace(/\bhttps?:\/\/[^\s<>()"']+/g, function (url) {
      let trailing = "";
      while (/[.,;:!?]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      return buildAnchorHtml(url, url) + trailing;
    });

    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    return escaped.replace(/\uE000(\d+)\uE001/g, function (_match, index) {
      return placeholders[Number(index)] || "";
    });
  }

  function buildAnchorHtml(url, labelHtml) {
    const href = escapeHtml(url);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function handleBodyClickForToc(event) {
    if (currentRenderMode !== "markdown") return;
    if (!currentHeadings.length) return;

    if (event.target && event.target.closest && event.target.closest("a")) {
      return;
    }

    const menu = document.getElementById(CONFIG.tocMenuId);
    if (menu && menu.contains(event.target)) return;

    if (isTocMenuOpen()) {
      closeTocMenu();
      event.stopPropagation();
      return;
    }

    const selection = window.getSelection && window.getSelection();
    if (selection && String(selection.toString() || "").trim()) return;

    openTocMenuAt(event.clientX, event.clientY);
    event.stopPropagation();
  }

  function openTocMenuAt(clientX, clientY) {
    const panel = document.getElementById(CONFIG.panelId);
    const menu = document.getElementById(CONFIG.tocMenuId);
    if (!panel || !menu) return;

    renderTocMenu();
    menu.classList.add("is-open");

    const panelRect = panel.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 260;
    const menuHeight = menu.offsetHeight || 260;

    let left = clientX - panelRect.left;
    let top = clientY - panelRect.top + 8;

    if (left + menuWidth > panelRect.width - 8) {
      left = panelRect.width - menuWidth - 8;
    }

    if (top + menuHeight > panelRect.height - 8) {
      top = clientY - panelRect.top - menuHeight - 8;
    }

    left = clamp(left, 8, Math.max(8, panelRect.width - menuWidth - 8));
    top = clamp(top, 46, Math.max(46, panelRect.height - menuHeight - 8));

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function toggleTocMenu() {
    const menu = document.getElementById(CONFIG.tocMenuId);
    if (!menu) return;

    renderTocMenu();
    menu.classList.toggle("is-open");
  }

  function isTocMenuOpen() {
    const menu = document.getElementById(CONFIG.tocMenuId);
    return Boolean(menu && menu.classList.contains("is-open"));
  }

  function closeTocMenu() {
    const menu = document.getElementById(CONFIG.tocMenuId);
    if (!menu) return;

    menu.classList.remove("is-open");
  }

  function updateTocMenu() {
    const menu = document.getElementById(CONFIG.tocMenuId);
    if (!menu) return;

    renderTocMenu();
  }

  function renderTocMenu() {
    const menu = document.getElementById(CONFIG.tocMenuId);
    if (!menu) return;

    if (currentRenderMode !== "markdown") {
      menu.innerHTML = [
        '<div class="tv-md-toc-title">目次</div>',
        '<div class="tv-md-toc-empty">Markdown表示で利用できます。</div>',
      ].join("");
      return;
    }

    if (!currentHeadings.length) {
      menu.innerHTML = [
        '<div class="tv-md-toc-title">目次</div>',
        '<div class="tv-md-toc-empty">見出しがありません。</div>',
      ].join("");
      return;
    }

    const items = currentHeadings
      .map(function (heading) {
        return [
          `<button type="button" class="tv-md-toc-item level-${heading.level}" data-heading-id="${escapeHtml(heading.id)}" title="${escapeHtml(heading.text)}">`,
          escapeHtml(heading.text),
          "</button>",
        ].join("");
      })
      .join("");

    menu.innerHTML = `<div class="tv-md-toc-title">目次</div>${items}`;

    Array.from(menu.querySelectorAll(".tv-md-toc-item")).forEach(function (button) {
      button.addEventListener("click", function () {
        const headingId = button.getAttribute("data-heading-id");
        scrollToHeading(headingId);
        closeTocMenu();
      });
    });
  }

  function scrollToHeading(headingId) {
    const body = document.getElementById(CONFIG.bodyId);
    const heading = document.getElementById(headingId);

    if (!body || !heading) return;

    const bodyRect = body.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const offset = headingRect.top - bodyRect.top;

    body.scrollTop = body.scrollTop + offset - 4;
  }

  function resetBodyScrollSoon() {
    window.requestAnimationFrame(function () {
      const body = document.getElementById(CONFIG.bodyId);
      if (!body) return;
      body.scrollTop = 0;
    });
  }

  function showTickerExtractionError(titleText) {
    currentMarkdownText = "";
    currentHeadings = [];
    updateTocMenu();

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
    currentMarkdownText = "";
    currentHeadings = [];
    updateTocMenu();

    const title = document.getElementById(CONFIG.titleId);

    showPanel();

    if (title) {
      if (target && target.ticker) {
        title.textContent = `${CONFIG.panelTitle} / ${target.ticker} / error`;
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
    closeSettingsMenu();
    closeTocMenu();
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
    const analyzeButton = document.getElementById(CONFIG.floatingAnalyzeButtonId);
    const panelVisible = panel && panel.style.display !== "none";

    if (button) {
      button.style.display = panelVisible ? "none" : "block";
    }

    if (analyzeButton) {
      analyzeButton.style.display = panelVisible ? "none" : "block";
    }
  }

  function copyEarningsAnalysisPrompt(button) {
    const target = buildTargetFromCurrentTitle();

    if (!target || !target.ticker || !target.filename) {
      showAnalyzeButtonFeedback(button, "No ticker");
      return;
    }

    const prompt = buildEarningsAnalysisPrompt(target);

    copyTextToClipboard(prompt)
      .then(function () {
        showAnalyzeButtonFeedback(button, "Copied");
      })
      .catch(function (error) {
        console.warn("[TV Custom Panel] Failed to copy earnings prompt:", error);
        showAnalyzeButtonFeedback(button, "Copy NG");
      });
  }

  function buildEarningsAnalysisPrompt(target) {
    const ticker = String(target && target.ticker ? target.ticker : "").trim().toUpperCase();
    const filename = String(target && target.filename ? target.filename : `${ticker}.md`).trim();

    return [
      `# 決算分析　対象：${ticker}`,
      "",
      "Codex Skill「earnings-signal-analysis」を使用してください。",
      "SKILL.md本文を直接読んで実行してください。",
      "frontmatter、summary、generated yaml、default_prompt、過去の記憶だけで実行しないでください。",
      "",
      "出力は、このCodex workspace内の以下の相対パスに保存してください。",
      `earnings-signal-analysis/md/${filename}`,
      "",
      "SKILL.md本文はUTF-8として扱ってください。",
      "もしmdファイルの日本語が文字化けしているように見える場合は、分析を続行せず、どのファイル・どの読み取りコマンドで文字化けしたかだけ報告してください。",
      "",
      "文字化け対策やEncoding Guardをskill本文に追加しないでください。",
      "今回は分析結果mdの作成のみを行い、skillファイルや設定ファイルは編集しないでください。",
    ].join("\n");
  }

  function copyTextToClipboard(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return Promise.resolve();
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();

        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);

        if (copied) {
          resolve();
        } else {
          reject(new Error("document.execCommand('copy') returned false"));
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function showAnalyzeButtonFeedback(button, text) {
    if (!button) return;

    const originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;

    window.setTimeout(function () {
      button.textContent = originalText || "Analyze";
      button.disabled = false;
    }, 1500);
  }

  function setupPanelMove() {
    if (moveInitialized) return;

    const panel = document.getElementById(CONFIG.panelId);
    const handle = document.getElementById(CONFIG.titleId);
    if (!panel || !handle) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startRect = null;

    handle.addEventListener("mousedown", function (event) {
      const rect = getPanelRect();
      isDragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startRect = rect;

      document.body.style.cursor = "move";
      document.body.style.userSelect = "none";

      event.preventDefault();
      event.stopPropagation();
    });

    window.addEventListener("mousemove", function (event) {
      if (!isDragging || !startRect) return;

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      const nextRect = normalizePanelRect({
        left: startRect.left + deltaX,
        top: startRect.top + deltaY,
        width: startRect.width,
        height: startRect.height,
      });

      applyPanelRect(nextRect);
    });

    window.addEventListener("mouseup", function () {
      if (!isDragging) return;

      isDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      savePanelRect(getPanelRect());
    });

    moveInitialized = true;
  }

  function setupPanelResize() {
    if (resizeInitialized) return;

    const panel = document.getElementById(CONFIG.panelId);
    const leftResizer = document.getElementById(CONFIG.leftResizerId);
    const topResizer = document.getElementById(CONFIG.topResizerId);
    const topLeftResizer = document.getElementById(CONFIG.topLeftResizerId);
    const rightResizer = document.getElementById(CONFIG.rightResizerId);
    const bottomResizer = document.getElementById(CONFIG.bottomResizerId);
    const cornerResizer = document.getElementById(CONFIG.cornerResizerId);

    if (!panel || !leftResizer || !topResizer || !topLeftResizer || !rightResizer || !bottomResizer || !cornerResizer) return;

    let resizeMode = null;
    let startX = 0;
    let startY = 0;
    let startRect = null;

    function startResize(mode, event) {
      resizeMode = mode;
      startX = event.clientX;
      startY = event.clientY;
      startRect = getPanelRect();

      if (mode === "left" || mode === "right") {
        document.body.style.cursor = "ew-resize";
      } else if (mode === "top" || mode === "bottom") {
        document.body.style.cursor = "ns-resize";
      } else {
        document.body.style.cursor = "nwse-resize";
      }

      document.body.style.userSelect = "none";

      event.preventDefault();
      event.stopPropagation();
    }

    leftResizer.addEventListener("mousedown", function (event) {
      startResize("left", event);
    });

    topResizer.addEventListener("mousedown", function (event) {
      startResize("top", event);
    });

    topLeftResizer.addEventListener("mousedown", function (event) {
      startResize("top-left", event);
    });

    rightResizer.addEventListener("mousedown", function (event) {
      startResize("right", event);
    });

    bottomResizer.addEventListener("mousedown", function (event) {
      startResize("bottom", event);
    });

    cornerResizer.addEventListener("mousedown", function (event) {
      startResize("corner", event);
    });

    window.addEventListener("mousemove", function (event) {
      if (!resizeMode || !startRect) return;

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      const nextRect = {
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
      };

      if (resizeMode === "left" || resizeMode === "top-left") {
        const viewportWidth = Math.max(window.innerWidth || 0, CONFIG.minPanelWidth);
        const maxWidth = Math.max(
          CONFIG.minPanelWidth,
          Math.min(CONFIG.maxPanelWidth, viewportWidth)
        );
        const fixedRight = startRect.left + startRect.width;
        const minLeft = Math.max(0, fixedRight - maxWidth);
        const maxLeft = Math.max(minLeft, fixedRight - CONFIG.minPanelWidth);

        nextRect.left = clamp(startRect.left + deltaX, minLeft, maxLeft);
        nextRect.width = fixedRight - nextRect.left;
      }

      if (resizeMode === "top" || resizeMode === "top-left") {
        const viewportHeight = Math.max(window.innerHeight || 0, CONFIG.minPanelHeight);
        const fixedBottom = startRect.top + startRect.height;
        const minTop = Math.max(0, fixedBottom - viewportHeight);
        const maxTop = Math.max(minTop, fixedBottom - CONFIG.minPanelHeight);

        nextRect.top = clamp(startRect.top + deltaY, minTop, maxTop);
        nextRect.height = fixedBottom - nextRect.top;
      }

      if (resizeMode === "right" || resizeMode === "corner") {
        nextRect.width = startRect.width + deltaX;
      }

      if (resizeMode === "bottom" || resizeMode === "corner") {
        nextRect.height = startRect.height + deltaY;
      }

      applyPanelRect(normalizePanelRect(nextRect));
    });

    window.addEventListener("mouseup", function () {
      if (!resizeMode) return;

      resizeMode = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      savePanelRect(getPanelRect());
    });

    resizeInitialized = true;
  }

  function getPanelRect() {
    const panel = document.getElementById(CONFIG.panelId);

    if (!panel) {
      return getDefaultPanelRect();
    }

    const rect = panel.getBoundingClientRect();

    return normalizePanelRect({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  function getDefaultPanelRect() {
    const availableHeight = Math.max(
      CONFIG.minPanelHeight,
      window.innerHeight - CONFIG.defaultPanelTop - 24
    );

    return normalizePanelRect({
      left: CONFIG.defaultPanelLeft,
      top: CONFIG.defaultPanelTop,
      width: CONFIG.defaultPanelWidth,
      height: availableHeight,
    });
  }

  function applyPanelRect(rect) {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;

    const normalized = normalizePanelRect(rect);

    panel.style.left = `${normalized.left}px`;
    panel.style.top = `${normalized.top}px`;
    panel.style.width = `${normalized.width}px`;
    panel.style.height = `${normalized.height}px`;
  }

  function loadPanelRect() {
    try {
      const raw = localStorage.getItem(CONFIG.panelRectStorageKey);
      if (!raw) return getDefaultPanelRect();

      const parsed = JSON.parse(raw);
      return normalizePanelRect({
        left: Number(parsed.left),
        top: Number(parsed.top),
        width: Number(parsed.width),
        height: Number(parsed.height),
      });
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to load panel rect:", error);
      return getDefaultPanelRect();
    }
  }

  function savePanelRect(rect) {
    try {
      const normalized = normalizePanelRect(rect);
      localStorage.setItem(
        CONFIG.panelRectStorageKey,
        JSON.stringify(normalized)
      );
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to save panel rect:", error);
    }
  }

  function normalizePanelRect(rect) {
    const viewportWidth = Math.max(window.innerWidth || 0, CONFIG.minPanelWidth);
    const viewportHeight = Math.max(window.innerHeight || 0, CONFIG.minPanelHeight);

    let width = Number(rect && rect.width);
    let height = Number(rect && rect.height);
    let left = Number(rect && rect.left);
    let top = Number(rect && rect.top);

    if (!Number.isFinite(width)) width = CONFIG.defaultPanelWidth;
    if (!Number.isFinite(height)) height = window.innerHeight - CONFIG.defaultPanelTop - 24;
    if (!Number.isFinite(left)) left = CONFIG.defaultPanelLeft;
    if (!Number.isFinite(top)) top = CONFIG.defaultPanelTop;

    const maxWidth = Math.max(CONFIG.minPanelWidth, Math.min(CONFIG.maxPanelWidth, viewportWidth));
    const maxHeight = Math.max(CONFIG.minPanelHeight, viewportHeight);

    width = clamp(width, CONFIG.minPanelWidth, maxWidth);
    height = clamp(height, CONFIG.minPanelHeight, maxHeight);

    left = clamp(left, 0, Math.max(0, viewportWidth - width));
    top = clamp(top, 0, Math.max(0, viewportHeight - height));

    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  function loadPanelOpacity() {
    try {
      const raw = localStorage.getItem(CONFIG.panelOpacityStorageKey);
      if (raw === null) return CONFIG.defaultPanelOpacity;
      return normalizePanelOpacity(Number(raw));
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to load panel opacity:", error);
      return CONFIG.defaultPanelOpacity;
    }
  }

  function savePanelOpacity(opacity) {
    try {
      localStorage.setItem(
        CONFIG.panelOpacityStorageKey,
        String(normalizePanelOpacity(opacity))
      );
    } catch (error) {
      console.warn("[TV Custom Panel] Failed to save panel opacity:", error);
    }
  }

  function applyPanelOpacity(opacity) {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;

    const normalized = normalizePanelOpacity(opacity);
    const headerAlpha = normalizePanelOpacity(Math.min(1, normalized + 0.01));

    panel.style.setProperty("--tv-md-panel-alpha", String(normalized));
    panel.style.setProperty("--tv-md-header-alpha", String(headerAlpha));

    updateOpacityControl();
  }

  function updateOpacityControl() {
    const range = document.getElementById(CONFIG.opacityRangeId);
    const value = document.getElementById(CONFIG.opacityValueId);
    const percent = Math.round(normalizePanelOpacity(currentPanelOpacity) * 100);

    if (range) {
      range.value = String(percent);
    }

    if (value) {
      value.textContent = `${percent}%`;
    }
  }

  function normalizePanelOpacity(value) {
    const opacity = Number(value);

    if (!Number.isFinite(opacity)) {
      return CONFIG.defaultPanelOpacity;
    }

    return clamp(opacity, CONFIG.minPanelOpacity, CONFIG.maxPanelOpacity);
  }

  function toggleSettingsMenu() {
    const menu = document.getElementById(CONFIG.settingsMenuId);
    if (!menu) return;

    menu.classList.toggle("is-open");
  }

  function closeSettingsMenu() {
    const menu = document.getElementById(CONFIG.settingsMenuId);
    if (!menu) return;

    menu.classList.remove("is-open");
  }

  function setBodyText(text, className) {
    const body = document.getElementById(CONFIG.bodyId);
    if (!body) return;

    body.className = className || "";
    body.textContent = text;
    resetBodyScrollSoon();
  }

  function setBodyHtml(html, className) {
    const body = document.getElementById(CONFIG.bodyId);
    if (!body) return;

    body.className = className || "";
    body.innerHTML = html;
    resetBodyScrollSoon();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function isStaleTarget(target) {
    return !currentTarget || currentTarget.ticker !== target.ticker;
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