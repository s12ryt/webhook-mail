import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.io.IOException;
import java.net.HttpCookie;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;

public class WebhookMail {
  static final int PORT = Integer.parseInt(System.getenv().getOrDefault("PORT", "3000"));
  static final String ADMIN_INITIAL_PASSWORD = System.getenv().getOrDefault("ADMIN_INITIAL_PASSWORD", "change-me-now");
  static final String ADMIN_INITIAL_USERNAME = System.getenv().getOrDefault("ADMIN_INITIAL_USERNAME", "admin");
  static final String WEBHOOK_SHARED_SECRET = System.getenv().getOrDefault("WEBHOOK_SHARED_SECRET", "");
  static final Path DATA_FILE = Path.of(System.getenv().getOrDefault("DATA_FILE", "webhook-mail-java.json"));
  static final SecureRandom RANDOM = new SecureRandom();
  static Store store;

  public static void main(String[] args) throws Exception {
    store = new Store(DATA_FILE);
    HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
    server.createContext("/", WebhookMail::handle);
    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    System.out.printf("webhook-mail java single-file listening on http://localhost:%d (data: %s)%n", PORT, DATA_FILE);
    server.start();
  }

  static void handle(HttpExchange exchange) throws IOException {
    String method = exchange.getRequestMethod();
    String path = exchange.getRequestURI().getPath();
    try {
      if (method.equals("GET") && path.equals("/health")) {
        sendJson(exchange, 200, Map.of("status", "ok", "events", store.events.size(), "storage", "json"));
      } else if (method.equals("GET") && path.equals("/login")) {
        if (session(exchange) != null) redirect(exchange, "/", null); else sendHtml(exchange, 200, loginPage(""), null);
      } else if (method.equals("GET") && path.equals("/")) {
        Map<String, Object> session = session(exchange);
        if (session == null) redirect(exchange, "/login", null); else sendHtml(exchange, 200, dashboard(session, ""), null);
      } else if (method.equals("POST") && path.equals("/login")) {
        Map<String, String> form = parseForm(body(exchange));
        Map<String, Object> session = store.authenticate(form.getOrDefault("username", "").trim(), form.getOrDefault("password", ""));
        if (session == null) {
          sendHtml(exchange, 401, loginPage("帳號或密碼錯誤"), null);
          return;
        }
        String sessionId = UUID.randomUUID() + "-" + token(24);
        store.sessions.put(sessionId, session);
        store.save();
        sendHtml(exchange, 200, dashboard(session, "登入成功"), Map.of("Set-Cookie", "webhook_mail_session=" + sessionId + "; HttpOnly; SameSite=Lax; Path=/"));
      } else if (method.equals("POST") && path.equals("/logout")) {
        store.sessions.remove(cookies(exchange).get("webhook_mail_session"));
        store.save();
        redirect(exchange, "/login", Map.of("Set-Cookie", "webhook_mail_session=; Max-Age=0; Path=/"));
      } else if (method.equals("POST") && path.equals("/api/webhooks/email")) {
        if (!WEBHOOK_SHARED_SECRET.isBlank() && !WEBHOOK_SHARED_SECRET.equals(exchange.getRequestHeaders().getFirst("x-webhook-secret"))) {
          sendJson(exchange, 401, Map.of("ok", false, "error", "invalid webhook secret"));
          return;
        }
        Object parsed = Json.parse(body(exchange));
        if (!(parsed instanceof Map<?, ?> raw) || !"email.received".equals(String.valueOf(raw.get("event"))) || raw.get("messageId") == null) {
          sendJson(exchange, 400, Map.of("ok", false, "error", "invalid payload"));
          return;
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("event", "email.received");
        event.put("messageId", String.valueOf(raw.get("messageId")));
        event.put("from", String.valueOf(raw.containsKey("from") ? raw.get("from") : "unknown"));
        event.put("to", raw.get("to") instanceof List<?> ? raw.get("to") : List.of());
        event.put("rawSize", raw.containsKey("rawSize") ? raw.get("rawSize") : 0);
        event.put("subject", String.valueOf(raw.containsKey("subject") ? raw.get("subject") : "(no subject)"));
        event.put("headers", raw.get("headers") instanceof Map<?, ?> ? raw.get("headers") : Map.of());
        event.put("textPreview", String.valueOf(raw.containsKey("textPreview") ? raw.get("textPreview") : ""));
        event.put("rawBase64", String.valueOf(raw.containsKey("rawBase64") ? raw.get("rawBase64") : ""));
        event.put("receivedAt", String.valueOf(raw.containsKey("receivedAt") ? raw.get("receivedAt") : nowIso()));
        event.put("storedAt", nowIso());
        store.events.add(0, event);
        while (store.events.size() > 200) store.events.remove(store.events.size() - 1);
        store.save();
        sendJson(exchange, 202, Map.of("ok", true, "stored", store.events.size(), "storage", "json"));
      } else if (method.equals("POST") && path.equals("/api/users")) {
        Map<String, Object> session = session(exchange);
        if (session == null || !"admin".equals(session.get("role"))) {
          sendHtml(exchange, 403, loginPage("需要管理員權限"), null);
          return;
        }
        Map<String, String> form = parseForm(body(exchange));
        String username = form.getOrDefault("username", "").trim();
        String password = form.getOrDefault("password", "");
        if (username.length() < 3 || username.equals(ADMIN_INITIAL_USERNAME) || store.users.containsKey(username) || password.length() < 8) {
          sendHtml(exchange, 400, dashboard(session, "使用者名稱或密碼不合法"), null);
          return;
        }
        store.users.put(username, new LinkedHashMap<>(Map.of("username", username, "password", hashPassword(password), "role", "member", "createdAt", nowIso())));
        store.save();
        sendHtml(exchange, 200, dashboard(session, "已建立普通用戶：" + username), null);
      } else {
        sendText(exchange, 404, "not found");
      }
    } catch (Exception error) {
      error.printStackTrace();
      sendText(exchange, 500, "internal server error: " + error.getMessage());
    }
  }

  static String nowIso() { return Instant.now().toString(); }

  static String token(int bytes) {
    byte[] data = new byte[bytes];
    RANDOM.nextBytes(data);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
  }

  static String hashPassword(String password) throws Exception {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    byte[] digest = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(password.toCharArray(), salt, 200_000, 256)).getEncoded();
    return "pbkdf2$200000$" + Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(digest);
  }

