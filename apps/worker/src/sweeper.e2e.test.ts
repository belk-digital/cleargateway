import { predictDepositAddress } from "@belk/chain";
import { depositAddresses, issueDepositAddress, merchants, paymentEvents, paymentIntents, webhookDeliveries } from "@belk/db";
import { and, eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChainWatcher } from "./jobs/chain-watcher.js";
import { runConfirmations } from "./jobs/confirmations.js";
import { runDepositWatcher } from "./jobs/deposit-watcher.js";
import { runSweeper } from "./jobs/sweeper.js";
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
const depRow = async (intentId: string) => (await s.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, intentId)))[0]!;
const reasons = async (id: string) => (await s.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id)).orderBy(paymentEvents.createdAt)).map((e) => e.reason);
const deliveries = (type: string, intentId: string) =>
  s.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.eventType, type), sql`${webhookDeliveries.payload} #>> '{data,object,id}' = ${intentId}`));

/** Each test gets its own merchant (own payout wallet), so absolute balance assertions never see another
 * test's leftover funds. A webhook endpoint is pre-registered on the shared receiver for the tests that check delivery. */
async function freshMerchant(feeBps = 200) {
  const merchant = await seedMerchant(s, feeBps);
  const api = apiClient(s, merchant.apiKey);
  expect((await api("POST", "/v1/webhook_endpoints", { url: receiver.url })).status).toBe(201);
  return { merchant, api };
}

async function newDepositIntent(api: ReturnType<typeof apiClient>, amount = USDC(100)): Promise<{ id: string; address: Address }> {
  const created = await api("POST", "/v1/payment_intents", { amount: amount.toString() });
  expect(created.status).toBe(201);
  const row = await intentRow(created.json.id);
  const address = predictDepositAddress({ factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, salt: row.intentHash as Hex });
  const head = await s.chain.publicClient.getBlockNumber();
  await s.db.transaction((tx) =>
    issueDepositAddress(tx, { intentId: row.id, chainId: 84532, address, factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, salt: row.intentHash, creationBlock: head, actor: "test" }),
  );
  return { id: row.id, address };
}

