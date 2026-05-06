# memory

- 倉庫初始狀態為空，只有 `.git/`。
- issue #1 要求同時完成 mail 接收 worker 與 webhook 接收服務。
- 使用者明確要求推送 PR 到 `s12ryt/webhook-mail`。
- 本次實作選擇 monorepo 方式，用 npm workspaces 管理 `worker-send` 與 `docker-accept`。
- issue #3 要求 `docker-accept` 增加登入、管理員首次密碼、普通用戶只能由管理員建立，以及 MySQL / Postgres / GitHub 連線資訊展示。
- issue #7 提供 `wenfxl/openai-cpa-email` 作為 worker 參考來源，但該倉庫 `worker.js` 為混淆後程式且帶有非商用/保留註解限制，因此本專案只吸收設計思路，不直接複製原始碼。
- `docker-accept` 目前實際讀取的環境變數為 `PORT`、`WEBHOOK_SHARED_SECRET`、`ADMIN_INITIAL_PASSWORD`、`MYSQL_URL`、`POSTGRES_URL`、`GITHUB_URL`，README 需與此同步。
- `docker-accept` 已擴充 GitHub 郵件儲存功能；目前 GitHub 相關設定包含 `GITHUB_URL`、`GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_BRANCH`、`GITHUB_PATH`，其中私人倉庫上傳必須提供 `GITHUB_TOKEN`。
- `docker-accept` 現在的資料庫策略為 MySQL / Postgres 二選一；若兩者都未設定則退回記憶體模式，若兩者同時設定則啟動失敗以避免歧義。
- `docker-accept` 的密碼儲存目前採 scrypt 雜湊；為了兼容先前明文資料，登入驗證支援舊值，且成功登入後會自動將舊明文更新成雜湊。
