"use strict";
/* ============================================================
 * SystemOne 決策模型測試台（主測試台 — 學習／編寫／驗證）
 * POST /v1/systemone — llama.cpp TypeSafe-compatible endpoint
 * 共用層（$, LS, state, header/probe, fetch 工具, SCENARIOS…）
 * 由 common.js 提供；三語比對功能在 compare.html（compare.js）。
 * ============================================================ */

/* ============================================================
 * 入門範例（單語）— 學習主路徑：choice / score / messages 基本型
 * ============================================================ */
const INTRO_PRESETS = [
  {
    name: "入門：choice 基本型",
    payload: {
      state: "Customer message: My parcel was supposed to arrive Tuesday and it is still not here.",
      questions: {
        topic: {
          type: "choice",
          instructions: "What is this message about?",
          criteria: { delivery: "parcel, shipping, tracking", billing: "payment, charge, refund", other: null },
        },
      },
    },
  },
  {
    name: "入門：score 基本型",
    payload: {
      state: "Customer message: I am a bit annoyed that my order is late, but it is not a big problem.",
      questions: {
        mood: {
          type: "score",
          instructions: "How unhappy is this customer?",
          criteria: ["happy", "neutral", "annoyed", "furious"],
        },
      },
    },
  },
  {
    name: "入門：noul 基本型",
    payload: {
      state: "Agent step: ran `git push origin main`. Output: Everything up-to-date. No errors reported.",
      questions: {
        succeeded: { type: "noul", instructions: "Did this step achieve its goal?" },
      },
    },
  },
];

/* ============================================================
 * state 編輯區（text / json / messages）
 * ============================================================ */
function initStateEditor() {
  $("#stateMode").addEventListener("change", () => {
    const ta = $("#stateText");
    const mode = $("#stateMode").value;
    ta.placeholder = mode === "json"
      ? '例：{"ticket_id": 42, "text": "I was charged twice"}'
      : mode === "messages"
        ? '例：[{"role":"user","content":[{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}]}]'
        : "例：Customer message: I was charged twice for my order last week and nobody has replied.";
  });
}

function readState() {
  const mode = $("#stateMode").value;
  const raw = $("#stateText").value;
  if (mode === "text") {
    if (!raw.trim()) throw new UiError("state（文字）不可為空。");
    return raw;
  }
  // json / messages 皆解析 JSON
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new UiError(`state（${mode}）不是合法 JSON：${e.message}`); }
  if (mode === "messages") {
    const msgs = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.messages) ? parsed.messages : null;
    if (!msgs) throw new UiError('messages 模式需為訊息陣列，或含 "messages" 陣列的物件。');
  }
  return parsed;
}

/* ============================================================
 * images
 * ============================================================ */
function initImages() {
  $("#imageFiles").addEventListener("change", async (ev) => {
    for (const file of ev.target.files) {
      const dataUrl = await readFileAsDataUrl(file);
      state.images.push({ dataUrl, name: file.name, size: file.size });
    }
    ev.target.value = "";
    renderImages();
  });
  renderImages();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new UiError(`讀取圖片失敗：${file.name}`));
    r.readAsDataURL(file);
  });
}

function renderImages() {
  const box = $("#imageList");
  box.innerHTML = "";
  state.images.forEach((img, i) => {
    const chip = document.createElement("div");
    chip.className = "img-chip";
    const el = document.createElement("img");
    el.src = img.dataUrl;
    el.alt = img.name;
    const meta = document.createElement("div");
    meta.className = "img-meta";
    meta.textContent = `${img.name} · ${(img.size / 1024).toFixed(0)} KB`;
    const del = document.createElement("button");
    del.className = "img-del";
    del.title = "移除";
    del.textContent = "✕";
    del.addEventListener("click", () => { state.images.splice(i, 1); renderImages(); });
    chip.append(el, meta, del);
    box.append(chip);
  });
}

