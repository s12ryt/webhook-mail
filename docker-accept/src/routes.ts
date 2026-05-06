import { randomUUID } from "node:crypto";

import type { Express, Request, Response } from "express";

import type { RuntimeConfig } from "./config.js";
import { parseCookies } from "./http.js";
import { hashPassword, isHashedPassword, verifyPassword } from "./security/password.js";
import { renderDashboardPage, renderLoginPage } from "./views.js";
import type { EmailWebhookPayload, SessionRecord, UserAccount } from "./types.js";
import type { StorageAdapter } from "./storage.js";

type RouteDeps = {
  storage: StorageAdapter;
  config: RuntimeConfig;
};

async function ensureAdminAccount(storage: StorageAdapter, adminBootstrapUsername: string, adminBootstrapPassword: string): Promise<UserAccount> {
  return storage.ensureAdminAccount(adminBootstrapUsername, await hashPassword(adminBootstrapPassword));
}

async function getSession(request: Request, storage: StorageAdapter): Promise<SessionRecord | null> {
  const sessionId = parseCookies(request).webhook_mail_session;
  if (!sessionId) {
    return null;
  }

  return storage.getSession(sessionId);
}

async function verifyAndUpgradePassword(storage: StorageAdapter, account: UserAccount, password: string): Promise<boolean> {
  const matched = await verifyPassword(password, account.password);
  if (!matched) {
    return false;
  }

  if (!isHashedPassword(account.password)) {
    await storage.updateUserPassword(account.username, await hashPassword(password));
  }

  return true;
}

async function authenticate(storage: StorageAdapter, adminBootstrapUsername: string, adminBootstrapPassword: string, username: string, password: string): Promise<SessionRecord | null> {
  const account = username === adminBootstrapUsername ? await ensureAdminAccount(storage, adminBootstrapUsername, adminBootstrapPassword) : await storage.findUser(username);
  if (!account || !(await verifyAndUpgradePassword(storage, account, password))) {
    return null;
  }

  return { username: account.username, role: account.role, createdAt: new Date().toISOString() };
}

async function requireAdmin(request: Request, response: Response, storage: StorageAdapter): Promise<SessionRecord | null> {
  const session = await getSession(request, storage);
  if (!session || session.role !== "admin") {
    response.status(403).type("html").send(renderLoginPage("需要管理員權限"));
    return null;
  }

  return session;
}

function normalizePayload(payload: Partial<EmailWebhookPayload>): EmailWebhookPayload {
  return {
    event: payload.event ?? "email.received",
    messageId: payload.messageId ?? "",
    from: payload.from ?? "unknown",
    to: payload.to ?? [],
    rawSize: payload.rawSize ?? 0,
    subject: payload.subject ?? "(no subject)",
    headers: payload.headers ?? {},
    textPreview: payload.textPreview ?? "",
    rawBase64: payload.rawBase64 ?? "",
    receivedAt: payload.receivedAt ?? new Date().toISOString()
  };
}

