import { chainTransactions, ledgerAccounts, ledgerEntries, ledgerTransactions, paymentEvents, paymentIntents, webhookDeliveries } from "@belk/db";
import { verifyWebhookSignature } from "@belk/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PublicClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChainWatcher } from "./jobs/chain-watcher.js";
import { runConfirmations } from "./jobs/confirmations.js";
import { runExpiry } from "./jobs/expiry.js";
import { runReconciliation } from "./jobs/reconciliation.js";
import { runWebhookDelivery } from "./jobs/webhook-delivery.js";
import {
  apiClient,
  balanceOf,
  makeStack,
  mintTo,
  newAccount,
  payWithApprove,
  payWithAuthorization,
  seedMerchant,
  startReceiver,
  type Receiver,
  type SeededMerchant,
  type Stack,
  type WalletPayload,
} from "./test/harness.js";

let s: Stack;
let m: SeededMerchant;
let api: ReturnType<typeof apiClient>;
let receiver: Receiver;
let webhookSecret: string;

beforeAll(async () => {
  s = await makeStack();
  m = await seedMerchant(s, 200);
  api = apiClient(s, m.apiKey);
  receiver = await startReceiver();
  const ep = await api("POST", "/v1/webhook_endpoints", { url: receiver.url });
  expect(ep.status).toBe(201);
  webhookSecret = ep.json.secret;
});
afterAll(async () => {
  await receiver?.close();
  await s?.close();
});

// ------------------------------------------------------------------------------------------------ helpers

async function newPayment(opts: { method?: "approve" | "authorization"; amount?: string } = {}) {
  const amount = opts.amount ?? "100000000";
  const payer = newAccount();
  await s.chain.fund(payer.address);
  await mintTo(s.chain, payer.address, BigInt(amount));
  const created = await api("POST", "/v1/payment_intents", { amount });
  expect(created.status).toBe(201);
  const res = await s.app.inject({
    method: "POST",
    url: `/v1/checkout/${created.json.id}/wallet-payment`,
    headers: { "x-client-secret": created.json.client_secret, "content-type": "application/json" },
    payload: JSON.stringify({ payer_address: payer.address, method: opts.method ?? "approve" }),
  });
  expect(res.statusCode).toBe(200);
  return { payer, intent: created.json as { id: string; client_secret: string }, payload: res.json() as WalletPayload };
}

const intentRow = async (id: string) => (await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)))[0]!;
const events = (id: string) => s.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id)).orderBy(paymentEvents.createdAt);
const setExpiry = (id: string, at: Date) => s.db.execute(sql`update payment_intents set expires_at = ${at.toISOString()} where id = ${id}`);
const ledgerFor = async (intentId: string) => {
  const rows = await s.db
    .select({ type: ledgerAccounts.type, dir: ledgerEntries.direction, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerTransactions.intentId, intentId));
  const sum = (dir: string) => rows.filter((r) => r.dir === dir).reduce((a, r) => a + r.amount, 0n);
  const of = (type: string, dir: string) => rows.filter((r) => r.type === type && r.dir === dir).reduce((a, r) => a + r.amount, 0n);
  return { debits: sum("debit"), credits: sum("credit"), clearing: of("customer_payments_clearing", "debit"), merchant: of("merchant_receivable", "credit"), fee: of("platform_fee_revenue", "credit"), n: rows.length };
};
const deliveriesFor = (eventType: string, intentId: string) =>
  s.db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.eventType, eventType), sql`${webhookDeliveries.payload} #>> '{data,object,id}' = ${intentId}`));

// ------------------------------------------------------------------------------------------------ happy paths