/* ============================================================
 * questions UI
 * ============================================================ */
function addQuestionCard(qid = "", type = "choice", instructions = "", criteria = null) {
  const node = $("#qTemplate").content.firstElementChild.cloneNode(true);
  const list = $("#questionList");
  qid = qid || `q${list.querySelectorAll(".q-card").length + 1}`;
  $(".q-id", node).value = qid;
  $(".q-type", node).value = type;
  $(".q-instr", node).value = instructions;

  const critBox = $(".q-criteria", node);
  const renderCriteria = () => renderCriteriaEditor(critBox, $(".q-type", node).value, criteria);
  renderCriteria();
  $(".q-type", node).addEventListener("change", () => {
    criteria = defaultCriteriaFor($(".q-type", node).value);
    renderCriteria();
  });
  $(".q-del", node).addEventListener("click", () => node.remove());
  list.append(node);
}

function defaultCriteriaFor(type) {
  if (type === "choice") return { option1: null, option2: null };
  if (type === "score") return ["low", "high"];
  return null;
}

function renderCriteriaEditor(critBox, type, criteria) {
  critBox.innerHTML = "";
  if (type === "noul") {
    const p = document.createElement("div");
    p.className = "q-noul-note";
    p.textContent = "noul 的 criteria 選填：{\"true\": 描述, \"false\": 描述}，留空即可。";
    critBox.append(p);
    return;
  }
  const addBtn = document.createElement("button");
  addBtn.className = "btn ghost sm crit-add";
  if (type === "choice") {
    const map = criteria && typeof criteria === "object" && !Array.isArray(criteria) ? criteria : { option1: null, option2: null };
    Object.entries(map).forEach(([k, v]) => appendChoiceRow(critBox, k, v));
    addBtn.textContent = "＋ 選項";
    addBtn.addEventListener("click", () => appendChoiceRow(critBox, "", ""));
  } else { // score
    const arr = Array.isArray(criteria) && criteria.length >= 2 ? criteria : ["low", "high"];
    arr.forEach(lv => appendScoreRow(critBox, lv));
    addBtn.textContent = "＋ 等級";
    addBtn.addEventListener("click", () => appendScoreRow(critBox, ""));
  }
  critBox.append(addBtn);
  renumber(critBox);
}

function appendChoiceRow(critBox, key, val) {
  const row = $("#choiceRowTemplate").content.firstElementChild.cloneNode(true);
  $(".crit-key", row).value = key;
  $(".crit-val", row).value = val ?? "";
  $(".crit-del", row).addEventListener("click", () => { row.remove(); renumber(critBox); });
  critBox.insertBefore(row, $(".crit-add", critBox));
}

function appendScoreRow(critBox, val) {
  const row = $("#scoreRowTemplate").content.firstElementChild.cloneNode(true);
  $(".crit-level", row).value = val ?? "";
  $(".crit-del", row).addEventListener("click", () => { row.remove(); renumber(critBox); });
  critBox.insertBefore(row, $(".crit-add", critBox));
}

function renumber(critBox) {
  critBox.querySelectorAll(".crit-idx").forEach((el, i) => { el.textContent = i; });
}

