# memory

- 倉庫初始狀態為空，只有 `.git/`。
- issue #1 要求同時完成 mail 接收 worker 與 webhook 接收服務。
- 使用者明確要求推送 PR 到 `s12ryt/webhook-mail`。
- 本次實作選擇 monorepo 方式，用 npm workspaces 管理 `worker-send` 與 `docker-accept`。
- issue #3 要求 `docker-accept` 增加登入、管理員首次密碼、普通用戶只能由管理員建立，以及 MySQL / Postgres / GitHub 連線資訊展示。
- issue #7 提供 `wenfxl/openai-cpa-email` 作為 worker 參考來源，但該倉庫 `worker.js` 為混淆後程式且帶有非商用/保留註解限制，因此本專案只吸收設計思路，不直接複製原始碼。
