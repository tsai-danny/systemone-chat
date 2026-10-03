# SystemOne 決策模型測試台

> 一個讓 AI 決策模型**做選擇題**的純靜態測試台：送出一段內容＋問題，模型以**單次 forward pass** 直接回傳「答案＋信心程度」，**不生成任何 token**。

對應端點：llama.cpp 的 `POST /v1/systemone`（[TypeSafe-compatible System One API](https://docs.typesafe.ai/api)）。
無建置、無依賴、無後端——用瀏覽器直接開啟即可。

## 快速開始

1. 啟動 llama-server（需支援 `/v1/systemone` 的決策模型）：

   ```
   llama serve -hf ggml-org/Julia-1-GGUF
   ```

   > 測中文請用 **Julia-1** 或 **OpenJev**（Laya / Kev-4B / lev 僅英文）。

2. 用瀏覽器開啟根目錄 [`index.html`](index.html)（啟動頁，會自動進入測試台）。
3. 頁面右上角狀態燈顯示「**上線**」即代表可用（預設位址 `http://localhost:8080/v1/systemone`）。
4. 選「入門：choice 基本型」預設範例 → 按**送出請求** → 右側即見結果。

## 三個工具

| 檔案 | 用途 |
|---|---|
| [`index.html`](index.html) | 單一進入點（啟動跳轉頁） |
| [`spa/index.html`](spa/index.html) | **測試台**：自己組問題、送出、看結果，可儲存自訂預設 |
| [`spa/compare.html`](spa/compare.html) | **語言能力檢測台**：同一情境用英文／中文／混雜各測一次，比一致性（Δ） |

問題三種題型：

- **choice** 選擇題 → 回選項＋機率（總和＝1）
- **score** 評分題 → 回加權分數（等級由低到高排，2–10 級）
- **noul** 是非題 → 回「是」的機率

## 目錄

```
index.html   單一進入點（啟動跳轉頁）
spa\         測試台與語言能力檢測台（HTML/JS/CSS）
docs\        使用手冊、端點規格、模型能力測試報告
```

## 文件

| 文件 | 說明 |
|---|---|
| [`docs/user_manual.md`](docs/user_manual.md) | 新手上手使用手冊（**建議先讀**，另有 [`user_manual.html`](docs/user_manual.html) 瀏覽器版） |
| [`docs/systemone_api.md`](docs/systemone_api.md) | `POST /v1/systemone` 端點規格書 |
| [`docs/model_capability_test_report.md`](docs/model_capability_test_report.md) | 模型能力測試報告（Julia-1 / Laya / lev × 三語，另有 [`.html`](docs/model_capability_test_report.html) 版） |

## 注意事項

- 自存預設與歷史紀錄存在瀏覽器 `localStorage`（`file://` 下以檔案路徑為範圍）。
- 跨機連線需 llama-server 開啟 CORS（llama.cpp 預設開啟）。
- 若 server 以 `--api-key` 啟動，需 `Authorization: Bearer <key>`。

## 授權

Apache License 2.0 — 見 [`LICENSE`](LICENSE)。
