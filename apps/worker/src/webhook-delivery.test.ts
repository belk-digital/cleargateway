import { webhookAttempts, webhookDeliveries } from "@belk/db";
import { verifyWebhookSignature } from "@belk/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WEBHOOK_BACKOFF_MINUTES, WEBHOOK_MAX_ATTEMPTS, runWebhookDelivery } from "./jobs/webhook-delivery.js";
import { apiClient, makeStack, seedMerchant, startReceiver, type Receiver, type SeededMerchant, type Stack } from "./test/harness.js";

let s: Stack;
let m: SeededMerchant;
let api: ReturnType<typeof apiClient>;
let receiver: Receiver;
let endpointId: string;
let secret: string;

beforeAll(async () => {
  s = await makeStack();
  m = await seedMerchant(s);
  api = apiClient(s, m.apiKey);
  receiver = await startReceiver();
  const ep = await api("POST", "/v1/webhook_endpoints", { url: receiver.url });
  endpointId = ep.json.id;
  secret = ep.json.secret;
  // Test isolation: deliveries left over by other test files (dead receivers) must not interfere with these tests.
  await s.db.execute(sql`update webhook_deliveries set status = 'failed', next_attempt_at = null where endpoint_id <> ${endpointId} and status = 'pending'`);
});
afterAll(async () => {
  await receiver?.close();
  await s?.close();
});
beforeEach(() => {
  receiver.received.length = 0;
  receiver.script.length = 0;
  receiver.defaultStatus = 200;
  receiver.delayMs = 0;
  receiver.redirectTo = null;
});

/** Queues a fresh test event for the endpoint through the public API, returns its delivery row. */
async function queueEvent() {
  const res = await api("POST", `/v1/webhook_endpoints/${endpointId}/test`);
  expect(res.status).toBe(202);
  const rows = await s.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
}
const delivery = async (id: string) => (await s.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0]!;
const attempts = (id: string) => s.db.select().from(webhookAttempts).where(eq(webhookAttempts.deliveryId, id)).orderBy(webhookAttempts.attemptNumber);
const at = (offsetMs: number) => ({ ...s.ctx, now: () => T0 + offsetMs });
let T0 = Date.now();

