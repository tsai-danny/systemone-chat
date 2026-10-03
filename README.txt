SystemOne 決策模型測試台
================================

開始使用
  用瀏覽器開啟根目錄的 index.html（會自動進入測試台）。

先決條件
  需要 llama-server 在線（預設 http://localhost:8080/v1/systemone）。
  啟動範例：
      llama serve -hf ggml-org/Julia-1-GGUF
  測中文請用 Julia-1 或 OpenJev（Laya / Kev-4B / lev 僅英文）。
  頁面右上角狀態燈顯示「上線」即代表可用。

目錄
  index.html   單一進入點（啟動跳轉頁）
  spa\         測試台與語言能力檢測台（HTML/JS/CSS）
  docs\        使用手冊、端點規格、模型能力測試報告

文件
  docs\user_manual.md                      新手上手（建議先讀）
  docs\user_manual.html                    同上（瀏覽器版）
  docs\systemone_api.md                    端點規格
  docs\model_capability_test_report.md     模型能力測試報告

自存預設與歷史紀錄存在瀏覽器 localStorage（file:// 下以檔案路徑為範圍）。
