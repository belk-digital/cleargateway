import { createHmac } from "node:crypto";
import { inboundWebhookEvents, webhookDeliveries, webhookEndpoints } from "@belk/db";
import { decryptSecret } from "@belk/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { client, makeHarness, seedMerchant, type Harness, type SeededMerchant } from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;
let m: SeededMerchant;
const signal = vi.fn(async () => {});

beforeAll(async () => {
  h = await makeHarness({ signalWatcher: signal });
  api = client(h);
  m = await seedMerchant(h);
});
afterAll(async () => {
  await h.close();
});

const create = (body: unknown = { url: "http://127.0.0.1:9/hook" }, o: Parameters<typeof api>[2] = {}) =>
  api("POST", "/v1/webhook_endpoints", { key: m.apiKey, body, ...o });

describe("webhook endpoints", () => {
  it("creates an endpoint, shows the secret exactly once, and stores it encrypted", async () => {
    const res = await create({ url: "http://127.0.0.1:9/hook", enabled_events: ["payment_intent.succeeded"] });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ object: "webhook_endpoint", mode: "test", status: "enabled", enabled_events: ["payment_intent.succeeded"] });
    expect(res.json.secret).toMatch(/^whsec_[0-9a-f]{48}$/);

    const [row] = await h.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, res.json.id));
    expect(row?.secretEncrypted).not.toContain(res.json.secret);
    expect(decryptSecret(row?.secretEncrypted ?? "", h.config.ENCRYPTION_KEY as string)).toBe(res.json.secret);

    const got = await api("GET", `/v1/webhook_endpoints/${res.json.id}`, { key: m.apiKey });
    expect(got.json.secret).toBeUndefined();
    const list = await api("GET", "/v1/webhook_endpoints", { key: m.apiKey });
    expect(list.json.data.some((e: { id: string }) => e.id === res.json.id)).toBe(true);
    expect(JSON.stringify(list.json)).not.toContain("whsec_");
  });

  it("replays creation with the same Idempotency-Key (same secret, one row)", async () => {
    const other = await seedMerchant(h);
    const call = () => api("POST", "/v1/webhook_endpoints", { key: other.apiKey, body: { url: "http://127.0.0.1:9/a" }, idem: "we-idem" });
    const a = await call();
    const b = await call();
    expect(b.json).toEqual(a.json);
    const rows = await h.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.merchantId, other.merchantId));
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["unknown event", { url: "http://127.0.0.1:9/h", enabled_events: ["nope"] }],
    ["empty events", { url: "http://127.0.0.1:9/h", enabled_events: [] }],
    ["test event not subscribable", { url: "http://127.0.0.1:9/h", enabled_events: ["webhook.test"] }],
    ["not a url", { url: "nope" }],
    ["credentials in url", { url: "http://u:p@127.0.0.1:9/h" }],
    ["file scheme", { url: "file:///etc/passwd" }],
    ["unknown field", { url: "http://127.0.0.1:9/h", secret: "mine" }],
  ])("rejects: %s", async (_n, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
  });

  it("enforces the SSRF guard when private URLs are not allowed (production behavior)", async () => {
    const strict = await makeHarness({ env: { WEBHOOK_ALLOW_PRIVATE_URLS: "false" } });
    const api2 = client(strict);
    for (const url of ["http://example.com/h", "https://127.0.0.1/h", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/h", "https://[::1]/h"]) {
      const res = await api2("POST", "/v1/webhook_endpoints", { key: m.apiKey, body: { url } });
      expect(res.status, url).toBe(400);
    }
    const ok = await api2("POST", "/v1/webhook_endpoints", { key: m.apiKey, body: { url: "https://8.8.8.8/hook" } });
    expect(ok.status).toBe(201);
    await strict.close();
  });

  it("limits endpoints per mode", async () => {
    const other = await seedMerchant(h);
    for (let i = 0; i < 10; i++) {
      expect((await api("POST", "/v1/webhook_endpoints", { key: other.apiKey, body: { url: `http://127.0.0.1:9/${i}` } })).status).toBe(201);
    }
    expect((await api("POST", "/v1/webhook_endpoints", { key: other.apiKey, body: { url: "http://127.0.0.1:9/11" } })).status).toBe(409);
  });

  it("is isolated per merchant", async () => {
    const other = await seedMerchant(h);
    const mine = await create();
    expect((await api("GET", `/v1/webhook_endpoints/${mine.json.id}`, { key: other.apiKey })).status).toBe(404);
    expect((await api("DELETE", `/v1/webhook_endpoints/${mine.json.id}`, { key: other.apiKey })).status).toBe(404);
    expect((await api("POST", `/v1/webhook_endpoints/${mine.json.id}/test`, { key: other.apiKey })).status).toBe(404);
  });

  it("deletes (soft) and then 404s", async () => {
    const e = await create();
    const del = await api("DELETE", `/v1/webhook_endpoints/${e.json.id}`, { key: m.apiKey });
    expect(del.json).toEqual({ id: e.json.id, object: "webhook_endpoint", deleted: true });
    expect((await api("GET", `/v1/webhook_endpoints/${e.json.id}`, { key: m.apiKey })).status).toBe(404);
    const [row] = await h.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, e.json.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("queues a test event for just that endpoint, fresh on every call, replayed on the same key", async () => {
    const e = await create();
    const other = await create();
    const a = await api("POST", `/v1/webhook_endpoints/${e.json.id}/test`, { key: m.apiKey });
    const b = await api("POST", `/v1/webhook_endpoints/${e.json.id}/test`, { key: m.apiKey });
    expect(a.status).toBe(202);
    expect(a.json).toEqual({ object: "webhook_test", endpoint_id: e.json.id, queued: true });
    const rows = await h.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, e.json.id));
    expect(rows).toHaveLength(2); // two distinct explicit calls
    expect(rows[0]?.eventType).toBe("webhook.test");
    expect(rows[0]?.payload).toMatchObject({ type: "webhook.test", object: "event" });
    expect(await h.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, other.json.id))).toHaveLength(0);
    expect(b.status).toBe(202);

    const same = await api("POST", `/v1/webhook_endpoints/${e.json.id}/test`, { key: m.apiKey, idem: "test-replay" });
    await api("POST", `/v1/webhook_endpoints/${e.json.id}/test`, { key: m.apiKey, idem: "test-replay" });
    expect(same.status).toBe(202);
    expect(await h.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, e.json.id))).toHaveLength(3);
  });
});

