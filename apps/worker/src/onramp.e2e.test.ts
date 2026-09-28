import { signMockOnrampWebhook } from "@belk/onramp";
import { inboundWebhookEvents, onrampSessions, paymentEvents, paymentIntents } from "@belk/db";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChainWatcher } from "./jobs/chain-watcher.js";
import { runConfirmations } from "./jobs/confirmations.js";
import { runOnrampProcessor } from "./jobs/onramp-processor.js";
import { runWebhookDelivery } from "./jobs/webhook-delivery.js";
import {
  apiClient,
  balanceOf,
  makeStack,
  mintTo,
  newAccount,
  payWithApprove,
  seedMerchant,
  seedOnrampRouting,
  startReceiver,
  type Receiver,
  type Stack,
  type WalletPayload,
} from "./test/harness.js";

let s: Stack;
let receiver: Receiver;
const USDC = (n: number) => BigInt(n) * 1_000_000n;
const ONRAMP_SECRET = "e2e-onramp-webhook-secret";

beforeAll(async () => {
  s = await makeStack();
  receiver = await startReceiver();
});
afterAll(async () => {
  await receiver?.close();
  await s?.close();
});

const intentRow = async (id: string) => (await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)))[0]!;
const reasons = async (id: string) => (await s.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id)).orderBy(paymentEvents.createdAt)).map((e) => e.reason);

async function sendOnrampWebhook(sessionId: string, status: "created" | "pending" | "completed" | "failed", txHash?: string) {
  const body = JSON.stringify({ session_id: sessionId, status, ...(txHash ? { tx_hash: txHash } : {}) });
  const res = await s.app.inject({
    method: "POST",
    url: "/webhooks/onramp/mock",
    headers: { "content-type": "application/json", "x-mock-onramp-signature": signMockOnrampWebhook(ONRAMP_SECRET, body) },
    payload: body,
  });
  expect(res.statusCode).toBe(200);
}

/**
 * Milestone 6 close-out: the on-ramp module never touches the blockchain. It gets USDC into a wallet the CUSTOMER
 * owns; that wallet then pays through the existing wallet-payment flow (Milestone 3). This test drives the whole
 * path through the real public API: create session -> webhook says the on-ramp completed -> the SAME wallet pays
 * the splitter -> the chain watcher (never the webhook) is what finally marks the payment succeeded.
 */
