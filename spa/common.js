"use strict";
/* ============================================================
 * SystemOne 共用層：base URL / 連線偵測 / fetch 工具 / 情境資料
 * 由 index.html（測試台）與 compare.html（語言能力檢測）共載。
 * POST /v1/systemone — llama.cpp TypeSafe-compatible endpoint
 * ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

const DEFAULT_BASE = "http://localhost:8080/v1/systemone";
const MAX_HISTORY = 20;

class UiError extends Error {}

/* ---------- 全域狀態 ---------- */
const state = {
  baseUrl: LS.get("s1.baseUrl", DEFAULT_BASE),
  images: [],            // [{dataUrl, name, size}]（主測試台用）
  presets: LS.get("s1.presets", []),   // [{name, payload}]（主測試台用）
  history: LS.get("s1.history", []),   // [{ts, status, ok, summary, payload, response}]（主測試台用）
  compareHistory: LS.get("s1.compareHistory", []), // 比對頁專用，獨立 key
  lastRequest: null,
};

/* ============================================================
 * Header：base URL 與連線偵測
 * ============================================================ */
function initHeader() {
  const input = $("#baseUrl");
  input.value = state.baseUrl;
  input.addEventListener("change", () => {
    state.baseUrl = input.value.trim() || DEFAULT_BASE;
    LS.set("s1.baseUrl", state.baseUrl);
    setBadge("off", "已儲存 URL，請重新偵測");
  });
  $("#probeBtn").addEventListener("click", probeServer);
}

function apiRoot() {
  // base URL 形如 http://host:port[/api-prefix]/v1/systemone → 剝掉結尾的 /v1/systemone
  return state.baseUrl.replace(/\/v1\/systemone\/?$/, "");
}

function setBadge(cls, text) {
  const b = $("#connBadge");
  b.className = "badge " + cls;
  b.textContent = text;
}

/* 模型語言支援對照表（規格 §5 模型矩陣）：以 model id 小寫子字串比對 */
const MODEL_LANGS = [
  { match: "julia",  label: "50+ 語言", zh: true },
  { match: "openjev", label: "en/de/fr/hi/zh/ja", zh: true },
  { match: "laya",   label: "僅英文", zh: false },
  { match: "kev",    label: "僅英文", zh: false },
  { match: "lev",    label: "僅英文", zh: false },
];

function modelLangNote(id) {
  const low = String(id).toLowerCase();
  const hit = MODEL_LANGS.find(m => low.includes(m.match));
  if (!hit) return null;
  return hit.zh ? `語言 ${hit.label}` : `語言 ${hit.label}⚠`;
}

async function probeServer() {
  setBadge("off", "偵測中…");
  const root = apiRoot();
  try {
    const health = await fetchJson(root + "/health", { method: "GET" });
    let modelLine = "health ok";
    try {
      const models = await fetchJson(root + "/v1/models", { method: "GET" });
      const ids = (models.data || []).map(m => m.id);
      if (ids.length) {
        const notes = ids.map(id => { const n = modelLangNote(id); return n ? `${id}（${n}）` : id; });
        modelLine = `模型：${notes.join(", ")}`;
      }
    } catch { /* models 取不到不影響 health 結果 */ }
    setBadge("ok", "上線 · " + modelLine);
  } catch (err) {
    setBadge("err", "離線 · " + shortErr(err));
  }
}

/* ============================================================
 * fetch 工具
 * ============================================================ */
function fetchJson(url, opts) {
  return fetch(url, opts).then(async r => {
    const text = await r.text();
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = oaiErrorMessage(JSON.parse(text)) || msg; } catch {}
      throw new Error(msg);
    }
    return JSON.parse(text);
  });
}

function oaiErrorMessage(data) {
  return data && data.error ? (data.error.message || data.error.type || String(data.error.code)) : null;
}
function shortErr(err) {
  const m = String(err && err.message || err);
  return m.length > 120 ? m.slice(0, 120) + "…" : m;
}

/* ============================================================
 * 通用格式化
 * ============================================================ */
