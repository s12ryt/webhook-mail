#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const crypto = require("node:crypto");
const querystring = require("node:querystring");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || "change-me-now";
const WEBHOOK_SHARED_SECRET = process.env.WEBHOOK_SHARED_SECRET || "";
const DATA_FILE = process.env.DATA_FILE || "webhook-mail-node.json";

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, 200000, 32, "sha256");
  return `pbkdf2$200000$${salt.toString("base64")}$${digest.toString("base64")}`;
}

function verifyPassword(password, stored) {
  if (!String(stored).startsWith("pbkdf2$")) {
    return crypto.timingSafeEqual(Buffer.from(password), Buffer.from(String(stored || "")));
  }
  const parts = String(stored).split("$");
  if (parts.length !== 4) return false;
  const digest = crypto.pbkdf2Sync(password, Buffer.from(parts[2], "base64"), Number(parts[1]), 32, "sha256");
  return crypto.timingSafeEqual(digest, Buffer.from(parts[3], "base64"));
}

function loadStore() {
  let data = { users: {}, sessions: {}, events: [] };
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
    } catch {}
  }
  if (!data.users.admin) {
    data.users.admin = { username: "admin", password: hashPassword(ADMIN_INITIAL_PASSWORD), role: "admin", createdAt: nowIso() };
    saveStore(data);
  }
  return data;
}

function saveStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const store = loadStore();