async function exchangeSend(to: Address, amount: bigint): Promise<Hex> {
  const ex = newAccount();
  await s.chain.fund(ex.address);
  await mintTo(s.chain, ex.address, amount);
  const hash = await s.chain.wallet(ex).writeContract({ address: s.chain.usdc, abi: s.chain.usdcAbi, functionName: "transfer", args: [to, amount], chain: null });
  await s.chain.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Advances the whole pipeline one tick: deposit watcher -> sweeper -> chain watcher -> confirmations. */
async function tick() {
  await runDepositWatcher(s.ctx);
  const sw = await runSweeper(s.ctx);
  await runChainWatcher(s.ctx);
  await runConfirmations(s.ctx);
  return sw;
}
async function untilSucceeded(id: string, maxTicks = 8) {
  for (let i = 0; i < maxTicks; i++) {
    await tick();
    if ((await intentRow(id)).status === "succeeded") return;
    await s.chain.mine(1);
  }
  throw new Error(`intent ${id} did not succeed within ${maxTicks} ticks`);
}

describe("E2E: sweeper (deposit address -> splitter payment, no customer signature)", () => {
  it("full deposit sweeps automatically: funded -> swept -> confirming -> succeeded, ledger balanced, webhook signed", async () => {
    const { merchant: m, api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(100));
    await exchangeSend(address, USDC(100));

    await runDepositWatcher(s.ctx);
    await s.chain.mine(2); // reach CONFIRMATIONS=3 for the deposit itself
    const r1 = await runDepositWatcher(s.ctx);
    expect(r1.funded).toBe(1);
    expect((await depRow(id)).status).toBe("funded");

    const sweep = await runSweeper(s.ctx);
    expect(sweep.outcomes.submitted).toBe(1);
    const afterSubmit = await depRow(id);
    expect(afterSubmit.status).toBe("sweeping");
    expect(afterSubmit.sweepTxHash).toMatch(/^0x[0-9a-f]{64}$/);

    // The sweep tx itself already performed the on-chain split.
    expect(await balanceOf(s.chain, m.payoutWallet)).toBe(USDC(98));
    expect(await balanceOf(s.chain, s.chain.platform)).toBe(USDC(2));
    expect(await balanceOf(s.chain, address)).toBe(0n);
    expect(await balanceOf(s.chain, s.chain.splitter)).toBe(0n);

    // Sweeping alone does not finalize the payment: only the chain watcher + confirmations do that.
    expect((await intentRow(id)).status).toBe("awaiting_payment");

    const settled = await runSweeper(s.ctx); // sees the receipt landed
    expect(settled.outcomes.succeeded).toBe(1);
    expect((await depRow(id)).status).toBe("swept");

    await runChainWatcher(s.ctx);
    expect((await intentRow(id)).status).toBe("confirming");
    await s.chain.mine(3);
    await runConfirmations(s.ctx);
    const row = await intentRow(id);
    // Payer address is stored checksummed (decoded from the on-chain event), same convention as wallet payments.
    expect(row).toMatchObject({ status: "succeeded", paymentMethod: "deposit_address", payerAddress: address });

    const rows = await s.db.execute<{ debits: string; credits: string }>(sql`
      select coalesce(sum(e.amount) filter (where e.direction='debit'),0)::text as debits, coalesce(sum(e.amount) filter (where e.direction='credit'),0)::text as credits
      from ledger_entries e join ledger_transactions t on t.id=e.transaction_id where t.intent_id = ${id}`);
    expect(rows[0]).toEqual({ debits: USDC(100).toString(), credits: USDC(100).toString() });

    expect(await reasons(id)).toEqual(
      expect.arrayContaining(["intent_created", "deposit_address_issued", "deposit_detected", "deposit_funded", "payment_detected", "confirmed_on_chain"]),
    );
    const hook = await deliveries("payment_intent.succeeded", id);
    expect(hook).toHaveLength(1);
  });

  it("underpaid deposit does not sweep; a top-up triggers exactly one sweep for the full intent amount", async () => {
    const { merchant: m, api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(100));
    await exchangeSend(address, USDC(60));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    expect((await intentRow(id)).status).toBe("underpaid");
    expect((await runSweeper(s.ctx)).outcomes).toEqual({});
    expect(await balanceOf(s.chain, address)).toBe(USDC(60));

    await exchangeSend(address, USDC(40));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    expect((await depRow(id)).status).toBe("funded");

    await untilSucceeded(id);
    expect(await balanceOf(s.chain, m.payoutWallet)).toBe(USDC(98));
    expect(await balanceOf(s.chain, s.chain.platform)).toBeGreaterThanOrEqual(USDC(2)); // shared across tests
    expect(await balanceOf(s.chain, address)).toBe(0n); // both transfers combined were swept exactly once
  });

  it("overpayment: sweeps exactly the intent amount and leaves the excess at the address (decision 1=A)", async () => {
    const { merchant: m, api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(100));
    await exchangeSend(address, USDC(150));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    await untilSucceeded(id);
    expect(await balanceOf(s.chain, m.payoutWallet)).toBe(USDC(98));
    expect(await balanceOf(s.chain, address)).toBe(USDC(50)); // untouched, awaits a manual rescue
    expect((await intentRow(id)).overpaidAmount).toBe(USDC(50));
  });

  it("uses the merchant's CURRENT payout wallet, read fresh at sweep time", async () => {
    const { merchant: m, api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(20));
    const newWallet = newAccount().address;
    await s.db.update(merchants).set({ payoutWalletAddress: newWallet }).where(eq(merchants.id, m.merchantId));
    await exchangeSend(address, USDC(20));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    await untilSucceeded(id);
    // 20 USDC @ 200 bps -> fee 0.4, merchant 19.6.
    expect(await balanceOf(s.chain, newWallet)).toBe(19_600_000n);
    expect(await balanceOf(s.chain, m.payoutWallet)).toBe(0n); // nothing went to the old wallet for THIS payment
  });

  it("cancellation after funding: the sweeper refuses to sweep, flags for review, and abandons retries", async () => {
    const { api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(30));
    await exchangeSend(address, USDC(30));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    expect((await depRow(id)).status).toBe("funded");

    // Cancel is not deposit-aware today: the merchant (or a bug) can still cancel a funded intent.
    await s.db.execute(sql`update payment_intents set status = 'canceled' where id = ${id}`);

    const r = await runSweeper(s.ctx);
    expect(r.outcomes.not_eligible).toBe(1);
    expect(await depRow(id)).toMatchObject({ status: "abandoned" });
    expect(await intentRow(id)).toMatchObject({ needsReview: true, reviewReason: "deposit_funded_after_terminal" });
    expect(await balanceOf(s.chain, address)).toBe(USDC(30)); // untouched, funds still sit there for a rescue
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(1);

    // Abandoned addresses are never retried.
    const again = await runSweeper(s.ctx);
    expect(again.outcomes).toEqual({});
  });

  it("gives up once sweepAttempts reaches SWEEP_MAX_ATTEMPTS and flags for review, without moving any funds", async () => {
    const { merchant: m, api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(10));
    await exchangeSend(address, USDC(10));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    expect((await depRow(id)).status).toBe("funded");

    // Simulate attempts already exhausted by a previous run (e.g. a relayer that was out of gas for a while),
    // without needing to force a real on-chain failure.
    await s.db.update(depositAddresses).set({ sweepAttempts: s.workerConfig.SWEEP_MAX_ATTEMPTS }).where(eq(depositAddresses.intentId, id));

    const r = await runSweeper(s.ctx);
    expect(r.outcomes.abandoned).toBe(1);
    expect(await depRow(id)).toMatchObject({ status: "abandoned", sweepTxHash: null });
    expect(await intentRow(id)).toMatchObject({ needsReview: true, reviewReason: "sweep_attempts_exhausted", status: "awaiting_payment" });
    expect(await balanceOf(s.chain, address)).toBe(USDC(10)); // no transaction was ever sent
    expect(await balanceOf(s.chain, m.payoutWallet)).toBe(0n);
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(1);

    // Abandoned addresses are never retried, even once attempts would "reset" (they don't).
    expect((await runSweeper(s.ctx)).outcomes).toEqual({});
  });

  it("does nothing when the signer or relayer is not configured", async () => {
    const { api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(10));
    await exchangeSend(address, USDC(10));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    const r = await runSweeper({ ...s.ctx, signer: undefined });
    expect(r.skipped).toBe("not_configured");
    expect((await depRow(id)).status).toBe("funded");
  });

  it("two sweepers racing submit exactly one sweep transaction for the address", async () => {
    const { api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(15));
    await exchangeSend(address, USDC(15));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    const [a, b] = await Promise.all([runSweeper(s.ctx), runSweeper(s.ctx)]);
    const submitted = (a.outcomes.submitted ?? 0) + (b.outcomes.submitted ?? 0);
    expect(submitted).toBe(1);
    await untilSucceeded(id);
  });

  it("the relayer key holds no authority over funds: it only pays gas, and gains no USDC from sweeping", async () => {
    const { api } = await freshMerchant(200);
    const { id, address } = await newDepositIntent(api, USDC(10));
    await exchangeSend(address, USDC(10));
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2);
    await runDepositWatcher(s.ctx);
    const ethBefore = await s.chain.publicClient.getBalance({ address: s.relayerAccount.address });

    await runSweeper(s.ctx);
    await runSweeper(s.ctx); // observe the confirmed receipt

    expect(await balanceOf(s.chain, s.relayerAccount.address)).toBe(0n); // the relayer account never receives USDC
    const ethAfter = await s.chain.publicClient.getBalance({ address: s.relayerAccount.address });
    expect(ethAfter).toBeLessThan(ethBefore); // it only spent gas
    expect((await depRow(id)).status).toBe("swept");
  });
});
