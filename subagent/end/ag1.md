# ag1 完工回報（issue #24）

## 已完成內容

### 1) 建立 Release 自動化流程

新增檔案：`.github/workflows/publish-release.yml`

- 觸發條件：push 符合 `v*` 的 tag（例如 `v0.2.0`）
- 權限：`contents: write`
- 行為：使用 `softprops/action-gh-release@v2` 自動建立 GitHub Release
- Release notes：啟用 `generate_release_notes: true`

這讓專案具備可重複的正式版本發布流程，不再只有程式碼分支而沒有版本基準。

### 2) README 補上版本發布與最新版本辨識規則

更新檔案：`README.md`

新增章節：`版本發布（Releases）`，內容包含：

- 正式 tag 命名規則：`vX.Y.Z`
- push tag 後自動建立 Release
- 如何判斷最新穩定版：以 GitHub **Latest Release** 為準
  - Releases 頁面：<https://github.com/s12ryt/webhook-mail/releases>
  - Latest API：<https://api.github.com/repos/s12ryt/webhook-mail/releases/latest>
- fallback 規則：若尚未有 Release，才參考 `package.json` 版本
- 發版步驟示例（`git tag` / `git push origin <tag>`）

這直接回應「沒有 Releases 無法確定當前最新版本」的痛點。

### 3) Agent 紀錄同步更新

已更新：

- `agent/deep_todos.md`
- `agent/memory.md`
- `agent/項目表.md`

補上本次 issue #24 的處理紀錄與 workflow 用途。

## 驗收對照

- [x] 建立 GitHub Releases 發佈流程
- [x] 每個正式版本對應 tag（`v*`）
- [x] README 可看出最新版本來源
- [x] tag push 後可自動建立 Release
- [x] 外部使用者可直接依 Latest Release 判斷版本，不需猜測

## 操作提醒

目前 workflow 已就緒；當你推送第一個版本 tag（例如 `v0.1.0` 或 `v0.2.0`）後，GitHub 才會出現第一個 Release。
