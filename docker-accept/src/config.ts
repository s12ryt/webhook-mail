import type { GitHubStorageInput, StorageMode } from "./storage.js";

export type RuntimeConfig = {
  port: number;
  sharedSecret?: string;
  adminBootstrapPassword: string;
  mysqlConnection: string;
  postgresConnection: string;
  githubStorageInput: GitHubStorageInput;
  githubConnection: string;
  storageMode: StorageMode;
};

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

  return {
    port: Number(process.env.PORT ?? 3000),
    sharedSecret: process.env.WEBHOOK_SHARED_SECRET,
    adminBootstrapPassword: process.env.ADMIN_INITIAL_PASSWORD ?? "change-me-now",
    mysqlConnection: process.env.MYSQL_URL ?? "",
    postgresConnection: process.env.POSTGRES_URL ?? "",
    githubStorageInput,
    githubConnection: buildGitHubConnection(githubStorageInput),
    storageMode
  };
}
