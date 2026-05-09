# memory

- 倉庫初始狀態為空，只有 `.git/`。
- issue #1 要求同時完成 mail 接收 worker 與 webhook 接收服務。
- 使用者明確要求推送 PR 到 `s12ryt/webhook-mail`。
- 本次實作選擇 monorepo 方式，用 npm workspaces 管理 `worker-send` 與 `docker-accept`。
- issue #3 要求 `docker-accept` 增加登入、管理員首次密碼、普通用戶只能由管理員建立，以及 MySQL / Postgres / GitHub 連線資訊展示。
- issue #7 提供 `wenfxl/openai-cpa-email` 作為 worker 參考來源，但該倉庫 `worker.js` 為混淆後程式且帶有非商用/保留註解限制，因此本專案只吸收設計思路，不直接複製原始碼。
- `docker-accept` 目前實際讀取的環境變數為 `PORT`、`WEBHOOK_SHARED_SECRET`、`ADMIN_INITIAL_USERNAME`、`ADMIN_INITIAL_PASSWORD`、`MYSQL_URL`、`POSTGRES_URL`、`GITHUB_URL`，README 需與此同步。
- `docker-accept` 已擴充 GitHub 郵件儲存功能；目前 GitHub 相關設定包含 `GITHUB_URL`、`GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_BRANCH`、`GITHUB_PATH`，其中私人倉庫上傳必須提供 `GITHUB_TOKEN`。
- `docker-accept` 現在的資料庫策略為 MySQL / Postgres 二選一；若兩者都未設定則退回記憶體模式，若兩者同時設定則啟動失敗以避免歧義。
- `docker-accept` 的密碼儲存目前採 scrypt 雜湊；為了兼容先前明文資料，登入驗證支援舊值，且成功登入後會自動將舊明文更新成雜湊。
- issue #12 要求 Python、Node.js、Java 都能單文件部署，最多再附一個依賴安裝文件；本次選擇全部使用標準庫/內建模組，放在 `single-file/`，以本地 JSON 檔替代完整 TypeScript 版的 MySQL/Postgres/GitHub 儲存後端。
- 使用者指出登入需要帳號與密碼，但先前只提供 `ADMIN_INITIAL_PASSWORD` 可設定；已補 `ADMIN_INITIAL_USERNAME`，預設仍為 `admin`，主 TypeScript 版與 single-file 三版都需同步支援。
- 2026-05-07 最新 main 檢查發現兩個實際 bug：`single-file/node/webhook-mail.js` 在驗證舊明文密碼時若輸入長度不同會因 `crypto.timingSafeEqual` 拋出 `RangeError`，已改為先檢查 buffer 長度；`single-file/java/WebhookMail.java` 宣稱 JDK 17+ 但使用 `Executors.newVirtualThreadPerTaskExecutor()`（JDK 21），已改為 JDK 17 可用的 `Executors.newCachedThreadPool()`。
- issue #17 的 UI 策略：新增根目錄 `web-ui/` 作為 Docker 版與 single-file 三版共用 UI；執行時依 `WEB_UI_RAW_BASE` 下載 `manifest.json` 指定檔案，依 `WEB_UI_REFRESH_SECONDS` 做 TTL 熱更新，寫入 `WEB_UI_CACHE_DIR`，若遠端/快取失敗才退回內建 fallback HTML。
- issue #20 安全/可靠性修正方向：GitHub 郵件事件檔名需含 `randomUUID()` 避免同毫秒覆寫；`docker-accept` webhook secret 以 `timingSafeEqual` 比對；未設定 `ADMIN_INITIAL_PASSWORD` 時只在首次建立 admin 帳號時印出強隨機 bootstrap 密碼；記憶體模式預設保留 1000 封並支援 `MEMORY_EVENT_LIMIT`；worker 預設 webhook timeout 調為 30000ms。
- issue #22 細節補強：`secureCompare` 先將兩側輸入做 SHA-256 digest 再使用 `timingSafeEqual`，避免比較前因長度不同提早返回；bootstrap 密碼只存在首次啟動 log，README 需提醒部署者保存 log 或立即登入更換；GitHub Storage 近期郵件列表依 JSON `storedAt` / `receivedAt` 排序，舊檔名與新 randomUUID 檔名可並存。
- issue #24 針對「沒有 Releases 無法判斷最新版本」：已新增 tag 觸發的 Release workflow（`.github/workflows/publish-release.yml`，push `v*` 自動建立 Release 並產生 notes），README 新增版本發布章節，明確以 GitHub Latest Release 為穩定版來源；若尚無 Release 才退回 `package.json` 版本。
