import { paymentSettledEvent } from "@belk/chain";
import {
  chainTransactions,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  newId,
  paymentIntents,
  reconciliationRuns,
} from "@belk/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { nowMs, type WorkerCtx } from "../context.js";
import type { SettledLog } from "./chain-watcher.js";

export type MismatchType =
  | "event_not_recorded" // on-chain event the watcher never stored
  | "event_unknown_intent" // on-chain event whose intent id we don't have
  | "event_amount_mismatch"
  | "event_intent_not_succeeded" // paid on-chain but the intent is not succeeded (late payment, stuck, flagged...)
  | "event_tx_mismatch" // intent succeeded with a different tx than the event
  | "succeeded_without_event" // intent marked paid but no matching on-chain event
  | "ledger_missing"
  | "ledger_amount_mismatch"
  | "ledger_orphan" // ledger booking for an intent that is not succeeded
  | "ledger_unbalanced"
  | "stuck_confirming";

export interface Mismatch {
  type: MismatchType;
  intentId?: string;
  txHash?: string;
  detail: Record<string, unknown>;
}

export interface ReconciliationReport {
  chain: { head: string; from: string; to: string; events: number; finalEvents: number };
  intentsChecked: number;
  ledgerTransactionsChecked: number;
  mismatches: Mismatch[];
  /** Informational, not counted as mismatches. */
  info: { intentsNeedingReview: number };
}

const PAID = ["succeeded", "refunded", "partially_refunded"] as const;
const STUCK_CONFIRMING_MS = 60 * 60 * 1000;

/**
 * Compares three sources of truth: contract events, the payment_intents table and the ledger.
 * It ONLY REPORTS. It never edits payments, ledger entries or chain records: money discrepancies need a human.
 * The report is stored in `reconciliation_runs`.
 */
