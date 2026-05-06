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

const app = express();
const port = Number(process.env.PORT ?? 3000);
const sharedSecret = process.env.WEBHOOK_SHARED_SECRET;

const receivedEvents: EmailWebhookPayload[] = [];

app.use(express.json({ limit: "15mb" }));

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

app.get("/", (_request: Request, response: Response) => {
  response.type("html").send(renderPage(receivedEvents));
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

app.listen(port, () => {
  console.log(`docker-accept listening on http://localhost:${port}`);
});
