#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const crypto = require("node:crypto");
const querystring = require("node:querystring");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || "change-me-now";
const ADMIN_INITIAL_USERNAME = process.env.ADMIN_INITIAL_USERNAME || "admin";
const WEBHOOK_SHARED_SECRET = process.env.WEBHOOK_SHARED_SECRET || "";
const DATA_FILE = process.env.DATA_FILE || "webhook-mail-node.json";
const WEB_UI_RAW_BASE = (process.env.WEB_UI_RAW_BASE || "https://raw.githubusercontent.com/s12ryt/webhook-mail/main/web-ui").replace(/\/+$/g, "");
const WEB_UI_REFRESH_SECONDS = Number(process.env.WEB_UI_REFRESH_SECONDS || 30);
const WEB_UI_CACHE_DIR = process.env.WEB_UI_CACHE_DIR || ".web-ui-cache";
const WEB_UI_FETCH_TIMEOUT_MS = Number(process.env.WEB_UI_FETCH_TIMEOUT_MS || 5000);
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 60 * 1000;
const LOGIN_RATE_GC_INTERVAL_MS = 60 * 1000;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const loginRateLimits = new Map();
let loginRateLastGcAt = 0;
let webUiLastCheckedAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

function isExpired(iso) {
  const time = Date.parse(String(iso || ""));
  return Number.isFinite(time) && time <= Date.now();
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function isLoginLocked(ip) {
  gcLoginRateLimits();
  const state = loginRateLimits.get(ip);
  if (!state) return false;
  if (state.lockedUntil <= Date.now()) {
    loginRateLimits.delete(ip);
    return false;
  }
  return true;
}

function gcLoginRateLimits(now = Date.now()) {
  if (now - loginRateLastGcAt < LOGIN_RATE_GC_INTERVAL_MS) return;
  loginRateLastGcAt = now;
  for (const [ip, state] of loginRateLimits) {
    if (state.lockedUntil <= now) loginRateLimits.delete(ip);
  }
}

function recordLoginFailure(ip) {
  const state = loginRateLimits.get(ip) || { failed: 0, lockedUntil: 0 };
  state.failed += 1;
  if (state.failed >= LOGIN_FAILURE_LIMIT) state.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  loginRateLimits.set(ip, state);
}

function recordLoginSuccess(ip) {
  loginRateLimits.delete(ip);
}

function cookieSecuritySuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
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
    const expected = Buffer.from(String(stored || ""));
    const actual = Buffer.from(password);
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }
  const parts = String(stored).split("$");
  if (parts.length !== 4) return false;
  const digest = crypto.pbkdf2Sync(password, Buffer.from(parts[2], "base64"), Number(parts[1]), 32, "sha256");
  const expected = Buffer.from(parts[3], "base64");
  return expected.length === digest.length && crypto.timingSafeEqual(digest, expected);
}

function loadStore() {
  let data = { users: {}, sessions: {}, events: [] };
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
    } catch {}
  }
  if (!data.users[ADMIN_INITIAL_USERNAME]) {
    data.users[ADMIN_INITIAL_USERNAME] = { username: ADMIN_INITIAL_USERNAME, password: hashPassword(ADMIN_INITIAL_PASSWORD), role: "admin", createdAt: nowIso() };
    saveStore(data);
  }
  return data;
}

function saveStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const store = loadStore();