export async function initializeAdminAccount(storage: StorageAdapter, adminBootstrapUsername: string, adminBootstrapPassword: string): Promise<void> {
  await ensureAdminAccount(storage, adminBootstrapUsername, adminBootstrapPassword);
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const { storage, config } = deps;

  app.get("/health", async (_request: Request, response: Response) => {
    response.json({ status: "ok", events: await storage.countEmailEvents(), storage: config.storageMode });
  });

  app.get("/login", async (request: Request, response: Response) => {
    if (await getSession(request, storage)) {
      response.redirect("/");
      return;
    }

    response.type("html").send(renderLoginPage());
  });

  app.post("/login", async (request: Request, response: Response) => {
    const username = String(request.body.username ?? "").trim();
    const password = String(request.body.password ?? "");
    const session = await authenticate(storage, config.adminBootstrapUsername, config.adminBootstrapPassword, username, password);

    if (!session) {
      response.status(401).type("html").send(renderLoginPage("帳號或密碼錯誤"));
      return;
    }

    const sessionId = randomUUID();
    await storage.createSession(sessionId, session);
    response.cookie("webhook_mail_session", sessionId, { httpOnly: true, sameSite: "lax" });
    response.type("html").send(await renderDashboardPage({
      session,
      users: await storage.listUsers(),
      receivedEvents: await storage.listRecentEmailEvents(20),
      userCount: await storage.countUsers(),
      eventCount: await storage.countEmailEvents(),
      storageMode: config.storageMode,
      mysqlConnection: config.mysqlConnection,
      postgresConnection: config.postgresConnection,
      githubConnection: config.githubConnection,
      flash: { kind: "success", message: "登入成功" }
    }));
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
    const session = await getSession(request, storage);
    if (!session) {
      response.redirect("/login");
      return;
    }

    response.type("html").send(await renderDashboardPage({
      session,
      users: await storage.listUsers(),
      receivedEvents: await storage.listRecentEmailEvents(20),
      userCount: await storage.countUsers(),
      eventCount: await storage.countEmailEvents(),
      storageMode: config.storageMode,
      mysqlConnection: config.mysqlConnection,
      postgresConnection: config.postgresConnection,
      githubConnection: config.githubConnection
    }));
  });

  app.post("/api/webhooks/email", async (request: Request, response: Response) => {
    if (config.sharedSecret) {
      const secret = request.header("x-webhook-secret");
      if (secret !== config.sharedSecret) {
        response.status(401).json({ ok: false, error: "invalid webhook secret" });
        return;
      }
    }

    const payload = request.body as Partial<EmailWebhookPayload>;
    if (!payload || payload.event !== "email.received" || !payload.messageId) {
      response.status(400).json({ ok: false, error: "invalid payload" });
      return;
    }

    try {
      await storage.storeEmailEvent(normalizePayload(payload));
      response.status(202).json({ ok: true, stored: await storage.countEmailEvents(), storage: config.storageMode });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      response.status(502).json({ ok: false, error: "storage failed", detail, storage: config.storageMode });
    }
  });

  app.post("/api/users", async (request: Request, response: Response) => {
    const session = await requireAdmin(request, response, storage);
    if (!session) {
      return;
    }

    const username = String(request.body.username ?? "").trim();
    const password = String(request.body.password ?? "");

    if (!username || username === config.adminBootstrapUsername || username.length < 3) {
      response.status(400).type("html").send(await renderDashboardPage({
        session,
        users: await storage.listUsers(),
        receivedEvents: await storage.listRecentEmailEvents(20),
        userCount: await storage.countUsers(),
        eventCount: await storage.countEmailEvents(),
        storageMode: config.storageMode,
        mysqlConnection: config.mysqlConnection,
        postgresConnection: config.postgresConnection,
        githubConnection: config.githubConnection,
        flash: { kind: "error", message: "使用者名稱不合法" }
      }));
      return;
    }

    if (await storage.findUser(username)) {
      response.status(409).type("html").send(await renderDashboardPage({
        session,
        users: await storage.listUsers(),
        receivedEvents: await storage.listRecentEmailEvents(20),
        userCount: await storage.countUsers(),
        eventCount: await storage.countEmailEvents(),
        storageMode: config.storageMode,
        mysqlConnection: config.mysqlConnection,
        postgresConnection: config.postgresConnection,
        githubConnection: config.githubConnection,
        flash: { kind: "error", message: "此帳號已存在" }
      }));
      return;
    }

    if (password.length < 8) {
      response.status(400).type("html").send(await renderDashboardPage({
        session,
        users: await storage.listUsers(),
        receivedEvents: await storage.listRecentEmailEvents(20),
        userCount: await storage.countUsers(),
        eventCount: await storage.countEmailEvents(),
        storageMode: config.storageMode,
        mysqlConnection: config.mysqlConnection,
        postgresConnection: config.postgresConnection,
        githubConnection: config.githubConnection,
        flash: { kind: "error", message: "密碼至少需要 8 個字元" }
      }));
      return;
    }

    await storage.createUser({
      username,
      password: await hashPassword(password),
      role: "member",
      createdAt: new Date().toISOString()
    });

    response.type("html").send(await renderDashboardPage({
      session,
      users: await storage.listUsers(),
      receivedEvents: await storage.listRecentEmailEvents(20),
      userCount: await storage.countUsers(),
      eventCount: await storage.countEmailEvents(),
      storageMode: config.storageMode,
      mysqlConnection: config.mysqlConnection,
      postgresConnection: config.postgresConnection,
      githubConnection: config.githubConnection,
      flash: {
        kind: "success",
        message: "已建立普通用戶",
        detail: `帳號：${username}\n初始密碼：${password}\n請立即通知使用者登入後修改。`
      }
    }));
  });
}
