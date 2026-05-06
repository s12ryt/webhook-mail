import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import express, { type Request, type Response } from "express";

import { createStorageAdapter, getStorageDisplayMode } from "./storage.js";
import type { EmailWebhookPayload, SessionRecord, UserAccount } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const sharedSecret = process.env.WEBHOOK_SHARED_SECRET;
const adminBootstrapPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "change-me-now";
const mysqlConnection = process.env.MYSQL_URL ?? "";
const postgresConnection = process.env.POSTGRES_URL ?? "";
const githubStorageInput = {
  url: process.env.GITHUB_URL ?? "",
  token: process.env.GITHUB_TOKEN ?? "",
  owner: process.env.GITHUB_OWNER ?? "",
  repo: process.env.GITHUB_REPO ?? "",
  branch: process.env.GITHUB_BRANCH ?? "main",
  path: process.env.GITHUB_PATH ?? "mail-events"
};
const githubConnection = buildGitHubConnection(githubStorageInput);
const storageMode = getStorageDisplayMode(mysqlConnection, postgresConnection, githubStorageInput);
const storage = createStorageAdapter(mysqlConnection, postgresConnection, githubStorageInput);
const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_PREFIX = "scrypt";

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

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

function normalizePathSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeMessageId(value: string): string {
  return value.replace(/[<>]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "message";
}

function normalizeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((segment) => normalizePathSegment(segment))
    .filter(Boolean)
    .join("/");
}

function buildGitHubConnection(input: { url: string; owner: string; repo: string; branch: string; path: string }): string {
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

function parseCookies(request: Request): Record<string, string> {
  const header = request.header("cookie");
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 0) {
        return [part.trim(), ""];
      }

      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      return [key, decodeURIComponent(value)];
    })
  );
}

async function getSession(request: Request): Promise<SessionRecord | null> {
  const sessionId = parseCookies(request).webhook_mail_session;
  if (!sessionId) {
    return null;
  }

  return storage.getSession(sessionId);
}

async function ensureAdminAccount(): Promise<UserAccount> {
  return storage.ensureAdminAccount(await hashPassword(adminBootstrapPassword));
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived.toString("hex")}`;
}

function isHashedPassword(value: string): boolean {
  return value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

async function verifyPassword(password: string, storedPassword: string): Promise<boolean> {
  if (!isHashedPassword(storedPassword)) {
    return password === storedPassword;
  }

  const [, salt, expectedHex] = storedPassword.split("$");
  if (!salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

async function verifyAndUpgradePassword(account: UserAccount, password: string): Promise<boolean> {
  const matched = await verifyPassword(password, account.password);
  if (!matched) {
    return false;
  }

  if (!isHashedPassword(account.password)) {
    await storage.updateUserPassword(account.username, await hashPassword(password));
  }

  return true;
}

function maskSecret(value: string): string {
  if (!value) {
    return "未設定";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}••••`;
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function authShell(title: string, content: string): string {
  return `<!DOCTYPE html>
  <html lang="zh-Hant">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(title)}</title>
      <link rel="stylesheet" href="/css/style.css" />
    </head>
    <body>
      <main class="wrap">
        ${content}
      </main>
    </body>
  </html>`;
}

function renderLoginPage(error?: string): string {
  return authShell(
    "webhook-mail 登入",
    `
      <section class="hero">
        <div class="badge">SECURE ACCESS</div>
        <h1>黑藍風格登入入口</h1>
        <p>管理員首次使用 <strong>ADMIN_INITIAL_PASSWORD</strong> 建立帳號，之後以帳號密碼登入；普通用戶不開放註冊，只能由管理員建立。</p>
      </section>
      ${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}
      <section class="panel" style="max-width: 520px;">
        <h2>登入</h2>
        <form method="post" action="/login">
          <label>帳號
            <input name="username" autocomplete="username" required />
          </label>
          <label>密碼
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <button type="submit">登入</button>
        </form>
      </section>
    `
  );
}

function renderConnectionCard(title: string, value: string): string {
  return `
    <article class="card">
      <div class="label">${escapeHtml(title)}</div>
      <div class="value">${value ? "已讀取" : "未設定"}</div>
      <div class="muted-code">${escapeHtml(value ? maskSecret(value) : "請透過環境變數提供連線資訊")}</div>
    </article>
  `;
}

