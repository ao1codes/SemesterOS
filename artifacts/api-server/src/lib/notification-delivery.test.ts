import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmailPayload,
  buildOneSignalPayload,
  retryDelayMs,
  stableDeliveryKey,
  sendNotificationDelivery,
} from "./notification-delivery.ts";

test("delivery keys are deterministic UUIDs and differ by channel", () => {
  const emailKey = stableDeliveryKey("user-1", "note-1", "email");
  assert.match(emailKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(emailKey, stableDeliveryKey("user-1", "note-1", "email"));
  assert.notEqual(emailKey, stableDeliveryKey("user-1", "note-1", "push"));
});

test("email rendering escapes untrusted title and message content", () => {
  const payload = buildEmailPayload("SemesterOS <notify@example.test>", "student@example.test", {
    title: "<Exam>",
    message: "Review & submit 'work'",
  });
  assert.equal(payload.to, "student@example.test");
  assert.match(payload.html, /&lt;Exam&gt;/);
  assert.match(payload.html, /Review &amp; submit &#39;work&#39;/);
  assert.match(payload.text, /Review & submit 'work'/);
});

test("OneSignal payload targets only the signed-in external user", () => {
  const payload = buildOneSignalPayload(
    "app-id",
    "clerk-user",
    { title: "Due soon", message: "Review your plan." },
    stableDeliveryKey("clerk-user", "note-1", "push"),
  );
  assert.deepEqual(payload.include_aliases, { external_id: ["clerk-user"] });
  assert.equal(payload.target_channel, "push");
  assert.equal(payload.app_id, "app-id");
  assert.match(payload.idempotency_key, /^[0-9a-f-]{36}$/);
});

test("retry delays grow exponentially and cap at six hours", () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(2), 120_000);
  assert.equal(retryDelayMs(10), 6 * 60 * 60_000);
});

const delivery = {
  channel: "email" as const, userId: "test-user", recipientEmail: "student@example.test",
  senderEmail: "notify@example.test", notification: { title: "Due", message: "Review plan" },
  idempotencyKey: stableDeliveryKey("test-user", "test-note", "email"),
};
test("direct Resend uses bearer auth and a stable idempotency header", async () => {
  const transport: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("Authorization"), "Bearer mock-key");
    assert.equal(headers.get("Idempotency-Key"), delivery.idempotencyKey);
    assert.equal(options?.method, "POST");
    return Response.json({ id: "mock-email" });
  };
  assert.deepEqual(await sendNotificationDelivery(delivery, transport, { RESEND_API_KEY: "mock-key" }), { status: "sent", providerMessageId: "mock-email" });
});
test("direct OneSignal targets only one external user with app key auth", async () => {
  const transport: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api.onesignal.com/notifications");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Key mock-push-key");
    const body = JSON.parse(options?.body as string);
    assert.deepEqual(body.include_aliases, { external_id: ["test-user"] });
    assert.equal(body.app_id, "mock-app");
    assert.equal(body.idempotency_key, delivery.idempotencyKey);
    return Response.json({ id: "mock-push" });
  };
  assert.deepEqual(await sendNotificationDelivery({ ...delivery, channel: "push", oneSignalAppId: "mock-app" }, transport, {
    ONESIGNAL_REST_API_KEY: "mock-push-key", ONESIGNAL_API_READY: "true",
  }), { status: "sent", providerMessageId: "mock-push" });
});
test("missing provider configuration never makes a network call", async () => {
  const transport: typeof fetch = async () => { throw new Error("unexpected network"); };
  assert.equal((await sendNotificationDelivery(delivery, transport, {})).status, "skipped");
  assert.equal((await sendNotificationDelivery({ ...delivery, channel: "push" }, transport, {})).status, "skipped");
});
test("provider rate limits and failures retry but authorization failures do not", async () => {
  for (const [status, retryable] of [[429, true], [503, true], [401, false], [400, false]] as const) {
    const result = await sendNotificationDelivery(delivery, async () => new Response("", { status }), { RESEND_API_KEY: "mock-key" });
    assert.deepEqual(result, { status: "failed", errorCode: `provider_http_${status}`, retryable });
  }
  const offline = await sendNotificationDelivery(delivery, async () => { throw new Error("offline"); }, { RESEND_API_KEY: "mock-key" });
  assert.deepEqual(offline, { status: "failed", errorCode: "provider_unavailable", retryable: true });
});
test("malformed provider responses fail explicitly", async () => {
  const config = { RESEND_API_KEY: "mock-key" };
  assert.equal((await sendNotificationDelivery(delivery, async () => new Response("not json"), config)).status, "failed");
  assert.equal((await sendNotificationDelivery(delivery, async () => Response.json({}), config)).status, "failed");
});
