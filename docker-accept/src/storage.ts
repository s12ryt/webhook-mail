import mysql from "mysql2/promise";
import pg from "pg";

import type { EmailWebhookPayload, SessionRecord, UserAccount } from "./types.js";

export type StorageMode = "memory" | "mysql" | "postgres" | "github";

export type GitHubStorageInput = {
  url?: string;
  token?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
};

export type GitHubStorageConfig = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  displayUrl: string;
};

export type StorageAdapter = {
  mode: StorageMode;
  init(): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  createSession(sessionId: string, session: SessionRecord): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  ensureAdminAccount(username: string, password: string): Promise<UserAccount>;
  findUser(username: string): Promise<UserAccount | null>;
  updateUserPassword(username: string, password: string): Promise<void>;
  listUsers(): Promise<UserAccount[]>;
  countUsers(): Promise<number>;
  createUser(account: UserAccount): Promise<void>;
  storeEmailEvent(payload: EmailWebhookPayload): Promise<void>;
  listRecentEmailEvents(limit: number): Promise<EmailWebhookPayload[]>;
  countEmailEvents(): Promise<number>;
};

type DbKind = "mysql" | "postgres";

type StorageRow = {
  username: string;
  password: string;
  role: string;
  created_at: string;
};

type SessionRow = {
  username: string;
  role: string;
  created_at: string;
};

type EmailEventRow = {
  event: string;
  message_id: string;
  sender: string;
  recipients_json: string;
  raw_size: number;
  subject: string;
  headers_json: string;
  text_preview: string;
  raw_base64: string;
  received_at: string;
};

function mapUserRow(row: StorageRow): UserAccount {
  return {
    username: row.username,
    password: row.password,
    role: row.role === "admin" ? "admin" : "member",
    createdAt: row.created_at
  };
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    username: row.username,
    role: row.role === "admin" ? "admin" : "member",
    createdAt: row.created_at
  };
}

function mapEmailEventRow(row: EmailEventRow): EmailWebhookPayload {
  return {
    event: row.event,
    messageId: row.message_id,
    from: row.sender,
    to: safeParseArray(row.recipients_json),
    rawSize: Number(row.raw_size ?? 0),
    subject: row.subject,
    headers: safeParseRecord(row.headers_json),
    textPreview: row.text_preview,
    rawBase64: row.raw_base64,
    receivedAt: row.received_at
  };
}

function safeParseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function safeParseRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
  } catch {
    return {};
  }
}

function parseGitHubRepoUrl(value: string): { owner: string; repo: string } | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    return {
      owner: parts[0] ?? "",
      repo: (parts[1] ?? "").replace(/\.git$/i, "")
    };
  } catch {
    return null;
  }
}

function normalizeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((segment) => segment.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function normalizeGitHubSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function buildGitHubFilePath(...segments: string[]): string {
  return segments.filter(Boolean).map((segment) => normalizeGitHubSegment(segment)).join("/");
}

export function resolveGitHubStorageConfig(input: GitHubStorageInput): GitHubStorageConfig | null {
  const explicitUrl = String(input.url ?? "").trim();
  const parsed = parseGitHubRepoUrl(explicitUrl);
  const token = String(input.token ?? "").trim();
  const owner = String(input.owner ?? parsed?.owner ?? "").trim();
  const repo = String(input.repo ?? parsed?.repo ?? "").trim();
  const branch = String(input.branch ?? "main").trim() || "main";
  const path = normalizeGitHubPath(String(input.path ?? "mail-events")) || "mail-events";

  if (!token && !owner && !repo && !explicitUrl) {
    return null;
  }

  if (!token) {
    throw new Error("Missing GITHUB_TOKEN for GitHub storage");
  }

  if (!owner || !repo) {
    throw new Error("Missing GITHUB_OWNER / GITHUB_REPO (or a valid GITHUB_URL) for GitHub storage");
  }

  return {
    token,
    owner,
    repo,
    branch,
    path,
    displayUrl: explicitUrl || `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
  };
}

class MemoryStorage implements StorageAdapter {
  public readonly mode = "memory" satisfies StorageMode;

  private readonly events: EmailWebhookPayload[] = [];
  private readonly users = new Map<string, UserAccount>();
  private readonly sessions = new Map<string, SessionRecord>();

  async init(): Promise<void> {}

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async createSession(sessionId: string, session: SessionRecord): Promise<void> {
    this.sessions.set(sessionId, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async ensureAdminAccount(username: string, password: string): Promise<UserAccount> {
    const existing = this.users.get(username);
    if (existing) {
      return existing;
    }

    const account: UserAccount = {
      username,
      password,
      role: "admin",
      createdAt: new Date().toISOString()
    };

    this.users.set(account.username, account);
    return account;
  }

  async findUser(username: string): Promise<UserAccount | null> {
    return this.users.get(username) ?? null;
  }

  async updateUserPassword(username: string, password: string): Promise<void> {
    const existing = this.users.get(username);
    if (!existing) {
      return;
    }

    this.users.set(username, { ...existing, password });
  }

  async listUsers(): Promise<UserAccount[]> {
    return Array.from(this.users.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async createUser(account: UserAccount): Promise<void> {
    this.users.set(account.username, account);
  }

  async storeEmailEvent(payload: EmailWebhookPayload): Promise<void> {
    this.events.unshift(payload);
    this.events.splice(20);
  }

  async listRecentEmailEvents(limit: number): Promise<EmailWebhookPayload[]> {
    return this.events.slice(0, limit);
  }

  async countEmailEvents(): Promise<number> {
    return this.events.length;
  }
}

class MysqlStorage implements StorageAdapter {
  public readonly mode = "mysql" satisfies StorageMode;

  private readonly pool: mysql.Pool;

  constructor(connectionString: string) {
    this.pool = mysql.createPool({
      uri: connectionString,
      connectionLimit: 10,
      charset: "utf8mb4"
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(64) PRIMARY KEY,
        password TEXT NOT NULL,
        role VARCHAR(16) NOT NULL,
        created_at VARCHAR(64) NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) PRIMARY KEY,
        username VARCHAR(64) NOT NULL,
        role VARCHAR(16) NOT NULL,
        created_at VARCHAR(64) NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS email_events (
        message_id VARCHAR(255) PRIMARY KEY,
        event VARCHAR(64) NOT NULL,
        sender TEXT NOT NULL,
        recipients_json LONGTEXT NOT NULL,
        raw_size INT NOT NULL,
        subject TEXT NOT NULL,
        headers_json LONGTEXT NOT NULL,
        text_preview LONGTEXT NOT NULL,
        raw_base64 LONGTEXT NOT NULL,
        received_at VARCHAR(64) NOT NULL,
        stored_at VARCHAR(64) NOT NULL
      )
    `);
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT username, role, created_at FROM sessions WHERE session_id = ? LIMIT 1",
      [sessionId]
    );

    const row = rows[0] as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  async createSession(sessionId: string, session: SessionRecord): Promise<void> {
    await this.pool.query(
      "REPLACE INTO sessions (session_id, username, role, created_at) VALUES (?, ?, ?, ?)",
      [sessionId, session.username, session.role, session.createdAt]
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
  }

  async ensureAdminAccount(username: string, password: string): Promise<UserAccount> {
    const existing = await this.findUser(username);
    if (existing) {
      return existing;
    }

    const account: UserAccount = {
      username,
      password,
      role: "admin",
      createdAt: new Date().toISOString()
    };

    await this.createUser(account);
    return account;
  }

  async findUser(username: string): Promise<UserAccount | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT username, password, role, created_at FROM users WHERE username = ? LIMIT 1",
      [username]
    );

    const row = rows[0] as StorageRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async updateUserPassword(username: string, password: string): Promise<void> {
    await this.pool.query("UPDATE users SET password = ? WHERE username = ?", [password, username]);
  }

  async listUsers(): Promise<UserAccount[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT username, password, role, created_at FROM users ORDER BY created_at ASC"
    );

    return rows.map((row) => mapUserRow(row as StorageRow));
  }

  async countUsers(): Promise<number> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM users");
    return Number((rows[0] as { total: number } | undefined)?.total ?? 0);
  }

  async createUser(account: UserAccount): Promise<void> {
    await this.pool.query(
      "INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)",
      [account.username, account.password, account.role, account.createdAt]
    );
  }

  async storeEmailEvent(payload: EmailWebhookPayload): Promise<void> {
    await this.pool.query(
      `REPLACE INTO email_events (
        message_id, event, sender, recipients_json, raw_size, subject, headers_json, text_preview, raw_base64, received_at, stored_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.messageId,
        payload.event,
        payload.from,
        JSON.stringify(payload.to),
        payload.rawSize,
        payload.subject,
        JSON.stringify(payload.headers),
        payload.textPreview,
        payload.rawBase64,
        payload.receivedAt,
        new Date().toISOString()
      ]
    );
  }

  async listRecentEmailEvents(limit: number): Promise<EmailWebhookPayload[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT event, message_id, sender, recipients_json, raw_size, subject, headers_json, text_preview, raw_base64, received_at FROM email_events ORDER BY stored_at DESC LIMIT ?",
      [limit]
    );

    return rows.map((row) => mapEmailEventRow(row as EmailEventRow));
  }

  async countEmailEvents(): Promise<number> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM email_events");
    return Number((rows[0] as { total: number } | undefined)?.total ?? 0);
  }
}

class PostgresStorage implements StorageAdapter {
  public readonly mode = "postgres" satisfies StorageMode;

  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(64) PRIMARY KEY,
        password TEXT NOT NULL,
        role VARCHAR(16) NOT NULL,
        created_at VARCHAR(64) NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) PRIMARY KEY,
        username VARCHAR(64) NOT NULL,
        role VARCHAR(16) NOT NULL,
        created_at VARCHAR(64) NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS email_events (
        message_id VARCHAR(255) PRIMARY KEY,
        event VARCHAR(64) NOT NULL,
        sender TEXT NOT NULL,
        recipients_json TEXT NOT NULL,
        raw_size INTEGER NOT NULL,
        subject TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        text_preview TEXT NOT NULL,
        raw_base64 TEXT NOT NULL,
        received_at VARCHAR(64) NOT NULL,
        stored_at VARCHAR(64) NOT NULL
      )
    `);
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      "SELECT username, role, created_at FROM sessions WHERE session_id = $1 LIMIT 1",
      [sessionId]
    );

    return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
  }

  async createSession(sessionId: string, session: SessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (session_id, username, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role, created_at = EXCLUDED.created_at`,
      [sessionId, session.username, session.role, session.createdAt]
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
  }

  async ensureAdminAccount(username: string, password: string): Promise<UserAccount> {
    const existing = await this.findUser(username);
    if (existing) {
      return existing;
    }

    const account: UserAccount = {
      username,
      password,
      role: "admin",
      createdAt: new Date().toISOString()
    };

    await this.createUser(account);
    return account;
  }

  async findUser(username: string): Promise<UserAccount | null> {
    const result = await this.pool.query<StorageRow>(
      "SELECT username, password, role, created_at FROM users WHERE username = $1 LIMIT 1",
      [username]
    );

    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async updateUserPassword(username: string, password: string): Promise<void> {
    await this.pool.query("UPDATE users SET password = $1 WHERE username = $2", [password, username]);
  }

  async listUsers(): Promise<UserAccount[]> {
    const result = await this.pool.query<StorageRow>(
      "SELECT username, password, role, created_at FROM users ORDER BY created_at ASC"
    );

    return result.rows.map(mapUserRow);
  }

  async countUsers(): Promise<number> {
    const result = await this.pool.query<{ total: string }>("SELECT COUNT(*) AS total FROM users");
    return Number(result.rows[0]?.total ?? 0);
  }

  async createUser(account: UserAccount): Promise<void> {
    await this.pool.query(
      "INSERT INTO users (username, password, role, created_at) VALUES ($1, $2, $3, $4)",
      [account.username, account.password, account.role, account.createdAt]
    );
  }

  async storeEmailEvent(payload: EmailWebhookPayload): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_events (
        message_id, event, sender, recipients_json, raw_size, subject, headers_json, text_preview, raw_base64, received_at, stored_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (message_id) DO UPDATE SET
        event = EXCLUDED.event,
        sender = EXCLUDED.sender,
        recipients_json = EXCLUDED.recipients_json,
        raw_size = EXCLUDED.raw_size,
        subject = EXCLUDED.subject,
        headers_json = EXCLUDED.headers_json,
        text_preview = EXCLUDED.text_preview,
        raw_base64 = EXCLUDED.raw_base64,
        received_at = EXCLUDED.received_at,
        stored_at = EXCLUDED.stored_at`,
      [
        payload.messageId,
        payload.event,
        payload.from,
        JSON.stringify(payload.to),
        payload.rawSize,
        payload.subject,
        JSON.stringify(payload.headers),
        payload.textPreview,
        payload.rawBase64,
        payload.receivedAt,
        new Date().toISOString()
      ]
    );
  }

  async listRecentEmailEvents(limit: number): Promise<EmailWebhookPayload[]> {
    const result = await this.pool.query<EmailEventRow>(
      "SELECT event, message_id, sender, recipients_json, raw_size, subject, headers_json, text_preview, raw_base64, received_at FROM email_events ORDER BY stored_at DESC LIMIT $1",
      [limit]
    );

    return result.rows.map(mapEmailEventRow);
  }

  async countEmailEvents(): Promise<number> {
    const result = await this.pool.query<{ total: string }>("SELECT COUNT(*) AS total FROM email_events");
    return Number(result.rows[0]?.total ?? 0);
  }
}