describe("Milestone 6 close-out: on-ramp session -> customer wallet funded -> wallet pays -> succeeded", () => {
  it("end to end through the real checkout API and the worker's onramp processor", async () => {
    const merchant = await seedMerchant(s, 200);
    await seedOnrampRouting(s, merchant.merchantId, [{ provider: "mock", priority: 0 }]);
    const api = apiClient(s, merchant.apiKey);
    const endpoint = await api("POST", "/v1/webhook_endpoints", { url: receiver.url });
    expect(endpoint.status).toBe(201);
    const webhookSecret = endpoint.json.secret as string;

    const created = await api("POST", "/v1/payment_intents", { amount: USDC(100).toString() });
    expect(created.status).toBe(201);
    const { id, client_secret: clientSecret } = created.json as { id: string; client_secret: string };

    // 1) Checkout page creates an on-ramp session for the customer's OWN wallet (a fresh account here).
    const customer = newAccount();
    const sessionRes = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${id}/onramp-session`,
      headers: { "x-client-secret": clientSecret, "content-type": "application/json" },
      payload: JSON.stringify({ customer_wallet_address: customer.address }),
    });
    expect(sessionRes.statusCode).toBe(200);
    const session = sessionRes.json() as { session_id: string; provider: string };
    expect(session.provider).toBe("mock");
    expect((await intentRow(id)).status).toBe("awaiting_payment");

    // 2) The on-ramp provider (simulated) tells us it's pending, then completed, delivering USDC to the CUSTOMER's
    //    wallet (never to the merchant or the splitter). Applying these must never change the payment's status.
    await sendOnrampWebhook(session.session_id, "pending");
    let procResult = await runOnrampProcessor(s.ctx);
    expect(procResult.applied).toBe(1);
    expect((await intentRow(id))).toMatchObject({ status: "awaiting_payment", onrampStatus: "pending" });

    // Simulate the on-ramp's own transfer landing in the customer's wallet.
    await s.chain.fund(customer.address);
    await mintTo(s.chain, customer.address, USDC(100));
    const onrampTxHash = "0x" + "ab".repeat(32);
    await sendOnrampWebhook(session.session_id, "completed", onrampTxHash);
    procResult = await runOnrampProcessor(s.ctx);
    expect(procResult.applied).toBe(1);

    const afterOnramp = await intentRow(id);
    expect(afterOnramp).toMatchObject({ status: "awaiting_payment", onrampStatus: "completed", txHash: null }); // still NOT paid
    const onrampEvents = await reasons(id);
    expect(onrampEvents.filter((r) => r === "onramp_status_changed")).toHaveLength(2);

    // 3) The checkout page now asks for a wallet-payment payload for that SAME (now-funded) wallet.
    const wpRes = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${id}/wallet-payment`,
      headers: { "x-client-secret": clientSecret, "content-type": "application/json" },
      payload: JSON.stringify({ payer_address: customer.address }),
    });
    expect(wpRes.statusCode).toBe(200);
    const payload = wpRes.json() as WalletPayload;
    expect(getAddress(payload.payment_intent.payer)).toBe(getAddress(customer.address));

    // 4) The wallet pays the splitter itself, exactly like a connected-wallet payment.
    const payTx = await payWithApprove(s.chain, customer, payload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: payTx });
    expect(await balanceOf(s.chain, customer.address)).toBe(0n);
    expect(await balanceOf(s.chain, merchant.payoutWallet)).toBe(USDC(98));
    expect(await balanceOf(s.chain, s.chain.platform)).toBe(USDC(2));

    // Still not succeeded until the chain watcher (never the on-ramp webhook) confirms it.
    expect((await intentRow(id)).status).toBe("awaiting_payment");

    await runChainWatcher(s.ctx);
    expect((await intentRow(id)).status).toBe("confirming");
    await s.chain.mine(3);
    await runConfirmations(s.ctx);

    const final = await intentRow(id);
    expect(final).toMatchObject({ status: "succeeded", paymentMethod: "onramp", txHash: payTx.toLowerCase() });
    // The on-ramp's own transfer tx is recorded only in the audit trail, never as the payment's tx_hash.
    expect(final.txHash).not.toBe(onrampTxHash);

    await runWebhookDelivery(s.ctx);
    const hook = receiver.received.find((r) => r.body.includes(id) && r.body.includes("payment_intent.succeeded"));
    expect(hook).toBeDefined();
    const { verifyWebhookSignature } = await import("@belk/shared");
    expect(verifyWebhookSignature({ payload: hook!.body, header: hook!.headers["cleargateway-signature"] as string, secret: webhookSecret })).toBe(true);

    const [row] = await s.db.select().from(onrampSessions).where(eq(onrampSessions.providerSessionId, session.session_id));
    expect(row?.status).toBe("completed");
  });

  it("an on-ramp webhook after the payment already succeeded never reopens or changes it", async () => {
    const merchant = await seedMerchant(s, 200);
    await seedOnrampRouting(s, merchant.merchantId, [{ provider: "mock", priority: 0 }]);
    const api = apiClient(s, merchant.apiKey);
    const created = await api("POST", "/v1/payment_intents", { amount: USDC(10).toString() });
    const clientSecret = created.json.client_secret as string;
    const customer = newAccount();
    await s.chain.fund(customer.address);
    await mintTo(s.chain, customer.address, USDC(10));

    const sessionRes = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${created.json.id}/onramp-session`,
      headers: { "x-client-secret": clientSecret, "content-type": "application/json" },
      payload: JSON.stringify({ customer_wallet_address: customer.address }),
    });
    const session = sessionRes.json() as { session_id: string };

    const wpRes = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${created.json.id}/wallet-payment`,
      headers: { "x-client-secret": clientSecret, "content-type": "application/json" },
      payload: JSON.stringify({ payer_address: customer.address }),
    });
    const payTx = await payWithApprove(s.chain, customer, wpRes.json() as WalletPayload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: payTx });
    await runChainWatcher(s.ctx);
    await s.chain.mine(3);
    await runConfirmations(s.ctx);
    expect((await intentRow(created.json.id)).status).toBe("succeeded");

    // A late "completed" webhook must not touch the succeeded payment.
    await sendOnrampWebhook(session.session_id, "completed", "0x" + "cd".repeat(32));
    await runOnrampProcessor(s.ctx);
    const row = await intentRow(created.json.id);
    expect(row).toMatchObject({ status: "succeeded", txHash: payTx.toLowerCase() });
  });

  it("a wert webhook is refused before it is ever stored, and cannot reach the processor", async () => {
    const before = (await s.db.select().from(inboundWebhookEvents)).length;
    const res = await s.app.inject({ method: "POST", url: "/webhooks/onramp/wert", payload: "{}", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(501);
    expect((await s.db.select().from(inboundWebhookEvents)).length).toBe(before);
  });

  it("the on-ramp processor is idempotent and never marks a payment succeeded by itself", async () => {
    const merchant = await seedMerchant(s, 200);
    await seedOnrampRouting(s, merchant.merchantId, [{ provider: "mock", priority: 0 }]);
    const api = apiClient(s, merchant.apiKey);
    const created = await api("POST", "/v1/payment_intents", { amount: USDC(5).toString() });
    const clientSecret = created.json.client_secret as string;
    const customer = newAccount();
    const sessionRes = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${created.json.id}/onramp-session`,
      headers: { "x-client-secret": clientSecret, "content-type": "application/json" },
      payload: JSON.stringify({ customer_wallet_address: customer.address }),
    });
    const session = sessionRes.json() as { session_id: string };

    await sendOnrampWebhook(session.session_id, "completed");
    await runOnrampProcessor(s.ctx);
    const before = await reasons(created.json.id);
    const r = await runOnrampProcessor(s.ctx); // nothing new to process
    expect(r.processed).toBe(0);
    const after = await reasons(created.json.id);
    expect(after).toEqual(before);
    expect((await intentRow(created.json.id)).status).toBe("awaiting_payment");
  });
});
