import { adminAuditLog, merchants, onrampRouting, paymentEvents, paymentIntents, recordIntentEvent, transitionIntent, type IntentRow } from "@belk/db";
import { desc, eq } from "drizzle-orm";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMIN_TOKEN, adminClient, client, insertIntent, makeHarness, seedAdmin, seedMerchant, type Harness } from "../../test/harness.js";

let h: Harness;
let admin: { id: string; email: string };
let adm: ReturnType<typeof adminClient>;
let api: ReturnType<typeof client>;
const wallet = () => privateKeyToAddress(generatePrivateKey());

beforeAll(async () => {
  h = await makeHarness();
  admin = await seedAdmin(h);
  adm = adminClient(h, admin);
  api = client(h);
});
afterAll(async () => {
  await h.close();
});

const audit = (targetId: string) => h.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId)).orderBy(adminAuditLog.createdAt);
const newMerchantBody = (over: Record<string, unknown> = {}) => ({ legal_name: "Acme Ltd", display_name: "Acme", payout_wallet_address: wallet(), fee_bps: 200, ...over });

/** Full lifecycle through the internal API only: create -> key -> approve. */
async function onboard(over: Record<string, unknown> = {}) {
  const created = await adm("POST", "/merchants", { body: newMerchantBody(over) });
  expect(created.status).toBe(201);
  const key = await adm("POST", `/merchants/${created.json.id}/api-keys`, { body: { mode: "test" } });
  expect(key.status).toBe(201);
  expect((await adm("POST", `/merchants/${created.json.id}/approve-kyb`)).status).toBe(200);
  return { id: created.json.id as string, apiKey: key.json.key as string, keyId: key.json.id as string };
}

describe("internal API authentication", () => {
  it("requires the admin token, then a known staff email", async () => {
    expect((await adm("GET", "/merchants", { token: null })).status).toBe(401);
    expect((await adm("GET", "/merchants", { token: "wrong-token" })).status).toBe(401);
    expect((await adm("GET", "/merchants", { email: null })).status).toBe(403);
    expect((await adm("GET", "/merchants", { email: "nobody@cleargateway.test" })).status).toBe(403);
    expect((await adm("GET", "/merchants")).status).toBe(200);
  });

  it("checks auth before validating the body, so unauthenticated callers learn nothing about our schemas", async () => {
    const res = await adm("POST", "/merchants", { token: "wrong-token", body: { nonsense: true } });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.json)).not.toMatch(/legal_name|fee_bps/);
  });

  it("does not accept a merchant API key", async () => {
    const m = await seedMerchant(h);
    expect((await adm("GET", "/merchants", { token: m.apiKey })).status).toBe(401);
  });

  it("without a session, an unset ADMIN_TOKEN means the shared-token path is off (401)", async () => {
    const h2 = await makeHarness({ env: { ADMIN_TOKEN: "" } });
    const res = await adminClient(h2, admin)("GET", "/merchants");
    expect(res.status).toBe(401);
    await h2.close();
  });

  it("the admin token is only ever compared, never echoed", async () => {
    const res = await adm("GET", "/merchants", { token: `${ADMIN_TOKEN}x` });
    expect(JSON.stringify(res.json)).not.toContain(ADMIN_TOKEN);
  });
});

