"use strict";
/* ============================================================
 * SystemOne 模型語言能力檢測台（compare.html 專用）
 * 同情境依序送出 en → zh → mix（串行），彙整比較表。
 * 依賴 common.js（$、LS、state、SCENARIOS、LANG_*、fmt、escapeHtml…）。
 * ============================================================ */

function initCompare() {
  const sel = $("#compareSel");
  SCENARIOS.forEach((sc, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = sc.title;
    sel.append(o);
  });
  $("#compareBtn").addEventListener("click", runCompare);
  $("#clearHistoryBtn").addEventListener("click", () => {
    state.compareHistory = [];
    LS.set("s1.compareHistory", state.compareHistory);
    renderCompareHistory();
  });
  renderLangMatrix();
  renderCompareHistory();
}

/* 模型語言矩陣對照表（規格 §5） */
function renderLangMatrix() {
  const box = $("#langMatrix");
  const rows = [
    ["Julia-1", "144M", "50+ 語言", true],
    ["OpenJev", "27B", "en / de / fr / hi / zh / ja（vision）", true],
    ["Laya", "421M", "僅英文", false],
    ["Kev-4B", "4B", "僅英文", false],
    ["lev", "4B", "僅英文", false],
  ];
  box.innerHTML =
    `<table class="cmp-table"><thead><tr><th>模型</th><th>規模</th><th>語言支援</th><th>中文提示</th></tr></thead><tbody>` +
    rows.map(([m, sz, lang, zh]) =>
      `<tr><th class="cmp-qid">${m}</th><td class="cmp-cell mono">${sz}</td><td class="cmp-cell">${lang}</td>` +
      `<td class="cmp-cell">${zh ? '<span class="cmp-verdict cmp-ok">支援</span>' : '<span class="cmp-verdict cmp-bad">僅英文⚠</span>'}</td></tr>`).join("") +
    `</tbody></table>`;
}

async function runCompare() {
  const idx = Number($("#compareSel").value || 0);
  const sc = SCENARIOS[idx];
  if (!sc) return;
  const btn = $("#compareBtn");
  const box = $("#compareBox");
  btn.disabled = true;
  box.classList.remove("hidden");
  box.innerHTML = '<div class="badge off"><span class="spinner"></span>比對中：EN…</div>';

  const results = {};
  for (const lang of LANG_ORDER) {
    const payload = sc.variants[lang].payload;
    const t0 = performance.now();
    try {
      const res = await fetch(state.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const latency = Math.round(performance.now() - t0);
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* ignore */ }
      results[lang] = res.ok
        ? { ok: true, data, latency, usage: data && data.usage }
        : { ok: false, latency, err: `HTTP ${res.status}`, code: res.status };
    } catch (err) {
      results[lang] = { ok: false, latency: Math.round(performance.now() - t0), err: shortErr(err), code: null };
    }
    box.innerHTML = `<div class="badge off"><span class="spinner"></span>比對中：${LANG_ORDER.indexOf(lang) + 1}/3（${lang}）…</div>`;
  }

  btn.disabled = false;
  renderCompare(sc, results);
  pushHistoryCompare(sc, results);
}

