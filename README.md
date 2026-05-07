# webhook-mail

依照 issue #1 建立的雙端專案：

- `worker-send/`：Cloudflare Email Worker，負責接收郵件事件並轉送 webhook 到 `docker-accept`
- `docker-accept/`：TypeScript + Express 服務，負責接收 webhook、提供黑藍風格可視化介面，並可包成 Docker 映像

## 專案結構

```text
.
├─ worker-send/
├─ docker-accept/
├─ web-ui/
├─ single-file/
├─ agent/
└─ .github/workflows/
```

## 本地使用

### 安裝

```bash
npm install
```

### 建置全部

```bash
npm run build
```

### 啟動 docker-accept

```bash
npm run dev -w docker-accept
```

### 開發 worker-send

```bash
npm run dev -w worker-send
```

## 單文件部署

若不想使用完整 TypeScript / Docker 專案，`single-file/` 另外提供 issue #12 要求的單文件部署版本：

- `single-file/python/webhook_mail.py`：Python 3.10+，無額外依賴
- `single-file/node/webhook-mail.js`：Node.js 18+，無額外依賴
- `single-file/java/WebhookMail.java`：JDK 17+，可直接 `java WebhookMail.java`

這三個版本都內建簡易黑藍控制台、登入、管理員建立普通用戶、`/api/webhooks/email` 接收端與本地 JSON 持久化。詳細啟動方式請看 [`single-file/README.md`](single-file/README.md)。

## 共用 web-ui 與熱更新

issue #17 將 Docker 版與單文件版的控制台 HTML 統一改為載入 `web-ui/`：

- `web-ui/manifest.json`：宣告版本與要下載的檔案
- `web-ui/index.html`：共用 HTML shell
- `web-ui/style.css`：完整黑藍風格樣式
- `web-ui/app.js`：前端渲染登入頁與控制台

Docker 版與 `single-file/` 的 Python / Node.js / Java 版都會定期從 raw GitHub URL 拉取 `web-ui` 並寫入本機快取，不需要重啟服務就能套用新的 HTML/CSS/JS。若遠端不可用，會優先使用既有快取，最後才退回內建精簡 HTML。

### 單文件快速啟動

三個單文件版本都可使用相同的基礎環境變數：

```bash
PORT=3000
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=change-this-password
WEBHOOK_SHARED_SECRET=your-shared-secret
DATA_FILE=webhook-mail.json
```

依照想使用的語言啟動：

```bash
# Python 3.10+
python single-file/python/webhook_mail.py

# Node.js 18+
node single-file/node/webhook-mail.js

# JDK 17+
java single-file/java/WebhookMail.java
```

單文件版本只使用標準庫或內建模組，不需要額外安裝依賴；資料會寫入本地 JSON 檔。若需要 MySQL、Postgres 或 GitHub 持久化後端，請使用完整的 `docker-accept/` TypeScript 版本。

## worker-send 環境變數

- `DOCKER_ACCEPT_WEBHOOK_URL`：要接收郵件事件的 webhook 端點；支援以逗號分隔多個 URL
- `WEBHOOK_SHARED_SECRET`：選填，若有設定會在 request header 帶上 `x-webhook-secret`
- `WEBHOOK_TIMEOUT_MS`：選填，worker 投遞 webhook 的 timeout，預設 `10000`

## docker-accept 環境變數

- `PORT`：服務埠號，預設 `3000`
- `WEBHOOK_SHARED_SECRET`：選填，若有設定則 webhook 需帶上相同 secret 才會接受
- `ADMIN_INITIAL_USERNAME`：管理員首次登入使用的初始帳號，預設 `admin`
- `ADMIN_INITIAL_PASSWORD`：管理員首次登入使用的初始密碼，預設 `change-me-now`
- `MYSQL_URL`：選填，MySQL 持久化連線字串；與 `POSTGRES_URL`、`GITHUB_*` 三選一
- `POSTGRES_URL`：選填，Postgres 持久化連線字串；與 `MYSQL_URL`、`GITHUB_*` 三選一
- `GITHUB_URL`：選填，GitHub 持久化倉庫網址；若未提供 `GITHUB_OWNER` / `GITHUB_REPO`，系統會嘗試從這個 URL 解析
- `GITHUB_TOKEN`：GitHub 持久化必填 token
- `GITHUB_OWNER`：選填，GitHub 倉庫 owner
- `GITHUB_REPO`：選填，GitHub 倉庫名稱
- `GITHUB_BRANCH`：選填，GitHub 持久化分支，預設 `main`
- `GITHUB_PATH`：選填，GitHub 持久化基底路徑，預設 `mail-events`
- `WEB_UI_RAW_BASE`：選填，web-ui raw 檔案基底 URL，預設 `https://raw.githubusercontent.com/s12ryt/webhook-mail/main/web-ui`
- `WEB_UI_REFRESH_SECONDS`：選填，web-ui 熱更新檢查間隔秒數，預設 `30`
- `WEB_UI_CACHE_DIR`：選填，web-ui 快取目錄，預設 `.web-ui-cache`

### docker-accept 持久化模式

- `MYSQL_URL`、`POSTGRES_URL`、`GITHUB_*` 採 **三選一**，不能同時設定
- 若設定 `MYSQL_URL`，`docker-accept` 會把 **郵件、帳號、session** 都寫入 MySQL
- 若設定 `POSTGRES_URL`，`docker-accept` 會把 **郵件、帳號、session** 都寫入 Postgres
- 若設定 `GITHUB_*`，`docker-accept` 會把 **郵件、帳號、session** 都寫成 GitHub JSON 檔案
- 若三者都沒設定，服務仍可啟動，但會退回 **記憶體模式**
- 服務啟動時會自動建立需要的資料表或資料夾結構
- 使用者密碼以 **scrypt 雜湊** 形式儲存；若既有舊明文密碼，登入成功後會自動升級成雜湊格式

### docker-accept 環境變數範例

```bash
PORT=3000
WEBHOOK_SHARED_SECRET=your-shared-secret
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=change-this-password
MYSQL_URL=mysql://user:password@host:3306/dbname
```

若要改用 Postgres，請改成：

```bash
POSTGRES_URL=postgres://user:password@host:5432/dbname
```

若要改用 GitHub，請改成：

```bash
GITHUB_URL=https://github.com/your-name/your-repo
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-name
GITHUB_REPO=your-repo
GITHUB_BRANCH=main
GITHUB_PATH=mail-events
```

### GitHub 持久化格式

- 每筆資料都以 **JSON** 儲存
- 郵件、帳號、session 都會各自寫成獨立 JSON 檔
- GitHub 作為持久化後端時，`docker-accept` 不再只是「上傳附加功能」，而是與 MySQL / Postgres 並列的正式儲存方案

## worker-send 投遞行為

- 保留既有通用 payload 格式：`messageId`、`from`、`to`、`headers`、`textPreview`、`rawBase64`、`receivedAt`
- 吸收 issue #7 參考倉庫的優點：
  - 支援多個 webhook 目標
  - 支援 timeout 控制
  - 支援部分成功 / 部分失敗的投遞結果紀錄
- 若多個 webhook 中至少一個成功，worker 視為本次投遞成功