function fmt(x, digits) {
  return typeof x === "number" ? Number(x.toFixed(digits)).toString() : String(x);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
 * 內建情境（三語設計 — 語言能力測試用）
 *   en  = 純英文：state + instructions + criteria 全英文。
 *   zh  = 純中文：state + instructions + criteria 全中文化（測完整中文提示）。
 *   mix = 中英混雜：僅 state 混雜，instructions/criteria 維持英文
 *         （隔離變因：只測 state 語言，不測提示語言）。
 * 對照規格 §5 語言矩陣：Julia-1 = 50+ 語言；OpenJev = en/de/fr/hi/zh/ja；
 * Laya / Kev-4B / lev = 僅英文 → 中文欄位的退化即為模型語言能力的訊號。
 * ============================================================ */
const LANG_LABEL = { en: "純英文", zh: "純中文", mix: "中英混雜" };
const LANG_ORDER = ["en", "zh", "mix"];

/* 情境 1：客服工單路由（對齊規格 §7.1 canonical 範例） */
const TICKET_EN_QUESTIONS = {
  route: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: {
      billing: "payments, charges, refunds, invoices",
      shipping: "delivery, tracking, lost or late parcels",
      technical: "bugs, errors, login problems",
    },
  },
  angry: { type: "noul", instructions: "Is the customer angry?" },
  urgency: {
    type: "score",
    instructions: "How urgent is this?",
    criteria: ["can wait", "this week", "today", "right now"],
  },
};

/* 情境 2：內容審核 */
const MODERATION_EN_QUESTIONS = {
  category: {
    type: "choice",
    instructions: "What category is this comment?",
    criteria: {
      spam: "ads, promotion, links",
      abuse: "insults, harassment, threats",
      complaint: "negative feedback about the product or service",
      praise: "positive feedback",
      question: "asks for information",
    },
  },
  severity: {
    type: "score",
    instructions: "How severe is this comment?",
    criteria: ["no issue", "minor", "serious", "critical"],
  },
};

/* 情境 3：Agent 步驟自評 */
const AGENT_EN_QUESTIONS = {
  succeeded: { type: "noul", instructions: "Did this step achieve its goal?" },
  needs_human: { type: "noul", instructions: "Does this step need a human to review before continuing?" },
};

/* 情境 1～3 的全混雜 questions（中文骨架＋英文關鍵字，對應全混雜 state）。
 * mix 變體設計（v1.1 修正）：state 與 instructions/criteria 皆混雜，
 * 反映生產環境真實中文輸入（使用者保留英文欄位名／產品名／指令骨架）。 */
const TICKET_MIX_QUESTIONS = {
  route: {
    type: "choice",
    instructions: "Which team 應該處理這筆工單？",
    criteria: {
      billing: "付款、charge、退款、invoice",
      shipping: "配送、tracking、包裹 lost 或 late",
      technical: "bug、error、登入問題",
    },
  },
  angry: { type: "noul", instructions: "這位 customer 是否 angry？" },
  urgency: {
    type: "score",
    instructions: "這件事情有多 urgent？",
    criteria: ["可以等待", "this week 內", "today", "立刻"],
  },
};

const MODERATION_MIX_QUESTIONS = {
  category: {
    type: "choice",
    instructions: "這則留言屬於哪個 category？",
    criteria: {
      spam: "廣告、promotion、連結",
      abuse: "侮辱、harassment、威脅",
      complaint: "對 product 或 service 的負面 feedback",
      praise: "正面 feedback",
      question: "詢問資訊",
    },
  },
  severity: {
    type: "score",
    instructions: "這則留言的 severity 如何？",
    criteria: ["沒有問題", "minor", "serious", "critical"],
  },
};

const AGENT_MIX_QUESTIONS = {
  succeeded: { type: "noul", instructions: "這個 step 達成 goal 了嗎？" },
  needs_human: { type: "noul", instructions: "這個 step 在繼續之前需要 human review 嗎？" },
};