function readQuestions() {
  const out = {};
  const cards = $("#questionList").querySelectorAll(".q-card");
  if (cards.length === 0) throw new UiError("questions 不可為空 — 請至少新增一個問題。");
  const seen = new Set();
  for (const card of cards) {
    const qid = $(".q-id", card).value.trim();
    if (!qid) throw new UiError("每個問題都需要 id。");
    if (seen.has(qid)) throw new UiError(`問題 id 重複：${qid}`);
    seen.add(qid);
    const type = $(".q-type", card).value;
    const instructions = $(".q-instr", card).value;
    if (!instructions.trim()) throw new UiError(`問題 ${qid}：instructions 不可為空。`);

    if (type === "choice") {
      const criteria = {};
      const rows = card.querySelectorAll(".crit-row");
      rows.forEach(row => {
        const k = $(".crit-key", row).value.trim();
        if (!k) throw new UiError(`問題 ${qid}：choice 選項名稱不可為空。`);
        if (k in criteria) throw new UiError(`問題 ${qid}：選項重複：${k}`);
        const v = $(".crit-val", row).value;
        criteria[k] = v === "" ? null : v;
      });
      if (Object.keys(criteria).length === 0) throw new UiError(`問題 ${qid}：choice 的 criteria 不可為空物件（至少一個選項）。`);
      out[qid] = { type, instructions, criteria };
    } else if (type === "score") {
      const levels = [...card.querySelectorAll(".crit-level")].map(i => i.value);
      if (levels.length < 2) throw new UiError(`問題 ${qid}：score 需要 2–10 個等級描述（目前 ${levels.length} 個）。`);
      if (levels.length > 10) throw new UiError(`問題 ${qid}：score 最多 10 個等級（目前 ${levels.length} 個）。`);
      out[qid] = { type, instructions, criteria: levels };
    } else { // noul
      out[qid] = { type, instructions };
    }
  }
  return out;
}

/* ============================================================
 * 請求序列化 + 預覽
 * ============================================================ */
function buildRequest() {
  const st = readState();
  const questions = readQuestions();
  const req = { state: st, questions };
  const images = state.images.map(i => i.dataUrl);
  if (images.length) req.images = images;
  // router 模式：目前 UI 不指定 model（單模型 server 忽略此欄位）
  return req;
}

function renderPreview() {
  const box = $("#previewBox");
  if (!$("#previewToggle").checked) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  try {
    const req = buildRequest();
    box.textContent = JSON.stringify(redactImages(req), null, 2);
  } catch (e) {
    box.textContent = "（請求無效：" + (e instanceof UiError ? e.message : String(e)) + "）";
  }
}

function redactImages(req) {
  const copy = JSON.parse(JSON.stringify(req));
  if (Array.isArray(copy.images)) copy.images = copy.images.map(u => u.slice(0, 48) + "…(" + u.length + " chars)");
  return copy;
}

/* ============================================================
 * 送出請求
 * ============================================================ */
async function sendRequest(payloadOverride) {
  const btn = $("#sendBtn");
  btn.disabled = true;
  $("#statusLine").classList.remove("hidden");
  $("#statusLine").innerHTML = '<span class="badge off"><span class="spinner"></span>送出中…</span>';
  $("#errorBox").classList.add("hidden");
  $("#answersBox").innerHTML = "";
  $("#rawBox").classList.add("hidden");

  let payload;
  try {
    payload = payloadOverride ?? buildRequest();
    state.lastRequest = payload;
    if ($("#previewToggle").checked) renderPreview();
  } catch (e) {
    btn.disabled = false;
    showError("前端驗證", e instanceof UiError ? e.message : String(e), null);
    $("#statusLine").innerHTML = '<span class="badge warn">已擋下（未送出）</span>';
    return;
  }

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
    try { data = JSON.parse(text); } catch { /* 保留原始文字 */ }

    if (!res.ok) {
      showError(`HTTP ${res.status}`, oaiErrorMessage(data) || text, res.status);
      $("#statusLine").innerHTML = statusBadges(res.status, latency, null);
      pushHistory(payload, res.status, false, summarizeError(data, text));
    } else {
      renderAnswers(data);
      $("#statusLine").innerHTML = statusBadges(res.status, latency, data && data.usage);
      $("#rawBox").textContent = JSON.stringify(data, null, 2);
      $("#rawBox").classList.toggle("hidden", !$("#rawToggle").checked);
      pushHistory(payload, res.status, true, summarizeAnswers(data));
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0);
    showError("連線失敗", `${shortErr(err)}\n（base URL：${state.baseUrl}）`, null);
    $("#statusLine").innerHTML = `<span class="badge err">網路錯誤</span><span class="mono">${latency} ms</span>`;
    pushHistory(payload, 0, false, "network: " + shortErr(err));
  } finally {
    btn.disabled = false;
  }
}