  static boolean verifyPassword(String password, String stored) throws Exception {
    if (!stored.startsWith("pbkdf2$")) return password.equals(stored);
    String[] parts = stored.split("\\$", 4);
    if (parts.length != 4) return false;
    byte[] salt = Base64.getDecoder().decode(parts[2]);
    byte[] expected = Base64.getDecoder().decode(parts[3]);
    byte[] actual = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(password.toCharArray(), salt, Integer.parseInt(parts[1]), 256)).getEncoded();
    return java.security.MessageDigest.isEqual(expected, actual);
  }

  static Map<String, String> cookies(HttpExchange exchange) {
    Map<String, String> result = new HashMap<>();
    List<String> headers = exchange.getRequestHeaders().getOrDefault("Cookie", List.of());
    for (String header : headers) {
      for (String part : header.split(";")) {
        int index = part.indexOf('=');
        if (index > -1) result.put(part.substring(0, index).trim(), urlDecode(part.substring(index + 1)));
      }
    }
    return result;
  }

  static Map<String, Object> session(HttpExchange exchange) {
    return store.sessions.get(cookies(exchange).get("webhook_mail_session"));
  }

  static String body(HttpExchange exchange) throws IOException {
    return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
  }

  static Map<String, String> parseForm(String body) {
    Map<String, String> result = new HashMap<>();
    if (body.isBlank()) return result;
    for (String part : body.split("&")) {
      int index = part.indexOf('=');
      if (index > -1) result.put(urlDecode(part.substring(0, index)), urlDecode(part.substring(index + 1)));
    }
    return result;
  }

  static String urlDecode(String value) { return URLDecoder.decode(value, StandardCharsets.UTF_8); }

  static void sendHtml(HttpExchange exchange, int status, String html, Map<String, String> headers) throws IOException {
    send(exchange, status, html, "text/html; charset=utf-8", headers);
  }

  static void sendText(HttpExchange exchange, int status, String text) throws IOException {
    send(exchange, status, text, "text/plain; charset=utf-8", null);
  }

  static void sendJson(HttpExchange exchange, int status, Object payload) throws IOException {
    send(exchange, status, Json.stringify(payload), "application/json; charset=utf-8", null);
  }

  static void send(HttpExchange exchange, int status, String body, String contentType, Map<String, String> extraHeaders) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    Headers headers = exchange.getResponseHeaders();
    headers.set("Content-Type", contentType);
    if (extraHeaders != null) extraHeaders.forEach(headers::set);
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }

  static void redirect(HttpExchange exchange, String location, Map<String, String> extraHeaders) throws IOException {
    Headers headers = exchange.getResponseHeaders();
    headers.set("Location", location);
    if (extraHeaders != null) extraHeaders.forEach(headers::set);
    exchange.sendResponseHeaders(303, -1);
    exchange.close();
  }

  static String esc(Object value) {
    return String.valueOf(value == null ? "" : value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
  }

  static String page(String title, String body) {
    String css = "body{margin:0;background:#06111f;color:#dbeafe;font-family:system-ui,Segoe UI,sans-serif}.wrap{max-width:1100px;margin:auto;padding:32px}.hero,.panel,.card{background:#0b1930;border:1px solid #1d4ed8;border-radius:18px;padding:22px;margin:16px 0;box-shadow:0 0 30px #0ea5e933}h1{color:#93c5fd}.badge{display:inline-block;background:#0f2f62;color:#bfdbfe;border:1px solid #2563eb;border-radius:999px;padding:4px 10px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.value{font-size:30px;font-weight:800;color:#60a5fa}input,button{width:100%;box-sizing:border-box;padding:11px;margin:7px 0;border-radius:10px;border:1px solid #2563eb;background:#081426;color:#e0f2fe}button{cursor:pointer;background:#2563eb;font-weight:700}.secondary{background:#172554}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #1e3a8a;padding:8px;text-align:left}pre{white-space:pre-wrap;background:#020617;padding:12px;border-radius:10px}.notice{padding:12px;border-radius:12px}.error{background:#7f1d1d}.success{background:#14532d}.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center}.muted{color:#93a4bd}";
    return "<!doctype html><html lang='zh-Hant'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(title) + "</title><style>" + css + "</style></head><body><main class='wrap'>" + body + "</main></body></html>";
  }

  static String loginPage(String error) {
    String notice = error == null || error.isBlank() ? "" : "<div class='notice error'>" + esc(error) + "</div>";
    return page("webhook-mail 登入", "<section class='hero'><span class='badge'>SINGLE FILE JAVA</span><h1>webhook-mail 登入</h1><p>管理員帳號來自 ADMIN_INITIAL_USERNAME，密碼來自 ADMIN_INITIAL_PASSWORD。</p></section>" + notice + "<section class='panel'><form method='post' action='/login'><label>帳號<input name='username' required></label><label>密碼<input name='password' type='password' required></label><button>登入</button></form></section>");
  }

  static String dashboard(Map<String, Object> session, String flash) {
    List<Map<String, Object>> users = new ArrayList<>(store.users.values());
    users.sort(Comparator.comparing(user -> String.valueOf(user.get("createdAt"))));
    StringBuilder userRows = new StringBuilder();
    for (Map<String, Object> user : users) userRows.append("<tr><td>").append(esc(user.get("username"))).append("</td><td>").append(esc(user.get("role"))).append("</td><td>").append(esc(user.get("createdAt"))).append("</td></tr>");
    StringBuilder events = new StringBuilder();
    for (int i = 0; i < Math.min(20, store.events.size()); i++) {
      Map<String, Object> event = store.events.get(i);
      events.append("<article class='panel'><div class='toolbar'><strong>").append(esc(event.getOrDefault("subject", "(no subject)"))).append("</strong><span class='badge'>").append(esc(event.get("event"))).append("</span></div><p class='muted'>From: ").append(esc(event.get("from"))).append(" ｜ To: ").append(esc(event.get("to"))).append(" ｜ Received: ").append(esc(event.get("receivedAt"))).append("</p><pre>").append(esc(event.getOrDefault("textPreview", "(empty preview)"))).append("</pre></article>");
    }
    if (events.isEmpty()) events.append("<article class='panel'><p class='muted'>尚未收到任何 webhook。</p></article>");
    String notice = flash == null || flash.isBlank() ? "" : "<div class='notice success'>" + esc(flash) + "</div>";
    String adminTools = "";
    if ("admin".equals(session.get("role"))) {
      adminTools = "<section class='panel'><h2>管理員操作</h2><div class='grid'><form method='post' action='/api/users'><label>新帳號<input name='username' minlength='3' required></label><label>初始密碼<input name='password' minlength='8' required></label><button>建立普通用戶</button></form><div><h3>目前帳號</h3><table><thead><tr><th>帳號</th><th>角色</th><th>建立時間</th></tr></thead><tbody>" + userRows + "</tbody></table></div></div></section>";
    }
    return page("webhook-mail 控制台", "<section class='hero'><span class='badge'>BLACK + BLUE UI</span><h1>webhook-mail 單文件控制台</h1><p>目前登入：" + esc(session.get("username")) + "</p><form method='post' action='/logout'><button class='secondary'>登出</button></form></section>" + notice + "<section class='grid'><article class='card'><div>收到事件</div><div class='value'>" + store.events.size() + "</div></article><article class='card'><div>帳號數</div><div class='value'>" + users.size() + "</div></article><article class='card'><div>儲存</div><div class='value'>JSON</div><div class='muted'>" + esc(DATA_FILE) + "</div></article></section>" + adminTools + "<section><h2>最近 webhook</h2>" + events + "</section>");
  }

  static class Store {
    final Path path;
    Map<String, Map<String, Object>> users = new LinkedHashMap<>();
    Map<String, Map<String, Object>> sessions = new LinkedHashMap<>();
    List<Map<String, Object>> events = new ArrayList<>();

    Store(Path path) throws Exception {
      this.path = path;
      load();
      if (!users.containsKey(ADMIN_INITIAL_USERNAME)) {
        users.put(ADMIN_INITIAL_USERNAME, new LinkedHashMap<>(Map.of("username", ADMIN_INITIAL_USERNAME, "password", hashPassword(ADMIN_INITIAL_PASSWORD), "role", "admin", "createdAt", nowIso())));
        save();
      }
    }

    @SuppressWarnings("unchecked")
    void load() throws IOException {
      if (!Files.exists(path)) return;
      Object parsed = Json.parse(Files.readString(path));
      if (!(parsed instanceof Map<?, ?> root)) return;
      Object rawUsers = root.get("users");
      if (rawUsers instanceof Map<?, ?> map) map.forEach((key, value) -> { if (value instanceof Map<?, ?> user) users.put(String.valueOf(key), (Map<String, Object>) user); });
      Object rawSessions = root.get("sessions");
      if (rawSessions instanceof Map<?, ?> map) map.forEach((key, value) -> { if (value instanceof Map<?, ?> session) sessions.put(String.valueOf(key), (Map<String, Object>) session); });
      Object rawEvents = root.get("events");
      if (rawEvents instanceof List<?> list) for (Object value : list) if (value instanceof Map<?, ?> event) events.add((Map<String, Object>) event);
    }

    void save() throws IOException {
      Map<String, Object> root = new LinkedHashMap<>();
      root.put("users", users);
      root.put("sessions", sessions);
      root.put("events", events);
      Files.writeString(path, Json.stringify(root), StandardCharsets.UTF_8);
    }

    Map<String, Object> authenticate(String username, String password) throws Exception {
      Map<String, Object> user = users.get(username);
      if (user == null || !verifyPassword(password, String.valueOf(user.get("password")))) return null;
      if (!String.valueOf(user.get("password")).startsWith("pbkdf2$")) {
        user.put("password", hashPassword(password));
        save();
      }
      return new LinkedHashMap<>(Map.of("username", user.get("username"), "role", user.get("role"), "createdAt", nowIso()));
    }
  }

  static class Json {
    static Object parse(String text) {
      return new Parser(text).parseValue();
    }

    static String stringify(Object value) {
      StringBuilder out = new StringBuilder();
      write(out, value);
      return out.toString();
    }

    static void write(StringBuilder out, Object value) {
      if (value == null) out.append("null");
      else if (value instanceof String s) out.append('"').append(s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")).append('"');
      else if (value instanceof Number || value instanceof Boolean) out.append(value);
      else if (value instanceof Map<?, ?> map) {
        out.append('{');
        boolean first = true;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
          if (!first) out.append(',');
          first = false;
          write(out, String.valueOf(entry.getKey()));
          out.append(':');
          write(out, entry.getValue());
        }
        out.append('}');
      } else if (value instanceof Iterable<?> list) {
        out.append('[');
        boolean first = true;
        for (Object item : list) {
          if (!first) out.append(',');
          first = false;
          write(out, item);
        }
        out.append(']');
      } else write(out, String.valueOf(value));
    }

    static class Parser {
      final String text;
      int pos;
      Parser(String text) { this.text = text == null ? "" : text; }
      Object parseValue() {
        skip();
        if (pos >= text.length()) return null;
        char c = text.charAt(pos);
        if (c == '{') return object();
        if (c == '[') return array();
        if (c == '"') return string();
        if (text.startsWith("true", pos)) { pos += 4; return true; }
        if (text.startsWith("false", pos)) { pos += 5; return false; }
        if (text.startsWith("null", pos)) { pos += 4; return null; }
        return number();
      }
      Map<String, Object> object() {
        Map<String, Object> map = new LinkedHashMap<>();
        pos++;
        skip();
        while (pos < text.length() && text.charAt(pos) != '}') {
          String key = string();
          skip();
          if (pos < text.length() && text.charAt(pos) == ':') pos++;
          map.put(key, parseValue());
          skip();
          if (pos < text.length() && text.charAt(pos) == ',') pos++;
          skip();
        }
        if (pos < text.length()) pos++;
        return map;
      }
      List<Object> array() {
        List<Object> list = new ArrayList<>();
        pos++;
        skip();
        while (pos < text.length() && text.charAt(pos) != ']') {
          list.add(parseValue());
          skip();
          if (pos < text.length() && text.charAt(pos) == ',') pos++;
          skip();
        }
        if (pos < text.length()) pos++;
        return list;
      }
      String string() {
        StringBuilder out = new StringBuilder();
        if (pos < text.length() && text.charAt(pos) == '"') pos++;
        while (pos < text.length()) {
          char c = text.charAt(pos++);
          if (c == '"') break;
          if (c == '\\' && pos < text.length()) {
            char n = text.charAt(pos++);
            if (n == 'n') out.append('\n'); else if (n == 'r') out.append('\r'); else if (n == 't') out.append('\t'); else out.append(n);
          } else out.append(c);
        }
        return out.toString();
      }
      Number number() {
        int start = pos;
        while (pos < text.length() && "-0123456789.eE+".indexOf(text.charAt(pos)) >= 0) pos++;
        String raw = text.substring(start, pos);
        try { return raw.contains(".") ? Double.parseDouble(raw) : Long.parseLong(raw); } catch (Exception ignored) { return 0; }
      }
      void skip() { while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) pos++; }
    }
  }
}
