export interface Env {
  DOCKER_ACCEPT_WEBHOOK_URL: string;
  WEBHOOK_SHARED_SECRET?: string;
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

function previewText(rawText: string): string {
  return rawText.replace(/\s+/g, " ").trim().slice(0, 500);
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
    rawBase64: btoa(String.fromCharCode(...rawBytes)),
    receivedAt: new Date().toISOString()
  };
}

async function sendWebhook(message: ForwardableEmailMessage, env: Env): Promise<Response> {
  if (!env.DOCKER_ACCEPT_WEBHOOK_URL) {
    return new Response("Missing DOCKER_ACCEPT_WEBHOOK_URL", { status: 500 });
  }

  const payload = await buildPayload(message);
  const body = JSON.stringify(payload);
  const signature = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const checksum = Array.from(new Uint8Array(signature)).map((value) => value.toString(16).padStart(2, "0")).join("");

  const response = await fetch(env.DOCKER_ACCEPT_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-source": "cloudflare-email-worker",
      "x-webhook-checksum": checksum,
      ...(env.WEBHOOK_SHARED_SECRET ? { "x-webhook-secret": env.WEBHOOK_SHARED_SECRET } : {})
    },
    body
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Webhook delivery failed: ${response.status} ${responseText}`);
  }

  return response;
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
    ctx.waitUntil(sendWebhook(message, env));
  }
};