function statusBadges(status, latencyMs, usage) {
  const cls = status === 200 ? "ok" : status === 503 ? "warn" : "err";
  const usageTxt = usage
    ? `<span class="mono">input_tokens=${usage.input_tokens} · output_tokens=${usage.output_tokens}</span>`
    : "";
  return `<span class="badge ${cls}">HTTP ${status}</span><span class="mono">${latencyMs} ms</span>${usageTxt}`;
}

function showError(title, message, code) {
  const box = $("#errorBox");
  box.classList.remove("hidden");
  box.innerHTML = "";
  const head = document.createElement("div");
  head.innerHTML = `<b>${escapeHtml(title)}</b>` +
    (code ? ` <span class="code">${code}</span>` : "");
  const body = document.createElement("div");
  body.style.whiteSpace = "pre-wrap";
  body.textContent = message;
  box.append(head, body);
}

/* ============================================================
 * 結果渲染
 * ============================================================ */
function renderAnswers(data) {
  const box = $("#answersBox");
  box.innerHTML = "";
  const answers = data && data.answers;
  if (!answers || Object.keys(answers).length === 0) {
    const p = document.createElement("div");
    p.className = "hint";
    p.textContent = "回應中沒有 answers。";
    box.append(p);
    return;
  }
  if (data.model) {
    const m = document.createElement("div");
    m.className = "hint";
    m.innerHTML = `model: <code>${escapeHtml(data.model)}</code>`;
    box.append(m);
  }
  for (const [qid, ans] of Object.entries(answers)) {
    box.append(renderAnswerCard(qid, ans));
  }
}

function renderAnswerCard(qid, ans) {
  const card = document.createElement("div");
  card.className = "ans-card";
  const head = document.createElement("div");
  head.className = "ans-head";
  head.innerHTML = `<span class="qid">${escapeHtml(qid)}</span>` +
    `<span class="type-tag">${escapeHtml(ans.type || "?")}</span>`;
  if (typeof ans.confidence === "number") {
    head.innerHTML += `<span class="conf">confidence <b>${fmt(ans.confidence, 4)}</b></span>`;
  }
  card.append(head);

  if (ans.type === "choice") {
    const probs = ans.probabilities || {};
    const entries = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    for (const [opt, p] of entries) {
      const row = document.createElement("div");
      row.className = "prob-row" + (opt === ans.choice ? " winner" : "");
      row.innerHTML =
        `<div class="opt${opt === ans.choice ? " winner" : ""}" title="${escapeHtml(opt)}">${escapeHtml(opt)}</div>` +
        `<div class="prob-bar"><div style="width:${(p * 100).toFixed(2)}%"></div></div>` +
        `<div class="pv">${fmt(p, 4)}</div>`;
      card.append(row);
    }
    const sum = entries.reduce((s, [, p]) => s + p, 0);
    const note = document.createElement("div");
    note.className = "legend-note";
    note.textContent = `choice = ${ans.choice} · 機率總和 = ${fmt(sum, 6)}`;
    card.append(note);
  } else if (ans.type === "score") {
    const big = document.createElement("div");
    big.className = "score-big";
    big.innerHTML = `${fmt(ans.score, 4)} <small>（加權期望等級索引）</small>`;
    card.append(big);
    const probs = ans.probabilities || {};
    const legend = ans.legend || {};
    const keys = Object.keys(probs).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) {
      const p = probs[k];
      const row = document.createElement("div");
      row.className = "prob-row";
      const label = `${k}: ${legend[k] ?? ""}`;
      row.innerHTML =
        `<div class="opt" title="${escapeHtml(label)}">${escapeHtml(label)}</div>` +
        `<div class="prob-bar"><div style="width:${(p * 100).toFixed(2)}%"></div></div>` +
        `<div class="pv">${fmt(p, 4)}</div>`;
      card.append(row);
    }
    const sum = keys.reduce((s, k) => s + probs[k], 0);
    const note = document.createElement("div");
    note.className = "legend-note";
    note.textContent = `legend 對應 criteria 索引（0 = 最低等級） · 機率總和 = ${fmt(sum, 6)}`;
    card.append(note);
  } else if (ans.type === "noul") {
    const wrap = document.createElement("div");
    wrap.className = "noul-wrap";
    const p = typeof ans.noul === "number" ? ans.noul : 0;
    const ring = document.createElement("div");
    ring.className = "noul-ring";
    ring.style.setProperty("--p", p);
    ring.innerHTML = `<div>${(p * 100).toFixed(1)}%</div>`;
    const label = document.createElement("div");
    label.className = "noul-label";
    label.innerHTML = `noul = <b>${fmt(p, 4)}</b><br>P(true)：機率越高越傾向「是」。`;
    wrap.append(ring, label);
    card.append(wrap);
  } else {
    const pre = document.createElement("pre");
    pre.className = "preview";
    pre.textContent = JSON.stringify(ans, null, 2);
    card.append(pre);
  }
  return card;
}

