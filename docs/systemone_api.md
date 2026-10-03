# SystemOne API 規格 — `POST /v1/systemone`

> 本文件整理 llama.cpp HTTP server 的 **TypeSafe-compatible System One API**（`/v1/systemone`），
> 用於本地相容端點 `http://localhost:8080/v1/systemone`。
> 來源：llama.cpp `tools/server/README.md`（TypeSafe-compatible API Endpoints 章節）、
> [PR #29818](https://github.com/ggml-org/llama.cpp/pull/29818)、
> [HuggingFace 決策模型文章](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp)。

---

## 1. 端點總覽

| 項目 | 說明 |
|---|---|
| 方法 / 路徑 | `POST /v1/systemone` |
| 相容格式 | [TypeSafe System One API](https://docs.typesafe.ai/api)（Jev 模型格式）；既有 TypeSafe 客戶端只需換 base URL |
| 多模態擴充 | 遵循 [OpenJev multimodal API](https://jev-skills.github.io/openjev-multimodal/api) |
| 推理方式 | **單次 forward pass** 直接對選項打分，**不生成 token**（`output_tokens` 恆為 0） |
| Streaming | **不支援** |
| 內容類型 | `Content-Type: application/json` |
| CORS | llama.cpp server 預設開啟（`--cors-origins` / `--cors-methods` / `--cors-headers` / `--cors-credentials`）。預設 `--cors-origins` 為 `*` 且 credentials 啟用時，會 echo 回 Origin |
| 認證 | 若 server 以 `--api-key` 啟動，需 `Authorization: Bearer <key>` |

**決策模型 vs 聊天模型**：聊天模型每個輸出 token 一次 forward pass，輸出仍需解析；
決策模型讀取輸入一次，答案永遠是你給的選項之一，並附機率。典型用途：請求路由、內容審核、
檢查 agent 步驟是否成功、選擇下一步動作。

---

## 2. 請求規格

```json
{
  "model": "ggml-org/Kev-4B-GGUF",
  "state": "字串、物件或陣列",
  "images": ["data:image/png;base64,..."],
  "questions": {
    "qid": { "type": "choice | score | noul", "instructions": "...", "criteria": "..." }
  }
}
```

### 2.1 欄位總表

| 欄位 | 必填 | 型別 | 說明 |
|---|---|---|---|
| `state` | ✅ | string \| object \| array | 要評估的內容。**非字串**的值會以 JSON 文字餵給模型。也可為 chat messages 陣列（或含 `messages` 陣列的物件），其中 `image_url` part 視為圖片（僅接受 data URL）。 |
| `images` | ❌ | array\<string\> | 圖片陣列，每個皆為 **data URL**（`data:image/...;base64,...`）。最大數量依模型而異。見 §2.3。 |
| `model` | ❌ | string | **僅 router 模式**使用（多模型 server 依此路由）。單模型模式下被忽略。id 由 `GET /v1/models` 取得。 |
| `questions` | ✅ | object | 問題 id → 問題定義的映射，**不可為空**。見 §2.2。 |

### 2.2 `questions` 結構

`questions` 為物件，key 為自訂問題 id（任意字串），value 為問題定義：

| 欄位 | 必填 | 型別 | 說明 |
|---|---|---|---|
| `type` | ✅ | string | `"choice"` \| `"score"` \| `"noul"`。未知 type → **400**。 |
| `instructions` | ✅ | string \| object \| array | 問題本身。 |
| `criteria` | 依 type | 見下 | 可能答案，形狀取決於 `type`。 |

**`criteria` 依 type 的形狀：**

| type | criteria 形狀 | 限制 |
|---|---|---|
| `choice` | 物件 `{ option: description }`，description 可為 `null` | **空物件 → 400**。選項數量受模型上限限制（例：openjev **52**、laya **255**）。laya 會把過長的問題/選項截斷至訓練 token 預算。 |
| `score` | 陣列，**2–10 個**等級描述，**由最低等級排到最高** | 僅 1 個元素 → **400**；超過 10 個 → 400。 |
| `noul` | 選填物件 `{ "true": desc, "false": desc }` | 可省略。 |

> 同一請求中的問題**彼此獨立**回答，一個答案不依賴其他問題。
> Kev-4B、lev、OpenJev 對 `state` 只處理一次（共享 prompt 前綴），建議**批量提問**。

### 2.3 圖片輸入

- 需要**支援圖片的模型**（目前：OpenJev）及其 **multimodal projector**（`--mmproj`；用 `-hf` 啟動時會自動下載）。
- 圖片可**兩種方式並用**於同一請求：
  1. `images` 欄位。
  2. `state` 為 chat messages（陣列，或含 `messages` 陣列的物件），message `content` 中的
     `image_url` part 視為圖片，格式同 chat completions。**僅接受 data URL**。
- **所有圖片排在 state 之前**進入 prompt，`images` 欄位的圖片排最前；state 中的 image parts 會被移除。
- 非 data URL → **400**；數量超過模型上限 → **400**；模型不支援圖片或未載入 mmproj → **501**。

---

## 3. 回應規格（HTTP 200）

```json
{
  "model": "模型 id",
  "answers": { "<qid>": { ... } },
  "usage": { "input_tokens": 239, "output_tokens": 0 }
}
```

- `answers`：問題 id → 答案的映射，答案欄位依問題 type：

**`choice` 答案**

| 欄位 | 說明 |
|---|---|
| `type` | `"choice"` |
| `choice` | **機率最高**的選項 |
| `probabilities` | 每個選項的機率，**總和為 1** |
| `confidence` | 0–1；0 代表所有選項機率相同 |

**`score` 答案**

| 欄位 | 說明 |
|---|---|
| `type` | `"score"` |
| `score` | **期望等級索引**（按機率加權，$score = \sum_i i \cdot p_i$），**可落在兩等級之間**（小數） |
| `legend` | 每個等級索引的描述，如 `{"0": "can wait", "1": "this week", ...}` |
| `probabilities` | 每個等級索引的機率，**總和為 1**（key 為 `"0"`,`"1"`,…） |
| `confidence` | 0–1 |

**`noul` 答案**

| 欄位 | 說明 |
|---|---|
| `type` | `"noul"` |
| `noul` | 答案為 **true 的機率**（0–1） |

- `usage.input_tokens`：**所有問題**的 prompt tokens 總數；`usage.output_tokens` **恆為 0**。

> ⚠️ 機率以**模型檔案內儲存的 temperature** 縮放，**不保證**對你的資料校準。
> 實務上常見模式：對高 confidence 的答案自動處理，其餘交人工；confidence 閾值需**按模型自測**
> （例：模糊工單 Julia-1 得 0.25，Kev-4B 得 0.80）。

---

## 4. 錯誤規格

錯誤一律採 OAI 格式：

```json
{ "error": { "code": 400, "message": "...", "type": "invalid_request_error" } }
```

| HTTP | 觸發條件 |
|---|---|
| **400** `invalid_request_error` | 無效請求：缺 `state` 或 `questions`、`questions` 為空、未知 `type`、缺 `instructions`、`choice` 的 criteria 為空物件、`score` criteria 少於 2 級、`images` 非 data URL、圖片數量超過模型上限 |
| **501** `not_supported_error` | 載入的模型**不是決策模型**；或請求含圖片但模型**不支援圖片輸入**、或**未載入 multimodal projector** |
| 503 | 模型仍在載入中（`/health` 亦同） |

---

## 5. 支援的決策模型

| 模型 | 規模 | Base | 語言 | Vision | 授權 | 延時* | GGUF repo |
|---|---|---|---|---|---|---|---|
| Julia-1 | 144M | mmBERT-small | 50+ | ❌ | Apache 2.0 | 3 ms | `ggml-org/Julia-1-GGUF` |
| Laya | 421M | ModernBERT-large | English | ❌ | Apache 2.0 | 5 ms | `ggml-org/Laya-GGUF` |
| Kev-4B | 4B | Qwen3.5-4B-Base | English | ❌ | Apache 2.0 | 12 ms | `ggml-org/Kev-4B-GGUF` |
| lev | 4B | Qwen3.5-4B | English | ❌ | Apache 2.0 | 36 ms | `ggml-org/lev-GGUF` |
| OpenJev | 27B | Qwen3.8-27B | en, de, fr, hi, zh, ja | ✅ | CC BY-NC 4.0 | 43 ms | `ggml-org/OpenJev-GGUF` |

\* 單題中位延時，NVIDIA RTX PRO 6000。

- 啟動：`llama serve -hf ggml-org/Kev-4B-GGUF`（quant 預設 Q4_K_M，可加 `:Q8_0` 等）。
- 集合：[ggml-org/decision-models](https://huggingface.co/collections/ggml-org/decision-models)；
  比較：[Decision Index](https://multimodalart-jev-decision-index.static.hf.space/index.html)。
- 小模型較快、大模型較強；不同 quant 精度（如 `:Q8_0`）效果/速度不同。

---

## 6. Router 模式（多模型單一 server）

```shell
llama serve
curl http://localhost:8080/v1/systemone -H "Content-Type: application/json" \
  -d '{"model": "ggml-org/Julia-1-GGUF:Q8_0", "state": "...", "questions": {...}}'
```

- POST 端點以 body 的 `"model"` 欄位路由；GET 端點以 `?model=` query param 路由。
- `GET /v1/models` 列出可用 id；單模型模式下 `model` 欄位被忽略。

---

## 7. 完整範例

### 7.1 文字（客服工單路由）

```shell
curl http://localhost:8080/v1/systemone \
  -H "Content-Type: application/json" \
  -d '{
    "state": "Customer message: I was charged twice for my order last week and nobody has replied.",
    "questions": {
      "route": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": {
          "billing": "payments, charges, refunds, invoices",
          "shipping": "delivery, tracking, lost or late parcels",
          "technical": "bugs, errors, login problems"
        }
      },
      "angry":  { "type": "noul",  "instructions": "Is the customer angry?" },
      "urgency": {
        "type": "score",
        "instructions": "How urgent is this?",
        "criteria": ["can wait", "this week", "today", "right now"]
      }
    }
  }'
```

回應（數值四捨五入）：

```json
{
  "model": "ggml-org/Kev-4B-GGUF",
  "answers": {
    "route": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.9049, "shipping": 0.0275, "technical": 0.0676 },
      "confidence": 0.8574
    },
    "angry": { "type": "noul", "noul": 0.8208 },
    "urgency": {
      "type": "score",
      "score": 2.2821,
      "legend": { "0": "can wait", "1": "this week", "2": "today", "3": "right now" },
      "probabilities": { "0": 0.036, "1": 0.1937, "2": 0.2225, "3": 0.5478 },
      "confidence": 0.2821
    }
  },
  "usage": { "input_tokens": 130, "output_tokens": 0 }
}
```

### 7.2 圖片（文件分類，需 OpenJev）

```shell
curl http://localhost:8080/v1/systemone \
  -H "Content-Type: application/json" \
  -d '{
    "state": "A file uploaded by a customer.",
    "images": ["data:image/png;base64,<...>"],
    "questions": {
      "kind": {
        "type": "choice",
        "instructions": "What kind of document is this?",
        "criteria": { "invoice": null, "receipt": null, "contract": null, "other": null }
      }
    }
  }'
```

---

## 8. 使用提示

- **描述你的選項**：Julia-1 對「I was charged twice」在只有裸標籤時路由到 `shipping`；
  每個選項加上描述後正確路由到 `billing`（0.99）。
- **批量提問**：問題彼此獨立回答，Kev-4B / lev / OpenJev 只處理 state 一次。
- **confidence 閾值按模型自測**後再決定自動化 cutoff。
- **多試幾個模型與 quant**：小模型快、大模型強。

### 8.1 語言能力測試（三語範例）

內建情境各提供三種語言變體。三語比對功能已獨立至「模型語言能力檢測台」（`compare.html`，由測試台右上角「語言能力檢測」進入），可一鍵依序送出並比較：

| 變體 | 設計 | 目的 |
|---|---|---|
| 純英文（en） | state + instructions + criteria 全英文 | 基準線（對齊 §7.1 canonical） |
| 純中文（zh） | 三者全中文化 | 測模型完整中文提示的理解 |
| 中英混雜（mix） | **三者全混雜**：中文骨架＋英文關鍵字（欄位名／產品名／指令骨架保留英文） | 反映生產環境真實中文輸入（v1.1 修正：舊版僅 state 混雜，無法評估提示語言的影響） |

解讀方式（對照 §5 語言矩陣）：

- **Julia-1（50+ 語言）**、**OpenJev（en/de/fr/hi/zh/ja）**：三語欄位的 choice 選擇應一致、
  score/noul 偏移小 → 多語言能力強。
- **Laya / Kev-4B / lev（僅英文）**：中文欄位出現 choice 分歧、score/noul 偏移大、
  confidence 下降 → 語言能力受限，符合預期。
- **input_tokens 差異**：中文 token 數與英文的差距反映 tokenizer 的語言效率，
  也會影響 prompt 預算（laya 會截斷至訓練 token 預算）。

比對表判定門檻：choice 全同＝一致；score/noul 最大絕對差 ≤0.15 相近、≤0.35 輕微偏移、
>0.35 分歧。偵測連線時測試台會依 model id 標註官方語言支援（例：`Kev-4B（語言 僅英文⚠）`）。

## 9. 快速探測端點

| 端點 | 用途 |
|---|---|
| `GET /health` | 200 `{"status":"ok"}` 代表模型就緒；503 代表載入中 |
| `GET /v1/models` | 模型 id 與 metadata（router 模式列出全部） |
| `GET /props` | server 全域屬性，含 `modalities.vision`（判斷是否支援圖片） |

## 10. 參考來源

- llama.cpp server README — TypeSafe-compatible API Endpoints：
  <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- 實作 PR： <https://github.com/ggml-org/llama.cpp/pull/29818>
- 決策模型介紹： <https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp>
- TypeSafe API： <https://docs.typesafe.ai/api>
- OpenJev multimodal API： <https://jev-skills.github.io/openjev-multimodal/api>
