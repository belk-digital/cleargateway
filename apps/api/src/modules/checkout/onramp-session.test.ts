import { newMockSessionId, signMockOnrampWebhook } from "@belk/onramp";
import { onrampSessions, paymentEvents, paymentIntents } from "@belk/db";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEPOSIT_FACTORY, SPLITTER, USDC, client, makeHarness, seedMerchant, seedOnrampRouting, type Harness, type SeededMerchant } from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;
let m: SeededMerchant;
const CUSTOMER_WALLET = getAddress("0x999999999999999999999999999999999999999a");

beforeAll(async () => {
  h = await makeHarness();
  api = client(h);
  m = await seedMerchant(h);
  await seedOnrampRouting(h, m.merchantId, [{ provider: "mock", priority: 0 }]);
});
afterAll(async () => {
  await h.close();
});

async function newIntent(body: Record<string, unknown> = { amount: "100000000" }) {
  const res = await api("POST", "/v1/payment_intents", { key: m.apiKey, body });
  expect(res.status).toBe(201);
  return res.json as { id: string; client_secret: string };
}
const secretHeader = (s: string) => ({ "x-client-secret": s });
const post = (i: { id: string; client_secret: string }, body: unknown = { customer_wallet_address: CUSTOMER_WALLET }) =>
  api("POST", `/v1/checkout/${i.id}/onramp-session`, { headers: secretHeader(i.client_secret), body, idem: false });

describe("POST /checkout/:id/onramp-session", () => {
  it("creates a session with the routed (mock) provider and moves created -> awaiting_payment", async () => {
    const i = await newIntent({ amount: "100000000", customer_email: undefined });
    const res = await post(i, { customer_wallet_address: CUSTOMER_WALLET, customer_email: "buyer@example.com" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      intent_id: i.id,
      provider: "mock",
      chain_id: 84532,
      token_address: USDC,
      customer_wallet_address: CUSTOMER_WALLET,
      amount: "100000000",
      currency: "USDC",
    });
    expect(res.json.session_id).toMatch(/^oref_[0-9a-f]{32}$/);
    expect(res.json.widget_config).toMatchObject({ provider: "mock", wallet_address: CUSTOMER_WALLET, amount: "100" });

    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(row).toMatchObject({ status: "awaiting_payment", paymentMethod: "onramp", onrampProvider: "mock", onrampOrderId: res.json.session_id, onrampStatus: "created" });
    const [session] = await h.db.select().from(onrampSessions).where(eq(onrampSessions.providerSessionId, res.json.session_id));
    expect(session).toMatchObject({ provider: "mock", customerWalletAddress: CUSTOMER_WALLET.toLowerCase(), status: "created" });
    const events = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, i.id));
    expect(events.at(-1)).toMatchObject({ toStatus: "awaiting_payment", reason: "onramp_session_created" });
  });

  it("rejects the merchant's payout wallet, the splitter, and the USDC contract as the customer wallet", async () => {
    for (const addr of [m.payoutWallet, SPLITTER, USDC]) {
      const i = await newIntent();
      const res = await post(i, { customer_wallet_address: addr });
      expect(res.status).toBe(400);
      const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
      expect(row?.status).toBe("created"); // nothing was issued
    }
  });

  it("accepts any other distinct address, including the deposit factory (a different, unrelated contract)", async () => {
    const i = await newIntent();
    const res = await post(i, { customer_wallet_address: DEPOSIT_FACTORY });
    expect(res.status).toBe(200);
  });

  it.each([
    ["missing wallet", {}],
    ["bad checksum", { customer_wallet_address: "0xAbC0000000000000000000000000000000000D" }],
    ["not an address", { customer_wallet_address: "0x123" }],
    ["bad email", { customer_wallet_address: CUSTOMER_WALLET, customer_email: "nope" }],
    ["unknown field", { customer_wallet_address: CUSTOMER_WALLET, foo: "bar" }],
  ])("rejects invalid input: %s", async (_n, body) => {
    const i = await newIntent();
    const res = await post(i, body);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a wrong or missing client secret", async () => {
    const i = await newIntent();
    expect((await api("POST", `/v1/checkout/${i.id}/onramp-session`, { body: { customer_wallet_address: CUSTOMER_WALLET }, idem: false })).status).toBe(404);
  });

  it("rejects an expired or canceled intent, issuing nothing", async () => {
    const i = await newIntent();
    expect((await api("POST", `/v1/payment_intents/${i.id}/cancel`, { key: m.apiKey })).status).toBe(200);
    const res = await post(i);
    expect(res.status).toBe(409);
    expect((await h.db.select().from(onrampSessions).where(eq(onrampSessions.intentId, i.id)))).toHaveLength(0);
  });

  it("returns 503 not_configured when the merchant has no enabled on-ramp routing", async () => {
    const other = await seedMerchant(h);
    const otherApi = client(h);
    const created = await otherApi("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" } });
    const res = await otherApi("POST", `/v1/checkout/${created.json.id}/onramp-session`, {
      headers: secretHeader(created.json.client_secret),
      body: { customer_wallet_address: CUSTOMER_WALLET },
      idem: false,
    });
    expect(res.status).toBe(503);
  });

  it("skips a disabled routing row and falls through to the next enabled one", async () => {
    const other = await seedMerchant(h);
    await seedOnrampRouting(h, other.merchantId, [
      { provider: "wert", priority: 10, enabled: false },
      { provider: "mock", priority: 0 },
    ]);
    const otherApi = client(h);
    const created = await otherApi("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" } });
    const res = await otherApi("POST", `/v1/checkout/${created.json.id}/onramp-session`, {
      headers: secretHeader(created.json.client_secret),
      body: { customer_wallet_address: CUSTOMER_WALLET },
      idem: false,
    });
    expect(res.status).toBe(200);
    expect(res.json.provider).toBe("mock");
  });

  it("returns 501 not_implemented when routing points only at a real (stub) provider", async () => {
    const other = await seedMerchant(h);
    await seedOnrampRouting(h, other.merchantId, [{ provider: "wert", priority: 0 }]);
    const otherApi = client(h);
    const created = await otherApi("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" } });
    const res = await otherApi("POST", `/v1/checkout/${created.json.id}/onramp-session`, {
      headers: secretHeader(created.json.client_secret),
      body: { customer_wallet_address: CUSTOMER_WALLET },
      idem: false,
    });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe("not_implemented");
  });

  it("preserves paymentMethod=onramp across a later wallet-payment call for the now-funded wallet", async () => {
    const i = await newIntent();
    await post(i);
    const wp = await api("POST", `/v1/checkout/${i.id}/wallet-payment`, {
      headers: secretHeader(i.client_secret),
      body: { payer_address: CUSTOMER_WALLET },
      idem: false,
    });
    expect(wp.status).toBe(200);
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(row?.paymentMethod).toBe("onramp");
    expect(row?.payerAddress).toBe(CUSTOMER_WALLET);
  });
});