/* ============================================================
 * 預設範例（入門 + 內建 + 使用者自存）
 * ============================================================ */
function initPresets() {
  const sel = $("#presetSel");
  const groupI = document.createElement("optgroup");
  groupI.label = "入門範例（單語）";
  INTRO_PRESETS.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = "i" + i;
    o.textContent = p.name;
    groupI.append(o);
  });
  const groupB = document.createElement("optgroup");
  groupB.label = "內建範例（三語）";
  // 注意：optgroup 不可巢狀 optgroup（HTML 非法），故採平鋪並在前綴情境名
  SCENARIOS.forEach((sc, si) => {
    ["en", "zh", "mix"].forEach(lang => {
      const o = document.createElement("option");
      o.value = `b${si}-${lang}`;
      o.textContent = `${sc.title} · ${LANG_LABEL[lang]}`;
      groupB.append(o);
    });
  });
  EXTRA_PRESETS.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = "x" + i;
    o.textContent = p.name;
    groupB.append(o);
  });
  const groupU = document.createElement("optgroup");
  groupU.label = "我的預設";
  const rebuildUser = () => {
    groupU.innerHTML = "";
    state.presets.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = "u" + i;
      o.textContent = p.name;
      groupU.append(o);
    });
  };
  sel.append(groupI, groupB, groupU);
  rebuildUser();

  sel.addEventListener("change", () => {
    const v = sel.value;
    if (!v) return;
    let payload = null;
    if (v[0] === "i") {
      payload = INTRO_PRESETS[Number(v.slice(1))]?.payload;
    } else if (v.startsWith("b")) {
      const m = /^b(\d+)-(\w+)$/.exec(v);
      if (m) payload = SCENARIOS[Number(m[1])]?.variants[m[2]]?.payload;
    } else if (v[0] === "x") {
      payload = EXTRA_PRESETS[Number(v.slice(1))]?.payload;
    } else if (v[0] === "u") {
      payload = state.presets[Number(v.slice(1))]?.payload;
    }
    if (payload) loadPayload(payload);
    sel.value = "";
  });

  $("#delPresetBtn").addEventListener("click", () => {
    const v = $("#presetSel").value;
    if (!v || v[0] !== "u") { alert("請先從「我的預設」選取要刪除的項目。"); return; }
    const idx = Number(v.slice(1));
    if (!confirm(`刪除預設「${state.presets[idx].name}」？`)) return;
    state.presets.splice(idx, 1);
    LS.set("s1.presets", state.presets);
    rebuildUser();
    $("#presetSel").value = "";
  });

  $("#savePresetBtn").addEventListener("click", () => {
    let payload;
    try { payload = buildRequest(); }
    catch (e) { showError("無法儲存預設", e instanceof UiError ? e.message : String(e), null); return; }
    const name = prompt("預設名稱：", "我的預設 " + (state.presets.length + 1));
    if (!name) return;
    state.presets.push({ name, payload });
    LS.set("s1.presets", state.presets);
    rebuildUser();
  });
}

