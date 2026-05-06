# webhook-mail

依照 issue #1 建立的雙端專案：

- `worker-send/`：Cloudflare Email Worker，負責接收郵件事件並轉送 webhook 到 `docker-accept`
- `docker-accept/`：TypeScript + Express 服務，負責接收 webhook、提供黑藍風格可視化介面，並可包成 Docker 映像

## 專案結構

```text
.
├─ worker-send/
├─ docker-accept/
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

## worker-send 環境變數

- `DOCKER_ACCEPT_WEBHOOK_URL`：要接收郵件事件的 webhook 端點；支援以逗號分隔多個 URL
- `WEBHOOK_SHARED_SECRET`：選填，若有設定會在 request header 帶上 `x-webhook-secret`
- `WEBHOOK_TIMEOUT_MS`：選填，worker 投遞 webhook 的 timeout，預設 `10000`

## docker-accept 環境變數

- `PORT`：服務埠號，預設 `3000`
- `WEBHOOK_SHARED_SECRET`：選填，若有設定則 webhook 需帶上相同 secret 才會接受
- `ADMIN_INITIAL_PASSWORD`：管理員首次登入使用的初始密碼，預設 `change-me-now`
- `MYSQL_URL`：選填，提供給控制台顯示 MySQL 連線資訊是否已設定
- `POSTGRES_URL`：選填，提供給控制台顯示 Postgres 連線資訊是否已設定
- `GITHUB_URL`：選填，可填 GitHub 倉庫網址；若未提供 `GITHUB_OWNER` / `GITHUB_REPO`，系統會嘗試從這個 URL 解析目標倉庫
- `GITHUB_TOKEN`：若要把郵件 JSON 自動上傳到 GitHub，必填；私人倉庫也需要此 token
- `GITHUB_OWNER`：選填，目標 GitHub 倉庫 owner；若未設定可由 `GITHUB_URL` 解析
- `GITHUB_REPO`：選填，目標 GitHub 倉庫名稱；若未設定可由 `GITHUB_URL` 解析
- `GITHUB_BRANCH`：選填，郵件 JSON 要寫入的分支，預設 `main`
- `GITHUB_PATH`：選填，郵件 JSON 在倉庫中的基底路徑，預設 `mail-events`

### docker-accept 資料庫行為

- `MYSQL_URL` 與 `POSTGRES_URL` 採 **二選一**，不能同時設定
- 若設定 `MYSQL_URL`，`docker-accept` 會把 **郵件、帳號、session** 都寫入 MySQL
- 若設定 `POSTGRES_URL`，`docker-accept` 會把 **郵件、帳號、session** 都寫入 Postgres
- 若兩者都沒設定，服務仍可啟動，但會退回 **記憶體模式**
- 服務啟動時會自動建立需要的資料表：`users`、`sessions`、`email_events`
- 使用者密碼目前會以 **scrypt 雜湊** 形式儲存，而非明文；若資料庫內已有舊的明文密碼，登入成功後會自動升級成雜湊格式

### docker-accept 環境變數範例

```bash
PORT=3000
WEBHOOK_SHARED_SECRET=your-shared-secret
ADMIN_INITIAL_PASSWORD=change-this-password
MYSQL_URL=mysql://user:password@host:3306/dbname
GITHUB_URL=https://github.com/your-name/your-repo
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-name
GITHUB_REPO=your-repo
GITHUB_BRANCH=main
GITHUB_PATH=mail-events
```

若要改用 Postgres，請改成：

```bash
POSTGRES_URL=postgres://user:password@host:5432/dbname
```

## GitHub 郵件儲存行為

- `docker-accept` 收到 webhook 後，會把每封郵件自動上傳為一份 JSON 到 GitHub 倉庫
- JSON 內容包含完整 webhook payload，例如：`messageId`、`from`、`to`、`headers`、`textPreview`、`rawBase64`、`receivedAt`
- 預設儲存路徑為：`mail-events/YYYY/MM/DD/<timestamp>-<messageId>.json`
- 若目標為私人倉庫，**必須提供 `GITHUB_TOKEN`**
- 若有設定 GitHub 上傳但缺少必要資訊，`/api/webhooks/email` 會回傳上傳失敗訊息
- 若完全沒有設定 GitHub 上傳相關變數，服務仍會接收 webhook，僅不會執行 GitHub 上傳

## worker-send 投遞行為

- 保留既有通用 payload 格式：`messageId`、`from`、`to`、`headers`、`textPreview`、`rawBase64`、`receivedAt`
- 吸收 issue #7 參考倉庫的優點：
  - 支援多個 webhook 目標
  - 支援 timeout 控制
  - 支援部分成功 / 部分失敗的投遞結果紀錄
- 若多個 webhook 中至少一個成功，worker 視為本次投遞成功
