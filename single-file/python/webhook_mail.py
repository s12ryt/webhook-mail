#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import secrets
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


PORT = int(os.getenv("PORT", "3000"))
ADMIN_INITIAL_PASSWORD = os.getenv("ADMIN_INITIAL_PASSWORD", "change-me-now")
WEBHOOK_SHARED_SECRET = os.getenv("WEBHOOK_SHARED_SECRET", "")
DATA_FILE = Path(os.getenv("DATA_FILE", "webhook-mail-python.json"))


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return "pbkdf2$200000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    if not stored.startswith("pbkdf2$"):
        return hmac.compare_digest(password, stored)
    try:
        _, iterations, salt_b64, digest_b64 = stored.split("$", 3)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(base64.b64encode(digest).decode(), digest_b64)
    except Exception:
        return False


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, Any] = {"users": {}, "sessions": {}, "events": []}
        self.load()
        self.ensure_admin()

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                self.data.update(loaded)
        except Exception:
            pass

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")

    def ensure_admin(self) -> None:
        if "admin" not in self.data["users"]:
            self.data["users"]["admin"] = {
                "username": "admin",
                "password": hash_password(ADMIN_INITIAL_PASSWORD),
                "role": "admin",
                "createdAt": now_iso(),
            }
            self.save()

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        user = self.data["users"].get(username)
        if not user or not verify_password(password, user.get("password", "")):
            return None
        if not str(user.get("password", "")).startswith("pbkdf2$"):
            user["password"] = hash_password(password)
            self.save()
        return {"username": user["username"], "role": user["role"], "createdAt": now_iso()}

    def create_session(self, session: dict[str, Any]) -> str:
        session_id = secrets.token_urlsafe(32)
        self.data["sessions"][session_id] = session
        self.save()
        return session_id

    def get_session(self, session_id: str | None) -> dict[str, Any] | None:
        if not session_id:
            return None
        return self.data["sessions"].get(session_id)

    def delete_session(self, session_id: str | None) -> None:
        if session_id and session_id in self.data["sessions"]:
            del self.data["sessions"][session_id]
            self.save()

    def create_user(self, username: str, password: str) -> None:
        self.data["users"][username] = {
            "username": username,
            "password": hash_password(password),
            "role": "member",
            "createdAt": now_iso(),
        }
        self.save()

    def add_event(self, payload: dict[str, Any]) -> None:
        payload["storedAt"] = now_iso()
        self.data["events"].insert(0, payload)
        self.data["events"] = self.data["events"][:200]
        self.save()


store = Store(DATA_FILE)


def page(title: str, body: str) -> bytes:
    css = """
    body{margin:0;background:#06111f;color:#dbeafe;font-family:system-ui,Segoe UI,sans-serif}.wrap{max-width:1100px;margin:auto;padding:32px}.hero,.panel,.card{background:#0b1930;border:1px solid #1d4ed8;border-radius:18px;padding:22px;margin:16px 0;box-shadow:0 0 30px #0ea5e933}h1{color:#93c5fd}.badge{display:inline-block;background:#0f2f62;color:#bfdbfe;border:1px solid #2563eb;border-radius:999px;padding:4px 10px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.value{font-size:30px;font-weight:800;color:#60a5fa}input,button{width:100%;box-sizing:border-box;padding:11px;margin:7px 0;border-radius:10px;border:1px solid #2563eb;background:#081426;color:#e0f2fe}button{cursor:pointer;background:#2563eb;font-weight:700}.secondary{background:#172554}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #1e3a8a;padding:8px;text-align:left}pre{white-space:pre-wrap;background:#020617;padding:12px;border-radius:10px}.notice{padding:12px;border-radius:12px}.error{background:#7f1d1d}.success{background:#14532d}.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center}.muted{color:#93a4bd}
    """
    return f"<!doctype html><html lang='zh-Hant'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{html.escape(title)}</title><style>{css}</style></head><body><main class='wrap'>{body}</main></body></html>".encode()


def login_page(error: str = "") -> bytes:
    notice = f"<div class='notice error'>{html.escape(error)}</div>" if error else ""
    return page("webhook-mail 登入", f"<section class='hero'><span class='badge'>SINGLE FILE PYTHON</span><h1>webhook-mail 登入</h1><p>管理員帳號 admin，密碼來自 ADMIN_INITIAL_PASSWORD。</p></section>{notice}<section class='panel'><form method='post' action='/login'><label>帳號<input name='username' required></label><label>密碼<input name='password' type='password' required></label><button>登入</button></form></section>")