/* 把 payload 填入編輯區 */
function loadPayload(payload) {
  // state
  const st = payload.state;
  if (typeof st === "string") {
    $("#stateMode").value = "text";
    $("#stateText").value = st;
  } else if (Array.isArray(st) && st.every(m => m && typeof m.role === "string")) {
    $("#stateMode").value = "messages";
    $("#stateText").value = JSON.stringify(st, null, 2);
  } else {
    $("#stateMode").value = "json";
    $("#stateText").value = JSON.stringify(st, null, 2);
  }
  // images
  state.images = (payload.images || []).map((u, i) => ({ dataUrl: u, name: `image${i + 1}`, size: Math.round(u.length * 0.75) }));
  renderImages();
  // questions
  $("#questionList").innerHTML = "";
  for (const [qid, q] of Object.entries(payload.questions || {})) {
    addQuestionCard(qid, q.type, q.instructions, q.criteria ?? null);
  }
  renderPreview();
}

/* ============================================================
 * 歷史紀錄
 * ============================================================ */
function summarizeAnswers(data) {
  const ans = data && data.answers;
  if (!ans) return "no answers";
  return Object.entries(ans).map(([qid, a]) => {
    if (a.type === "choice") return `${qid}→${a.choice}`;
    if (a.type === "score") return `${qid}→${fmt(a.score, 2)}`;
    if (a.type === "noul") return `${qid}→${fmt(a.noul, 2)}`;
    return qid;
  }).join(" · ");
}
function summarizeError(data, text) {
  const m = oaiErrorMessage(data);
  return m ? m.slice(0, 120) : (text || "").slice(0, 120);
}

function pushHistory(payload, status, ok, summary) {
  state.history.unshift({ ts: Date.now(), status, ok, summary, payload });
  state.history = state.history.slice(0, MAX_HISTORY);
  LS.set("s1.history", state.history);
  renderHistory();
}

function renderHistory() {
  const box = $("#historyList");
  box.innerHTML = "";
  state.history.forEach((h, i) => {
    const item = document.createElement("div");
    item.className = "hist-item";
    item.title = "點擊載入該請求到編輯區";
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = new Date(h.ts).toLocaleTimeString();
    const s = document.createElement("span");
    s.className = "s";
    s.textContent = h.summary;
    const st = document.createElement("span");
    st.className = "st " + (h.ok ? "ok" : "bad");
    st.textContent = h.status ? `HTTP ${h.status}` : "ERR";
    item.append(t, s, st);
    item.addEventListener("click", () => loadPayload(h.payload));
    box.append(item);
  });
}

/* ============================================================
 * 初始化
 * ============================================================ */
function init() {
  initHeader();
  initStateEditor();
  initImages();
  initPresets();
  renderHistory();

  $("#addQBtn").addEventListener("click", () => addQuestionCard());
  $("#sendBtn").addEventListener("click", () => sendRequest());
  $("#previewToggle").addEventListener("change", renderPreview);
  $("#rawToggle").addEventListener("change", () => {
    $("#rawBox").classList.toggle("hidden", !$("#rawToggle").checked);
  });
  $("#clearHistoryBtn").addEventListener("click", () => {
    state.history = [];
    LS.set("s1.history", []);
    renderHistory();
  });

  // 預設載入第一個情境的純英文變體，方便立即測試
  loadPayload(SCENARIOS[0].variants.en.payload);
  probeServer();
}

document.addEventListener("DOMContentLoaded", init);
