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

> 注意：單文件版本主打「快速部署」，儲存層使用本地 JSON 檔，不包含主專案 TypeScript 版的 MySQL / Postgres / GitHub 儲存後端。

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