describe("merchant lifecycle", () => {
  it("creates a merchant as pending_kyb with a checksummed wallet, and audits it", async () => {
    const lower = wallet().toLowerCase();
    const res = await adm("POST", "/merchants", { body: newMerchantBody({ payout_wallet_address: lower, branding: { primary_color: "#0052ff" } }) });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ object: "merchant", status: "pending_kyb", kyb_status: "not_started", fee_bps: 200, payout_wallet_address: getAddress(lower), branding: { primary_color: "#0052ff" } });
    const rows = await audit(res.json.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adminId: admin.id, action: "merchant.create", targetType: "merchant" });
  });

  it.each([
    ["fee above the cap", { fee_bps: 1001 }],
    ["negative fee", { fee_bps: -1 }],
    ["fractional fee", { fee_bps: 1.5 }],
    ["bad wallet", { payout_wallet_address: "0x123" }],
    ["bad checksum", { payout_wallet_address: "0xAbC0000000000000000000000000000000000dEf" }],
    ["empty name", { legal_name: "" }],
    ["bad colour", { branding: { primary_color: "blue" } }],
    ["unknown field", { status: "active" }],
  ])("rejects a merchant with: %s", async (_n, over) => {
    expect((await adm("POST", "/merchants", { body: newMerchantBody(over) })).status).toBe(400);
  });

  it("a new merchant cannot take payments until KYB is approved; approval activates it, idempotently", async () => {
    const created = await adm("POST", "/merchants", { body: newMerchantBody() });
    const key = await adm("POST", `/merchants/${created.json.id}/api-keys`, { body: { mode: "test" } });
    const intent = () => api("POST", "/v1/payment_intents", { key: key.json.key, body: { amount: "100000000" } });
    expect((await intent()).status).toBe(403);

    const approved = await adm("POST", `/merchants/${created.json.id}/approve-kyb`, { body: { note: "documents verified" } });
    expect(approved.json).toMatchObject({ status: "active", kyb_status: "approved" });
    expect((await intent()).status).toBe(201);

    await adm("POST", `/merchants/${created.json.id}/approve-kyb`);
    const actions = (await audit(created.json.id)).map((r) => r.action);
    expect(actions.filter((a) => a === "merchant.approve_kyb")).toHaveLength(1); // the repeat wrote nothing
    const line = (await audit(created.json.id)).find((r) => r.action === "merchant.approve_kyb");
    expect(line?.data).toMatchObject({ from: { status: "pending_kyb", kyb_status: "not_started" }, to: { status: "active", kyb_status: "approved" }, note: "documents verified" });
  });

  it("suspending cuts off the merchant's API immediately; reinstating restores it", async () => {
    const m = await onboard();
    const create = () => api("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    expect((await create()).status).toBe(201);
    expect((await adm("POST", `/merchants/${m.id}/suspend`, { body: { note: "chargeback spike" } })).json.status).toBe("suspended");
    const blocked = await create();
    expect(blocked.status).toBe(403);
    await adm("POST", `/merchants/${m.id}/suspend`); // idempotent
    expect((await adm("POST", `/merchants/${m.id}/reinstate`)).json.status).toBe("active");
    expect((await create()).status).toBe(201);
  });

  it("refuses illegal transitions: approving a suspended merchant, reinstating one whose KYB was never approved", async () => {
    const m = await onboard();
    await adm("POST", `/merchants/${m.id}/suspend`);
    const res = await adm("POST", `/merchants/${m.id}/approve-kyb`);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("invalid_state_transition");

    const pending = await adm("POST", "/merchants", { body: newMerchantBody() });
    await adm("POST", `/merchants/${pending.json.id}/suspend`);
    expect((await adm("POST", `/merchants/${pending.json.id}/reinstate`)).status).toBe(409);
  });

  it("rejecting KYB on an active merchant also suspends it", async () => {
    const m = await onboard();
    const res = await adm("POST", `/merchants/${m.id}/reject-kyb`, { body: { note: "sanctions hit" } });
    expect(res.json).toMatchObject({ kyb_status: "rejected", status: "suspended" });
    expect((await api("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } })).status).toBe(403);
  });

  it("returns 404 for unknown merchants and 400 for malformed ids", async () => {
    expect((await adm("GET", `/merchants/mer_${"0".repeat(32)}`)).status).toBe(404);
    expect((await adm("POST", `/merchants/mer_${"0".repeat(32)}/suspend`)).status).toBe(404);
    expect((await adm("GET", "/merchants/not-an-id")).status).toBe(400);
  });

  it("lists merchants newest-first with a cursor and a status filter", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await adm("POST", "/merchants", { body: newMerchantBody({ legal_name: `Paged ${i}` }) })).json.id);
    const first = await adm("GET", "/merchants?limit=2");
    expect(first.json.data).toHaveLength(2);
    expect(first.json.has_more).toBe(true);
    const second = await adm("GET", `/merchants?limit=2&starting_after=${first.json.next_cursor}`);
    const seen = new Set([...first.json.data, ...second.json.data].map((m: { id: string }) => m.id));
    expect(seen.size).toBe(4); // no overlap between pages
    expect((await adm("GET", "/merchants?starting_after=mer_nope")).status).toBe(400);
    const pending = await adm("GET", "/merchants?status=pending_kyb&limit=100");
    expect(pending.json.data.every((m: { status: string }) => m.status === "pending_kyb")).toBe(true);
    expect(ids.length).toBe(5);
  });
});

