# 單文件部署版本

issue #12 要求提供 Python、Node.js、Java 的「單文件部署」版本。這個資料夾提供三個不依賴原本 TypeScript build 流程的獨立 webhook 接收服務，適合只想快速起一個 `docker-accept` 輕量版的人使用。

## 功能範圍

三個版本都支援：

- `GET /health`：健康檢查與事件數量
- `GET /login` / `POST /login`：登入頁與登入
- `POST /logout`：登出
- `GET /`：黑藍風格簡易控制台
- `POST /api/webhooks/email`：接收郵件 webhook
- `POST /api/users`：管理員建立普通用戶
- `WEBHOOK_SHARED_SECRET`：若有設定，webhook 必須帶 `x-webhook-secret`
- `ADMIN_INITIAL_USERNAME`：管理員初始帳號，預設 `admin`
- `ADMIN_INITIAL_PASSWORD`：管理員初始密碼，預設 `change-me-now`
- `DATA_FILE`：JSON 持久化檔案路徑，未設定時各版本會使用自己的預設檔名
- `WEB_UI_RAW_BASE`：共用 `web-ui` raw 檔案基底 URL，預設 `https://raw.githubusercontent.com/s12ryt/webhook-mail/main/web-ui`
- `WEB_UI_REFRESH_SECONDS`：檢查 `web-ui` 更新的間隔秒數，預設 `30`
- `WEB_UI_CACHE_DIR`：下載後的 `web-ui` 快取目錄，預設 `.web-ui-cache`

> 注意：單文件版本主打「快速部署」，儲存層使用本地 JSON 檔，不包含主專案 TypeScript 版的 MySQL / Postgres / GitHub 儲存後端。

## 共用 HTML 與熱更新

issue #17 起，三個單文件版本不再只輸出內建精簡 HTML，而是會在請求頁面時定期下載倉庫的 `web-ui/manifest.json`、`index.html`、`style.css`、`app.js`，並以同一套黑藍完整 UI 渲染登入頁與控制台。

- 預設來源：`https://raw.githubusercontent.com/s12ryt/webhook-mail/main/web-ui`
- 預設快取：目前工作目錄下的 `.web-ui-cache/`
- 預設檢查間隔：30 秒
- 若網路或遠端檔案失敗，會使用本機快取；若連快取也不存在，才退回單文件內建精簡頁面。

## Python

檔案：`python/webhook_mail.py`

需求：Python 3.10+

```bash
cd single-file/python
python webhook_mail.py
```

可選環境變數：

```bash
PORT=3000
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=change-this-password
WEBHOOK_SHARED_SECRET=your-shared-secret
DATA_FILE=webhook-mail-python.json
WEB_UI_REFRESH_SECONDS=30
python webhook_mail.py
```

## Node.js

檔案：`node/webhook-mail.js`

需求：Node.js 18+

```bash
cd single-file/node
node webhook-mail.js
```

不需要 `npm install`，沒有額外依賴。

## Java

檔案：`java/WebhookMail.java`

需求：JDK 17+

Java 支援直接執行單一 `.java` 檔：

```bash
cd single-file/java
java WebhookMail.java
```

若想先編譯：

```bash
javac WebhookMail.java
java WebhookMail
```

## 測試 webhook

登入控制台：

- URL：`http://localhost:3000/login`
- 帳號：`ADMIN_INITIAL_USERNAME`，預設 `admin`
- 密碼：`ADMIN_INITIAL_PASSWORD`，預設 `change-me-now`

送測試事件：

```bash
curl -X POST http://localhost:3000/api/webhooks/email \
  -H "content-type: application/json" \
  -H "x-webhook-secret: your-shared-secret" \
  -d '{
    "event":"email.received",
    "messageId":"demo-1",
    "from":"sender@example.com",
    "to":["you@example.com"],
    "rawSize":123,
    "subject":"Hello",
    "headers":{},
    "textPreview":"This is a test mail",
    "rawBase64":"",
    "receivedAt":"2026-05-06T00:00:00.000Z"
  }'
```

若沒有設定 `WEBHOOK_SHARED_SECRET`，請移除 `x-webhook-secret` header。