describe("POST /webhooks/chain/:provider (fast signal)", () => {
  const body = JSON.stringify({ event: { activity: [{ hash: "0xabc" }] } });
  const sign = (raw: string, secret = "mock-chain-webhook-secret") => createHmac("sha256", secret).update(raw).digest("hex");
  const post = (provider: string, raw: string, sig?: string) =>
    h.app.inject({
      method: "POST",
      url: `/webhooks/chain/${provider}`,
      headers: { "content-type": "application/json", ...(sig ? { "x-cleargateway-mock-signature": sig } : {}) },
      payload: raw,
    });

  it("verifies the signature over the raw body, stores it, and signals the watcher (never touching payments)", async () => {
    signal.mockClear();
    const res = await post("mock", body, sign(body));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect(signal).toHaveBeenCalledTimes(1);
    const rows = await h.db.select().from(inboundWebhookEvents).where(eq(inboundWebhookEvents.rawBody, body));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "chain", provider: "mock", signatureValid: true });
    expect(rows[0]?.processedAt).toBeInstanceOf(Date);
    expect(Object.keys(rows[0]?.headers ?? {})).not.toContain("authorization");
  });

  it("preserves the exact bytes: whitespace differences fail verification", async () => {
    signal.mockClear();
    const res = await post("mock", `${body} `, sign(body));
    expect(res.statusCode).toBe(401);
    expect(signal).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong secret", () => sign(body, "another-secret-value")],
    ["missing signature", () => undefined],
    ["malformed signature", () => "zz"],
  ])("rejects %s with 401 and stores nothing", async (_n, sig) => {
    signal.mockClear();
    const before = (await h.db.select().from(inboundWebhookEvents)).length;
    const res = await post("mock", body, sig());
    expect(res.statusCode).toBe(401);
    expect(signal).not.toHaveBeenCalled();
    expect((await h.db.select().from(inboundWebhookEvents)).length).toBe(before);
  });

  it("returns 501 for providers not implemented yet (no guessing at their signature formats)", async () => {
    for (const p of ["alchemy", "quicknode"]) {
      const res = await post(p, body, sign(body));
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe("not_implemented");
    }
  });

  it("still succeeds if the watcher signal fails (poller remains the source of truth)", async () => {
    const h2 = await makeHarness({
      signalWatcher: async () => {
        throw new Error("queue down");
      },
    });
    const res = await h2.app.inject({
      method: "POST",
      url: "/webhooks/chain/mock",
      headers: { "content-type": "application/json", "x-cleargateway-mock-signature": sign(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    await h2.close();
  });
});
