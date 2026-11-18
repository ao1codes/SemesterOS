import { createHash } from "node:crypto";
import type { Notification } from "@workspace/api-zod";

export type DeliveryChannel = "email" | "push";

export function stableDeliveryKey(
  userId: string,
  notificationId: string,
  channel: DeliveryChannel,
) {
  const bytes = createHash("sha256")
    .update(`${userId}\u0000${notificationId}\u0000${channel}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildEmailPayload(
  from: string,
  to: string,
  notification: Pick<Notification, "title" | "message">,
) {
  const title = escapeHtml(notification.title);
  const message = escapeHtml(notification.message);
  return {
    from,
    to,
    subject: `SemesterOS · ${notification.title}`,
    text: `${notification.title}\n\n${notification.message}\n\nOpen SemesterOS to review your plan.`,
    html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#28263b"><p style="color:#6758e8;font-size:12px;font-weight:700;letter-spacing:1px">SEMESTEROS</p><h1 style="font-size:22px">${title}</h1><p style="line-height:1.6">${message}</p><p style="color:#777589;font-size:13px">Open SemesterOS to review your plan.</p></main>`,
  };
}

export function buildOneSignalPayload(
  appId: string,
  externalId: string,
  notification: Pick<Notification, "title" | "message">,
  idempotencyKey: string,
) {
  return {
    app_id: appId,
    include_aliases: { external_id: [externalId] },
    target_channel: "push",
    headings: { en: notification.title },
    contents: { en: notification.message },
    idempotency_key: idempotencyKey,
  };
}

export type ProviderResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "skipped"; errorCode: string }
  | { status: "failed"; errorCode: string; retryable: boolean };

type DeliveryRequest = {
  channel: DeliveryChannel;
  userId: string;
  notification: Pick<Notification, "title" | "message">;
  idempotencyKey: string;
  recipientEmail?: string;
  senderEmail?: string;
  oneSignalAppId?: string;
};

export async function sendNotificationDelivery(
  request: DeliveryRequest,
  transport: typeof fetch = fetch,
  config: NodeJS.ProcessEnv = process.env,
): Promise<ProviderResult> {
  let path: string;
  let body: unknown;
  let headers: Record<string, string> = { "Content-Type": "application/json" };

  if (request.channel === "email") {
    if (!config.RESEND_API_KEY) {
      return { status: "skipped", errorCode: "email_key_not_configured" };
    }
    if (!request.senderEmail) {
      return { status: "skipped", errorCode: "sender_not_configured" };
    }
    if (!request.recipientEmail) {
      return { status: "skipped", errorCode: "verified_recipient_unavailable" };
    }
    path = "https://api.resend.com/emails";
    body = buildEmailPayload(
      request.senderEmail,
      request.recipientEmail,
      request.notification,
    );
    headers = { ...headers, Authorization: `Bearer ${config.RESEND_API_KEY}`, "Idempotency-Key": request.idempotencyKey };
  } else {
    if (!config.ONESIGNAL_REST_API_KEY || config.ONESIGNAL_API_READY !== "true") {
      return { status: "skipped", errorCode: "push_not_configured" };
    }
    if (!request.oneSignalAppId) {
      return { status: "skipped", errorCode: "push_app_not_configured" };
    }
    path = "https://api.onesignal.com/notifications";
    headers.Authorization = `Key ${config.ONESIGNAL_REST_API_KEY}`;
    body = buildOneSignalPayload(
      request.oneSignalAppId,
      request.userId,
      request.notification,
      request.idempotencyKey,
    );
  }

  let response: Response;
  try {
    response = await transport(path, {
      method: "POST", headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: "failed", errorCode: "provider_unavailable", retryable: true };
  }

  if (!response.ok) {
    return {
      status: "failed",
      errorCode: `provider_http_${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
    };
  }

  let result: { id?: string } = {};
  try {
    result = (await response.json()) as { id?: string };
  } catch {
    return { status: "failed", errorCode: "invalid_provider_response", retryable: true };
  }

  if (request.channel === "push" && !result.id) {
    return { status: "skipped", errorCode: "no_push_subscription" };
  }
  if (!result.id) {
    return { status: "failed", errorCode: "invalid_provider_response", retryable: true };
  }
  return {
    status: "sent",
    providerMessageId: result.id ?? "accepted",
  };
}

export function retryDelayMs(attempt: number) {
  return Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}
