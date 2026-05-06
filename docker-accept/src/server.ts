import express, { type Request, type Response } from "express";

type EmailWebhookPayload = {
  event: string;
  messageId: string;
  from: string;
  to: string[];
  rawSize: number;
  subject: string;
  headers: Record<string, string>;
  textPreview: string;
  rawBase64: string;
  receivedAt: string;
};

type UserRole = "admin" | "member";

type UserAccount = {
  username: string;
  password: string;
  role: UserRole;
  createdAt: string;
};

type SessionRecord = {
  username: string;
  role: UserRole;
  createdAt: string;
};

const app = express();
const port = Number(process.env.PORT ?? 3000);
const sharedSecret = process.env.WEBHOOK_SHARED_SECRET;
const adminBootstrapPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "change-me-now";
const mysqlConnection = process.env.MYSQL_URL ?? "";
const postgresConnection = process.env.POSTGRES_URL ?? "";
const githubConnection = process.env.GITHUB_URL ?? "";

const receivedEvents: EmailWebhookPayload[] = [];
const users = new Map<string, UserAccount>();
const sessions = new Map<string, SessionRecord>();

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false }));

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

function getSession(request: Request): SessionRecord | null {
  const sessionId = parseCookies(request).webhook_mail_session;
  if (!sessionId) {
    return null;
  }

  return sessions.get(sessionId) ?? null;
}