describe("webhook delivery worker", () => {
  it("drains a backlog larger than one batch in a single run, so new events are never starved", async () => {
    for (let i = 0; i < 45; i++) expect((await api("POST", `/v1/webhook_endpoints/${endpointId}/test`)).status).toBe(202);
    const fresh = await queueEvent();
    const r = await runWebhookDelivery(s.ctx);
    expect(r.attempted).toBeGreaterThanOrEqual(46);
    expect(r.succeeded).toBeGreaterThanOrEqual(46);
    expect(receiver.received.some((x) => x.headers["cleargateway-event-id"] === fresh.eventId)).toBe(true);
    expect((await delivery(fresh.id)).status).toBe("succeeded");
  });

  it("has a ~3 day backoff schedule", () => {
    const totalMinutes = WEBHOOK_BACKOFF_MINUTES.reduce((a, b) => a + b, 0);
    expect(totalMinutes / 60 / 24).toBeGreaterThan(3);
    expect(totalMinutes / 60 / 24).toBeLessThan(3.5);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(14);
  });

  it("delivers a correctly signed, well-formed request and logs the attempt", async () => {
    const d = await queueEvent();
    T0 = Date.now();
    const r = await runWebhookDelivery(s.ctx);
    expect(r.succeeded).toBe(1);
    expect(receiver.received).toHaveLength(1);
    const hook = receiver.received[0]!;
    expect(verifyWebhookSignature({ payload: hook.body, header: hook.headers["cleargateway-signature"] as string, secret })).toBe(true);
    expect(verifyWebhookSignature({ payload: hook.body, header: hook.headers["cleargateway-signature"] as string, secret: "wrong" })).toBe(false);
    expect(hook.headers).toMatchObject({ "content-type": "application/json", "cleargateway-event-id": d.eventId, "cleargateway-event-type": "webhook.test", "cleargateway-delivery-attempt": "1" });
    expect(JSON.parse(hook.body)).toMatchObject({ id: d.eventId, object: "event", type: "webhook.test" });

    const after = await delivery(d.id);
    expect(after).toMatchObject({ status: "succeeded", attemptCount: 1, lastResponseCode: 200, nextAttemptAt: null });
    const log = await attempts(d.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ attemptNumber: 1, responseCode: 200, error: null });
    expect(log[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("retries with exponential backoff until the receiver succeeds, logging every attempt", async () => {
    const d = await queueEvent();
    receiver.script.push(500, 503, 200);
    T0 = Date.now();

    await runWebhookDelivery(at(0));
    let row = await delivery(d.id);
    expect(row).toMatchObject({ status: "pending", attemptCount: 1, lastResponseCode: 500 });
    expect(row.nextAttemptAt!.getTime() - T0).toBeGreaterThanOrEqual(60_000 - 50);
    expect(row.nextAttemptAt!.getTime() - T0).toBeLessThanOrEqual(60_000 + 50);

    // Not due yet: nothing is sent.
    const idle = await runWebhookDelivery(at(30_000));
    expect(idle.attempted).toBe(0);
    expect(receiver.received).toHaveLength(1);

    await runWebhookDelivery(at(61_000));
    row = await delivery(d.id);
    expect(row).toMatchObject({ status: "pending", attemptCount: 2, lastResponseCode: 503 });
    expect(row.nextAttemptAt!.getTime() - (T0 + 61_000)).toBeGreaterThanOrEqual(5 * 60_000 - 50); // 5 minute step

    await runWebhookDelivery(at(61_000 + 5 * 60_000 + 1000));
    row = await delivery(d.id);
    expect(row).toMatchObject({ status: "succeeded", attemptCount: 3, lastResponseCode: 200 });
    expect((await attempts(d.id)).map((a) => [a.attemptNumber, a.responseCode, a.error])).toEqual([
      [1, 500, "http_500"],
      [2, 503, "http_503"],
      [3, 200, null],
    ]);
    expect(receiver.received.map((r) => r.headers["cleargateway-delivery-attempt"])).toEqual(["1", "2", "3"]);
    // Same event id every time so the merchant can dedupe.
    expect(new Set(receiver.received.map((r) => r.headers["cleargateway-event-id"])).size).toBe(1);
  });

  it("gives up after 14 attempts and marks the delivery failed", async () => {
    const d = await queueEvent();
    receiver.defaultStatus = 500;
    T0 = Date.now();
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < WEBHOOK_MAX_ATTEMPTS + 2; i++) await runWebhookDelivery(at((i + 1) * TWO_DAYS));
    const row = await delivery(d.id);
    expect(row).toMatchObject({ status: "failed", attemptCount: WEBHOOK_MAX_ATTEMPTS, nextAttemptAt: null });
    expect(await attempts(d.id)).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    expect(receiver.received).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
  });

  it("does not follow redirects (SSRF) and treats 3xx as a failed attempt", async () => {
    const other = await startReceiver();
    receiver.redirectTo = other.url;
    const d = await queueEvent();
    await runWebhookDelivery(s.ctx);
    expect(other.received).toHaveLength(0);
    expect(await delivery(d.id)).toMatchObject({ status: "pending", lastResponseCode: 302 });
    await other.close();
  });

  it("times out slow receivers and records the error", async () => {
    receiver.delayMs = 1500;
    const d = await queueEvent();
    await runWebhookDelivery({ ...s.ctx, config: { ...s.ctx.config, WEBHOOK_TIMEOUT_MS: 300 } });
    const row = await delivery(d.id);
    expect(row.status).toBe("pending");
    expect(row.lastResponseCode).toBeNull();
    const [a] = await attempts(d.id);
    expect(a?.error).toBeTruthy();
    expect(a?.responseCode).toBeNull();
    await new Promise((r) => setTimeout(r, 1700)); // let the slow receiver finish so it can shut down cleanly
  });

  it("re-checks the SSRF guard at send time (private target blocked when not allowed)", async () => {
    const d = await queueEvent();
    const strict = { ...s.ctx, config: { ...s.ctx.config, WEBHOOK_ALLOW_PRIVATE_URLS: false } };
    await runWebhookDelivery(strict);
    expect(receiver.received).toHaveLength(0);
    const [a] = await attempts(d.id);
    expect(a?.error).toMatch(/https|private/i);
    expect((await delivery(d.id)).status).toBe("pending"); // retried later, in case DNS/config changes
  });

  it("abandons deliveries to a deleted endpoint immediately", async () => {
    const ep = await api("POST", "/v1/webhook_endpoints", { url: receiver.url });
    const test = await api("POST", `/v1/webhook_endpoints/${ep.json.id}/test`);
    expect(test.json.queued).toBe(true);
    await api("DELETE", `/v1/webhook_endpoints/${ep.json.id}`);
    const [d] = await s.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.json.id));
    await runWebhookDelivery(s.ctx);
    expect(receiver.received.filter((r) => r.headers["cleargateway-event-id"] === d?.eventId)).toHaveLength(0);
    expect(await delivery(d!.id)).toMatchObject({ status: "failed" });
    expect((await attempts(d!.id))[0]?.error).toBe("endpoint_unavailable");
  });

  it("two workers racing never send the same delivery twice", async () => {
    const d = await queueEvent();
    await Promise.all([runWebhookDelivery(s.ctx), runWebhookDelivery(s.ctx), runWebhookDelivery(s.ctx)]);
    expect(receiver.received.filter((r) => r.headers["cleargateway-event-id"] === d.eventId)).toHaveLength(1);
    expect(await attempts(d.id)).toHaveLength(1);
  });

  it("a crashed worker's lease expires and the delivery is retried", async () => {
    const d = await queueEvent();
    // Simulate a claim that never completed: lease pushed 60s out, nothing sent.
    await s.db.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() + 60_000) }).where(eq(webhookDeliveries.id, d.id));
    await runWebhookDelivery(s.ctx);
    expect(receiver.received.filter((r) => r.headers["cleargateway-event-id"] === d.eventId)).toHaveLength(0); // leased: not sent
    const later = { ...s.ctx, now: () => Date.now() + 61_000 };
    await runWebhookDelivery(later); // (other tests' pending retries may also be due; only assert on this delivery)
    expect(receiver.received.filter((r) => r.headers["cleargateway-event-id"] === d.eventId)).toHaveLength(1);
    expect((await delivery(d.id)).status).toBe("succeeded");
  });
});