type GitHubContentFile = {
  type: "file";
  path: string;
  sha: string;
  content?: string;
  encoding?: string;
};

type GitHubContentDirectoryEntry = {
  type: "file" | "dir" | "symlink" | "submodule";
  path: string;
  sha: string;
};

class GitHubStorage implements StorageAdapter {
  public readonly mode = "github" satisfies StorageMode;

  constructor(private readonly config: GitHubStorageConfig) {}

  async init(): Promise<void> {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json"
    };
  }

  private filePath(...segments: string[]): string {
    return buildGitHubFilePath(this.config.path, ...segments);
  }

  private async getContent(path: string): Promise<GitHubContentFile | null> {
    const response = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${encodeURIComponent(this.config.branch)}`, {
      method: "GET",
      headers: this.headers()
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub read failed: ${response.status} ${detail}`);
    }

    const data = (await response.json()) as GitHubContentFile;
    return data.type === "file" ? data : null;
  }

  private async listDirectory(path: string): Promise<GitHubContentDirectoryEntry[]> {
    const response = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${encodeURIComponent(this.config.branch)}`, {
      method: "GET",
      headers: this.headers()
    });

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub directory list failed: ${response.status} ${detail}`);
    }

    const data = (await response.json()) as GitHubContentDirectoryEntry | GitHubContentDirectoryEntry[];
    return Array.isArray(data) ? data : [];
  }

  private async writeJson(path: string, payload: unknown): Promise<void> {
    const existing = await this.getContent(path);
    const body: Record<string, string> & { sha?: string } = {
      message: `Update ${path}`,
      content: Buffer.from(JSON.stringify(payload, null, 2), "utf8").toString("base64"),
      branch: this.config.branch
    };

    if (existing?.sha) {
      body.sha = existing.sha;
    }

    const response = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub write failed: ${response.status} ${detail}`);
    }
  }

  private async deleteFile(path: string): Promise<void> {
    const existing = await this.getContent(path);
    if (!existing?.sha) {
      return;
    }

    const response = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify({
        message: `Delete ${path}`,
        sha: existing.sha,
        branch: this.config.branch
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub delete failed: ${response.status} ${detail}`);
    }
  }

  private decodeFileContent(file: GitHubContentFile): string {
    if (!file.content) {
      return "";
    }

    return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
  }

  private async readJson<T>(path: string): Promise<T | null> {
    const file = await this.getContent(path);
    if (!file) {
      return null;
    }

    try {
      return JSON.parse(this.decodeFileContent(file)) as T;
    } catch {
      return null;
    }
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.readJson<SessionRecord>(this.filePath("sessions", `${sessionId}.json`));
  }

  async createSession(sessionId: string, session: SessionRecord): Promise<void> {
    await this.writeJson(this.filePath("sessions", `${sessionId}.json`), session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.deleteFile(this.filePath("sessions", `${sessionId}.json`));
  }

  async ensureAdminAccount(username: string, password: string): Promise<UserAccount> {
    const existing = await this.findUser(username);
    if (existing) {
      return existing;
    }

    const account: UserAccount = {
      username,
      password,
      role: "admin",
      createdAt: new Date().toISOString()
    };

    await this.createUser(account);
    return account;
  }

  async findUser(username: string): Promise<UserAccount | null> {
    return this.readJson<UserAccount>(this.filePath("users", `${username}.json`));
  }

  async updateUserPassword(username: string, password: string): Promise<void> {
    const user = await this.findUser(username);
    if (!user) {
      return;
    }

    await this.createUser({ ...user, password });
  }

  async listUsers(): Promise<UserAccount[]> {
    const entries = await this.listDirectory(this.filePath("users"));
    const users = await Promise.all(
      entries
        .filter((entry): entry is GitHubContentDirectoryEntry & { type: "file" } => entry.type === "file" && entry.path.endsWith(".json"))
        .map(async (entry) => this.readJson<UserAccount>(entry.path))
    );

    return users.filter((item): item is UserAccount => Boolean(item)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async countUsers(): Promise<number> {
    const entries = await this.listDirectory(this.filePath("users"));
    return entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json")).length;
  }

  async createUser(account: UserAccount): Promise<void> {
    await this.writeJson(this.filePath("users", `${account.username}.json`), account);
  }

  async storeEmailEvent(payload: EmailWebhookPayload): Promise<void> {
    const fileName = `${Date.now()}-${payload.messageId}.json`;
    await this.writeJson(this.filePath("email_events", fileName), {
      ...payload,
      storedAt: new Date().toISOString()
    });
  }

  async listRecentEmailEvents(limit: number): Promise<EmailWebhookPayload[]> {
    const entries = await this.listDirectory(this.filePath("email_events"));
    const events = await Promise.all(
      entries
        .filter((entry): entry is GitHubContentDirectoryEntry & { type: "file" } => entry.type === "file" && entry.path.endsWith(".json"))
        .map(async (entry) => {
          const item = await this.readJson<EmailWebhookPayload & { storedAt?: string }>(entry.path);
          if (!item) {
            return null;
          }

          return item;
        })
    );

    return events
      .filter((item): item is EmailWebhookPayload & { storedAt?: string } => Boolean(item))
      .sort((left, right) => String((right as { storedAt?: string }).storedAt ?? right.receivedAt).localeCompare(String((left as { storedAt?: string }).storedAt ?? left.receivedAt)))
      .slice(0, limit)
      .map((item) => ({
        event: item.event,
        messageId: item.messageId,
        from: item.from,
        to: item.to,
        rawSize: item.rawSize,
        subject: item.subject,
        headers: item.headers,
        textPreview: item.textPreview,
        rawBase64: item.rawBase64,
        receivedAt: item.receivedAt
      }));
  }

  async countEmailEvents(): Promise<number> {
    const entries = await this.listDirectory(this.filePath("email_events"));
    return entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json")).length;
  }
}

export function createStorageAdapter(mysqlUrl: string, postgresUrl: string, githubInput: GitHubStorageInput = {}): StorageAdapter {
  const hasMysql = Boolean(mysqlUrl.trim());
  const hasPostgres = Boolean(postgresUrl.trim());
  const githubConfig = resolveGitHubStorageConfig(githubInput);
  const hasGithub = Boolean(githubConfig);

  const enabledCount = Number(hasMysql) + Number(hasPostgres) + Number(hasGithub);
  if (enabledCount > 1) {
    throw new Error("MYSQL_URL, POSTGRES_URL, and GITHUB_* can only choose one storage backend at a time");
  }

  if (hasMysql) {
    return new MysqlStorage(mysqlUrl);
  }

  if (hasPostgres) {
    return new PostgresStorage(postgresUrl);
  }

  if (githubConfig) {
    return new GitHubStorage(githubConfig);
  }

  return new MemoryStorage();
}

export function getStorageDisplayMode(mysqlUrl: string, postgresUrl: string, githubInput: GitHubStorageInput = {}): StorageMode {
  if (mysqlUrl.trim()) {
    return "mysql";
  }

  if (postgresUrl.trim()) {
    return "postgres";
  }

  if (resolveGitHubStorageConfig(githubInput)) {
    return "github";
  }

  return "memory";
}
