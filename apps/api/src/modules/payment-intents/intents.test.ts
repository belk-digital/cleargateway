import { apiKeys, idempotencyKeys, merchants, paymentEvents, paymentIntents } from "@belk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, insertIntent, makeHarness, seedMerchant, type Harness, type SeededMerchant } from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;
let m: SeededMerchant;

beforeAll(async () => {
  h = await makeHarness();
  api = client(h);
  m = await seedMerchant(h);
});
afterAll(async () => {
  await h.close();
});

const create = (body: unknown = { amount: "100000000" }, o: Parameters<typeof api>[2] = {}) =>
  api("POST", "/v1/payment_intents", { key: m.apiKey, body, ...o });

describe("POST /v1/payment_intents", () => {
  it("creates an intent with the fee snapshotted (100 USDC @ 200 bps -> 98 / 2)", async () => {
    const res = await create({
      amount: "100000000",
      merchant_order_id: "order-1001",
      metadata: { cart: "abc" },
      customer_email: "buyer@example.com",
      success_url: "https://shop.example/ok",
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      object: "payment_intent",
      mode: "test",
      amount: "100000000",
      currency: "USDC",
      fee_bps: 200,
      fee_amount: "2000000",
      merchant_amount: "98000000",
      status: "created",
      merchant_order_id: "order-1001",
      metadata: { cart: "abc" },
    });
    expect(res.json.id).toMatch(/^pi_[0-9a-f]{32}$/);
    expect(res.json.client_secret).toMatch(new RegExp(`^${res.json.id}_secret_[0-9a-f]{48}$`));
    expect(res.json.checkout_url).toBe(`http://localhost:3001/pay/${res.json.id}#client_secret=${res.json.client_secret}`);

    // Audit trail + only a hash of the secret at rest.
    const events = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, res.json.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "created", actor: `merchant:${m.merchantId}` });
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, res.json.id));
    expect(row?.clientSecretHash).not.toContain("_secret_");
    expect(row?.intentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("does not change an existing intent when the merchant's fee changes later", async () => {
    const other = await seedMerchant(h, { feeBps: 300 });
    const res = await api("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" } });
    expect(res.json.fee_bps).toBe(300);
    await h.db.update(merchants).set({ feeBps: 500 }).where(eq(merchants.id, other.merchantId));
    const got = await api("GET", `/v1/payment_intents/${res.json.id}`, { key: other.apiKey });
    expect(got.json).toMatchObject({ fee_bps: 300, fee_amount: "3000000", merchant_amount: "97000000" });
    const next = await api("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" } });
    expect(next.json.fee_bps).toBe(500);
  });

  it("rounds the fee down like the contract (999999 units @ 250 bps -> 24999 / 975000)", async () => {
    const other = await seedMerchant(h, { feeBps: 250 });
    const res = await api("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "999999" } });
    expect(res.json).toMatchObject({ fee_amount: "24999", merchant_amount: "975000" });
  });

  it.each([
    ["JSON number instead of string", { amount: 100 }],
    ["decimal string", { amount: "1.5" }],
    ["exponent notation", { amount: "1e6" }],
    ["negative", { amount: "-5" }],
    ["leading zero", { amount: "0100" }],
    ["below minimum ($0.01)", { amount: "9999" }],
    ["above maximum ($1M)", { amount: "1000000000001" }],
    ["unsupported currency", { amount: "100000000", currency: "EUR" }],
    ["unknown field", { amount: "100000000", fee_bps: 0 }],
    ["bad email", { amount: "100000000", customer_email: "nope" }],
    ["non-http url", { amount: "100000000", success_url: "javascript:alert(1)" }],
    ["metadata value too long", { amount: "100000000", metadata: { k: "x".repeat(501) } }],
    ["expiry too short", { amount: "100000000", expires_in_seconds: 10 }],
  ])("rejects invalid input: %s", async (_name, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("invalid_request");
    expect(res.json.error.request_id).toMatch(/^req_/);
  });

  it("rejects a duplicate merchant_order_id with 409 and points at the existing intent", async () => {
    const a = await create({ amount: "100000000", merchant_order_id: "dup-1" });
    const b = await create({ amount: "100000000", merchant_order_id: "dup-1" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
    expect(b.json.error.code).toBe("conflict");
    expect(b.json.error.details.payment_intent_id).toBe(a.json.id);
  });
});

describe("idempotency", () => {
  it("requires an Idempotency-Key on POST", async () => {
    const res = await create({ amount: "100000000" }, { idem: false });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("invalid_request");
    expect(res.json.error.message).toMatch(/idempotency-key/i);
  });

  it("replays the stored response for the same key + body (one row, identical body)", async () => {
    const idem = "replay-1";
    const first = await create({ amount: "123456789", merchant_order_id: "idem-order" }, { idem });
    const second = await create({ merchant_order_id: "idem-order", amount: "123456789" }, { idem }); // key order differs
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const rows = await h.db.select().from(paymentIntents).where(eq(paymentIntents.merchantOrderId, "idem-order"));
    expect(rows).toHaveLength(1);
  });

  it("returns 409 idempotency_conflict when the key is reused with a different body", async () => {
    const idem = "reuse-1";
    await create({ amount: "100000000" }, { idem });
    const res = await create({ amount: "200000000" }, { idem });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("idempotency_conflict");
  });

  it("scopes keys per merchant", async () => {
    const other = await seedMerchant(h);
    const a = await api("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" }, idem: "shared-key" });
    const b = await api("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" }, idem: "shared-key" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.json.id).not.toBe(b.json.id);
  });

  it("creates exactly one intent when the same request races 8 times", async () => {
    const idem = "race-1";
    const results = await Promise.all(
      Array.from({ length: 8 }, () => create({ amount: "100000000", merchant_order_id: "race-order" }, { idem })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json.id)).size).toBe(1);
    const rows = await h.db.select().from(paymentIntents).where(eq(paymentIntents.merchantOrderId, "race-order"));
    expect(rows).toHaveLength(1);
  });

  it("stores nothing when the handler fails, so the client can retry with the same key", async () => {
    const idem = "fail-then-retry";
    const bad = await create({ amount: "100000000", merchant_order_id: "dup-1" }, { idem }); // 409: order id already used
    expect(bad.status).toBe(409);
    const stored = await h.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idem));
    expect(stored).toHaveLength(0);
    const ok = await create({ amount: "100000000", merchant_order_id: "dup-1" }, { idem });
    expect(ok.status).toBe(409); // same deterministic failure, but re-executed rather than replayed
  });

  it("also protects cancel", async () => {
    const created = await create({ amount: "100000000" });
    const idem = "cancel-replay";
    const a = await api("POST", `/v1/payment_intents/${created.json.id}/cancel`, { key: m.apiKey, idem });
    const b = await api("POST", `/v1/payment_intents/${created.json.id}/cancel`, { key: m.apiKey, idem });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    const events = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, created.json.id));
    expect(events.filter((e) => e.toStatus === "canceled")).toHaveLength(1);
  });
});

