# ag1：沒有 Releases，無法確定當前最新版本

## Issue 資訊

- Issue：[#24](https://github.com/s12ryt/webhook-mail/issues/24)
- 標題：沒有Releases無法確定當前最新版本
- 狀態：open
- 內容：只有一句話，沒有額外補充需求

## 目前觀察到的專案現況

目前這個倉庫已有：

- `package.json` 的專案版本：`0.1.0`
- GitHub Actions：只有 `docker-accept` 的 Docker build workflow
- 目前沒有看到任何 `release` 發佈流程
- 目前也沒有看到可供外部直接辨識「最新穩定版」的 Release 頁面或 tag 規範

這會導致：

- 使用者不知道目前應該下載哪個版本
- README / 文件無法清楚標示 stable release
- 若未來有部署包、單文件版或 Docker 映像，外部也不容易對應「最新可用版本」

## Issue 想解決的核心問題

### 核心痛點

> 沒有 Releases，因此無法確定目前最新版本是什麼。

也就是說，這個 issue 的重點不是功能本身，而是**版本發布與版本辨識機制**。

### 可能的預期結果

1. 專案應該有至少一個可辨識的 GitHub Release。
2. Release 應該對應到明確版本號，例如 `v0.1.0`、`v0.2.0`。
3. 文件或程式應可從 Release 推斷「最新版本」。
4. 若專案有下載連結、安裝說明、Docker 映像或單文件版本，應與 Release 綁定。

## 建議需求定義

### 必要需求

- 建立 GitHub Releases 發佈流程
- 每個正式版本都要有對應 tag
- README 要能清楚指出：
  - 目前最新 Release
  - 如何判斷穩定版
  - 如何下載或部署對應版本

### 可選需求

- 自動從 tag 產生 Release notes
- 在 README 加上 latest release 連結
- 若有 CLI / API / Docker image，可讓版本號與 Release 同步

## 建議驗收標準

- [ ] GitHub 上至少存在一個 Release
- [ ] Release tag 與專案版本一致或可追蹤
- [ ] README 可看出目前最新版本來源
- [ ] 若使用自動化流程，tag push 後可建立 Release
- [ ] 外部使用者不需要猜測版本

## 建議實作方向

### 方向 A：手動發佈 Release

適合目前需求簡單、版本發布頻率低的情況。

流程：

1. 更新 `package.json` 版本號
2. 建立 git tag，例如 `v0.1.0`
3. 在 GitHub 手動建立 Release
4. 在 Release 說明中列出變更摘要

優點：簡單、可控

缺點：人工步驟多，容易忘記同步

### 方向 B：Tag 自動建立 Release

較適合長期維護。

流程：

1. push `vX.Y.Z` tag
2. GitHub Actions 依 tag 自動建立 Release
3. Release notes 可用 changelog 或 commit 摘要生成

優點：版本管理一致、可自動化

缺點：需要補 workflow

### 方向 C：文件與程式都讀取「最新 Release」

若專案有 UI、下載器或安裝器，可以直接從 GitHub API 抓最新 Release。

優點：使用者看到的版本資訊永遠與 GitHub 同步

缺點：需處理 API rate limit、無網路 fallback、快取策略

## 參考程式碼範例

### 1. 透過 GitHub API 取得最新 Release

```ts
const response = await fetch('https://api.github.com/repos/s12ryt/webhook-mail/releases/latest', {
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'webhook-mail',
  },
});

if (!response.ok) {
  throw new Error(`Failed to load latest release: ${response.status}`);
}

const release = await response.json();
console.log(release.tag_name); // 例如：v0.1.0
console.log(release.name);     // Release 標題
console.log(release.html_url); // Release 頁面
```

### 2. 若沒有 Release，退回 package 版本

```ts
import pkg from './package.json' assert { type: 'json' };

const version = pkg.version;
console.log(`Current version: v${version}`);
```

### 3. GitHub Actions 發佈 Release 的概念範例

```yaml
name: publish-release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

## 文件應補充的內容

建議 README 增加一段：

- 目前最新版本連結
- Release tag 命名規則
- 如何從 Release 下載或部署
- 如果沒有 Release，應明確說明目前版本來源是 `package.json` 或 git tag

## 本 issue 的整理結論

這個 issue 的本質是：**專案缺少正式版本發布機制，導致外部無法判定最新穩定版。**

因此後續工作應優先補：

1. Release/tag 規範
2. 自動或手動發佈流程
3. README 的版本指引
4. 若有需要，再補程式端取得最新版本的方法
