import { adminAuditLog, paymentEvents, refunds, webhookDeliveries, webhookEndpoints, newId } from "@belk/db";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEPOSIT_FACTORY, PLATFORM, SPLITTER, USDC, adminClient, client, insertIntent, makeHarness, seedAdmin, seedMerchant, type Harness } from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;
let adm: ReturnType<typeof adminClient>;
let admin: { id: string; email: string };
const wallet = () => privateKeyToAddress(generatePrivateKey());

beforeAll(async () => {
  h = await makeHarness();
  api = client(h);
  admin = await seedAdmin(h);
  adm = adminClient(h, admin);
});
afterAll(async () => {
  await h.close();
});

async function paid(amount = 100_000_000n) {
  const m = await seedMerchant(h);
  const p = await insertIntent(h, m.merchantId, { status: "succeeded", amount });
  return { m, p };
}

describe("refund recording", () => {
  it("records a full refund request (default amount = everything paid), logs an event, and queues a webhook", async () => {
    const { m, p } = await paid();
    const ep = newId("we");
    await h.db.insert(webhookEndpoints).values({ id: ep, merchantId: m.merchantId, url: "http://localhost:9/hook", mode: "test", secretEncrypted: "x", events: ["refund.created"] } as never);
    const to = wallet();
    const res = await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: to, reason: "customer_request" } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ object: "refund", payment_intent_id: p.id, amount: "100000000", status: "requested", to_address: to });

    const ev = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, p.id));
    expect(ev.some((e) => e.reason === "refund_requested")).toBe(true);
    const hooks = await h.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep));
    expect(hooks.some((d) => d.eventType === "refund.created")).toBe(true);
    // recording a refund never moves money and never changes the payment's status
    expect((await api("GET", `/v1/payment_intents/${p.id}`, { key: m.apiKey })).json.status).toBe("succeeded");
  });

  it("caps the total at what was paid, cumulatively", async () => {
    const { m, p } = await paid();
    const ask = (amount: string) => api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, amount, to_address: wallet() } });
    expect((await ask("60000000")).status).toBe(201);
    const over = await ask("40000001");
    expect(over.status).toBe(400);
    expect((await ask("40000000")).status).toBe(201);
    expect((await ask("1")).status).toBe(400);
    expect((await ask("0")).status).toBe(400);
    expect((await ask("1.5")).status).toBe(400);
  });

  it("cannot be overrun by concurrent requests", async () => {
    const { m, p } = await paid();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, amount: "40000000", to_address: wallet() } })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2); // 2 x 40 = 80 <= 100 < 120
    const rows = await h.db.select().from(refunds).where(eq(refunds.intentId, p.id));
    expect(rows.reduce((s, r) => s + r.amount, 0n)).toBeLessThanOrEqual(100_000_000n);
  });

  it("only refunds succeeded payments, and only your own", async () => {
    const m = await seedMerchant(h);
    const other = await seedMerchant(h);
    const pending = await insertIntent(h, m.merchantId, { status: "awaiting_payment" });
    const body = (id: string) => ({ payment_intent_id: id, to_address: wallet() });
    expect((await api("POST", "/v1/refunds", { key: m.apiKey, body: body(pending.id) })).status).toBe(409);
    const done = await insertIntent(h, m.merchantId, { status: "succeeded" });
    expect((await api("POST", "/v1/refunds", { key: other.apiKey, body: body(done.id) })).status).toBe(404);
  });

  it("rejects addresses that would send funds into our own contracts", async () => {
    const { m, p } = await paid();
    for (const to of [SPLITTER, USDC, DEPOSIT_FACTORY, "0x0000000000000000000000000000000000000000"]) {
      const res = await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: to } });
      expect(res.status, to).toBe(400);
    }
    expect((await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: "0x123" } })).status).toBe(400);
    expect(PLATFORM).toBeTruthy();
  });

  it("is idempotent: the same key replays, and creates one refund", async () => {
    const { m, p } = await paid();
    const body = { payment_intent_id: p.id, amount: "10000000", to_address: wallet() };
    const a = await api("POST", "/v1/refunds", { key: m.apiKey, body, idem: "refund-once" });
    const b = await api("POST", "/v1/refunds", { key: m.apiKey, body, idem: "refund-once" });
    expect(b.json.id).toBe(a.json.id);
    expect((await h.db.select().from(refunds).where(eq(refunds.intentId, p.id)))).toHaveLength(1);
    expect((await api("POST", "/v1/refunds", { key: m.apiKey, body, idem: false })).status).toBe(400); // key required
  });

  it("gets and lists refunds, scoped to the merchant", async () => {
    const { m, p } = await paid();
    const other = await seedMerchant(h);
    const r = await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: wallet() } });
    expect((await api("GET", `/v1/refunds/${r.json.id}`, { key: m.apiKey })).json.id).toBe(r.json.id);
    expect((await api("GET", `/v1/refunds/${r.json.id}`, { key: other.apiKey })).status).toBe(404);
    expect((await api("GET", `/v1/refunds?payment_intent_id=${p.id}`, { key: m.apiKey })).json.data).toHaveLength(1);
    expect((await api("GET", "/v1/refunds", { key: other.apiKey })).json.data).toHaveLength(0);
  });

  it("a rejected refund frees its amount for a new request", async () => {
    const { m, p } = await paid();
    const r = await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: wallet() } });
    expect((await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: wallet() } })).status).toBe(400);
    await adm("POST", `/refunds/${r.json.id}/reject`, { body: { note: "wrong address" } });
    expect((await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: wallet() } })).status).toBe(201);
  });
});

describe("staff refund review", () => {
  it("approves, rejects (note required), stays idempotent, refuses illegal moves, and audits", async () => {
    const { m, p } = await paid();
    const mk = async () => (await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, amount: "1000000", to_address: wallet() } })).json.id as string;
    const a = await mk();
    const b = await mk();

    expect((await adm("GET", `/refunds?payment_intent_id=${p.id}&status=requested`)).json.data).toHaveLength(2);
    expect((await adm("POST", `/refunds/${a}/approve`)).json.status).toBe("approved");
    await adm("POST", `/refunds/${a}/approve`);
    expect((await h.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, a))).filter((r) => r.action === "refund.approve")).toHaveLength(1);

    expect((await adm("POST", `/refunds/${b}/reject`)).status).toBe(400); // note required
    expect((await adm("POST", `/refunds/${b}/reject`, { body: { note: "duplicate" } })).json.status).toBe("rejected");
    expect((await adm("POST", `/refunds/${b}/approve`)).status).toBe(409); // rejected is final
    expect((await adm("POST", `/refunds/${a}/reject`, { body: { note: "changed mind" } })).json.status).toBe("rejected"); // approved -> rejected allowed
    expect((await adm("POST", `/refunds/re_${"0".repeat(32)}/approve`)).status).toBe(404);
    expect((await api("POST", "/v1/refunds", { key: m.apiKey, body: { payment_intent_id: p.id, to_address: wallet() } })).status).toBe(201);
  });
});