describe("GET /checkout/:id shows on-ramp progress without leaking internals", () => {
  it("reports the provider and status, and nothing before a session exists", async () => {
    const i = await newIntent();
    const before = await api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(i.client_secret) });
    expect(before.json.onramp).toBeNull();
    await post(i);
    const after = await api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(i.client_secret) });
    expect(after.json.onramp).toEqual({ provider: "mock", status: "created" });
  });
});

describe("POST /webhooks/onramp/:provider", () => {
  const secret = "mock-onramp-webhook-secret";
  const post2 = (raw: string, sig?: string) =>
    h.app.inject({
      method: "POST",
      url: "/webhooks/onramp/mock",
      headers: { "content-type": "application/json", ...(sig ? { "x-mock-onramp-signature": sig } : {}) },
      payload: raw,
    });

  it("verifies the signature over the raw body and stores the payload for the worker to process", async () => {
    const i = await newIntent();
    const created = await post(i);
    const body = JSON.stringify({ session_id: created.json.session_id, status: "pending" });
    const res = await post2(body, signMockOnrampWebhook(secret, body));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    // Never applies the status itself here: onramp_status is unchanged until the worker processes it.
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(row?.onrampStatus).toBe("created");
  });

  it("rejects a bad signature and stores nothing", async () => {
    const body = JSON.stringify({ session_id: newMockSessionId(), status: "completed" });
    const res = await post2(body, "0".repeat(64));
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an unknown provider name and 501 for a known-but-unimplemented one", async () => {
    expect((await h.app.inject({ method: "POST", url: "/webhooks/onramp/not-a-provider", payload: "{}", headers: { "content-type": "application/json" } })).statusCode).toBe(404);
    const res = await h.app.inject({ method: "POST", url: "/webhooks/onramp/wert", payload: "{}", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(501);
  });
});
