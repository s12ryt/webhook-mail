# deep_todos

## 需求拆解

1. 建立 `worker-send`，用 Cloudflare Email Worker 接收郵件事件。
2. 將郵件摘要、標頭與原始內容轉成 webhook payload，送往 `docker-accept`。
3. 建立 `docker-accept` 的 TypeScript 服務與黑藍色 HTML 介面。
4. 提供 Dockerfile 與雲端可用的 GitHub Actions Docker 建置流程。
5. 完成本地 build 驗證、建立 branch、push 並開 PR。

## 執行紀錄

- 2026-05-06：根據 issue #1 從空倉庫初始化整個專案。
- 2026-05-06：開始處理 issue #3，將 `docker-accept` 擴充為具登入機制與用戶管理的黑藍風格控制台。
- 2026-05-06：處理 issue #7，參考 `wenfxl/openai-cpa-email` 的思路，但不直接複製受限制/混淆程式碼；為 `worker-send` 補上多 webhook URL、timeout 與較清楚的投遞結果紀錄。
