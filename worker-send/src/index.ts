export interface Env {
  DOCKER_ACCEPT_WEBHOOK_URL: string;
  WEBHOOK_SHARED_SECRET?: string;
  WEBHOOK_TIMEOUT_MS?: string;
}

type EmailWebhookPayload = {
  event: "email.received";
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

const encoder = new TextEncoder();

function parseWebhookUrls(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTimeoutMs(value?: string): number {
  const parsed = Number.parseInt(value ?? "30000", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30000;
  }

  return parsed;
}

function previewText(rawText: string): string {
  return rawText.replace(/\s+/g, " ").trim().slice(0, 500);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function buildPayload(message: ForwardableEmailMessage): Promise<EmailWebhookPayload> {
  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);

  return {
    event: "email.received",
    messageId: message.headers.get("message-id") ?? crypto.randomUUID(),
    from: message.from,
    to: Array.from(message.to),
    rawSize: rawBytes.byteLength,
    subject: message.headers.get("subject") ?? "(no subject)",
    headers: Object.fromEntries(message.headers.entries()),
    textPreview: previewText(new TextDecoder().decode(rawBytes)),
    rawBase64: bytesToBase64(rawBytes),
    receivedAt: new Date().toISOString()
  };
}

async function sendWebhook(message: ForwardableEmailMessage, env: Env): Promise<Response> {
  if (!env.DOCKER_ACCEPT_WEBHOOK_URL) {
    return new Response("Missing DOCKER_ACCEPT_WEBHOOK_URL", { status: 500 });
  }

  const webhookUrls = parseWebhookUrls(env.DOCKER_ACCEPT_WEBHOOK_URL);
  if (!webhookUrls.length) {
    return new Response("No valid webhook URLs configured", { status: 500 });
  }

  const payload = await buildPayload(message);
  const body = JSON.stringify(payload);
  const signature = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const checksum = Array.from(new Uint8Array(signature)).map((value) => value.toString(16).padStart(2, "0")).join("");

  const timeoutMs = getTimeoutMs(env.WEBHOOK_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("Webhook request timeout"), timeoutMs);

  try {
    const results = await Promise.allSettled(
      webhookUrls.map(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-source": "cloudflare-email-worker",
            "x-webhook-checksum": checksum,
            ...(env.WEBHOOK_SHARED_SECRET ? { "x-webhook-secret": env.WEBHOOK_SHARED_SECRET } : {})
          },
          body,
          signal: controller.signal
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(`[${url}] ${response.status} ${responseText}`);
        }

        return response;
      })
    );

    const successfulCount = results.filter((result) => result.status === "fulfilled").length;
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => String(result.reason));

    if (!successfulCount) {
      throw new Error(`Webhook delivery failed for all targets: ${failures.join(" | ")}`);
    }

    if (failures.length) {
      console.error(`Webhook partially delivered (${successfulCount}/${webhookUrls.length})`, failures.join(" | "));
    } else {
      console.log(`Webhook delivered to ${successfulCount} target(s)`);
    }

    return new Response(JSON.stringify({ ok: true, delivered: successfulCount, total: webhookUrls.length }), {
      status: 202,
      headers: { "content-type": "application/json" }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({
      service: "worker-send",
      status: "ok",
      message: "Use Cloudflare Email Routing to trigger the email handler."
    });
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sendWebhook(message, env).catch((error) => {
        console.error("Webhook delivery failed, rejecting message:", error);
        message.setReject("Webhook delivery failed");
      })
    );
  }
};
