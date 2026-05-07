(function () {
  function text(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function attr(value) {
    return text(value);
  }

  function parseData() {
    var element = document.getElementById("webhook-mail-data");
    if (!element) return { page: "login" };
    try { return JSON.parse(element.textContent || "{}"); } catch (_) { return { page: "login" }; }
  }

  function notice(item) {
    if (!item || !item.message) return "";
    return '<div class="notice ' + attr(item.kind || "success") + '"><strong>' + text(item.message) + '</strong>' + (item.detail ? '<div class="muted-code">' + text(item.detail) + '</div>' : '') + '</div>';
  }

  function login(data) {
    return '' +
      '<section class="hero"><span class="badge">LIVE WEB UI</span><h1>webhook-mail 登入</h1><p>此頁面由倉庫 web-ui 載入；若更新 web-ui，服務會在熱更新週期後自動套用，不需重啟。</p></section>' +
      notice(data.error ? { kind: "error", message: data.error } : null) +
      '<section class="panel" style="max-width:560px"><h2>登入</h2><form method="post" action="/login"><label>帳號<input name="username" autocomplete="username" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">登入</button></form></section>';
  }

  function connectionCard(title, value) {
    return '<article class="card"><div class="label">' + text(title) + '</div><div class="value">' + (value ? '已讀取' : '未設定') + '</div><div class="muted-code">' + text(value ? String(value).slice(0, 4) + '••••' + String(value).slice(-4) : '請透過環境變數提供') + '</div></article>';
  }

  function dashboard(data) {
    var session = data.session || {};
    var users = data.users || [];
    var events = data.receivedEvents || [];
    var stats = data.stats || {};
    var conn = data.connections || {};
    var userRows = users.map(function (user) {
      return '<tr><td>' + text(user.username) + '</td><td>' + text(user.role) + '</td><td>' + text(user.createdAt) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted">尚未建立任何帳號</td></tr>';
    var adminTools = session.role === 'admin' ? '<section class="panel"><div class="toolbar"><div><h2>管理員操作</h2><div class="muted">可建立普通用戶，禁止自助註冊。</div></div><form method="post" action="/logout"><button class="secondary" type="submit">登出</button></form></div><div class="split"><form method="post" action="/api/users"><label>新帳號<input name="username" autocomplete="off" required minlength="3" maxlength="32"></label><label>初始密碼<input name="password" type="text" autocomplete="off" required minlength="8" maxlength="64"></label><button type="submit">建立用戶</button></form><div><h3>目前帳號</h3><table><thead><tr><th>帳號</th><th>角色</th><th>建立時間</th></tr></thead><tbody>' + userRows + '</tbody></table></div></div></section>' : '<section class="panel"><div class="toolbar"><div><h2>目前登入：' + text(session.username) + '</h2><div class="muted">普通用戶只能查看郵件事件與系統狀態。</div></div><form method="post" action="/logout"><button class="secondary" type="submit">登出</button></form></div></section>';
    var eventItems = events.map(function (event) {
      var to = Array.isArray(event.to) ? event.to.join(', ') : event.to;
      return '<article class="list-item"><div class="toolbar"><strong>' + text(event.subject || '(no subject)') + '</strong><span class="badge">' + text(event.event) + '</span></div><div class="muted">From: ' + text(event.from) + ' ｜ To: ' + text(to) + ' ｜ Received: ' + text(event.receivedAt) + '</div><pre>' + text(event.textPreview || '(empty preview)') + '</pre></article>';
    }).join('') || '<article class="list-item"><div class="muted">尚未收到任何 webhook。</div></article>';
    return '<section class="hero"><span class="badge">BLACK + BLUE LIVE UI</span><h1>webhook-mail 控制台</h1><p>Docker 與單文件版本共用同一套 web-ui，支援熱更新與內建 fallback。</p></section>' + notice(data.flash) + '<section class="stats"><article class="card"><div class="label">登入身份</div><div class="value">' + text(session.role) + '</div></article><article class="card"><div class="label">收到事件</div><div class="value">' + text(stats.eventCount || 0) + '</div></article><article class="card"><div class="label">帳號數</div><div class="value">' + text(stats.userCount || 0) + '</div></article><article class="card"><div class="label">儲存模式</div><div class="value">' + text(stats.storageMode || 'json') + '</div></article></section><section class="grid">' + connectionCard('MySQL', conn.mysqlConnection) + connectionCard('Postgres', conn.postgresConnection) + connectionCard('GitHub', conn.githubConnection) + '</section>' + adminTools + '<section class="panel"><div class="toolbar"><div><h2>最近 webhook</h2><div class="muted">保留最新 20 筆郵件事件。</div></div><span class="badge">/api/webhooks/email</span></div><div class="list">' + eventItems + '</div></section><div class="footer">webhook-mail · shared web-ui · hot reload ready</div>';
  }

  var data = parseData();
  var root = document.getElementById("app");
  root.innerHTML = data.page === "dashboard" ? dashboard(data) : login(data);
})();