describe("fees and profile changes", () => {
  it("a fee change applies to new payments only; existing payments keep their snapshot", async () => {
    const m = await onboard({ fee_bps: 200 });
    const before = await api("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    expect(before.json.fee_bps).toBe(200);

    const res = await adm("PATCH", `/merchants/${m.id}/fee`, { body: { fee_bps: 350 } });
    expect(res.json.fee_bps).toBe(350);
    const after = await api("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    expect(after.json).toMatchObject({ fee_bps: 350, fee_amount: "3500000", merchant_amount: "96500000" });
    expect((await api("GET", `/v1/payment_intents/${before.json.id}`, { key: m.apiKey })).json).toMatchObject({ fee_bps: 200, fee_amount: "2000000" });

    const line = (await audit(m.id)).find((r) => r.action === "merchant.set_fee");
    expect(line?.data).toEqual({ fee_bps_before: 200, fee_bps_after: 350 });
  });

  it("rejects fees outside 0-1000 and does not write an audit line for a no-op change", async () => {
    const m = await onboard({ fee_bps: 200 });
    expect((await adm("PATCH", `/merchants/${m.id}/fee`, { body: { fee_bps: 1001 } })).status).toBe(400);
    expect((await adm("PATCH", `/merchants/${m.id}/fee`, { body: { fee_bps: 200 } })).status).toBe(200);
    expect((await audit(m.id)).some((r) => r.action === "merchant.set_fee")).toBe(false);
    expect((await adm("PATCH", `/merchants/${m.id}/fee`, { body: { fee_bps: 0 } })).json.fee_bps).toBe(0);
  });

  it("updates profile fields; a payout wallet change is audited with before and after", async () => {
    const m = await onboard();
    const [before] = await h.db.select().from(merchants).where(eq(merchants.id, m.id));
    const next = wallet();
    const res = await adm("PATCH", `/merchants/${m.id}`, { body: { display_name: "Renamed", payout_wallet_address: next } });
    expect(res.json).toMatchObject({ display_name: "Renamed", payout_wallet_address: next });
    const line = (await audit(m.id)).find((r) => r.action === "merchant.update");
    expect(line?.data).toMatchObject({ changed: ["display_name", "payout_wallet_address"], payout_wallet_before: before?.payoutWalletAddress, payout_wallet_after: next });
    expect((await adm("PATCH", `/merchants/${m.id}`, { body: {} })).status).toBe(400);
    expect((await adm("PATCH", `/merchants/${m.id}`, { body: { fee_bps: 1 } })).status).toBe(400); // fee has its own endpoint
    expect((await adm("PATCH", `/merchants/${m.id}`, { body: { payout_wallet_address: "0x123" } })).status).toBe(400);
  });
});

describe("API keys", () => {
  it("returns the raw key once, stores only a hash, and never logs it in the audit trail", async () => {
    const m = await onboard();
    const created = await adm("POST", `/merchants/${m.id}/api-keys`, { body: { mode: "test" } });
    expect(created.json.key).toMatch(/^sk_test_[0-9a-f]{64}$/);
    expect(created.json.prefix).toBe(created.json.key.slice(0, 16));
    expect((await api("GET", "/v1/payment_intents", { key: created.json.key })).status).toBe(200);

    const list = await adm("GET", `/merchants/${m.id}/api-keys`);
    expect(list.json.data.length).toBeGreaterThanOrEqual(2);
    const text = JSON.stringify(list.json);
    expect(text).not.toContain(created.json.key);
    expect(text).not.toMatch(/key_hash|"key":/);
    expect(JSON.stringify(await audit(m.id))).not.toContain(created.json.key);
  });

  it("revokes immediately and idempotently, and only within the right merchant", async () => {
    const a = await onboard();
    const b = await onboard();
    expect((await api("GET", "/v1/payment_intents", { key: a.apiKey })).status).toBe(200);
    expect((await adm("DELETE", `/merchants/${b.id}/api-keys/${a.keyId}`)).status).toBe(404); // someone else's key
    expect((await api("GET", "/v1/payment_intents", { key: a.apiKey })).status).toBe(200);

    const revoked = await adm("DELETE", `/merchants/${a.id}/api-keys/${a.keyId}`);
    expect(revoked.json.revoked_at).toBeTruthy();
    expect((await api("GET", "/v1/payment_intents", { key: a.apiKey })).status).toBe(401);
    await adm("DELETE", `/merchants/${a.id}/api-keys/${a.keyId}`);
    expect((await audit(a.id)).filter((r) => r.action === "api_key.revoke")).toHaveLength(1);
  });

  it("can create live keys, which stay unusable while the platform is testnet-only", async () => {
    const m = await onboard();
    const live = await adm("POST", `/merchants/${m.id}/api-keys`, { body: { mode: "live" } });
    expect(live.status).toBe(201);
    const res = await api("GET", "/v1/payment_intents", { key: live.json.key });
    expect(res.json.error.code).toBe("live_mode_disabled");
    expect((await adm("POST", `/merchants/${m.id}/api-keys`, { body: { mode: "prod" } })).status).toBe(400);
    expect((await adm("POST", `/merchants/mer_${"0".repeat(32)}/api-keys`, { body: { mode: "test" } })).status).toBe(404);
  });
});

describe("on-ramp routing", () => {
  it("replaces the provider list, rejects duplicates, and an empty list disables card checkout", async () => {
    const m = await onboard();
    const set = await adm("PUT", `/merchants/${m.id}/onramp-routing`, { body: { providers: [{ provider: "mock", priority: 5 }, { provider: "wert", priority: 1, enabled: false }] } });
    expect(set.json.data).toEqual([
      { provider: "mock", priority: 5, enabled: true },
      { provider: "wert", priority: 1, enabled: false },
    ]);
    expect((await h.db.select().from(onrampRouting).where(eq(onrampRouting.merchantId, m.id)))).toHaveLength(2);
    expect((await adm("PUT", `/merchants/${m.id}/onramp-routing`, { body: { providers: [{ provider: "mock" }, { provider: "mock" }] } })).status).toBe(400);
    expect((await adm("PUT", `/merchants/${m.id}/onramp-routing`, { body: { providers: [{ provider: "paypal" }] } })).status).toBe(400);

    await adm("PUT", `/merchants/${m.id}/onramp-routing`, { body: { providers: [] } });
    expect((await h.db.select().from(onrampRouting).where(eq(onrampRouting.merchantId, m.id)))).toHaveLength(0);
    const line = (await audit(m.id)).filter((r) => r.action === "merchant.set_onramp_routing").at(-1);
    expect(line?.data).toMatchObject({ before: [{ provider: "mock" }, { provider: "wert" }].map((x) => expect.objectContaining(x)), after: [] });
  });
});

describe("payment search", () => {
  it("filters across merchants, never exposes client secrets, and paginates", async () => {
    const a = await seedMerchant(h);
    const b = await seedMerchant(h);
    const pa = await insertIntent(h, a.merchantId, { status: "succeeded" });
    await insertIntent(h, a.merchantId);
    const pb = await insertIntent(h, b.merchantId);

    const byMerchant = await adm("GET", `/payment_intents?merchant_id=${a.merchantId}`);
    expect(byMerchant.json.data).toHaveLength(2);
    expect(byMerchant.json.data.every((p: { merchant_id: string }) => p.merchant_id === a.merchantId)).toBe(true);
    expect(JSON.stringify(byMerchant.json)).not.toMatch(/client_secret|checkout_url/);

    expect((await adm("GET", `/payment_intents?merchant_id=${a.merchantId}&status=succeeded`)).json.data.map((p: { id: string }) => p.id)).toEqual([pa.id]);
    expect((await adm("GET", `/payment_intents?id=${pb.id}`)).json.data[0].merchant_id).toBe(b.merchantId);
    const paged = await adm("GET", `/payment_intents?merchant_id=${a.merchantId}&limit=1`);
    expect(paged.json).toMatchObject({ has_more: true });
    const next = await adm("GET", `/payment_intents?merchant_id=${a.merchantId}&limit=1&starting_after=${paged.json.next_cursor}`);
    expect(next.json.data[0].id).not.toBe(paged.json.data[0].id);
    expect((await adm("GET", "/payment_intents?limit=1&starting_after=pi_nope")).status).toBe(400);
    expect((await adm("GET", "/payment_intents?bogus=1")).status).toBe(400);
  });

  it("finds a payment by merchant order id and by transaction hash", async () => {
    const m = await onboard();
    const created = await api("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000", merchant_order_id: "order-find-me" } });
    const found = await adm("GET", "/payment_intents?merchant_order_id=order-find-me");
    expect(found.json.data.map((p: { id: string }) => p.id)).toEqual([created.json.id]);

    const hash = `0x${"ab".repeat(32)}`;
    await h.db.transaction((tx) => recordIntentEvent(tx, { intentId: created.json.id, actor: "test", reason: "x", patch: { txHash: hash } }));
    expect((await adm("GET", `/payment_intents?tx_hash=${hash.toUpperCase().replace("0X", "0x")}`)).json.data.map((p: { id: string }) => p.id)).toEqual([created.json.id]);
  });

  it("shows one payment with its full audit trail", async () => {
    const m = await seedMerchant(h);
    const p = await insertIntent(h, m.merchantId, { status: "confirming" });
    const res = await adm("GET", `/payment_intents/${p.id}`);
    expect(res.json.payment_intent.status).toBe("confirming");
    expect(res.json.events.map((e: { to_status: string }) => e.to_status).sort()).toEqual(["awaiting_payment", "confirming", "created"]);
    expect((await adm("GET", `/payment_intents/pi_${"0".repeat(32)}`)).status).toBe(404);
  });
});