function page(title, body) {
  const css = `body{margin:0;background:#06111f;color:#dbeafe;font-family:system-ui,Segoe UI,sans-serif}.wrap{max-width:1100px;margin:auto;padding:32px}.hero,.panel,.card{background:#0b1930;border:1px solid #1d4ed8;border-radius:18px;padding:22px;margin:16px 0;box-shadow:0 0 30px #0ea5e933}h1{color:#93c5fd}.badge{display:inline-block;background:#0f2f62;color:#bfdbfe;border:1px solid #2563eb;border-radius:999px;padding:4px 10px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.value{font-size:30px;font-weight:800;color:#60a5fa}input,button{width:100%;box-sizing:border-box;padding:11px;margin:7px 0;border-radius:10px;border:1px solid #2563eb;background:#081426;color:#e0f2fe}button{cursor:pointer;background:#2563eb;font-weight:700}.secondary{background:#172554}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #1e3a8a;padding:8px;text-align:left}pre{white-space:pre-wrap;background:#020617;padding:12px;border-radius:10px}.notice{padding:12px;border-radius:12px}.error{background:#7f1d1d}.success{background:#14532d}.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center}.muted{color:#93a4bd}`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main class="wrap">${body}</main></body></html>`;
}

function loginPage(error = "") {
  const notice = error ? `<div class="notice error">${escapeHtml(error)}</div>` : "";
  return page("webhook-mail 登入", `<section class="hero"><span class="badge">SINGLE FILE NODE</span><h1>webhook-mail 登入</h1><p>管理員帳號 admin，密碼來自 ADMIN_INITIAL_PASSWORD。</p></section>${notice}<section class="panel"><form method="post" action="/login"><label>帳號<input name="username" required></label><label>密碼<input name="password" type="password" required></label><button>登入</button></form></section>`);
}

function dashboard(session, flash = "") {
  const users = Object.values(store.users).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const events = store.events.slice(0, 20);
  const notice = flash ? `<div class="notice success">${escapeHtml(flash)}</div>` : "";
  const userRows = users.map((u) => `<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td><td>${escapeHtml(u.createdAt)}</td></tr>`).join("");
  const eventItems = events.map((e) => `<article class="panel"><div class="toolbar"><strong>${escapeHtml(e.subject || "(no subject)")}</strong><span class="badge">${escapeHtml(e.event)}</span></div><p class="muted">From: ${escapeHtml(e.from)} ｜ To: ${escapeHtml(Array.isArray(e.to) ? e.to.join(", ") : e.to)} ｜ Received: ${escapeHtml(e.receivedAt)}</p><pre>${escapeHtml(e.textPreview || "(empty preview)")}</pre></article>`).join("") || `<article class="panel"><p class="muted">尚未收到任何 webhook。</p></article>`;
  const adminTools = session.role === "admin" ? `<section class="panel"><h2>管理員操作</h2><div class="grid"><form method="post" action="/api/users"><label>新帳號<input name="username" minlength="3" required></label><label>初始密碼<input name="password" minlength="8" required></label><button>建立普通用戶</button></form><div><h3>目前帳號</h3><table><thead><tr><th>帳號</th><th>角色</th><th>建立時間</th></tr></thead><tbody>${userRows}</tbody></table></div></div></section>` : "";
  return page("webhook-mail 控制台", `<section class="hero"><span class="badge">BLACK + BLUE UI</span><h1>webhook-mail 單文件控制台</h1><p>目前登入：${escapeHtml(session.username)}</p><form method="post" action="/logout"><button class="secondary">登出</button></form></section>${notice}<section class="grid"><article class="card"><div>收到事件</div><div class="value">${store.events.length}</div></article><article class="card"><div>帳號數</div><div class="value">${users.length}</div></article><article class="card"><div>儲存</div><div class="value">JSON</div><div class="muted">${escapeHtml(DATA_FILE)}</div></article></section>${adminTools}<section><h2>最近 webhook</h2>${eventItems}</section>`);
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1));
  }
  return cookies;
}

function currentSession(req) {
  return store.sessions[parseCookies(req).webhook_mail_session] || null;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { location, ...headers });
  res.end();
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function authenticate(username, password) {
  const user = store.users[username];
  if (!user || !verifyPassword(password, user.password)) return null;
  if (!String(user.password).startsWith("pbkdf2$")) {
    user.password = hashPassword(password);
    saveStore(store);
  }
  return { username: user.username, role: user.role, createdAt: nowIso() };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { status: "ok", events: store.events.length, storage: "json" });
  if (req.method === "GET" && url.pathname === "/login") return currentSession(req) ? redirect(res, "/") : send(res, 200, loginPage());
  if (req.method === "GET" && url.pathname === "/") {
    const session = currentSession(req);
    return session ? send(res, 200, dashboard(session)) : redirect(res, "/login");
  }
  if (req.method === "POST" && url.pathname === "/login") {
    const form = querystring.parse(await readBody(req));
    const session = authenticate(String(form.username || "").trim(), String(form.password || ""));
    if (!session) return send(res, 401, loginPage("帳號或密碼錯誤"));
    const sessionId = crypto.randomBytes(32).toString("base64url");
    store.sessions[sessionId] = session;
    saveStore(store);
    return send(res, 200, dashboard(session, "登入成功"), "text/html; charset=utf-8", { "set-cookie": `webhook_mail_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/` });
  }
  if (req.method === "POST" && url.pathname === "/logout") {
    delete store.sessions[parseCookies(req).webhook_mail_session];
    saveStore(store);
    return redirect(res, "/login", { "set-cookie": "webhook_mail_session=; Max-Age=0; Path=/" });
  }
  if (req.method === "POST" && url.pathname === "/api/webhooks/email") {
    if (WEBHOOK_SHARED_SECRET && req.headers["x-webhook-secret"] !== WEBHOOK_SHARED_SECRET) return sendJson(res, 401, { ok: false, error: "invalid webhook secret" });
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { ok: false, error: "invalid json" }); }
    if (payload.event !== "email.received" || !payload.messageId) return sendJson(res, 400, { ok: false, error: "invalid payload" });
    store.events.unshift({ event: payload.event, messageId: payload.messageId, from: payload.from || "unknown", to: Array.isArray(payload.to) ? payload.to : [], rawSize: payload.rawSize || 0, subject: payload.subject || "(no subject)", headers: payload.headers || {}, textPreview: payload.textPreview || "", rawBase64: payload.rawBase64 || "", receivedAt: payload.receivedAt || nowIso(), storedAt: nowIso() });
    store.events = store.events.slice(0, 200);
    saveStore(store);
    return sendJson(res, 202, { ok: true, stored: store.events.length, storage: "json" });
  }
  if (req.method === "POST" && url.pathname === "/api/users") {
    const session = currentSession(req);
    if (!session || session.role !== "admin") return send(res, 403, loginPage("需要管理員權限"));
    const form = querystring.parse(await readBody(req));
    const username = String(form.username || "").trim();
    const password = String(form.password || "");
    if (username.length < 3 || username === "admin" || store.users[username] || password.length < 8) return send(res, 400, dashboard(session, "使用者名稱或密碼不合法"));
    store.users[username] = { username, password: hashPassword(password), role: "member", createdAt: nowIso() };
    saveStore(store);
    return send(res, 200, dashboard(session, `已建立普通用戶：${username}`));
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`webhook-mail node single-file listening on http://localhost:${PORT} (data: ${DATA_FILE})`);
});
