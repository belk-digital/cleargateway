import { PAYMENT_INTENT_TYPES, splitterDomain } from "@belk/chain";
import { merchants, paymentEvents, paymentIntents } from "@belk/db";
import { eq } from "drizzle-orm";
import { recoverTypedDataAddress, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SPLITTER,
  USDC,
  client,
  insertIntent,
  makeHarness,
  seedMerchant,
  type Harness,
  type SeededMerchant,
} from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;
let m: SeededMerchant;
const payer = privateKeyToAddress(generatePrivateKey());

beforeAll(async () => {
  h = await makeHarness();
  api = client(h);
  m = await seedMerchant(h);
});
afterAll(async () => {
  await h.close();
});

async function newIntent(body: Record<string, unknown> = { amount: "100000000" }) {
  const res = await api("POST", "/v1/payment_intents", { key: m.apiKey, body });
  expect(res.status).toBe(201);
  return res.json as { id: string; client_secret: string; checkout_url: string };
}
const secretHeader = (s: string) => ({ "x-client-secret": s });

describe("checkout access control (id + client secret)", () => {
  it("returns only public-safe fields", async () => {
    const i = await newIntent({ amount: "100000000", customer_email: "buyer@example.com", metadata: { secret: "internal" } });
    const res = await api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(i.client_secret) });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: i.id,
      status: "created",
      amount: "100000000",
      currency: "USDC",
      merchant: { display_name: "Test Merchant", branding: { primary_color: "#0052ff" } },
      chain_id: 84532,
      contract_address: SPLITTER,
      token_address: USDC,
    });
    const text = JSON.stringify(res.json);
    for (const leaked of ["buyer@example.com", "internal", m.merchantId, m.payoutWallet, "fee", "client_secret_hash"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("accepts the secret via query string too (EventSource cannot set headers)", async () => {
    const i = await newIntent();
    const res = await api("GET", `/v1/checkout/${i.id}?client_secret=${i.client_secret}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ["missing secret", (i: { id: string }) => api("GET", `/v1/checkout/${i.id}`)],
    ["wrong secret", (i: { id: string }) => api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(`${i.id}_secret_${"0".repeat(48)}`) })],
    ["garbage secret", (i: { id: string }) => api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader("nope") })],
  ])("returns 404 for %s (indistinguishable from unknown id)", async (_n, run) => {
    const i = await newIntent();
    const res = await run(i);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("not_found");
  });

  it("does not let one intent's secret open another intent", async () => {
    const a = await newIntent();
    const b = await newIntent();
    expect((await api("GET", `/v1/checkout/${b.id}`, { headers: secretHeader(a.client_secret) })).status).toBe(404);
    expect((await api("GET", `/v1/checkout/${b.id}/status`, { headers: secretHeader(a.client_secret) })).status).toBe(404);
    expect(
      (await api("POST", `/v1/checkout/${b.id}/wallet-payment`, { headers: secretHeader(a.client_secret), body: { payer_address: payer }, idem: false }))
        .status,
    ).toBe(404);
  });

  it("rejects secrets forged for an unknown id with the same shape", async () => {
    const fake = `pi_${"1".repeat(32)}`;
    const res = await api("GET", `/v1/checkout/${fake}`, { headers: secretHeader(`${fake}_secret_${"a".repeat(48)}`) });
    expect(res.status).toBe(404);
  });

  it("shows overdue intents as expired", async () => {
    const i = await newIntent();
    await h.db.update(paymentIntents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(paymentIntents.id, i.id));
    const res = await api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(i.client_secret) });
    expect(res.json.status).toBe("expired");
  });
});

describe("POST /checkout/:id/wallet-payment (approve path)", () => {
  const pay = (i: { id: string; client_secret: string }, body: unknown) =>
    api("POST", `/v1/checkout/${i.id}/wallet-payment`, { headers: secretHeader(i.client_secret), body, idem: false });

  it("returns a payload whose signature recovers to the configured signer over the exact DB values", async () => {
    const i = await newIntent({ amount: "100000000" });
    const res = await pay(i, { payer_address: payer });
    expect(res.status).toBe(200);
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));

    const p = res.json.payment_intent;
    expect(p).toMatchObject({
      intentId: row?.intentHash,
      merchant: m.payoutWallet,
      payer,
      amount: "100000000",
      feeBps: "200",
    });
    expect(res.json).toMatchObject({
      chain_id: 84532,
      contract_address: SPLITTER,
      token_address: USDC,
      method: "approve",
      approval: { token: USDC, spender: SPLITTER, amount: "100000000" },
      call: { function: "pay" },
    });

    const message = {
      intentId: p.intentId as Hex,
      merchant: p.merchant,
      token: USDC as `0x${string}`,
      payer: p.payer,
      amount: BigInt(p.amount),
      feeBps: BigInt(p.feeBps),
      expiry: BigInt(p.expiry),
    };
    const args = {
      domain: splitterDomain(84532, SPLITTER),
      types: PAYMENT_INTENT_TYPES,
      primaryType: "PaymentIntent",
      message,
      signature: res.json.intent_signature as Hex,
    } as const;
    expect(await recoverTypedDataAddress(args)).toBe(h.signerAddress);
    expect(await verifyTypedData({ ...args, address: h.signerAddress })).toBe(true);
    // A different amount must not verify: the signature really binds the terms.
    expect(await verifyTypedData({ ...args, message: { ...message, amount: 1n }, address: h.signerAddress })).toBe(false);
  });

  it("caps signature expiry at min(intent expiry, now + TTL)", async () => {
    const i = await newIntent({ amount: "100000000", expires_in_seconds: 86_400 });
    const res = await pay(i, { payer_address: payer });
    const expiry = Number(res.json.payment_intent.expiry);
    const now = Math.floor(Date.now() / 1000);
    expect(expiry).toBeLessThanOrEqual(now + 1800 + 2);
    expect(expiry).toBeGreaterThan(now + 1700);

    const short = await newIntent({ amount: "100000000", expires_in_seconds: 300 });
    const r2 = await pay(short, { payer_address: payer });
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, short.id));
    expect(Number(r2.json.payment_intent.expiry)).toBe(Math.floor((row?.expiresAt.getTime() ?? 0) / 1000));
  });

  it("moves created -> awaiting_payment with an audit event, and re-issuing keeps it open", async () => {
    const i = await newIntent();
    await pay(i, { payer_address: payer });
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(row).toMatchObject({ status: "awaiting_payment", paymentMethod: "wallet", payerAddress: payer, contractAddress: SPLITTER });

    const again = await pay(i, { payer_address: payer });
    expect(again.status).toBe(200);
    const events = await h.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, i.id)).orderBy(paymentEvents.createdAt);
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
      [null, "created", "intent_created"],
      ["created", "awaiting_payment", "wallet_payload_issued"],
      ["awaiting_payment", "awaiting_payment", "wallet_payload_reissued"],
    ]);
    // Signatures are never written to the audit log.
    expect(JSON.stringify(events)).not.toContain(again.json.intent_signature);
  });

  it("uses the merchant's current payout wallet and merchant status", async () => {
    const other = await seedMerchant(h);
    const c = await api("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "100000000" } });
    await h.db.update(merchants).set({ status: "suspended" }).where(eq(merchants.id, other.merchantId));
    const res = await api("POST", `/v1/checkout/${c.json.id}/wallet-payment`, {
      headers: secretHeader(c.json.client_secret),
      body: { payer_address: payer },
      idem: false,
    });
    expect(res.status).toBe(403);
  });

  it.each([
    ["bad checksum", "0xAbC0000000000000000000000000000000000dEf"],
    ["not an address", "0x123"],
    ["empty", ""],
  ])("rejects payer_address: %s", async (_n, addr) => {
    const i = await newIntent();
    const res = await pay(i, { payer_address: addr });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("invalid_request");
  });

  it("rejects the splitter, token contract and merchant wallet as payer, and unknown fields", async () => {
    const i = await newIntent();
    expect((await pay(i, { payer_address: SPLITTER })).status).toBe(400);
    expect((await pay(i, { payer_address: USDC })).status).toBe(400);
    expect((await pay(i, { payer_address: m.payoutWallet })).status).toBe(400);
    expect((await pay(i, { payer_address: payer, amount: "1" })).status).toBe(400);
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(row?.status).toBe("created"); // nothing was issued
  });

  it("accepts all-lowercase addresses and returns them checksummed", async () => {
    const i = await newIntent();
    const res = await pay(i, { payer_address: payer.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.json.payment_intent.payer).toBe(payer);
  });

  it.each(["expired", "canceled", "confirming", "succeeded", "failed"] as const)("refuses to sign for a %s intent (409)", async (status) => {
    const row = await insertIntent(h, m.merchantId, { status });
    // Manufacture a secret hash for the directly inserted row.
    const { deriveClientSecret, hashClientSecret } = await import("@belk/shared");
    const secret = deriveClientSecret(h.config.CLIENT_SECRET_KEY as string, row.id);
    await h.db.update(paymentIntents).set({ clientSecretHash: hashClientSecret(secret) }).where(eq(paymentIntents.id, row.id));
    const res = await api("POST", `/v1/checkout/${row.id}/wallet-payment`, {
      headers: secretHeader(secret),
      body: { payer_address: payer },
      idem: false,
    });
    expect(res.status).toBe(409);
  });

  it("refuses to sign once expires_at has passed, even if the worker has not expired it yet", async () => {
    const i = await newIntent();
    await h.db.update(paymentIntents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(paymentIntents.id, i.id));
    const res = await pay(i, { payer_address: payer });
    expect(res.status).toBe(409);
  });
});

describe("POST /checkout/:id/wallet-payment (EIP-3009 path)", () => {
  it("returns USDC typed data: payee = splitter, nonce = intent id, correct domain", async () => {
    const i = await newIntent();
    const res = await api("POST", `/v1/checkout/${i.id}/wallet-payment`, {
      headers: secretHeader(i.client_secret),
      body: { payer_address: payer, method: "authorization" },
      idem: false,
    });
    expect(res.status).toBe(200);
    const td = res.json.authorization.typed_data;
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(td.domain).toEqual({ name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC });
    expect(td.primary_type).toBe("ReceiveWithAuthorization");
    expect(td.message).toEqual({
      from: payer,
      to: SPLITTER,
      value: "100000000",
      validAfter: "0",
      validBefore: res.json.payment_intent.expiry,
      nonce: row?.intentHash,
    });
    expect(res.json.call.function).toBe("payWithAuthorization");
    expect(res.json.approval).toBeUndefined();
  });
});

describe("configuration guards", () => {
  it("returns 503 not_configured without a signer, and does not change state", async () => {
    const h2 = await makeHarness({ signer: false });
    const api2 = client(h2);
    const c = await api2("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    const res = await api2("POST", `/v1/checkout/${c.json.id}/wallet-payment`, {
      headers: secretHeader(c.json.client_secret),
      body: { payer_address: payer },
      idem: false,
    });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("not_configured");
    const [row] = await h2.db.select().from(paymentIntents).where(eq(paymentIntents.id, c.json.id));
    expect(row?.status).toBe("created");
    await h2.close();
  });

  it("refuses to create intents without CLIENT_SECRET_KEY", async () => {
    const h2 = await makeHarness({ env: { CLIENT_SECRET_KEY: "" } });
    const res = await client(h2)("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    expect(res.status).toBe(503);
    await h2.close();
  });
});

describe("GET /checkout/:id/status", () => {
  it("returns status, confirmations and the required confirmation count", async () => {
    const i = await newIntent();
    const res = await api("GET", `/v1/checkout/${i.id}/status`, { headers: secretHeader(i.client_secret) });
    expect(res.json).toMatchObject({ id: i.id, status: "created", tx_hash: null, confirmations: 0, required_confirmations: 5 });
  });

  it("streams status over SSE and closes once the payment is final", async () => {
    const i = await newIntent();
    await h.db.transaction(async (tx) => {
      const { transitionIntent } = await import("@belk/db");
      await transitionIntent(tx, { intentId: i.id, to: "awaiting_payment", actor: "test" });
      await transitionIntent(tx, { intentId: i.id, to: "confirming", actor: "test" });
      await transitionIntent(tx, { intentId: i.id, to: "succeeded", actor: "test" });
    });
    const res = await h.app.inject({ method: "GET", url: `/v1/checkout/${i.id}/status/stream?client_secret=${i.client_secret}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: status");
    expect(res.body).toContain('"status":"succeeded"');
  });

  it("SSE rejects a bad secret with 404 before opening a stream", async () => {
    const i = await newIntent();
    const res = await h.app.inject({ method: "GET", url: `/v1/checkout/${i.id}/status/stream?client_secret=wrong` });
    expect(res.statusCode).toBe(404);
  });
});

describe("CORS", () => {
  it("allows the checkout origin to send x-client-secret", async () => {
    const i = await newIntent();
    const res = await h.app.inject({
      method: "OPTIONS",
      url: `/v1/checkout/${i.id}`,
      headers: {
        origin: "http://localhost:3001",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-client-secret",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain("x-client-secret");
  });
});