describe("E2E: wallet payment (approve + pay)", () => {
  it("create -> pay on chain -> watcher detects -> confirmations -> succeeded -> ledger balanced -> webhook delivered", async () => {
    const { payer, intent, payload } = await newPayment({ method: "approve", amount: "100000000" });
    expect((await intentRow(intent.id)).status).toBe("awaiting_payment");

    // 1) Customer pays. The split happens on-chain in one transaction.
    const txHash = await payWithApprove(s.chain, payer, payload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: txHash });
    expect(await balanceOf(s.chain, m.payoutWallet)).toBeGreaterThanOrEqual(98_000_000n);
    expect(await balanceOf(s.chain, s.chain.splitter)).toBe(0n);
    expect(await balanceOf(s.chain, payer.address)).toBe(0n);

    // 2) Until the worker reads the chain, the platform does NOT consider it paid.
    expect((await intentRow(intent.id)).status).toBe("awaiting_payment");

    // 3) Watcher detects the event -> confirming.
    const w = await runChainWatcher(s.ctx);
    expect(w.outcomes.detected).toBe(1);
    let row = await intentRow(intent.id);
    expect(row).toMatchObject({ status: "confirming", txHash: txHash.toLowerCase(), payerAddress: payer.address, confirmations: 1 });
    const status = await api("GET", `/v1/payment_intents/${intent.id}`);
    expect(status.json).toMatchObject({ status: "confirming", tx_hash: txHash.toLowerCase() });

    // 4) Not enough confirmations yet: stays confirming, nothing booked, no success webhook.
    expect((await runConfirmations(s.ctx)).outcomes.waiting).toBe(1);
    await s.chain.mine(1);
    expect((await runConfirmations(s.ctx)).outcomes.waiting).toBe(1);
    row = await intentRow(intent.id);
    expect(row).toMatchObject({ status: "confirming", confirmations: 2 });
    expect((await ledgerFor(intent.id)).n).toBe(0);
    expect(await deliveriesFor("payment_intent.succeeded", intent.id)).toHaveLength(0);

    // 5) Reaches N=3 confirmations -> succeeded, ledger + webhook in the same transaction.
    await s.chain.mine(1);
    const c = await runConfirmations(s.ctx);
    expect(c.outcomes.succeeded).toBe(1);
    row = await intentRow(intent.id);
    expect(row.status).toBe("succeeded");
    expect(row.succeededAt).toBeInstanceOf(Date);

    const ledger = await ledgerFor(intent.id);
    expect(ledger).toMatchObject({ debits: 100_000_000n, credits: 100_000_000n, clearing: 100_000_000n, merchant: 98_000_000n, fee: 2_000_000n, n: 3 });
    const bal = await api("GET", "/v1/balance");
    expect(bal.json.settled_payments).toBeGreaterThanOrEqual(1);

    expect((await events(intent.id)).map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
      [null, "created", "intent_created"],
      ["created", "awaiting_payment", "wallet_payload_issued"],
      ["awaiting_payment", "confirming", "payment_detected"],
      ["confirming", "succeeded", "confirmed_on_chain"],
    ]);

    // 6) Signed webhook reaches the merchant.
    const d = await runWebhookDelivery(s.ctx);
    expect(d.succeeded).toBeGreaterThanOrEqual(1);
    const hook = receiver.received.find((r) => (JSON.parse(r.body) as { data: { object: { id: string } }; type: string }).data.object.id === intent.id && (JSON.parse(r.body) as { type: string }).type === "payment_intent.succeeded");
    expect(hook).toBeDefined();
    expect(verifyWebhookSignature({ payload: hook!.body, header: hook!.headers["cleargateway-signature"] as string, secret: webhookSecret })).toBe(true);
    const evt = JSON.parse(hook!.body);
    expect(evt).toMatchObject({ object: "event", type: "payment_intent.succeeded", mode: "test", data: { object: { id: intent.id, status: "succeeded", amount: "100000000", fee_amount: "2000000", merchant_amount: "98000000", tx_hash: txHash.toLowerCase() } } });
    expect(hook!.headers["cleargateway-event-id"]).toBe(evt.id);
    expect(evt.data.object.client_secret).toBeUndefined();

    // 7) Everything is idempotent: re-running jobs changes nothing.
    const before = { ledger: await ledgerFor(intent.id), events: (await events(intent.id)).length, hooks: receiver.received.length };
    await runChainWatcher(s.ctx);
    await runConfirmations(s.ctx);
    await runWebhookDelivery(s.ctx);
    expect(await ledgerFor(intent.id)).toEqual(before.ledger);
    expect((await events(intent.id)).length).toBe(before.events);
    expect(receiver.received.length).toBe(before.hooks);

    // 8) Replaying the whole chain from the start (cursor wiped) only finds duplicates.
    await s.db.execute(sql`delete from chain_cursors`);
    const replay = await runChainWatcher(s.ctx);
    expect(replay.outcomes.duplicate).toBeGreaterThanOrEqual(1);
    expect(replay.outcomes.detected).toBeUndefined();
    expect((await intentRow(intent.id)).status).toBe("succeeded");
    expect((await ledgerFor(intent.id)).n).toBe(3);

    // 9) Reconciliation agrees for this payment.
    const rec = await runReconciliation(s.ctx, { trigger: "manual" });
    expect(rec.report.mismatches.filter((x) => x.intentId === intent.id || x.txHash === txHash.toLowerCase())).toEqual([]);
    expect(rec.report.mismatches.filter((x) => x.type === "ledger_unbalanced")).toEqual([]);
    expect(rec.report.chain.finalEvents).toBeGreaterThanOrEqual(1);
  });

  it("dedupes on tx hash + log index in the database", async () => {
    const rows = await s.db.select().from(chainTransactions);
    const keys = rows.map((r) => `${r.txHash}:${r.logIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("E2E: wallet payment (EIP-3009, one signature, relayer submits)", () => {
  it("settles without any approval transaction", async () => {
    const { payer, intent, payload } = await newPayment({ method: "authorization", amount: "250000000" });
    const relayer = newAccount();
    await s.chain.fund(relayer.address);
    const merchantBefore = await balanceOf(s.chain, m.payoutWallet);
    const platformBefore = await balanceOf(s.chain, s.chain.platform);

    const txHash = await payWithAuthorization(s.chain, payer, relayer, payload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: txHash });
    expect(await balanceOf(s.chain, m.payoutWallet)).toBe(merchantBefore + 245_000_000n);
    expect(await balanceOf(s.chain, s.chain.platform)).toBe(platformBefore + 5_000_000n);
    expect(await balanceOf(s.chain, s.chain.splitter)).toBe(0n);

    await runChainWatcher(s.ctx);
    await s.chain.mine(3);
    await runConfirmations(s.ctx);
    expect((await intentRow(intent.id)).status).toBe("succeeded");
    expect(await ledgerFor(intent.id)).toMatchObject({ debits: 250_000_000n, merchant: 245_000_000n, fee: 5_000_000n });
  });
});

// ------------------------------------------------------------------------------------------------ edge cases

describe("E2E: late payment after expiry is flagged, never dropped", () => {
  it("expired intent that gets paid stays expired, is flagged for review, notifies the merchant and shows in reconciliation", async () => {
    const { payer, intent, payload } = await newPayment();
    await runChainWatcher(s.ctx); // fresh watcher heartbeat, no payment yet
    const txHash = await payWithApprove(s.chain, payer, payload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: txHash });

    // The watcher has not seen the payment yet, but the intent's time is up.
    await setExpiry(intent.id, new Date(Date.now() - 60_000));
    expect((await runExpiry(s.ctx)).expired).toBeGreaterThanOrEqual(1);
    expect((await intentRow(intent.id)).status).toBe("expired");
    expect(await deliveriesFor("payment_intent.expired", intent.id)).toHaveLength(1);

    const w = await runChainWatcher(s.ctx);
    expect(w.outcomes.late_payment).toBe(1);
    const row = await intentRow(intent.id);
    expect(row).toMatchObject({ status: "expired", needsReview: true, reviewReason: "late_payment_expired", txHash: txHash.toLowerCase() });
    expect((await events(intent.id)).some((e) => e.reason === "late_payment_expired")).toBe(true);
    expect(await deliveriesFor("payment_intent.requires_review", intent.id)).toHaveLength(1);

    // It must not be silently booked, and must not linger as confirming.
    await s.chain.mine(3);
    await runConfirmations(s.ctx);
    expect((await intentRow(intent.id)).status).toBe("expired");
    expect((await ledgerFor(intent.id)).n).toBe(0);

    const rec = await runReconciliation(s.ctx, { trigger: "manual" });
    const mm = rec.report.mismatches.filter((x) => x.intentId === intent.id);
    expect(mm.map((x) => x.type)).toContain("event_intent_not_succeeded");
    expect(rec.status).toBe("mismatch");
  });
});

describe("E2E: expiry safety", () => {
  it("expires created intents on time, but holds back payable intents while the watcher heartbeat is stale", async () => {
    const created = await api("POST", "/v1/payment_intents", { amount: "100000000" });
    const { intent: payable } = await newPayment();
    await setExpiry(created.json.id, new Date(Date.now() - 60_000));
    await setExpiry(payable.id, new Date(Date.now() - 60_000));
    await runChainWatcher(s.ctx);

    // Simulate a dead watcher: the clock is 10 minutes past the last heartbeat.
    const stale = await runExpiry({ ...s.ctx, now: () => Date.now() + 10 * 60_000 });
    expect(stale.skippedPayable).toBe("watcher_stale");
    expect((await intentRow(created.json.id)).status).toBe("expired");
    expect((await intentRow(payable.id)).status).toBe("awaiting_payment");

    const fresh = await runExpiry(s.ctx);
    expect(fresh.skippedPayable).toBeUndefined();
    expect((await intentRow(payable.id)).status).toBe("expired");
  });

  it("waits out the grace period after expires_at for payable intents", async () => {
    const { intent } = await newPayment();
    await runChainWatcher(s.ctx);
    await setExpiry(intent.id, new Date(Date.now() - 60_000));
    const graceCtx = { ...s.ctx, config: { ...s.ctx.config, EXPIRY_GRACE_SECONDS: 3600 } };
    await runExpiry(graceCtx);
    expect((await intentRow(intent.id)).status).toBe("awaiting_payment");
    await runExpiry(s.ctx); // no grace
    expect((await intentRow(intent.id)).status).toBe("expired");
  });

  it("running expiry twice does not double-notify", async () => {
    const created = await api("POST", "/v1/payment_intents", { amount: "100000000" });
    await setExpiry(created.json.id, new Date(Date.now() - 1000));
    await runExpiry(s.ctx);
    await runExpiry(s.ctx);
    expect(await deliveriesFor("payment_intent.expired", created.json.id)).toHaveLength(1);
  });
});

describe("E2E: robustness", () => {
  it("two watchers racing detect each payment exactly once", async () => {
    const a = await newPayment();
    const b = await newPayment();
    for (const p of [a, b]) await s.chain.publicClient.waitForTransactionReceipt({ hash: await payWithApprove(s.chain, p.payer, p.payload) });
    const results = await Promise.all([runChainWatcher(s.ctx), runChainWatcher(s.ctx)]);
    const detected = results.reduce((n, r) => n + (r.outcomes.detected ?? 0), 0);
    expect(detected).toBe(2);
    for (const p of [a, b]) {
      const transitions = (await events(p.intent.id)).filter((e) => e.toStatus === "confirming");
      expect(transitions).toHaveLength(1);
    }
  });

  it("an RPC failure is NOT mistaken for a reorg", async () => {
    const { payer, intent, payload } = await newPayment();
    await s.chain.publicClient.waitForTransactionReceipt({ hash: await payWithApprove(s.chain, payer, payload) });
    await runChainWatcher(s.ctx);
    const flaky = new Proxy(s.ctx.chain, {
      get(target, prop, receiver) {
        if (prop === "getTransactionReceipt") return async () => { throw new Error("rpc node unavailable"); };
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as PublicClient;
    const r = await runConfirmations({ ...s.ctx, chain: flaky });
    expect(r.outcomes.receipt_missing).toBeUndefined();
    const row = await intentRow(intent.id);
    expect(row.status).toBe("confirming");
    expect((await events(intent.id)).some((e) => e.reason === "receipt_missing")).toBe(false);
  });

  it("one bad intent does not block the confirmation batch", async () => {
    const good = await newPayment();
    await s.chain.publicClient.waitForTransactionReceipt({ hash: await payWithApprove(s.chain, good.payer, good.payload) });
    await runChainWatcher(s.ctx);
    await s.chain.mine(3);
    const r = await runConfirmations(s.ctx);
    expect(r.outcomes.succeeded ?? 0).toBeGreaterThanOrEqual(1);
    expect((await intentRow(good.intent.id)).status).toBe("succeeded");
  });
});

describe("E2E: chain reorganizations", () => {
  it("payment reorged out: receipt goes missing, then the intent is failed after the grace period, nothing booked", async () => {
    const { payer, intent, payload } = await newPayment();
    await runChainWatcher(s.ctx);
    const snap = await s.chain.snapshot();
    const txHash = await payWithApprove(s.chain, payer, payload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: txHash });
    await runChainWatcher(s.ctx);
    expect((await intentRow(intent.id)).status).toBe("confirming");

    await s.chain.revert(snap); // the payment (and the approve) vanish from the canonical chain
    await s.chain.mine(1);

    const w = await runChainWatcher(s.ctx);
    expect(w.rewound).toBe(true);

    const first = await runConfirmations({ ...s.ctx, config: { ...s.ctx.config, REORG_GRACE_SECONDS: 3600 } });
    expect(first.outcomes.receipt_missing).toBe(1);
    expect((await intentRow(intent.id)).status).toBe("confirming"); // still within grace
    const second = await runConfirmations(s.ctx); // grace = 0 in the test config
    expect(second.outcomes.failed).toBe(1);

    const row = await intentRow(intent.id);
    expect(row.status).toBe("failed");
    expect((await events(intent.id)).map((e) => e.reason)).toEqual(expect.arrayContaining(["receipt_missing", "tx_reorged_out"]));
    expect((await ledgerFor(intent.id)).n).toBe(0);
    expect(await deliveriesFor("payment_intent.failed", intent.id)).toHaveLength(1);
  });

  it("payment re-mined in a different block: block details are refreshed, then it succeeds exactly once", async () => {
    const { payer, intent, payload } = await newPayment();
    // Approve first so only the pay tx is replayed after the revert.
    const approve = await s.chain.wallet(payer).writeContract({ address: s.chain.usdc, abi: s.chain.usdcAbi, functionName: "approve", args: [s.chain.splitter, BigInt(payload.payment_intent.amount)], chain: null });
    await s.chain.publicClient.waitForTransactionReceipt({ hash: approve });
    await runChainWatcher(s.ctx);

    const snap = await s.chain.snapshot();
    const { FIXED_TX } = await import("./test/harness.js");
    const send = () =>
      s.chain.wallet(payer).writeContract({
        address: s.chain.splitter,
        abi: s.chain.splitterAbi,
        functionName: "pay",
        args: [
          { intentId: payload.payment_intent.intentId, merchant: payload.payment_intent.merchant, payer: payload.payment_intent.payer, amount: BigInt(payload.payment_intent.amount), feeBps: BigInt(payload.payment_intent.feeBps), expiry: BigInt(payload.payment_intent.expiry) },
          payload.intent_signature,
        ],
        chain: null,
        nonce: undefined,
        ...FIXED_TX,
      });
    const tx1 = await send();
    const r1 = await s.chain.publicClient.waitForTransactionReceipt({ hash: tx1 });
    await runChainWatcher(s.ctx);
    const first = await intentRow(intent.id);
    expect(first).toMatchObject({ status: "confirming", blockHash: r1.blockHash.toLowerCase() });

    await s.chain.revert(snap);
    await s.chain.mine(2); // a different chain now
    const tx2 = await send(); // identical transaction, mined in a different block
    const r2 = await s.chain.publicClient.waitForTransactionReceipt({ hash: tx2 });
    expect(tx2).toBe(tx1);
    expect(r2.blockHash).not.toBe(r1.blockHash);

    const w = await runChainWatcher(s.ctx);
    expect(w.rewound).toBe(true);
    expect(w.outcomes.block_changed).toBe(1);
    expect(await intentRow(intent.id)).toMatchObject({ status: "confirming", blockHash: r2.blockHash.toLowerCase() });
    expect((await events(intent.id)).some((e) => e.reason === "reorg_block_changed")).toBe(true);

    await s.chain.mine(3);
    await runConfirmations(s.ctx);
    expect((await intentRow(intent.id)).status).toBe("succeeded");
    expect((await ledgerFor(intent.id)).n).toBe(3);
    const ledgerTxs = await s.db.select().from(ledgerTransactions).where(eq(ledgerTransactions.intentId, intent.id));
    expect(ledgerTxs).toHaveLength(1);
  });
});

describe("E2E: reconciliation reports discrepancies and never fixes them", () => {
  it("flags a paid intent with no on-chain event and no ledger, and a ledger booking for an unpaid intent", async () => {
    const { createIntent, transitionIntent, postPaymentSettled, newId } = await import("@belk/db");
    const mk = async () => {
      const id = newId("pi");
      return s.db.transaction((tx) =>
        createIntent(tx, { id, merchantId: m.merchantId, mode: "test", amount: 10_000_000n, feeBps: 200, feeAmount: 200_000n, merchantAmount: 9_800_000n, clientSecretHash: "0".repeat(64), chainId: 84532, intentHash: `0x${"ab".repeat(30)}${id.slice(-4)}`, expiresAt: new Date(Date.now() + 60_000) }, "test"),
      );
    };
    const fake = await mk();
    await s.db.transaction(async (tx) => {
      await transitionIntent(tx, { intentId: fake.id, to: "awaiting_payment", actor: "test" });
      await transitionIntent(tx, { intentId: fake.id, to: "confirming", actor: "test", patch: { txHash: `0x${"11".repeat(32)}`, blockNumber: s.chain.deployBlock + 1n, blockHash: `0x${"22".repeat(32)}` } });
      await transitionIntent(tx, { intentId: fake.id, to: "succeeded", actor: "test" });
    });
    const orphan = await mk();
    await s.db.transaction(async (tx) => {
      await transitionIntent(tx, { intentId: orphan.id, to: "awaiting_payment", actor: "test" });
      await postPaymentSettled(tx, { ...orphan, status: "awaiting_payment" });
    });

    const snapshotBefore = await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, fake.id));
    const rec = await runReconciliation(s.ctx, { trigger: "manual" });
    const typesFor = (id: string) => rec.report.mismatches.filter((x) => x.intentId === id).map((x) => x.type).sort();
    expect(typesFor(fake.id)).toEqual(["ledger_missing", "succeeded_without_event"]);
    expect(typesFor(orphan.id)).toEqual(["ledger_orphan"]);
    expect(rec.status).toBe("mismatch");

    // Report only: nothing was changed.
    expect(await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, fake.id))).toEqual(snapshotBefore);
    expect((await ledgerFor(fake.id)).n).toBe(0);
    const [run] = await s.db.execute<{ status: string; mismatch_count: number }>(sql`select status, mismatch_count from reconciliation_runs where id = ${rec.runId}`);
    expect(run).toMatchObject({ status: "mismatch" });
  });

  it("last runs are stored", async () => {
    const rows = await s.db.execute<{ n: string }>(sql`select count(*)::text as n from reconciliation_runs`);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(2);
    const latest = await s.db.select().from(ledgerTransactions).orderBy(desc(ledgerTransactions.createdAt)).limit(1);
    expect(latest.length).toBe(1);
  });
});
