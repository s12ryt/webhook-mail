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

- `DOCKER_ACCEPT_WEBHOOK_URL`：要接收郵件事件的 webhook 端點
- `WEBHOOK_SHARED_SECRET`：選填，若有設定會在 request header 帶上 `x-webhook-secret`

## docker-accept 環境變數

- `PORT`：服務埠號，預設 `3000`
- `WEBHOOK_SHARED_SECRET`：選填，若有設定則 webhook 需帶上相同 secret 才會接受
