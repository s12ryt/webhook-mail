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
- 2026-05-06：補充 `README.md` 中 `docker-accept` 可用的環境變數說明與範例，與目前 `server.ts` 實作保持一致。
- 2026-05-06：依使用者要求為 `docker-accept` 實作 GitHub 郵件 JSON 自動上傳，支援私人倉庫所需的 `GITHUB_TOKEN` 與目標倉庫/分支/路徑設定。
- 2026-05-06：依使用者要求為 `docker-accept` 補上真正的資料庫儲存層，支援 MySQL 或 Postgres 二選一，並把郵件、帳號、session 全部持久化。
- 2026-05-06：將 `docker-accept` 帳號密碼改為以 scrypt 雜湊儲存，並相容舊明文資料於登入成功後自動升級。
- 2026-05-06：開始處理 issue #12，新增 `single-file/` 單文件部署版本，涵蓋 Python、Node.js、Java 三種獨立執行服務。
- 2026-05-06：依使用者回饋補上 `ADMIN_INITIAL_USERNAME`，讓初始管理員帳號與密碼都可透過環境變數設定。
- 2026-05-07：拉取最新 `main` 後檢查 bug，發現並修正 Node 單文件舊明文密碼比較可能丟出 `RangeError`、Java 單文件誤用 JDK 21 virtual thread API 導致不符合文件宣稱的 JDK 17+。
- 2026-05-07：處理 issue #17，新增共用 `web-ui/`（manifest、HTML shell、CSS、JS），讓 `docker-accept` 與 Python/Node.js/Java 單文件版都透過 raw GitHub + 本機快取熱更新完整黑藍 UI，失敗時退回內建精簡頁面。
- 2026-05-07：開始處理 issue #20，修正 GitHub 儲存郵件檔名碰撞、提升記憶體事件保留上限並記錄淘汰警告、將 `docker-accept` 未設定初始密碼時改為產生強隨機 bootstrap 密碼、將 webhook secret 比對改為安全比較、把 worker 預設 timeout 提高到 30 秒。