const SCENARIOS = [
  {
    id: "ticket",
    title: "客服工單路由（choice + noul + score）",
    variants: {
      en: {
        label: "純英文",
        payload: {
          state: "Customer message: I was charged twice for my order last week and nobody has replied.",
          questions: TICKET_EN_QUESTIONS,
        },
      },
      zh: {
        label: "純中文",
        payload: {
          state: "客戶訊息：上週我的訂單被重複扣款了兩次，到現在都還沒有任何人回覆我。",
          questions: {
            route: {
              type: "choice",
              instructions: "應該由哪個團隊處理這筆工單？",
              criteria: {
                billing: "付款、扣款、退款、發票",
                shipping: "配送、物流追蹤、包裹遺失或延遲",
                technical: "程式錯誤、系統故障、登入問題",
              },
            },
            angry: { type: "noul", instructions: "這位客戶是否生氣？" },
            urgency: {
              type: "score",
              instructions: "這件事情有多緊急？",
              criteria: ["可以等待", "本週內", "今天", "立刻"],
            },
          },
        },
      },
      mix: {
        label: "中英混雜",
        payload: {
          state: "客戶 message：我的 order 在 last week 被 charged 了兩次（double charge），nobody 回覆我，請尽速處理。",
          questions: TICKET_MIX_QUESTIONS,
        },
      },
    },
  },
  {
    id: "moderation",
    title: "內容審核（choice + score）",
    variants: {
      en: {
        label: "純英文",
        payload: {
          state: "User comment: Your product is garbage, I want a refund now, this is the worst experience ever!!!",
          questions: MODERATION_EN_QUESTIONS,
        },
      },
      zh: {
        label: "純中文",
        payload: {
          state: "使用者留言：你們的產品根本是垃圾，我要立刻退款，這是我遇過最糟的消費體驗！！！",
          questions: {
            category: {
              type: "choice",
              instructions: "這則留言屬於哪個類別？",
              criteria: {
                spam: "廣告、促銷、連結",
                abuse: "侮辱、騷擾、威脅",
                complaint: "對產品或服務的負面回饋",
                praise: "正面回饋",
                question: "詢問資訊",
              },
            },
            severity: {
              type: "score",
              instructions: "這則留言的嚴重程度如何？",
              criteria: ["沒有問題", "輕微", "嚴重", "重大"],
            },
          },
        },
      },
      mix: {
        label: "中英混雜",
        payload: {
          state: "使用者留言：你們的 product 根本是 garbage，我要立刻 refund，這是我遇過最糟的 consumer experience！！！",
          questions: MODERATION_MIX_QUESTIONS,
        },
      },
    },
  },
  {
    id: "agent",
    title: "Agent 步驟自評（noul）",
    variants: {
      en: {
        label: "純英文",
        payload: {
          state: "Agent step: ran `git push origin main`. Output: Everything up-to-date. No errors reported.",
          questions: AGENT_EN_QUESTIONS,
        },
      },
      zh: {
        label: "純中文",
        payload: {
          state: "Agent 步驟：執行了 `git push origin main`。輸出：Everything up-to-date。未回報任何錯誤。",
          questions: {
            succeeded: { type: "noul", instructions: "這個步驟達成目標了嗎？" },
            needs_human: { type: "noul", instructions: "這個步驟在繼續之前需要人工審查嗎？" },
          },
        },
      },
      mix: {
        label: "中英混雜",
        payload: {
          state: "Agent 步驟：執行了 `git push origin main`，Output 顯示 Everything up-to-date，沒有出現任何 error。",
          questions: AGENT_MIX_QUESTIONS,
        },
      },
    },
  },
];

/* 非語言測試用的附加範例（state 模式展示，主測試台預設選單用） */
const EXTRA_PRESETS = [
  {
    name: "多輪對話 state（messages 模式）",
    payload: {
      state: [
        { role: "user", content: "My parcel was supposed to arrive Tuesday and it is still not here." },
        { role: "assistant", content: "I am sorry, let me check the tracking for you." },
        { role: "user", content: "Fine, but I need it before the weekend." },
      ],
      questions: {
        topic: {
          type: "choice",
          instructions: "What is this conversation about?",
          criteria: { delivery: null, billing: null, account: null, other: null },
        },
      },
    },
  },
];