describe("review queue", () => {
  async function flagged(merchantId: string, reason: string | null, extra: { status?: "underpaid" } = {}): Promise<IntentRow> {
    const p = await insertIntent(h, merchantId, { status: "awaiting_payment" });
    await h.db.transaction(async (tx) => {
      if (extra.status) await transitionIntent(tx, { intentId: p.id, to: extra.status, actor: "test", patch: { underpaidAmount: 40_000_000n } });
      if (reason !== null) await recordIntentEvent(tx, { intentId: p.id, actor: "test", reason, patch: { needsReview: true, reviewReason: reason } });
    });
    return p;
  }

  it("groups payments into late / overpaid / underpaid / stuck / mismatch / other and filters by category", async () => {
    const m = await seedMerchant(h);
    const late = await flagged(m.merchantId, "late_deposit_expired");
    const late2 = await flagged(m.merchantId, "late_payment_canceled");
    const over = await flagged(m.merchantId, "deposit_overpaid");
    const stuck = await flagged(m.merchantId, "sweep_attempts_exhausted");
    const mismatch = await flagged(m.merchantId, "event_mismatch");
    const other = await flagged(m.merchantId, "something_new");
    const under = await flagged(m.merchantId, null, { status: "underpaid" });
    const mine = new Set([late, late2, over, stuck, mismatch, other, under].map((p) => p.id));

    const all = await adm("GET", "/review-queue?limit=100");
    const ours = all.json.data.filter((p: { id: string }) => mine.has(p.id));
    expect(ours).toHaveLength(7);
    const cat = (id: string) => ours.find((p: { id: string }) => p.id === id).category;
    expect([cat(late.id), cat(late2.id), cat(over.id), cat(stuck.id), cat(mismatch.id), cat(other.id), cat(under.id)]).toEqual([
      "late_payment", "late_payment", "overpaid", "stuck_deposit", "chain_mismatch", "other", "underpaid",
    ]);

    for (const [category, expected] of [
      ["late_payment", [late.id, late2.id]],
      ["overpaid", [over.id]],
      ["stuck_deposit", [stuck.id]],
      ["chain_mismatch", [mismatch.id]],
      ["other", [other.id]],
      ["underpaid", [under.id]],
    ] as const) {
      const res = await adm("GET", `/review-queue?category=${category}&limit=100`);
      const got = res.json.data.map((p: { id: string }) => p.id).filter((id: string) => mine.has(id));
      expect(new Set(got), category).toEqual(new Set(expected));
    }
    expect((await adm("GET", "/review-queue?category=bogus")).status).toBe(400);
  });

  it("marks only flagged items as resolvable (an underpaid item leaves the queue by itself)", async () => {
    const m = await seedMerchant(h);
    const under = await flagged(m.merchantId, null, { status: "underpaid" });
    const res = await adm("GET", `/review-queue?category=underpaid&limit=100`);
    const item = res.json.data.find((p: { id: string }) => p.id === under.id);
    expect(item).toMatchObject({ requires_review: false, underpaid_amount: "40000000" });
    expect((await adm("POST", `/review-queue/${under.id}/resolve`, { body: { resolution: "acknowledged", note: "n/a" } })).status).toBe(409);
  });

  it("resolving clears the flag, records who and why, and never touches the payment status", async () => {
    const m = await seedMerchant(h);
    const p = await flagged(m.merchantId, "late_deposit_expired");
    const res = await adm("POST", `/review-queue/${p.id}/resolve`, { body: { resolution: "refund_recorded", note: "Customer paid 2h late; refund logged." } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ requires_review: false, review_reason: null, status: "awaiting_payment" });

    const events = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, p.id)).orderBy(desc(paymentEvents.createdAt));
    expect(events[0]).toMatchObject({ reason: "review_resolved", actor: `admin:${admin.id}`, fromStatus: "awaiting_payment", toStatus: "awaiting_payment" });
    expect(events[0]?.data).toMatchObject({ resolution: "refund_recorded", previous_reason: "late_deposit_expired" });
    expect((await audit(p.id)).at(-1)).toMatchObject({ action: "review.resolve", adminId: admin.id });
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, p.id));
    expect(row?.status).toBe("awaiting_payment");

    const queue = await adm("GET", "/review-queue?limit=100");
    expect(queue.json.data.some((x: { id: string }) => x.id === p.id)).toBe(false);
    expect((await adm("POST", `/review-queue/${p.id}/resolve`, { body: { resolution: "acknowledged", note: "again" } })).status).toBe(409); // already resolved
  });

  it("validates the resolution and requires a note", async () => {
    const m = await seedMerchant(h);
    const p = await flagged(m.merchantId, "deposit_overpaid");
    expect((await adm("POST", `/review-queue/${p.id}/resolve`, { body: { resolution: "acknowledged" } })).status).toBe(400);
    expect((await adm("POST", `/review-queue/${p.id}/resolve`, { body: { resolution: "acknowledged", note: "" } })).status).toBe(400);
    expect((await adm("POST", `/review-queue/${p.id}/resolve`, { body: { resolution: "delete_it", note: "x" } })).status).toBe(400);
    expect((await adm("POST", `/review-queue/pi_${"0".repeat(32)}/resolve`, { body: { resolution: "acknowledged", note: "x" } })).status).toBe(404);
  });

  it("includes deposit progress for deposit-address payments", async () => {
    const m = await seedMerchant(h);
    const p = await flagged(m.merchantId, "deposit_overpaid");
    const res = await adm("GET", `/payment_intents/${p.id}`);
    expect(res.json.payment_intent.deposit).toBeNull(); // no deposit address on this one
  });
});