function renderCompare(sc, results) {
  const box = $("#compareBox");
  box.innerHTML = "";

  // 收集所有 question id（以 en 變體為基準，其餘變體補缺）
  const qids = [];
  for (const lang of LANG_ORDER) {
    for (const qid of Object.keys(results[lang].data?.answers || {})) {
      if (!qids.includes(qid)) qids.push(qid);
    }
  }

  const table = document.createElement("table");
  table.className = "cmp-table";

  // 表頭
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  htr.innerHTML = `<th>question</th>` +
    LANG_ORDER.map(l => `<th><span class="lang-tag ${l}">${l}</span>${LANG_LABEL[l]}</th>`).join("") +
    `<th>一致性</th>`;
  thead.append(htr);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const qid of qids) {
    const tr = document.createElement("tr");
    const cells = LANG_ORDER.map(lang => {
      const r = results[lang];
      if (!r.ok) return `<td class="cmp-cell cmp-err" title="${escapeHtml(r.err)}">ERR${r.code ? " " + r.code : ""}</td>`;
      const ans = r.data?.answers?.[qid];
      if (!ans) return `<td class="cmp-cell cmp-err">無答案</td>`;
      return `<td class="cmp-cell">${cmpCellHtml(ans)}</td>`;
    });
    const verdict = cmpConsistency(LANG_ORDER.map(l => (results[l].ok ? results[l].data?.answers?.[qid] : null)));
    tr.innerHTML = `<th class="cmp-qid">${escapeHtml(qid)}</th>` + cells.join("") +
      `<td><span class="cmp-verdict ${verdict.cls}">${verdict.text}</span></td>`;
    tbody.append(tr);
  }
  table.append(tbody);

  // 表尾：latency / input_tokens
  const tfoot = document.createElement("tfoot");
  const mkFoot = (label, fn) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th class="cmp-qid">${label}</th>` +
      LANG_ORDER.map(l => `<td class="cmp-cell mono">${fn(results[l])}</td>`).join("") + `<td></td>`;
    return tr;
  };
  tfoot.append(
    mkFoot("延時 (ms)", r => r.latency + " ms"),
    mkFoot("input_tokens", r => r.ok ? (r.usage ? r.usage.input_tokens : "?") : "—"),
  );
  table.append(tfoot);

  box.append(table);

  const note = document.createElement("div");
  note.className = "legend-note";
  note.textContent = "解讀：choice 全同＝語義穩定；score/noul 最大差 ≤0.15 相近、≤0.35 輕微偏移、>0.35 分歧。" +
    "zh 欄＝state 與 instructions/criteria 全中文；mix 欄＝全混雜（中文骨架＋英文關鍵字）。" +
    "僅英文模型（Laya/Kev-4B/lev）在中文欄的偏移即語言能力限制；Julia-1/OpenJev 應較一致。";
  box.append(note);
}

function cmpCellHtml(ans) {
  if (ans.type === "choice") {
    const p = ans.probabilities?.[ans.choice];
    return `<b>${escapeHtml(ans.choice)}</b><span class="cmp-p">${p != null ? fmt(p, 3) : ""}</span>` +
      (typeof ans.confidence === "number" ? `<span class="cmp-p">conf ${fmt(ans.confidence, 3)}</span>` : "");
  }
  if (ans.type === "score") {
    return `<b>${fmt(ans.score, 3)}</b>` +
      (typeof ans.confidence === "number" ? `<span class="cmp-p">conf ${fmt(ans.confidence, 3)}</span>` : "");
  }
  if (ans.type === "noul") {
    return `<b>${fmt(ans.noul, 3)}</b>`;
  }
  return escapeHtml(JSON.stringify(ans));
}

function cmpConsistency(ansList) {
  const valid = ansList.filter(Boolean);
  if (valid.length < 2) return { cls: "cmp-warn", text: "資料不足" };
  const type = valid[0].type;
  if (type === "choice") {
    const choices = new Set(valid.map(a => a.choice));
    if (choices.size === 1) return { cls: "cmp-ok", text: "一致" };
    if (valid.length === 3 && choices.size === 2) return { cls: "cmp-warn", text: "部分分歧" };
    return { cls: "cmp-bad", text: "分歧" };
  }
  const nums = valid.map(a => a.type === "score" ? a.score : a.type === "noul" ? a.noul : null).filter(n => typeof n === "number");
  if (nums.length < 2) return { cls: "cmp-warn", text: "資料不足" };
  const maxDiff = Math.max(...nums) - Math.min(...nums);
  if (maxDiff <= 0.15) return { cls: "cmp-ok", text: `相近 Δ${fmt(maxDiff, 3)}` };
  if (maxDiff <= 0.35) return { cls: "cmp-warn", text: `偏移 Δ${fmt(maxDiff, 3)}` };
  return { cls: "cmp-bad", text: `分歧 Δ${fmt(maxDiff, 3)}` };
}

/* 比對歷史：獨立 key s1.compareHistory，不與主測試台歷史互擾 */
function pushHistoryCompare(sc, results) {
  const summary = LANG_ORDER.map(l => results[l].ok ? "200" : "ERR").join("/") + ` 三語比對：${sc.title}`;
  state.compareHistory.unshift({ ts: Date.now(), ok: LANG_ORDER.every(l => results[l].ok), summary, scenarioIdx: SCENARIOS.indexOf(sc) });
  state.compareHistory = state.compareHistory.slice(0, MAX_HISTORY);
  LS.set("s1.compareHistory", state.compareHistory);
  renderCompareHistory();
}

function renderCompareHistory() {
  const box = $("#historyList");
  box.innerHTML = "";
  state.compareHistory.forEach(h => {
    const item = document.createElement("div");
    item.className = "hist-item";
    item.title = "點擊重新載入該情境";
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = new Date(h.ts).toLocaleTimeString();
    const s = document.createElement("span");
    s.className = "s";
    s.textContent = h.summary;
    const st = document.createElement("span");
    st.className = "st " + (h.ok ? "ok" : "bad");
    st.textContent = h.ok ? "OK" : "ERR";
    item.append(t, s, st);
    item.addEventListener("click", () => { $("#compareSel").value = String(h.scenarioIdx); });
    box.append(item);
  });
}

function init() {
  initHeader();
  initCompare();
  probeServer();
}

document.addEventListener("DOMContentLoaded", init);