describe("authentication", () => {
  const cases: Array<[string, () => Promise<Awaited<ReturnType<typeof api>>>, number, string]> = [
    ["no header", () => api("GET", "/v1/payment_intents"), 401, "unauthorized"],
    ["malformed key", () => api("GET", "/v1/payment_intents", { key: "sk_test_short" }), 401, "unauthorized"],
    ["unknown key", () => api("GET", "/v1/payment_intents", { key: `sk_test_${"a".repeat(64)}` }), 401, "unauthorized"],
    ["not a bearer token", () => api("GET", "/v1/payment_intents", { headers: { authorization: `Basic ${m.apiKey}` } }), 401, "unauthorized"],
  ];
  it.each(cases)("rejects %s", async (_n, run, status, code) => {
    const res = await run();
    expect(res.status).toBe(status);
    expect(res.json.error.code).toBe(code);
  });

  it("rejects a valid prefix with a wrong secret", async () => {
    const tampered = `${m.apiKey.slice(0, -4)}0000`;
    const res = await api("GET", "/v1/payment_intents", { key: tampered === m.apiKey ? `${m.apiKey.slice(0, -4)}1111` : tampered });
    expect(res.status).toBe(401);
  });

  it("rejects revoked keys", async () => {
    const other = await seedMerchant(h);
    expect((await api("GET", "/v1/payment_intents", { key: other.apiKey })).status).toBe(200);
    await h.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.merchantId, other.merchantId));
    expect((await api("GET", "/v1/payment_intents", { key: other.apiKey })).status).toBe(401);
  });

  it("rejects live keys while the platform is testnet-only", async () => {
    const live = await seedMerchant(h, { mode: "live" });
    const res = await api("GET", "/v1/payment_intents", { key: live.apiKey });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("live_mode_disabled");
  });

  it("rejects suspended and not-yet-approved merchants", async () => {
    const s = await seedMerchant(h, { status: "suspended" });
    const p = await seedMerchant(h, { status: "pending_kyb" });
    expect((await api("GET", "/v1/payment_intents", { key: s.apiKey })).status).toBe(403);
    expect((await api("GET", "/v1/payment_intents", { key: p.apiKey })).status).toBe(403);
  });

  it("never echoes the API key in errors", async () => {
    const res = await api("GET", "/v1/payment_intents", { key: `sk_test_${"b".repeat(64)}` });
    expect(JSON.stringify(res.json)).not.toContain("b".repeat(64));
  });

  it("records last_used_at (throttled)", async () => {
    const other = await seedMerchant(h);
    await api("GET", "/v1/payment_intents", { key: other.apiKey });
    await new Promise((r) => setTimeout(r, 150));
    const [k] = await h.db.select().from(apiKeys).where(eq(apiKeys.merchantId, other.merchantId));
    expect(k?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("GET /v1/payment_intents/:id and isolation", () => {
  it("retrieves own intents", async () => {
    const c = await create();
    const res = await api("GET", `/v1/payment_intents/${c.json.id}`, { key: m.apiKey });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(c.json.id);
  });

  it("returns 404 for another merchant's intent and for unknown ids", async () => {
    const other = await seedMerchant(h);
    const c = await create();
    expect((await api("GET", `/v1/payment_intents/${c.json.id}`, { key: other.apiKey })).status).toBe(404);
    expect((await api("GET", `/v1/payment_intents/pi_${"0".repeat(32)}`, { key: m.apiKey })).status).toBe(404);
    expect((await api("POST", `/v1/payment_intents/${c.json.id}/cancel`, { key: other.apiKey })).status).toBe(404);
  });

  it("test-mode keys never see live-mode data", async () => {
    const live = await insertIntent(h, m.merchantId, { mode: "live" });
    expect((await api("GET", `/v1/payment_intents/${live.id}`, { key: m.apiKey })).status).toBe(404);
    const list = await api("GET", "/v1/payment_intents?limit=100", { key: m.apiKey });
    expect(list.json.data.map((d: { id: string }) => d.id)).not.toContain(live.id);
  });

  it("rejects malformed ids", async () => {
    expect((await api("GET", "/v1/payment_intents/not-an-id", { key: m.apiKey })).status).toBe(400);
  });
});

describe("GET /v1/payment_intents (list)", () => {
  it("paginates newest-first without gaps or duplicates", async () => {
    const lm = await seedMerchant(h);
    const ids: string[] = [];
    const base = Date.now() - 100_000;
    for (let i = 0; i < 25; i++) {
      // Some rows share the exact same created_at to exercise the id tiebreaker.
      const row = await insertIntent(h, lm.merchantId, { createdAt: new Date(base + Math.floor(i / 3) * 1000) });
      ids.push(row.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/payment_intents?limit=10${cursor ? `&starting_after=${cursor}` : ""}`;
      const res = await api("GET", url, { key: lm.apiKey });
      expect(res.status).toBe(200);
      seen.push(...res.json.data.map((d: { id: string }) => d.id));
      cursor = res.json.next_cursor;
      expect(res.json.has_more).toBe(cursor !== null);
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(new Set(seen)).toEqual(new Set(ids));
    const rows = await h.db.select().from(paymentIntents).where(eq(paymentIntents.merchantId, lm.merchantId));
    const expectedOrder = rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((r) => r.id);
    expect(seen).toEqual(expectedOrder);
  });

  it("filters by status and created range", async () => {
    const lm = await seedMerchant(h);
    await insertIntent(h, lm.merchantId, { createdAt: new Date("2030-01-01T00:00:00Z"), status: "canceled" });
    await insertIntent(h, lm.merchantId, { createdAt: new Date("2030-06-01T00:00:00Z") });
    await insertIntent(h, lm.merchantId, { createdAt: new Date("2030-12-01T00:00:00Z"), status: "canceled" });

    const canceled = await api("GET", "/v1/payment_intents?status=canceled", { key: lm.apiKey });
    expect(canceled.json.data).toHaveLength(2);
    const ranged = await api("GET", "/v1/payment_intents?created_gte=2030-05-01T00:00:00Z&created_lte=2030-07-01T00:00:00Z", {
      key: lm.apiKey,
    });
    expect(ranged.json.data).toHaveLength(1);
    expect(ranged.json.data[0].status).toBe("created");
  });

  it("rejects bad query params and foreign cursors", async () => {
    const other = await seedMerchant(h);
    const foreign = await insertIntent(h, other.merchantId);
    expect((await api("GET", "/v1/payment_intents?limit=101", { key: m.apiKey })).status).toBe(400);
    expect((await api("GET", "/v1/payment_intents?status=bogus", { key: m.apiKey })).status).toBe(400);
    expect((await api("GET", "/v1/payment_intents?wat=1", { key: m.apiKey })).status).toBe(400);
    expect((await api("GET", `/v1/payment_intents?starting_after=${foreign.id}`, { key: m.apiKey })).status).toBe(400);
  });
});

describe("POST /v1/payment_intents/:id/cancel", () => {
  it("cancels an open intent and audits it", async () => {
    const c = await create();
    const res = await api("POST", `/v1/payment_intents/${c.json.id}/cancel`, { key: m.apiKey });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("canceled");
    const events = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, c.json.id));
    expect(events.at(-1)).toMatchObject({ fromStatus: "created", toStatus: "canceled", reason: "canceled_by_merchant" });
  });

  it("refuses to cancel twice, and refuses once payment is in flight or final (409)", async () => {
    const c = await create();
    await api("POST", `/v1/payment_intents/${c.json.id}/cancel`, { key: m.apiKey });
    const again = await api("POST", `/v1/payment_intents/${c.json.id}/cancel`, { key: m.apiKey });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("invalid_state_transition");

    for (const status of ["confirming", "succeeded"] as const) {
      const row = await insertIntent(h, m.merchantId, { status });
      const res = await api("POST", `/v1/payment_intents/${row.id}/cancel`, { key: m.apiKey });
      expect(res.status).toBe(409);
      const [after] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, row.id));
      expect(after?.status).toBe(status);
    }
  });
});

describe("expiry presentation", () => {
  it("reports overdue unpaid intents as expired before the worker records it", async () => {
    const row = await insertIntent(h, m.merchantId, { expiresAt: new Date(Date.now() - 1000) });
    const res = await api("GET", `/v1/payment_intents/${row.id}`, { key: m.apiKey });
    expect(res.json.status).toBe("expired");
  });
});
