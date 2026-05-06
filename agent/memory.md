# memory

- 倉庫初始狀態為空，只有 `.git/`。
- issue #1 要求同時完成 mail 接收 worker 與 webhook 接收服務。
- 使用者明確要求推送 PR 到 `s12ryt/webhook-mail`。
- 本次實作選擇 monorepo 方式，用 npm workspaces 管理 `worker-send` 與 `docker-accept`。
