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

## worker-send 投遞行為

- 保留既有通用 payload 格式：`messageId`、`from`、`to`、`headers`、`textPreview`、`rawBase64`、`receivedAt`
- 吸收 issue #7 參考倉庫的優點：
  - 支援多個 webhook 目標
  - 支援 timeout 控制
  - 支援部分成功 / 部分失敗的投遞結果紀錄
- 若多個 webhook 中至少一個成功，worker 視為本次投遞成功