async function renderDashboardPage(session: SessionRecord, flash?: { kind: "success" | "error"; message: string; detail?: string }): Promise<string> {
  const admin = session.role === "admin";
  const [users, receivedEvents, userCount, eventCount] = await Promise.all([
    storage.listUsers(),
    storage.listRecentEmailEvents(20),
    storage.countUsers(),
    storage.countEmailEvents()
  ]);

  const accountList = users
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(
      (account) => `
        <tr>
          <td>${escapeHtml(account.username)}</td>
          <td>${escapeHtml(account.role)}</td>
          <td>${escapeHtml(account.createdAt)}</td>
        </tr>
      `
    )
    .join("");

  const userManagement = admin
    ? `
      <section class="panel">
        <div class="toolbar">
          <div>
            <h2>管理員操作</h2>
            <div class="muted">可建立普通用戶，禁止自助註冊。</div>
          </div>
          <form method="post" action="/logout">
            <button class="secondary" type="submit">登出</button>
          </form>
        </div>
        <div class="split">
          <div>
            <h3>建立普通用戶</h3>
            <form method="post" action="/api/users">
              <label>新帳號
                <input name="username" autocomplete="off" required minlength="3" maxlength="32" />
              </label>
              <label>初始密碼
                <input name="password" type="text" autocomplete="off" required minlength="8" maxlength="64" />
              </label>
              <button type="submit">建立用戶</button>
            </form>
          </div>
          <div>
            <h3>目前帳號</h3>
            <table>
              <thead>
                <tr><th>帳號</th><th>角色</th><th>建立時間</th></tr>
              </thead>
              <tbody>${accountList || `<tr><td colspan="3" class="muted">尚未建立任何帳號</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </section>
    `
    : `
      <section class="panel">
        <div class="toolbar">
          <div>
            <h2>目前登入：${escapeHtml(session.username)}</h2>
            <div class="muted">普通用戶只能查看郵件事件與系統狀態。</div>
          </div>
          <form method="post" action="/logout">
            <button class="secondary" type="submit">登出</button>
          </form>
        </div>
      </section>
    `;

  const flashBanner = flash ? `<div class="notice ${flash.kind}"><strong>${escapeHtml(flash.message)}</strong>${flash.detail ? `<div class="muted-code">${escapeHtml(flash.detail)}</div>` : ""}</div>` : "";

  return authShell(
    "webhook-mail 儀表板",
    `
      <section class="hero">
        <div class="badge">BLACK + BLUE UI</div>
        <h1>webhook-mail 控制台</h1>
        <p>登入後可查看郵件 webhook、管理普通用戶，並檢視 MySQL / Postgres / GitHub 連線資訊是否已由環境變數提供。</p>
      </section>
      ${flashBanner}
      <section class="stats">
        <article class="card"><div class="label">登入身份</div><div class="value">${escapeHtml(session.role)}</div></article>
        <article class="card"><div class="label">收到事件</div><div class="value">${eventCount}</div></article>
        <article class="card"><div class="label">帳號數</div><div class="value">${userCount}</div></article>
        <article class="card"><div class="label">儲存模式</div><div class="value">${escapeHtml(storageMode)}</div></article>
      </section>
      <section class="grid" style="margin-bottom: 24px;">
        ${renderConnectionCard("MySQL", mysqlConnection)}
        ${renderConnectionCard("Postgres", postgresConnection)}
        ${renderConnectionCard("GitHub", githubConnection)}
      </section>
      ${userManagement}
      <section class="panel" style="margin-top: 24px;">
        <div class="toolbar">
          <div>
            <h2>最近 webhook</h2>
            <div class="muted">保留最新 20 筆郵件事件。</div>
          </div>
          <div class="badge">/api/webhooks/email</div>
        </div>
        <div class="list">
          ${
            receivedEvents.length
              ? receivedEvents
                  .map(
                    (event) => `
                      <article class="list-item">
                        <div class="toolbar" style="margin-bottom: 10px;">
                          <strong>${escapeHtml(event.subject)}</strong>
                          <span class="badge">${escapeHtml(event.event)}</span>
                        </div>
                        <div class="muted">From: ${escapeHtml(event.from)} ｜ To: ${escapeHtml(event.to.join(", "))} ｜ Received: ${escapeHtml(event.receivedAt)}</div>
                        <pre>${escapeHtml(event.textPreview || "(empty preview)")}</pre>
                      </article>
                    `
                  )
                  .join("")
              : `<article class="list-item"><div class="muted">尚未收到任何 webhook。</div></article>`
          }
        </div>
      </section>
      <div class="footer">webhook-mail · secure dashboard · admin bootstrap password consumed on first admin creation only.</div>
    `
  );
}

async function authenticate(username: string, password: string): Promise<SessionRecord | null> {
  const account = username === "admin" ? await ensureAdminAccount() : await storage.findUser(username);
  if (!account || !(await verifyAndUpgradePassword(account, password))) {
    return null;
  }

  return { username: account.username, role: account.role, createdAt: new Date().toISOString() };
}

async function requireAdmin(request: Request, response: Response): Promise<SessionRecord | null> {
  const session = await getSession(request);
  if (!session || session.role !== "admin") {
    response.status(403).type("html").send(renderLoginPage("需要管理員權限"));
    return null;
  }

  return session;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

app.get("/health", async (_request: Request, response: Response) => {
  response.json({ status: "ok", events: await storage.countEmailEvents(), storage: storageMode });
});

app.get("/login", async (request: Request, response: Response) => {
  if (await getSession(request)) {
    response.redirect("/");
    return;
  }

  response.type("html").send(renderLoginPage());
});

app.post("/login", async (request: Request, response: Response) => {
  const username = String(request.body.username ?? "").trim();
  const password = String(request.body.password ?? "");
  const session = await authenticate(username, password);

  if (!session) {
    response.status(401).type("html").send(renderLoginPage("帳號或密碼錯誤"));
    return;
  }

  const sessionId = crypto.randomUUID();
  await storage.createSession(sessionId, session);
  response.cookie("webhook_mail_session", sessionId, { httpOnly: true, sameSite: "lax" });
  response.type("html").send(await renderDashboardPage(session, { kind: "success", message: "登入成功" }));
});

app.post("/logout", async (request: Request, response: Response) => {
  const cookies = parseCookies(request);
  if (cookies.webhook_mail_session) {
    await storage.deleteSession(cookies.webhook_mail_session);
  }

  response.clearCookie("webhook_mail_session");
  response.redirect("/login");
});

app.get("/", async (request: Request, response: Response) => {
  const session = await getSession(request);
  if (!session) {
    response.redirect("/login");
    return;
  }

  response.type("html").send(await renderDashboardPage(session));
});

app.post("/api/webhooks/email", async (request: Request, response: Response) => {
  if (sharedSecret) {
    const secret = request.header("x-webhook-secret");
    if (secret !== sharedSecret) {
      response.status(401).json({ ok: false, error: "invalid webhook secret" });
      return;
    }
  }

  const payload = request.body as Partial<EmailWebhookPayload>;
  if (!payload || payload.event !== "email.received" || !payload.messageId) {
    response.status(400).json({ ok: false, error: "invalid payload" });
    return;
  }

  const normalized: EmailWebhookPayload = {
    event: payload.event,
    messageId: payload.messageId,
    from: payload.from ?? "unknown",
    to: payload.to ?? [],
    rawSize: payload.rawSize ?? 0,
    subject: payload.subject ?? "(no subject)",
    headers: payload.headers ?? {},
    textPreview: payload.textPreview ?? "",
    rawBase64: payload.rawBase64 ?? "",
    receivedAt: payload.receivedAt ?? new Date().toISOString()
  };

  try {
    await storage.storeEmailEvent(normalized);
    response.status(202).json({ ok: true, stored: await storage.countEmailEvents(), storage: storageMode });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    response.status(502).json({ ok: false, error: "storage failed", detail, storage: storageMode });
  }
});

app.post("/api/users", async (request: Request, response: Response) => {
  const session = await requireAdmin(request, response);
  if (!session) {
    return;
  }

  const username = String(request.body.username ?? "").trim();
  const password = String(request.body.password ?? "");

  if (!username || username === "admin" || username.length < 3) {
    response.status(400).type("html").send(await renderDashboardPage(session, { kind: "error", message: "使用者名稱不合法" }));
    return;
  }

  if (await storage.findUser(username)) {
    response.status(409).type("html").send(await renderDashboardPage(session, { kind: "error", message: "此帳號已存在" }));
    return;
  }

  if (password.length < 8) {
    response.status(400).type("html").send(await renderDashboardPage(session, { kind: "error", message: "密碼至少需要 8 個字元" }));
    return;
  }

  const account: UserAccount = {
    username,
    password: await hashPassword(password),
    role: "member",
    createdAt: new Date().toISOString()
  };

  await storage.createUser(account);
  response.type("html").send(
    await renderDashboardPage(session, {
      kind: "success",
      message: "已建立普通用戶",
      detail: `帳號：${username}\n初始密碼：${password}\n請立即通知使用者登入後修改。`
    })
  );
});

storage
  .init()
  .then(() => ensureAdminAccount())
  .then(() => {
    app.listen(port, () => {
      console.log(`docker-accept listening on http://localhost:${port} (storage: ${storage.mode})`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize docker-accept", error);
    process.exit(1);
  });