def dashboard(session: dict[str, Any], flash: str = "") -> bytes:
    users = sorted(store.data["users"].values(), key=lambda item: item.get("createdAt", ""))
    events = store.data["events"][:20]
    notice = f"<div class='notice success'>{html.escape(flash)}</div>" if flash else ""
    user_rows = "".join(f"<tr><td>{html.escape(u['username'])}</td><td>{html.escape(u['role'])}</td><td>{html.escape(u.get('createdAt',''))}</td></tr>" for u in users)
    event_items = "".join(f"<article class='panel'><div class='toolbar'><strong>{html.escape(e.get('subject','(no subject)'))}</strong><span class='badge'>{html.escape(e.get('event',''))}</span></div><p class='muted'>From: {html.escape(e.get('from',''))} ｜ To: {html.escape(', '.join(e.get('to', [])) if isinstance(e.get('to'), list) else str(e.get('to','')))} ｜ Received: {html.escape(e.get('receivedAt',''))}</p><pre>{html.escape(e.get('textPreview','(empty preview)'))}</pre></article>" for e in events) or "<article class='panel'><p class='muted'>尚未收到任何 webhook。</p></article>"
    admin_tools = ""
    if session.get("role") == "admin":
        admin_tools = f"<section class='panel'><h2>管理員操作</h2><div class='grid'><form method='post' action='/api/users'><label>新帳號<input name='username' minlength='3' required></label><label>初始密碼<input name='password' minlength='8' required></label><button>建立普通用戶</button></form><div><h3>目前帳號</h3><table><thead><tr><th>帳號</th><th>角色</th><th>建立時間</th></tr></thead><tbody>{user_rows}</tbody></table></div></div></section>"
    return page("webhook-mail 控制台", f"<section class='hero'><span class='badge'>BLACK + BLUE UI</span><h1>webhook-mail 單文件控制台</h1><p>目前登入：{html.escape(session.get('username',''))}</p><form method='post' action='/logout'><button class='secondary'>登出</button></form></section>{notice}<section class='grid'><article class='card'><div>收到事件</div><div class='value'>{len(store.data['events'])}</div></article><article class='card'><div>帳號數</div><div class='value'>{len(users)}</div></article><article class='card'><div>儲存</div><div class='value'>JSON</div><div class='muted'>{html.escape(str(DATA_FILE))}</div></article></section>{admin_tools}<section><h2>最近 webhook</h2>{event_items}</section>")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))

    def cookies(self) -> dict[str, str]:
        result = {}
        for part in self.headers.get("Cookie", "").split(";"):
            if "=" in part:
                key, value = part.strip().split("=", 1)
                result[key] = urllib.parse.unquote(value)
        return result

    def session(self) -> dict[str, Any] | None:
        return store.get_session(self.cookies().get("webhook_mail_session"))

    def read_body(self) -> bytes:
        return self.rfile.read(int(self.headers.get("Content-Length", "0")))

    def form(self) -> dict[str, str]:
        return {k: v[0] for k, v in urllib.parse.parse_qs(self.read_body().decode()).items()}

    def send_bytes(self, body: bytes, status: int = 200, content_type: str = "text/html; charset=utf-8", headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location: str) -> None:
        self.send_response(303)
        self.send_header("Location", location)
        self.end_headers()

    def json(self, payload: dict[str, Any], status: int = 200) -> None:
        self.send_bytes(json.dumps(payload, ensure_ascii=False).encode(), status, "application/json; charset=utf-8")

    def do_GET(self) -> None:
        if self.path == "/health":
            self.json({"status": "ok", "events": len(store.data["events"]), "storage": "json"})
        elif self.path == "/login":
            self.redirect("/") if self.session() else self.send_bytes(login_page())
        elif self.path == "/":
            session = self.session()
            self.send_bytes(dashboard(session)) if session else self.redirect("/login")
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if self.path == "/login":
            data = self.form()
            session = store.authenticate(data.get("username", "").strip(), data.get("password", ""))
            if not session:
                self.send_bytes(login_page("帳號或密碼錯誤"), 401)
                return
            session_id = store.create_session(session)
            self.send_bytes(dashboard(session, "登入成功"), headers={"Set-Cookie": f"webhook_mail_session={urllib.parse.quote(session_id)}; HttpOnly; SameSite=Lax; Path=/"})
        elif self.path == "/logout":
            store.delete_session(self.cookies().get("webhook_mail_session"))
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", "webhook_mail_session=; Max-Age=0; Path=/")
            self.end_headers()
        elif self.path == "/api/webhooks/email":
            if WEBHOOK_SHARED_SECRET and self.headers.get("x-webhook-secret") != WEBHOOK_SHARED_SECRET:
                self.json({"ok": False, "error": "invalid webhook secret"}, 401)
                return
            try:
                payload = json.loads(self.read_body().decode())
            except Exception:
                self.json({"ok": False, "error": "invalid json"}, 400)
                return
            if payload.get("event") != "email.received" or not payload.get("messageId"):
                self.json({"ok": False, "error": "invalid payload"}, 400)
                return
            payload.setdefault("subject", "(no subject)")
            payload.setdefault("from", "unknown")
            payload.setdefault("to", [])
            payload.setdefault("headers", {})
            payload.setdefault("textPreview", "")
            payload.setdefault("rawBase64", "")
            payload.setdefault("rawSize", 0)
            payload.setdefault("receivedAt", now_iso())
            store.add_event(payload)
            self.json({"ok": True, "stored": len(store.data["events"]), "storage": "json"}, 202)
        elif self.path == "/api/users":
            session = self.session()
            if not session or session.get("role") != "admin":
                self.send_bytes(login_page("需要管理員權限"), 403)
                return
            data = self.form()
            username = data.get("username", "").strip()
            password = data.get("password", "")
            if len(username) < 3 or username == "admin" or username in store.data["users"] or len(password) < 8:
                self.send_bytes(dashboard(session, "使用者名稱或密碼不合法"), 400)
                return
            store.create_user(username, password)
            self.send_bytes(dashboard(session, f"已建立普通用戶：{username}"))
        else:
            self.send_error(HTTPStatus.NOT_FOUND)


if __name__ == "__main__":
    print(f"webhook-mail python single-file listening on http://localhost:{PORT} (data: {DATA_FILE})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
