import type { EmailWebhookPayload, SessionRecord, UserAccount } from "./types.js";
import type { StorageMode } from "./storage.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

export function renderLoginPage(error?: string): string {
  return authShell(
    "webhook-mail 登入",
    `
      <section class="hero">
        <div class="badge">SECURE ACCESS</div>
        <h1>黑藍風格登入入口</h1>
        <p>管理員首次使用 <strong>ADMIN_INITIAL_USERNAME</strong> 與 <strong>ADMIN_INITIAL_PASSWORD</strong> 建立帳號，之後以帳號密碼登入；普通用戶不開放註冊，只能由管理員建立。</p>
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

export function renderConnectionCard(title: string, value: string): string {
  return `
    <article class="card">
      <div class="label">${escapeHtml(title)}</div>
      <div class="value">${value ? "已讀取" : "未設定"}</div>
      <div class="muted-code">${escapeHtml(value ? maskSecret(value) : "請透過環境變數提供連線資訊")}</div>
    </article>
  `;
}

export function renderDashboardPage(options: {
  session: SessionRecord;
  users: UserAccount[];
  receivedEvents: EmailWebhookPayload[];
  userCount: number;
  eventCount: number;
  storageMode: StorageMode;
  mysqlConnection: string;
  postgresConnection: string;
  githubConnection: string;
  flash?: { kind: "success" | "error"; message: string; detail?: string };
}): string {
  const { session, users, receivedEvents, userCount, eventCount, storageMode, mysqlConnection, postgresConnection, githubConnection, flash } = options;
  const admin = session.role === "admin";

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
      <div class="footer">webhook-mail · secure dashboard · admin bootstrap credentials consumed on first admin creation only.</div>
    `
  );
}
