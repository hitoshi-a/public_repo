// ==UserScript==
// @name         TDnet Universe Highlighter
// @namespace    https://github.com/hitoshi-a/public_repo
// @version      0.1.1
// @description  TDnetの適時開示一覧をuniverse_public.jsonに基づいて色分けする
// @match        https://www.release.tdnet.info/inbs/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tdnet/tdnet_highlight.user.js
// @downloadURL  https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tdnet/tdnet_highlight.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // 設定
  // ============================================================

  const UNIVERSE_URL =
    "https://raw.githubusercontent.com/hitoshi-a/public_repo/main/tdnet/universe_public.json";

  const CONFIG = {
    processedAttr: "data-tdnet-universe-highlighted",
    badgeClass: "tdnet-universe-badge",
    cellClass: "tdnet-universe-cell",

    // GitHub rawのキャッシュが気になる場合は true。
    // 通常は false でよい。
    useCacheBuster: false,

    // 未登録・unknownは確認対象なので、少し目立たせる。
    highlightUnknown: true
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
      rowBackground: "#fef9c3",
      rowOpacity: "",
      badgeBackground: "#fde68a",
      badgeColor: "#78350f",
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
      rowBackground: "#ffe4e6",
      rowOpacity: "",
      badgeBackground: "#fecdd3",
      badgeColor: "#881337",
      label: "要確認"
    },
    missing: {
      rowBackground: "#ffe4e6",
      rowOpacity: "",
      badgeBackground: "#fecdd3",
      badgeColor: "#881337",
      label: "未登録"
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

    // TDnet縺ｮ騾壼ｸｸ陦ｨ: 譎ょ綾 / 繧ｳ繝ｼ繝・/ 莨夂､ｾ蜷・/ 陦ｨ鬘・...
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

  function extractCodeFromRow(row) {
    const cells = Array.from(row.querySelectorAll("td"));

// TDnetの通常表: 時刻 / コード / 会社名 / 表題 ...
    if (cells.length < 3) return null;

    const raw = (cells[1].textContent || "").trim().toUpperCase();

    // TDnetでは 68570 のように5桁表示されることがある。
    // 末尾0を除いた先頭4文字を通常の証券コードとして扱う。
    const m5 = raw.match(/^([0-9]{3}[0-9A-Z])0$/);
    if (m5) return m5[1];

    // 念のため、4文字コードにも対応する。
    const m4 = raw.match(/^([0-9]{3}[0-9A-Z])$/);
    if (m4) return m4[1];

    return null;
  }
  function containsAny(text, keywords) {
    return keywords.some((kw) => text.includes(kw));
  }

  function formatNullable(value, fallback = "不明") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
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
        "universe_public.jsonに未登録",
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

  function addBadges(row, info, status) {
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
      addBadges(row, info, status);

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

    try {
      const universe = await fetchJson(UNIVERSE_URL);

      console.log(
        "[TDnet Highlighter] universe loaded:",
        universe.generated_at || "(no generated_at)",
        universe.summary || {}
      );

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