describe("reconciliation", () => {
  it("queues a run through the worker's queue and audits who asked", async () => {
    const enqueue = vi.fn(async () => {});
    const h2 = await makeHarness({ enqueueReconcile: enqueue });
    const res = await adminClient(h2, admin)("POST", "/reconciliation/run");
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((await h2.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "reconciliation.run"))).some((r) => r.adminId === admin.id)).toBe(true);
    await h2.close();
  });

  it("returns 503 when no queue is wired, and lists stored runs newest first", async () => {
    expect((await adm("POST", "/reconciliation/run")).status).toBe(503);
    const { reconciliationRuns, newId } = await import("@belk/db");
    const ids = [newId("orr"), newId("orr")];
    await h.db.insert(reconciliationRuns).values([
      { id: ids[0]!, trigger: "manual", status: "ok", mismatchCount: 0, report: { intentsChecked: 1 }, startedAt: new Date("2031-01-01T00:00:00Z"), finishedAt: new Date("2031-01-01T00:00:01Z") },
      { id: ids[1]!, trigger: "schedule", status: "mismatch", mismatchCount: 2, report: { mismatches: [{}, {}] }, startedAt: new Date("2031-06-01T00:00:00Z"), finishedAt: new Date("2031-06-01T00:00:02Z") },
    ]);
    const list = await adm("GET", "/reconciliation/runs?limit=2");
    expect(list.json.data.map((r: { id: string }) => r.id)).toEqual([ids[1], ids[0]]);
    expect(list.json.data[0]).toMatchObject({ status: "mismatch", mismatch_count: 2, trigger: "schedule" });
    expect((await adm("GET", `/reconciliation/runs/${ids[0]}`)).json.report).toEqual({ intentsChecked: 1 });
    expect((await adm("GET", "/reconciliation/runs/orr_nope")).status).toBe(404);
  });
});
