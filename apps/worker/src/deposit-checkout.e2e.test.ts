import { predictDepositAddress, predictImplementationAddress } from "@belk/chain";
import { depositAddresses, paymentIntents, webhookDeliveries } from "@belk/db";
import { verifyWebhookSignature } from "@belk/shared";
import { and, eq, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChainWatcher } from "./jobs/chain-watcher.js";
import { runConfirmations } from "./jobs/confirmations.js";
import { runDepositWatcher } from "./jobs/deposit-watcher.js";
import { runSweeper } from "./jobs/sweeper.js";
import { runWebhookDelivery } from "./jobs/webhook-delivery.js";
import { apiClient, balanceOf, makeStack, mintTo, newAccount, seedMerchant, startReceiver, type Receiver, type Stack } from "./test/harness.js";

let s: Stack;
let receiver: Receiver;
const USDC = (n: number) => BigInt(n) * 1_000_000n;

beforeAll(async () => {
  s = await makeStack();
  receiver = await startReceiver();
});
afterAll(async () => {
  await receiver?.close();
  await s?.close();
});

const intentRow = async (id: string) => (await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)))[0]!;
const deliveries = (type: string, intentId: string) =>
  s.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.eventType, type), sql`${webhookDeliveries.payload} #>> '{data,object,id}' = ${intentId}`));

/**
 * Closes Milestone 5 end to end: exercises the SAME public HTTP surface a real checkout frontend would call
 * (create intent -> POST .../deposit-address), not a database shortcut, then drives the deposit through the
 * full worker pipeline exactly as the earlier deposit/sweeper test files do with intents created directly.
 */
describe("Milestone 5 close-out: deposit-address checkout, end to end through the real API", () => {
  it("checkout API issues an address matching an independent CREATE2 computation, funds settle automatically", async () => {
    const merchant = await seedMerchant(s, 200);
    const api = apiClient(s, merchant.apiKey);
    const endpoint = await api("POST", "/v1/webhook_endpoints", { url: receiver.url });
    expect(endpoint.status).toBe(201);
    const webhookSecret = endpoint.json.secret as string;

    // 1) Merchant's server creates the intent.
    const created = await api("POST", "/v1/payment_intents", { amount: USDC(100).toString() });
    expect(created.status).toBe(201);
    const { id, client_secret: clientSecret } = created.json as { id: string; client_secret: string };

    // 2) Checkout page asks the PUBLIC API for a deposit address (client-secret scoped, no merchant key).
    const depRes = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${id}/deposit-address`,
      headers: { "x-client-secret": clientSecret },
    });
    expect(depRes.statusCode).toBe(200);
    const dep = depRes.json() as { address: Address; chain_id: number; token_address: Address; amount: string; warning: string };
    expect(dep).toMatchObject({ chain_id: 84532, token_address: getAddress(s.chain.usdc), amount: USDC(100).toString() });
    expect(dep.warning).toMatch(/USDC on Base only/i);

    // Independently verify the address the API handed back: same CREATE2 computation, done separately.
    const row = await intentRow(id);
    const implementation = predictImplementationAddress(s.chain.depositFactory);
    expect(getAddress(implementation)).toBe(getAddress(s.chain.depositImplementation));
    const expectedAddress = predictDepositAddress({ factory: s.chain.depositFactory, implementation, salt: row.intentHash as `0x${string}` });
    expect(getAddress(dep.address)).toBe(expectedAddress);
    expect(row).toMatchObject({ status: "awaiting_payment", paymentMethod: "deposit_address" });

    // 3) The public checkout view reflects the address before any money moves.
    const view = await s.app.inject({ method: "GET", url: `/v1/checkout/${id}`, headers: { "x-client-secret": clientSecret } });
    expect(view.json().deposit_address).toMatchObject({ address: dep.address.toLowerCase(), status: "awaiting_deposit" });

    // 4) Customer sends USDC from an exchange to the address the checkout page displayed.
    const exchange = newAccount();
    await s.chain.fund(exchange.address);
    await mintTo(s.chain, exchange.address, USDC(100));
    const txHash = await s.chain
      .wallet(exchange)
      .writeContract({ address: s.chain.usdc, abi: s.chain.usdcAbi, functionName: "transfer", args: [dep.address, USDC(100)], chain: null });
    await s.chain.publicClient.waitForTransactionReceipt({ hash: txHash });

    // 5) The worker pipeline takes it from there with no further customer action: detect -> confirm the deposit
    //    -> sweep into the splitter (merchant/platform split on-chain) -> detect PaymentSettled -> confirm -> succeeded.
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    const detected = await runDepositWatcher(s.ctx);
    expect(detected.funded).toBe(1);

    await runSweeper(s.ctx);
    await runSweeper(s.ctx); // observes the sweep's own receipt
    await runChainWatcher(s.ctx);
    await s.chain.mine(3);
    await runConfirmations(s.ctx);

    const finalRow = await intentRow(id);
    expect(finalRow.status).toBe("succeeded");
    expect(await balanceOf(s.chain, merchant.payoutWallet)).toBe(USDC(98));
    expect(await balanceOf(s.chain, s.chain.platform)).toBeGreaterThanOrEqual(USDC(2));
    expect(await balanceOf(s.chain, dep.address)).toBe(0n);
    expect(await balanceOf(s.chain, s.chain.splitter)).toBe(0n);
    const [depositRow] = await s.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, id));
    expect(depositRow?.status).toBe("swept");

    await runWebhookDelivery(s.ctx);

    // 6) Checkout status (as the frontend would poll) and the merchant's webhook both confirm success.
    const finalView = await s.app.inject({ method: "GET", url: `/v1/checkout/${id}/status`, headers: { "x-client-secret": clientSecret } });
    expect(finalView.json()).toMatchObject({ status: "succeeded", confirmations: expect.any(Number) });

    const hooks = await deliveries("payment_intent.succeeded", id);
    expect(hooks).toHaveLength(1);
    const delivered = receiver.received.find((r) => r.body.includes(id) && r.body.includes("payment_intent.succeeded"));
    expect(delivered).toBeDefined();
    expect(verifyWebhookSignature({ payload: delivered!.body, header: delivered!.headers["cleargateway-signature"] as string, secret: webhookSecret })).toBe(true);
    const event = JSON.parse(delivered!.body) as { data: { object: { id: string; amount: string; status: string } } };
    expect(event.data.object).toMatchObject({ id, amount: USDC(100).toString(), status: "succeeded" });
  });

  it("calling deposit-address again after funding returns the same address without disturbing the pipeline", async () => {
    const merchant = await seedMerchant(s, 200);
    const api = apiClient(s, merchant.apiKey);
    const created = await api("POST", "/v1/payment_intents", { amount: USDC(10).toString() });
    const secret = created.json.client_secret as string;

    const first = await s.app.inject({ method: "POST", url: `/v1/checkout/${created.json.id}/deposit-address`, headers: { "x-client-secret": secret } });
    const again = await s.app.inject({ method: "POST", url: `/v1/checkout/${created.json.id}/deposit-address`, headers: { "x-client-secret": secret } });
    expect(again.json().address).toBe(first.json().address);
    const rows = await s.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, created.json.id));
    expect(rows).toHaveLength(1);
  });
});