function ensureAdminAccount(): UserAccount {
  const existing = users.get("admin");
  if (existing) {
    return existing;
  }

  const account: UserAccount = {
    username: "admin",
    password: adminBootstrapPassword,
    role: "admin",
    createdAt: new Date().toISOString()
  };

  users.set(account.username, account);
  return account;
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
      <style>
        :root {
          color-scheme: dark;
          --bg: #020617;
          --panel: #0f172a;
          --panel-2: #1e293b;
          --text: #f8fafc;
          --muted: #94a3b8;
          --accent: #38bdf8;
          --accent-2: #818cf8;
          --border: rgba(56, 189, 248, 0.2);
          --danger: #f43f5e;
          --success: #10b981;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          background-color: var(--bg);
          color: var(--text);
          line-height: 1.5;
        }
        a { color: var(--accent); text-decoration: none; transition: opacity 0.2s; }
        a:hover { opacity: 0.8; }
        .wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        .hero, .panel, .card, .field, .notice {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .hero { padding: 32px; margin-bottom: 24px; }
        .hero h1 { margin: 0 0 12px; font-size: 2.5rem; font-weight: 800; }
        .hero p { margin: 0; color: var(--muted); font-size: 1.1rem; }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 999px;
          background: rgba(56, 189, 248, 0.1);
          color: var(--accent);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 16px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
        }
        .panel { padding: 24px; }
        .panel h2 { margin-top: 0; margin-bottom: 20px; font-size: 1.5rem; }
        .stats { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 24px; }
        .card { padding: 20px; }
        .card .value { font-size: 1.5rem; font-weight: 700; margin-top: 8px; }
        .card .label { color: var(--muted); font-size: 0.875rem; }
        .list { display: grid; gap: 16px; }
        .list-item {
          padding: 16px;
          border-radius: 12px;
          background: var(--panel-2);
          border: 1px solid var(--border);
        }
        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .button, button {
          appearance: none;
          border: 0;
          border-radius: 8px;
          padding: 10px 20px;
          font-weight: 600;
          cursor: pointer;
          color: white;
          background: var(--accent);
          transition: background 0.2s;
        }
        .button:hover, button:hover { background: #0ea5e9; }
        .button.secondary { background: var(--panel-2); border: 1px solid var(--border); }
        .button.secondary:hover { background: #334155; }
        input, select {
          width: 100%;
          margin-top: 8px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
        }
        input:focus { outline: 2px solid var(--accent); }
        label { display: block; margin-bottom: 16px; color: var(--muted); font-size: 0.875rem; }
        .notice { padding: 16px; margin-bottom: 20px; border-left: 4px solid; }
        .notice.error { border-color: var(--danger); background: rgba(244, 63, 94, 0.1); }
        .notice.success { border-color: var(--success); background: rgba(16, 185, 129, 0.1); }
        .muted-code {
          display: inline-block;
          margin-top: 8px;
          padding: 4px 8px;
          border-radius: 6px;
          background: var(--bg);
          color: var(--accent);
          font-family: monospace;
          font-size: 0.875rem;
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); }
        pre {
          overflow: auto;
          padding: 16px;
          border-radius: 8px;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          font-size: 0.875rem;
        }
        .footer { margin-top: 40px; color: var(--muted); font-size: 0.875rem; text-align: center; }
        .split { display: grid; gap: 24px; grid-template-columns: 1fr 1fr; }
        @media (max-width: 768px) { .split { grid-template-columns: 1fr; } }
      </style>
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

function renderDashboardPage(session: SessionRecord, flash?: { kind: "success" | "error"; message: string; detail?: string }): string {
  const admin = session.role === "admin";
  const accountList = Array.from(users.values())
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
        <article class="card"><div class="label">收到事件</div><div class="value">${receivedEvents.length}</div></article>
        <article class="card"><div class="label">帳號數</div><div class="value">${users.size}</div></article>
        <article class="card"><div class="label">服務狀態</div><div class="value">online</div></article>
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

function authenticate(username: string, password: string): SessionRecord | null {
  if (username === "admin") {
    const admin = ensureAdminAccount();
    if (admin.password === password) {
      return { username: admin.username, role: admin.role, createdAt: new Date().toISOString() };
    }

    return null;
  }

  const account = users.get(username);
  if (!account || account.password !== password) {
    return null;
  }

  return { username: account.username, role: account.role, createdAt: new Date().toISOString() };
}

function requireAdmin(request: Request, response: Response): SessionRecord | null {
  const session = getSession(request);
  if (!session || session.role !== "admin") {
    response.status(403).type("html").send(renderLoginPage("需要管理員權限"));
    return null;
  }

  return session;
}

function renderPage(events: EmailWebhookPayload[]): string {
  const cards = events.length
    ? events
        .map((event) => `
          <article class="card">
            <div class="pill">${event.event}</div>
            <h2>${escapeHtml(event.subject)}</h2>
            <p><strong>From:</strong> ${escapeHtml(event.from)}</p>
            <p><strong>To:</strong> ${escapeHtml(event.to.join(", "))}</p>
            <p><strong>Received:</strong> ${escapeHtml(event.receivedAt)}</p>
            <p><strong>Message ID:</strong> ${escapeHtml(event.messageId)}</p>
            <p><strong>Size:</strong> ${event.rawSize} bytes</p>
            <pre>${escapeHtml(event.textPreview || "(empty preview)")}</pre>
          </article>
        `)
        .join("")
    : `<article class="card empty"><h2>尚未收到任何 webhook</h2><p>等待 worker-send 傳送第一封郵件事件。</p></article>`;

  return `<!DOCTYPE html>
  <html lang="zh-Hant">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>docker-accept mail dashboard</title>
      <style>
        :root {
          color-scheme: dark;
          --bg: #050816;
          --panel: #0c1330;
          --panel-2: #101c49;
          --text: #e7efff;
          --muted: #8fa5d6;
          --accent: #2aa9ff;
          --accent-2: #5d7cff;
          --border: rgba(93, 124, 255, 0.25);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Inter, "Noto Sans TC", system-ui, sans-serif;
          background: radial-gradient(circle at top, #10255b 0%, var(--bg) 42%);
          color: var(--text);
        }
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 40px 20px 60px;
        }
        .hero, .stats, .card {
          background: linear-gradient(180deg, rgba(20, 36, 92, 0.95), rgba(9, 15, 38, 0.96));
          border: 1px solid var(--border);
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        }
        .hero {
          padding: 28px;
          margin-bottom: 24px;
        }
        .hero h1 { margin: 0 0 8px; font-size: clamp(2rem, 4vw, 3.25rem); }
        .hero p { margin: 0; color: var(--muted); line-height: 1.7; }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          padding: 18px;
          margin-bottom: 24px;
        }
        .stat {
          padding: 16px;
          border-radius: 16px;
          background: rgba(10, 18, 48, 0.7);
          border: 1px solid rgba(42, 169, 255, 0.12);
        }
        .stat .label { color: var(--muted); font-size: 0.9rem; }
        .stat .value { font-size: 1.8rem; font-weight: 700; margin-top: 8px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 18px;
        }
        .card {
          padding: 20px;
        }
        .card h2 { margin-top: 10px; }
        .card p { color: var(--muted); line-height: 1.65; }
        .card pre {
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          padding: 14px;
          border-radius: 12px;
          background: rgba(4, 10, 28, 0.9);
          border: 1px solid rgba(42, 169, 255, 0.15);
          color: #cfe3ff;
        }
        .pill {
          display: inline-flex;
          padding: 6px 10px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--accent), var(--accent-2));
          color: white;
          font-size: 0.8rem;
          font-weight: 700;
        }
        .empty { text-align: center; }
      </style>
    </head>
    <body>
      <main class="wrap">
        <section class="hero">
          <div class="pill">BLACK + BLUE UI</div>
          <h1>docker-accept webhook dashboard</h1>
          <p>這個服務會接收來自 Cloudflare Email Worker 的 webhook，保留最近事件並用黑底藍光風格頁面展示目前狀態。</p>
        </section>
        <section class="stats">
          <div class="stat">
            <div class="label">Webhook endpoint</div>
            <div class="value">/api/webhooks/email</div>
          </div>
          <div class="stat">
            <div class="label">Received events</div>
            <div class="value">${events.length}</div>
          </div>
          <div class="stat">
            <div class="label">Service status</div>
            <div class="value">online</div>
          </div>
        </section>
        <section class="grid">${cards}</section>
      </main>
    </body>
  </html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

app.get("/health", (_request: Request, response: Response) => {
  response.json({ status: "ok", events: receivedEvents.length });
});

app.get("/login", (request: Request, response: Response) => {
  if (getSession(request)) {
    response.redirect("/");
    return;
  }

  response.type("html").send(renderLoginPage());
});

app.post("/login", (request: Request, response: Response) => {
  const username = String(request.body.username ?? "").trim();
  const password = String(request.body.password ?? "");
  const session = authenticate(username, password);

  if (!session) {
    response.status(401).type("html").send(renderLoginPage("帳號或密碼錯誤"));
    return;
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, session);
  response.cookie("webhook_mail_session", sessionId, { httpOnly: true, sameSite: "lax" });
  response.type("html").send(renderDashboardPage(session, { kind: "success", message: "登入成功" }));
});

app.post("/logout", (request: Request, response: Response) => {
  const cookies = parseCookies(request);
  if (cookies.webhook_mail_session) {
    sessions.delete(cookies.webhook_mail_session);
  }

  response.clearCookie("webhook_mail_session");
  response.redirect("/login");
});

app.get("/", (request: Request, response: Response) => {
  const session = getSession(request);
  if (!session) {
    response.redirect("/login");
    return;
  }

  response.type("html").send(renderDashboardPage(session));
});

app.post("/api/webhooks/email", (request: Request, response: Response) => {
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

  receivedEvents.unshift(normalized);
  receivedEvents.splice(20);

  response.status(202).json({ ok: true, stored: receivedEvents.length });
});

app.post("/api/users", (request: Request, response: Response) => {
  const session = requireAdmin(request, response);
  if (!session) {
    return;
  }

  const username = String(request.body.username ?? "").trim();
  const password = String(request.body.password ?? "");

  if (!username || username === "admin" || username.length < 3) {
    response.status(400).type("html").send(renderDashboardPage(session, { kind: "error", message: "使用者名稱不合法" }));
    return;
  }

  if (users.has(username)) {
    response.status(409).type("html").send(renderDashboardPage(session, { kind: "error", message: "此帳號已存在" }));
    return;
  }

  if (password.length < 8) {
    response.status(400).type("html").send(renderDashboardPage(session, { kind: "error", message: "密碼至少需要 8 個字元" }));
    return;
  }

  const account: UserAccount = {
    username,
    password,
    role: "member",
    createdAt: new Date().toISOString()
  };

  users.set(username, account);
  response.type("html").send(
    renderDashboardPage(session, {
      kind: "success",
      message: "已建立普通用戶",
      detail: `帳號：${username}\n初始密碼：${password}\n請立即通知使用者登入後修改。`
    })
  );
});

app.listen(port, () => {
  console.log(`docker-accept listening on http://localhost:${port}`);
});
