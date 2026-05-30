// ==UserScript==
// @name         TDnet Universe Highlighter
// @namespace    https://github.com/hitoshi-a/public_repo
// @version      0.1.18
// @description  TDnetの適時開示一覧をuniverse_public.jsonに基づいて色分けする
// @match        https://www.release.tdnet.info/inbs/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tdnet/tdnet_highlight.user.js
// @downloadURL  https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tdnet/tdnet_highlight.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // 設定
  // ============================================================

  const SCRIPT_VERSION = "0.1.18";

  const UNIVERSE_URL =
    "https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tdnet/universe_public.json";

  const CONFIG = {
    processedAttr: "data-tdnet-universe-highlighted",
    badgeClass: "tdnet-universe-badge",
    cellClass: "tdnet-universe-cell",
    analyzeButtonClass: "tdnet-analyze-button",
    summaryPanelClass: "tdnet-universe-summary-panel",
    summaryPanelId: "tdnet-universe-summary-panel",

    // GitHub rawのキャッシュが気になる場合は true。
    // 通常は false でよい。
    useCacheBuster: false
  };

  const STATUS_STYLE = {
    ok: {
      rowBackground: "",
      rowOpacity: "",
      badgeBackground: "#f3f4f6",
      badgeColor: "#374151",
      label: "OK"
    },
    caution: {
      rowBackground: "#fde68a",
      rowOpacity: "",
      badgeBackground: "#f59e0b",
      badgeColor: "#111827",
      label: "注意"
    },
    ng: {
      rowBackground: "#d1d5db",
      rowOpacity: "0.15",
      badgeBackground: "#9ca3af",
      badgeColor: "#111827",
      label: "NG"
    },
    unknown: {
      rowBackground: "#fecdd3",
      rowOpacity: "",
      badgeBackground: "#fb7185",
      badgeColor: "#ffffff",
      label: "要確認"
    },
    missing: {
      rowBackground: "#d1d5db",
      rowOpacity: "0.15",
      badgeBackground: "#9ca3af",
      badgeColor: "#111827",
      label: "東証外"
    }
  };

  // v0.1では主判定はuniverse_public.jsonを信じる。
  // 念のため、TDnet行テキストに明らかな対象外語がある場合はtooltipに補足する。
  const TDNET_TEXT_NG_KEYWORDS = [
    "ETF",
    "ETN",
    "REIT",
    "投資法人",
    "インフラファンド",
    "TOKYO PRO"
  ];

  // ============================================================
  // HTTP / JSON
  // ============================================================

  function fetchJson(url) {
    const finalUrl = CONFIG.useCacheBuster
      ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`
      : url;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: finalUrl,
        headers: {
          Accept: "application/json"
        },
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) {
              reject(
                new Error(
                  `HTTP ${res.status}: ${String(res.responseText).slice(0, 200)}`
                )
              );
              return;
            }
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
        ontimeout: reject
      });
    });
  }

  // ============================================================
  // DOM / 表示
  // ============================================================

  function injectStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .${CONFIG.badgeClass} {
        display: inline-block;
        margin-left: 4px;
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
        border: 1px solid rgba(0, 0, 0, 0.08);
        white-space: nowrap;
        vertical-align: middle;
      }

      .${CONFIG.cellClass} {
        white-space: nowrap;
        font-size: 12px;
        padding-left: 6px;
        padding-right: 6px;
      }

      .${CONFIG.analyzeButtonClass} {
        display: inline-block;
        margin-left: 4px;
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.4;
        border: 1px solid rgba(0, 0, 0, 0.15);
        background: #e0f2fe;
        color: #075985;
        cursor: pointer;
        vertical-align: middle;
        white-space: nowrap;
      }

      .${CONFIG.analyzeButtonClass}:hover {
        background: #bae6fd;
      }

      .${CONFIG.summaryPanelClass} {
        position: fixed;
        right: 12px;
        top: 12px;
        z-index: 999999;
        max-width: 460px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        background: rgba(255, 255, 255, 0.94);
        color: #111827;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }

      .${CONFIG.summaryPanelClass} .title {
        font-weight: 700;
        margin-bottom: 2px;
      }

      .${CONFIG.summaryPanelClass} .counts {
        white-space: nowrap;
      }

      .${CONFIG.summaryPanelClass} .meta {
        color: #6b7280;
        font-size: 11px;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function makeBadge(text, backgroundColor, color) {
    const span = document.createElement("span");
    span.className = CONFIG.badgeClass;
    span.textContent = text;
    span.style.backgroundColor = backgroundColor;
    span.style.color = color;
    return span;
  }

  function ensureBadgeContainer(row) {
    const cells = Array.from(row.querySelectorAll("td"));

    // TDnetの通常表: 時刻 / コード / 会社名 / 表題 ...
    const targetCell = cells[2] || cells[3] || null;
    if (!targetCell) return null;

    let container = targetCell.querySelector(`.${CONFIG.cellClass}`);
    if (container) return container;

    container = document.createElement("span");
    container.className = CONFIG.cellClass;
    container.style.marginLeft = "6px";
    container.style.whiteSpace = "nowrap";

    targetCell.appendChild(container);
    return container;
  }

  function findCandidateRows() {
    const rows = Array.from(document.querySelectorAll("tr"));
    if (rows.length > 0) return rows;

    // 保険。通常TDnetではtrで足りる想定。
    return Array.from(document.querySelectorAll("li, div")).filter((el) => {
      const text = el.textContent || "";
      return /[0-9]{3}[0-9A-Z]/.test(text);
    });
  }

  function normalizeCode(code) {
    if (!code) return "";
    return String(code).trim().toUpperCase();
  }

  function extractCodeFromRow(row) {
    const cells = Array.from(row.querySelectorAll("td"));

    // TDnetの通常表: 時刻 / コード / 会社名 / 表題 ...
    if (cells.length < 3) return null;

    const raw = (cells[1].textContent || "").trim().toUpperCase();

    // TDnetでは 68570 のように5桁表示されることがある。
    // 末尾0を除いた先頭4文字を通常の証券コードとして扱う。
    const m5 = raw.match(/^([0-9]{3}[0-9A-Z])0$/);
    if (m5) return normalizeCode(m5[1]);

    // 念のため、4文字コードにも対応する。
    const m4 = raw.match(/^([0-9]{3}[0-9A-Z])$/);
    if (m4) return normalizeCode(m4[1]);

    return null;
  }

  function containsAny(text, keywords) {
    return keywords.some((kw) => text.includes(kw));
  }

  function formatNullable(value, fallback = "不明") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  }

  function formatCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return Math.round(n).toLocaleString("en-US");
  }

  function getUniverseCounts(universe) {
    const counts = {
      ok: 0,
      caution: 0,
      unknown: 0,
      ng: 0,
      total: 0
    };

    const summaryCounts = universe &&
      universe.summary &&
      universe.summary.universe_counts
      ? universe.summary.universe_counts
      : null;

    if (summaryCounts) {
      counts.ok = Number(summaryCounts.ok || 0);
      counts.caution = Number(summaryCounts.caution || 0);
      counts.unknown = Number(summaryCounts.unknown || 0);
      counts.ng = Number(summaryCounts.ng || 0);
      counts.total = Number(
        universe.summary && universe.summary.total !== undefined
          ? universe.summary.total
          : counts.ok + counts.caution + counts.unknown + counts.ng
      );
      return counts;
    }

    const symbols = universe && universe.symbols ? universe.symbols : {};

    Object.values(symbols).forEach((info) => {
      const status = getUniverseStatus(info);

      if (status === "ok") counts.ok += 1;
      else if (status === "caution") counts.caution += 1;
      else if (status === "ng") counts.ng += 1;
      else counts.unknown += 1;

      counts.total += 1;
    });

    return counts;
  }

  function isInFrame() {
    try {
      return window.self !== window.top;
    } catch (_e) {
      return true;
    }
  }

  function shouldShowUniverseSummary() {
    // TDnetは複数frame構成で、開示がない日には一覧frameにも実データ行がないため、
    // 「開示行の有無」で判定するとSummaryが二重表示される。
    // Summaryは画面全体に1つあればよいので、top windowでのみ表示する。
    return !isInFrame();
  }

  function removeUniverseSummaryPanels() {
    const selector = `#${CONFIG.summaryPanelId}, .${CONFIG.summaryPanelClass}`;
    Array.from(document.querySelectorAll(selector)).forEach((el) => el.remove());
  }

  function showUniverseSummary(universe) {
    removeUniverseSummaryPanels();

    if (!shouldShowUniverseSummary()) {
      return;
    }

    const counts = getUniverseCounts(universe);
    const generatedAt = formatNullable(universe && universe.generated_at);

    const panel = document.createElement("div");
    panel.id = CONFIG.summaryPanelId;
    panel.className = CONFIG.summaryPanelClass;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "TDnet Universe";

    const countsLine = document.createElement("div");
    countsLine.className = "counts";
    countsLine.textContent = [
      `OK ${formatCount(counts.ok)}`,
      `Caution ${formatCount(counts.caution)}`,
      `Unknown ${formatCount(counts.unknown)}`,
      `NG ${formatCount(counts.ng)}`,
      `Total ${formatCount(counts.total)}`
    ].join(" / ");

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Generated: ${generatedAt}`;

    panel.appendChild(title);
    panel.appendChild(countsLine);
    panel.appendChild(meta);
    document.body.appendChild(panel);
  }

  function getDisplaySector(info) {
    if (!info) return null;
    return info.sector33 || info.yf_sector || null;
  }

  function getUniverseStatus(info) {
    if (!info) return "missing";

    const status = info.universe_status || info.liquidity_status || "unknown";

    if (["ok", "caution", "ng", "unknown"].includes(status)) {
      return status;
    }

    return "unknown";
  }

  function buildTooltip(code, info, universe, rowText) {
    if (!info) {
      return [
        `${code}`,
        "JPX東証マスターに存在しないため、東証外または対象外候補として扱う",
        `JSON生成日時: ${formatNullable(universe.generated_at)}`
      ].join("\n");
    }

    const lines = [];

    lines.push(`${code} ${formatNullable(info.name, "")}`.trim());
    lines.push(`市場: ${formatNullable(info.market)}`);
    lines.push(`33業種: ${formatNullable(info.sector33)}`);
    lines.push(`17業種: ${formatNullable(info.sector17)}`);

    const yfSector = info.yf_sector || info.yf_industry
      ? `${formatNullable(info.yf_sector, "")} / ${formatNullable(info.yf_industry, "")}`.trim()
      : "不明";
    lines.push(`yfinance: ${yfSector}`);

    lines.push(`20日平均売買代金: ${formatNullable(info.avg_value_20d_label)}`);
    lines.push(`市場判定: ${formatNullable(info.market_status)}`);
    lines.push(`流動性判定: ${formatNullable(info.liquidity_status)}`);
    lines.push(`総合判定: ${formatNullable(info.universe_status)}`);

    const reasons = Array.isArray(info.reasons) ? info.reasons : [];
    if (reasons.length > 0) {
      lines.push("理由:");
      reasons.forEach((r) => lines.push(`- ${r}`));
    } else {
      lines.push("理由: なし");
    }

    if (containsAny(rowText, TDNET_TEXT_NG_KEYWORDS)) {
      lines.push("TDnet行テキスト補足:");
      lines.push("- ETF / REIT / 投資法人等の対象外語を検出");
    }

    lines.push(`JSON生成日時: ${formatNullable(universe.generated_at)}`);

    return lines.join("\n");
  }

  function applyRowStyle(row, status) {
    const style = STATUS_STYLE[status] || STATUS_STYLE.unknown;

    if (style.rowBackground) {
      row.style.backgroundColor = style.rowBackground;
    }

    if (style.rowOpacity) {
      row.style.opacity = style.rowOpacity;
    }
  }

  function buildAnalyzePrompt(code) {
    return `# 決算分析　対象：${code}

Codex Skill「earnings-signal-analysis」を使用してください。
SKILL.md本文を直接読んで実行してください。
frontmatter、summary、generated yaml、default_prompt、過去の記憶だけで実行しないでください。

出力は、このCodex workspace内の以下の相対パスに保存してください。
earnings-signal-analysis/md/${code}.md

SKILL.md本文はUTF-8として扱ってください。
もしmdファイルの日本語が文字化けしているように見える場合は、分析を続行せず、どのファイル・どの読み取りコマンドで文字化けしたかだけ報告してください。

文字化け対策やEncoding Guardをskill本文に追加しないでください。
今回は分析結果mdの作成のみを行い、skillファイルや設定ファイルは編集しないでください。`;
  }

  async function copyTextToClipboard(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const ok = document.execCommand("copy");
      if (!ok) {
        throw new Error("document.execCommand('copy') returned false");
      }
    } finally {
      document.body.removeChild(textarea);
    }
  }

  function addAnalyzeButton(container, code) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Analyze";
    button.className = CONFIG.analyzeButtonClass;
    button.title = "Codex用の決算兆候分析プロンプトをコピー";

    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const prompt = buildAnalyzePrompt(code);

      try {
        await copyTextToClipboard(prompt);
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = "Analyze";
        }, 1200);
      } catch (err) {
        console.error("[TDnet Highlighter] copy failed:", err);
        button.textContent = "Failed";
        setTimeout(() => {
          button.textContent = "Analyze";
        }, 1500);
      }
    });

    container.appendChild(button);
  }

  function addBadges(row, code, info, status) {
    const cell = ensureBadgeContainer(row);
    if (!cell) return;

    const style = STATUS_STYLE[status] || STATUS_STYLE.unknown;

    // 状態バッジ
    if (status !== "ok") {
      cell.appendChild(
        makeBadge(style.label, style.badgeBackground, style.badgeColor)
      );
    }

    // 業種バッジ
    const sector = getDisplaySector(info);
    if (sector) {
      cell.appendChild(
        makeBadge(sector, "#f3f4f6", "#374151")
      );
    }

    // 全行にAnalyzeボタンを表示する。
    addAnalyzeButton(cell, code);
  }

  function highlightRows(universe) {
    const symbols = universe && universe.symbols ? universe.symbols : {};
    const rows = findCandidateRows();

    let processed = 0;

    for (const row of rows) {
      if (row.getAttribute(CONFIG.processedAttr) === "1") continue;

      const rowText = row.textContent || "";
      const code = extractCodeFromRow(row);

      if (!code) continue;

      const info = symbols[code] || null;
      const status = getUniverseStatus(info);

      applyRowStyle(row, status);
      addBadges(row, code, info, status);

      row.title = buildTooltip(code, info, universe, rowText);

      row.setAttribute(CONFIG.processedAttr, "1");
      processed += 1;
    }

    if (processed > 0) {
      console.log(`[TDnet Highlighter] highlighted rows: ${processed}`);
    }
  }

  function showError(message) {
    const div = document.createElement("div");
    div.textContent = message;
    div.style.position = "fixed";
    div.style.right = "12px";
    div.style.bottom = "12px";
    div.style.zIndex = "999999";
    div.style.backgroundColor = "#fee2e2";
    div.style.color = "#7f1d1d";
    div.style.padding = "8px 12px";
    div.style.border = "1px solid #fecaca";
    div.style.borderRadius = "8px";
    div.style.fontSize = "12px";
    div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    document.body.appendChild(div);
  }

  function observePage(universe) {
    const observer = new MutationObserver(() => {
      highlightRows(universe);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ============================================================
  // main
  // ============================================================

  async function main() {
    injectStyle();

    console.log(`[TDnet Highlighter] script version ${SCRIPT_VERSION} loaded`);

    try {
      const universe = await fetchJson(UNIVERSE_URL);

      console.log(
        "[TDnet Highlighter] universe loaded:",
        universe.generated_at || "(no generated_at)",
        universe.summary || {}
      );

      showUniverseSummary(universe);
      highlightRows(universe);
      observePage(universe);
    } catch (e) {
      console.error("[TDnet Highlighter] failed:", e);
      showError(
        "TDnet Highlighter: universe_public.json の読み込みに失敗しました。Consoleを確認してください。"
      );
    }
  }

  main();
})();