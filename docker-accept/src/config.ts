import { randomBytes } from "node:crypto";

import type { GitHubStorageInput, StorageMode } from "./storage.js";

export type RuntimeConfig = {
  port: number;
  sharedSecret?: string;
  adminBootstrapUsername: string;
  adminBootstrapPassword: string;
  adminBootstrapCreatedAt: string;
  mysqlConnection: string;
  postgresConnection: string;
  githubStorageInput: GitHubStorageInput;
  githubConnection: string;
  storageMode: StorageMode;
  webUi: {
    rawBase: string;
    refreshSeconds: number;
    cacheDir: string;
  };
};

function generateBootstrapPassword(): string {
  return randomBytes(24).toString("base64url");
}

function normalizeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((segment) => segment.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function buildGitHubConnection(input: GitHubStorageInput): string {
  const explicitUrl = String(input.url ?? "").trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const owner = String(input.owner ?? "").trim();
  const repo = String(input.repo ?? "").trim();
  const branch = String(input.branch ?? "main").trim() || "main";
  const path = normalizeGitHubPath(String(input.path ?? "mail-events"));

  if (!owner || !repo) {
    return "";
  }

  return `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
}

export function loadRuntimeConfig(storageMode: StorageMode): RuntimeConfig {
  const githubStorageInput: GitHubStorageInput = {
    url: process.env.GITHUB_URL ?? "",
    token: process.env.GITHUB_TOKEN ?? "",
    owner: process.env.GITHUB_OWNER ?? "",
    repo: process.env.GITHUB_REPO ?? "",
    branch: process.env.GITHUB_BRANCH ?? "main",
    path: process.env.GITHUB_PATH ?? "mail-events"
  };

  const generatedAdminPassword = process.env.ADMIN_INITIAL_PASSWORD ? "" : generateBootstrapPassword();
  const adminBootstrapCreatedAt = new Date().toISOString();

  return {
    port: Number(process.env.PORT ?? 3000),
    sharedSecret: process.env.WEBHOOK_SHARED_SECRET,
    adminBootstrapUsername: process.env.ADMIN_INITIAL_USERNAME ?? "admin",
    adminBootstrapPassword: process.env.ADMIN_INITIAL_PASSWORD ?? generatedAdminPassword,
    adminBootstrapCreatedAt,
    mysqlConnection: process.env.MYSQL_URL ?? "",
    postgresConnection: process.env.POSTGRES_URL ?? "",
    githubStorageInput,
    githubConnection: buildGitHubConnection(githubStorageInput),
    storageMode,
    webUi: {
      rawBase: process.env.WEB_UI_RAW_BASE ?? "https://raw.githubusercontent.com/s12ryt/webhook-mail/main/web-ui",
      refreshSeconds: Number(process.env.WEB_UI_REFRESH_SECONDS ?? 30),
      cacheDir: process.env.WEB_UI_CACHE_DIR ?? ".web-ui-cache"
    }
  };
}