export async function runReconciliation(
  ctx: WorkerCtx,
  opts: { trigger?: "schedule" | "manual" } = {},
): Promise<{ runId: string; status: "ok" | "mismatch"; report: ReconciliationReport }> {
  const { db, chain, config } = ctx;
  const startedAt = new Date(nowMs(ctx));
  const mismatches: Mismatch[] = [];

  const head = await chain.getBlockNumber();
  const lookbackFloor = head > BigInt(config.RECONCILE_MAX_LOOKBACK_BLOCKS) ? head - BigInt(config.RECONCILE_MAX_LOOKBACK_BLOCKS) : 0n;
  const from = config.WATCHER_START_BLOCK ?? lookbackFloor;

  // ---- 1. Contract events (source of truth) ----
  const events: SettledLog[] = [];
  for (let start = from; start <= head; start += BigInt(config.WATCHER_MAX_RANGE)) {
    const end = start + BigInt(config.WATCHER_MAX_RANGE) - 1n < head ? start + BigInt(config.WATCHER_MAX_RANGE) - 1n : head;
    const logs = (await chain.getLogs({
      address: config.SPLITTER_ADDRESS,
      event: paymentSettledEvent,
      fromBlock: start,
      toBlock: end,
      strict: true,
    })) as unknown as SettledLog[]; // see chain-watcher: viem's inferred type is too loose here
    events.push(...logs);
  }
  // Only events with enough confirmations are expected to be fully reflected in our records.
  const finalEvents = events.filter((e) => head - e.blockNumber + 1n >= BigInt(config.CONFIRMATIONS));

  const recorded = await db.select().from(chainTransactions).where(eq(chainTransactions.chainId, config.CHAIN_ID));
  const recordedKeys = new Set(recorded.map((r) => `${r.txHash}:${r.logIndex}`));

  const allIntents = await db.select().from(paymentIntents);
  const byHash = new Map(allIntents.map((i) => [i.intentHash.toLowerCase(), i]));
  const byId = new Map(allIntents.map((i) => [i.id, i]));
  const eventTxHashes = new Set(events.map((e) => e.transactionHash.toLowerCase()));

  for (const e of finalEvents) {
    const txHash = e.transactionHash.toLowerCase();
    if (!recordedKeys.has(`${txHash}:${e.logIndex}`)) mismatches.push({ type: "event_not_recorded", txHash, detail: { block: e.blockNumber.toString() } });

    const intent = byHash.get(e.args.intentId.toLowerCase());
    if (!intent) {
      mismatches.push({ type: "event_unknown_intent", txHash, detail: { intentHash: e.args.intentId, amount: e.args.amount.toString() } });
      continue;
    }
    if (e.args.amount !== intent.amount || e.args.fee !== intent.feeAmount) {
      mismatches.push({
        type: "event_amount_mismatch",
        intentId: intent.id,
        txHash,
        detail: { event_amount: e.args.amount.toString(), event_fee: e.args.fee.toString(), intent_amount: intent.amount.toString(), intent_fee: intent.feeAmount.toString() },
      });
    }
    if (!(PAID as readonly string[]).includes(intent.status)) {
      mismatches.push({ type: "event_intent_not_succeeded", intentId: intent.id, txHash, detail: { status: intent.status, needs_review: intent.needsReview, review_reason: intent.reviewReason } });
    } else if (intent.txHash?.toLowerCase() !== txHash) {
      mismatches.push({ type: "event_tx_mismatch", intentId: intent.id, txHash, detail: { intent_tx_hash: intent.txHash } });
    }
  }

  // ---- 2. Intents marked paid must be backed by an on-chain event ----
  const paidIntents = allIntents.filter((i) => (PAID as readonly string[]).includes(i.status));
  for (const i of paidIntents) {
    const inWindow = i.blockNumber !== null && i.blockNumber >= from;
    if (inWindow && !(i.txHash && eventTxHashes.has(i.txHash.toLowerCase()))) {
      mismatches.push({ type: "succeeded_without_event", intentId: i.id, txHash: i.txHash ?? undefined, detail: { status: i.status } });
    }
  }

  // ---- 3. Ledger vs intents ----
  const ledgerRows = await db
    .select({
      txId: ledgerTransactions.id,
      intentId: ledgerTransactions.intentId,
      accountType: ledgerAccounts.type,
      accountMerchantId: ledgerAccounts.merchantId,
      direction: ledgerEntries.direction,
      amount: ledgerEntries.amount,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerTransactions.kind, "payment_settled"));

  const ledgerByIntent = new Map<string, typeof ledgerRows>();
  for (const r of ledgerRows) {
    if (!r.intentId) continue;
    ledgerByIntent.set(r.intentId, [...(ledgerByIntent.get(r.intentId) ?? []), r]);
  }
  const sumOf = (rows: typeof ledgerRows, type: string, dir: string) =>
    rows.filter((r) => r.accountType === type && r.direction === dir).reduce((a, r) => a + r.amount, 0n);

  for (const i of paidIntents) {
    const rows = ledgerByIntent.get(i.id);
    if (!rows) {
      mismatches.push({ type: "ledger_missing", intentId: i.id, detail: { status: i.status } });
      continue;
    }
    const got = {
      clearing_debit: sumOf(rows, "customer_payments_clearing", "debit"),
      merchant_credit: sumOf(rows, "merchant_receivable", "credit"),
      fee_credit: sumOf(rows, "platform_fee_revenue", "credit"),
    };
    const want = { clearing_debit: i.amount, merchant_credit: i.merchantAmount, fee_credit: i.feeAmount };
    const wrongMerchant = rows.some((r) => r.accountType === "merchant_receivable" && r.accountMerchantId !== i.merchantId);
    if (got.clearing_debit !== want.clearing_debit || got.merchant_credit !== want.merchant_credit || got.fee_credit !== want.fee_credit || wrongMerchant) {
      mismatches.push({
        type: "ledger_amount_mismatch",
        intentId: i.id,
        detail: {
          got: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.toString()])),
          want: Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v.toString()])),
          wrong_merchant_account: wrongMerchant,
        },
      });
    }
  }
  for (const [intentId] of ledgerByIntent) {
    const i = byId.get(intentId);
    if (!i || !(PAID as readonly string[]).includes(i.status)) {
      mismatches.push({ type: "ledger_orphan", intentId, detail: { status: i?.status ?? "unknown_intent" } });
    }
  }
  const balances = await db.execute<{ mode: string; currency: string; debits: string; credits: string }>(sql`
    select a.mode, a.currency,
      coalesce(sum(e.amount) filter (where e.direction = 'debit'), 0)::text as debits,
      coalesce(sum(e.amount) filter (where e.direction = 'credit'), 0)::text as credits
    from ledger_entries e join ledger_accounts a on a.id = e.account_id
    group by a.mode, a.currency`);
  const perMode = new Map<string, { d: bigint; c: bigint }>();
  for (const b of balances) {
    const cur = perMode.get(b.mode) ?? { d: 0n, c: 0n };
    perMode.set(b.mode, { d: cur.d + BigInt(b.debits), c: cur.c + BigInt(b.credits) });
  }
  for (const [mode, v] of perMode) {
    if (v.d !== v.c) mismatches.push({ type: "ledger_unbalanced", detail: { mode, debits: v.d.toString(), credits: v.c.toString() } });
  }

  // ---- 4. Operational: payments stuck confirming ----
  const stuck = await db
    .select({ id: paymentIntents.id, txHash: paymentIntents.txHash, updatedAt: paymentIntents.updatedAt })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.status, "confirming"), lt(paymentIntents.updatedAt, new Date(nowMs(ctx) - STUCK_CONFIRMING_MS))));
  for (const s of stuck) {
    mismatches.push({ type: "stuck_confirming", intentId: s.id, txHash: s.txHash ?? undefined, detail: { since: s.updatedAt.toISOString() } });
  }
  const review = await db.select({ id: paymentIntents.id }).from(paymentIntents).where(eq(paymentIntents.needsReview, true));

  const report: ReconciliationReport = {
    chain: { head: head.toString(), from: from.toString(), to: head.toString(), events: events.length, finalEvents: finalEvents.length },
    intentsChecked: allIntents.length,
    ledgerTransactionsChecked: new Set(ledgerRows.map((r) => r.txId)).size,
    mismatches,
    info: { intentsNeedingReview: review.length },
  };
  const status = mismatches.length === 0 ? "ok" : "mismatch";
  const runId = newId("orr");
  await db.insert(reconciliationRuns).values({
    id: runId,
    trigger: opts.trigger ?? "schedule",
    status,
    mismatchCount: mismatches.length,
    report: report as unknown as Record<string, unknown>,
    startedAt,
    finishedAt: new Date(nowMs(ctx)),
  });
  if (status === "mismatch") ctx.log.error({ runId, mismatchCount: mismatches.length, types: [...new Set(mismatches.map((m) => m.type))] }, "RECONCILIATION MISMATCH: manual review required");
  else ctx.log.info({ runId, intentsChecked: report.intentsChecked }, "reconciliation ok");
  return { runId, status, report };
}