function fallbackPage(title, body) {
  const css = `body{margin:0;background:#06111f;color:#dbeafe;font-family:system-ui,Segoe UI,sans-serif}.wrap{max-width:1100px;margin:auto;padding:32px}.hero,.panel,.card{background:#0b1930;border:1px solid #1d4ed8;border-radius:18px;padding:22px;margin:16px 0;box-shadow:0 0 30px #0ea5e933}h1{color:#93c5fd}.badge{display:inline-block;background:#0f2f62;color:#bfdbfe;border:1px solid #2563eb;border-radius:999px;padding:4px 10px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.value{font-size:30px;font-weight:800;color:#60a5fa}input,button{width:100%;box-sizing:border-box;padding:11px;margin:7px 0;border-radius:10px;border:1px solid #2563eb;background:#081426;color:#e0f2fe}button{cursor:pointer;background:#2563eb;font-weight:700}.secondary{background:#172554}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #1e3a8a;padding:8px;text-align:left}pre{white-space:pre-wrap;background:#020617;padding:12px;border-radius:10px}.notice{padding:12px;border-radius:12px}.error{background:#7f1d1d}.success{background:#14532d}.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center}.muted{color:#93a4bd}`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main class="wrap">${body}</main></body></html>`;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? require("node:https") : require("node:http");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Fetch ${url} timed out after ${WEB_UI_FETCH_TIMEOUT_MS}ms`)), WEB_UI_FETCH_TIMEOUT_MS);
    const req = client.get(url, { headers: { "user-agent": "webhook-mail-single-file-node" }, signal: controller.signal }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        clearTimeout(timeout);
        reject(new Error(`Fetch ${url} failed: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      res.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    req.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function isSafeWebUiAssetName(name) {
  if (typeof name !== "string" || !name) return false;
  if (name.includes("\\")) return false;
  if (name.startsWith("/") || name.startsWith(".") || name.includes("..")) return false;
  const normalized = require("node:path").posix.normalize(name);
  return normalized === name && !normalized.startsWith("../") && !normalized.includes("/../") && !normalized.endsWith("/..") && !normalized.includes("//");
}

async function refreshWebUi() {
  const now = Date.now();
  if (now - webUiLastCheckedAt < Math.max(1, WEB_UI_REFRESH_SECONDS) * 1000) return;
  webUiLastCheckedAt = now;
  fs.mkdirSync(WEB_UI_CACHE_DIR, { recursive: true });
  const manifest = JSON.parse(await fetchText(`${WEB_UI_RAW_BASE}/manifest.json`));
  const manifestPath = `${WEB_UI_CACHE_DIR}/manifest.json`;
  let cachedVersion = "";
  try { cachedVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version || ""; } catch {}
  if (cachedVersion === manifest.version && fs.existsSync(`${WEB_UI_CACHE_DIR}/index.html`)) return;
  for (const file of manifest.files || []) {
    if (!isSafeWebUiAssetName(file)) continue;
    const target = `${WEB_UI_CACHE_DIR}/${file}`;
    const content = await fetchText(`${WEB_UI_RAW_BASE}/${file}`);
    const expected = manifest.checksums && manifest.checksums[file];
    if (expected) {
      const actual = crypto.createHash("sha256").update(content, "utf8").digest("hex");
      if (actual !== String(expected).toLowerCase()) throw new Error(`Checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
    }
    fs.mkdirSync(require("node:path").dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function page(title, data, fallbackHtml) {
  try { await refreshWebUi(); } catch (error) { console.warn("web-ui refresh failed; using cache/fallback", error.message); }
  try {
    const html = fs.readFileSync(`${WEB_UI_CACHE_DIR}/index.html`, "utf8");
    const css = fs.readFileSync(`${WEB_UI_CACHE_DIR}/style.css`, "utf8");
    const js = fs.readFileSync(`${WEB_UI_CACHE_DIR}/app.js`, "utf8");
    return html.replaceAll("{{TITLE}}", escapeHtml(title)).replace("{{STYLE_CSS}}", css).replace("{{APP_DATA_JSON}}", JSON.stringify(data).replaceAll("<", "\\u003c")).replace("{{APP_JS}}", js);
  } catch {
    return fallbackHtml;
  }
}

async function loginPage(error = "") {
  const notice = error ? `<div class="notice error">${escapeHtml(error)}</div>` : "";
  const fallback = fallbackPage("webhook-mail 登入", `<section class="hero"><span class="badge">SINGLE FILE NODE</span><h1>webhook-mail 登入</h1><p>管理員帳號來自 ADMIN_INITIAL_USERNAME，密碼來自 ADMIN_INITIAL_PASSWORD。</p></section>${notice}<section class="panel"><form method="post" action="/login"><label>帳號<input name="username" required></label><label>密碼<input name="password" type="password" required></label><button>登入</button></form></section>`);
  return page("webhook-mail 登入", { page: "login", error }, fallback);
}

async function dashboard(session, flash = "") {
  const users = Object.values(store.users).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const events = store.events.slice(0, 20);
  const notice = flash ? `<div class="notice success">${escapeHtml(flash)}</div>` : "";
  const userRows = users.map((u) => `<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td><td>${escapeHtml(u.createdAt)}</td></tr>`).join("");
  const eventItems = events.map((e) => `<article class="panel"><div class="toolbar"><strong>${escapeHtml(e.subject || "(no subject)")}</strong><span class="badge">${escapeHtml(e.event)}</span></div><p class="muted">From: ${escapeHtml(e.from)} ｜ To: ${escapeHtml(Array.isArray(e.to) ? e.to.join(", ") : e.to)} ｜ Received: ${escapeHtml(e.receivedAt)}</p><pre>${escapeHtml(e.textPreview || "(empty preview)")}</pre></article>`).join("") || `<article class="panel"><p class="muted">尚未收到任何 webhook。</p></article>`;
  const adminTools = session.role === "admin" ? `<section class="panel"><h2>管理員操作</h2><div class="grid"><form method="post" action="/api/users"><label>新帳號<input name="username" minlength="3" required></label><label>初始密碼<input name="password" minlength="8" required></label><button>建立普通用戶</button></form><div><h3>目前帳號</h3><table><thead><tr><th>帳號</th><th>角色</th><th>建立時間</th></tr></thead><tbody>${userRows}</tbody></table></div></div></section>` : "";
  const fallback = fallbackPage("webhook-mail 控制台", `<section class="hero"><span class="badge">BLACK + BLUE UI</span><h1>webhook-mail 單文件控制台</h1><p>目前登入：${escapeHtml(session.username)}</p><form method="post" action="/logout"><button class="secondary">登出</button></form></section>${notice}<section class="grid"><article class="card"><div>收到事件</div><div class="value">${store.events.length}</div></article><article class="card"><div>帳號數</div><div class="value">${users.length}</div></article><article class="card"><div>儲存</div><div class="value">JSON</div><div class="muted">${escapeHtml(DATA_FILE)}</div></article></section>${adminTools}<section><h2>最近 webhook</h2>${eventItems}</section>`);
  return page("webhook-mail 控制台", { page: "dashboard", session, users, receivedEvents: events, stats: { userCount: users.length, eventCount: store.events.length, storageMode: "json" }, connections: {}, flash: flash ? { kind: "success", message: flash } : null }, fallback);
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
  const sessionId = parseCookies(req).webhook_mail_session;
  const session = store.sessions[sessionId] || null;
  if (session && isExpired(session.expiresAt)) {
    delete store.sessions[sessionId];
    saveStore(store);
    return null;
  }
  return session;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy(new Error("request body too large"));
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
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
  return { username: user.username, role: user.role, createdAt: nowIso(), expiresAt: sessionExpiresAt() };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { status: "ok", events: store.events.length, storage: "json" });
  if (req.method === "GET" && url.pathname === "/login") return currentSession(req) ? redirect(res, "/") : send(res, 200, await loginPage());
  if (req.method === "GET" && url.pathname === "/") {
    const session = currentSession(req);
    return session ? send(res, 200, await dashboard(session)) : redirect(res, "/login");
  }
  if (req.method === "POST" && url.pathname === "/login") {
    const ip = clientIp(req);
    if (isLoginLocked(ip)) return send(res, 429, await loginPage("登入失敗太多次，請 60 秒後再試"));
    let form;
    try { form = querystring.parse(await readBody(req)); } catch { return send(res, 413, await loginPage("請求內容過大")); }
    const session = authenticate(String(form.username || "").trim(), String(form.password || ""));
    if (!session) {
      recordLoginFailure(ip);
      return send(res, 401, await loginPage("帳號或密碼錯誤"));
    }
    recordLoginSuccess(ip);
    const sessionId = crypto.randomBytes(32).toString("base64url");
    store.sessions[sessionId] = session;
    saveStore(store);
    return send(res, 200, await dashboard(session, "登入成功"), "text/html; charset=utf-8", { "set-cookie": `webhook_mail_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/${cookieSecuritySuffix()}` });
  }
  if (req.method === "POST" && url.pathname === "/logout") {
    delete store.sessions[parseCookies(req).webhook_mail_session];
    saveStore(store);
    return redirect(res, "/login", { "set-cookie": `webhook_mail_session=; Max-Age=0; Path=/${cookieSecuritySuffix()}` });
  }
  if (req.method === "POST" && url.pathname === "/api/webhooks/email") {
    if (WEBHOOK_SHARED_SECRET && req.headers["x-webhook-secret"] !== WEBHOOK_SHARED_SECRET) return sendJson(res, 401, { ok: false, error: "invalid webhook secret" });
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (error) { return sendJson(res, error.message === "request body too large" ? 413 : 400, { ok: false, error: error.message === "request body too large" ? "request body too large" : "invalid json" }); }
    if (payload.event !== "email.received" || !payload.messageId) return sendJson(res, 400, { ok: false, error: "invalid payload" });
    store.events.unshift({ event: payload.event, messageId: payload.messageId, from: payload.from || "unknown", to: Array.isArray(payload.to) ? payload.to : [], rawSize: payload.rawSize || 0, subject: payload.subject || "(no subject)", headers: payload.headers || {}, textPreview: payload.textPreview || "", rawBase64: payload.rawBase64 || "", receivedAt: payload.receivedAt || nowIso(), storedAt: nowIso() });
    store.events = store.events.slice(0, 200);
    saveStore(store);
    return sendJson(res, 202, { ok: true, stored: store.events.length, storage: "json" });
  }
  if (req.method === "POST" && url.pathname === "/api/users") {
    const session = currentSession(req);
    if (!session || session.role !== "admin") return send(res, 403, await loginPage("需要管理員權限"));
    let form;
    try { form = querystring.parse(await readBody(req)); } catch { return send(res, 413, await dashboard(session, "請求內容過大")); }
    const username = String(form.username || "").trim();
    const password = String(form.password || "");
    if (username.length < 3 || username === ADMIN_INITIAL_USERNAME || store.users[username] || password.length < 8) return send(res, 400, await dashboard(session, "使用者名稱或密碼不合法"));
    store.users[username] = { username, password: hashPassword(password), role: "member", createdAt: nowIso() };
    saveStore(store);
    return send(res, 200, await dashboard(session, `已建立普通用戶：${username}`));
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`webhook-mail node single-file listening on http://localhost:${PORT} (data: ${DATA_FILE})`);
});
