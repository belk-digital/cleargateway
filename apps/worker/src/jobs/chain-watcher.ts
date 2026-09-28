import { paymentSettledEvent } from "@belk/chain";
import {
  chainCursors,
  chainTransactions,
  newId,
  paymentIntents,
  recordIntentEvent,
  transitionIntent,
  type DbTx,
  type IntentRow,
} from "@belk/db";
import { and, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { nowMs, type WorkerCtx } from "../context.js";
import { flagForReview as flagIntent } from "./review.js";

/** A decoded `PaymentSettled` log (strict mode guarantees these fields are present). */
export interface SettledLog {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  args: { intentId: Hex; payer: Address; merchant: Address; amount: bigint; fee: bigint };
}

export type LogOutcome =
  | "detected" // awaiting_payment/created/underpaid -> confirming
  | "duplicate" // already recorded in the same block
  | "block_changed" // same tx+log re-mined in another block (reorg)
  | "unknown_intent"
  | "late_payment" // intent already expired/canceled/failed: flagged for review, never dropped
  | "event_mismatch" // amounts differ from the intent: flagged for review
  | "duplicate_payment"; // a second, different tx for an already-paid intent: flagged for review

export interface WatcherResult {
  scannedFrom: bigint | null;
  scannedTo: bigint | null;
  logs: number;
  outcomes: Partial<Record<LogOutcome, number>>;
  rewound: boolean;
  /** Set when another worker holds the cursor lock. */
  skipped?: "locked";
}

const MAX_RANGES_PER_RUN = 25;

/**
 * Polls the chain for `PaymentSettled` events from the splitter and moves matching intents to `confirming`.
 * The chain is the source of truth: nothing else (frontend, on-ramp or provider webhooks) can mark a payment paid.
 *
 * Safe to run concurrently and to retry: the cursor row is locked (`FOR UPDATE SKIP LOCKED`), the whole range plus
 * the cursor advance commit atomically, and events are deduplicated on (chain, tx hash, log index).
 */
export async function runChainWatcher(ctx: WorkerCtx): Promise<WatcherResult> {
  const total: WatcherResult = { scannedFrom: null, scannedTo: null, logs: 0, outcomes: {}, rewound: false };
  for (let i = 0; i < MAX_RANGES_PER_RUN; i++) {
    const r = await scanOnce(ctx);
    if (r.skipped) return { ...total, skipped: r.skipped };
    total.scannedFrom ??= r.scannedFrom;
    total.scannedTo = r.scannedTo ?? total.scannedTo;
    total.logs += r.logs;
    total.rewound ||= r.rewound;
    for (const [k, v] of Object.entries(r.outcomes)) {
      const key = k as LogOutcome;
      total.outcomes[key] = (total.outcomes[key] ?? 0) + (v ?? 0);
    }
    if (r.caughtUp) break;
  }
  return total;
}

interface ScanResult extends WatcherResult {
  caughtUp: boolean;
}

async function scanOnce(ctx: WorkerCtx): Promise<ScanResult> {
  const { db, chain, config, log } = ctx;
  const contract = config.SPLITTER_ADDRESS.toLowerCase();
  const head = await chain.getBlockNumber();
  const empty: ScanResult = { scannedFrom: null, scannedTo: null, logs: 0, outcomes: {}, rewound: false, caughtUp: true };

  return db.transaction(async (tx) => {
    // Fresh database: start at the configured deployment block, or at the current head.
    const initialLast = config.WATCHER_START_BLOCK !== undefined ? config.WATCHER_START_BLOCK - 1n : head;
    await tx
      .insert(chainCursors)
      .values({ chainId: config.CHAIN_ID, contractAddress: contract, lastProcessedBlock: initialLast < 0n ? 0n : initialLast })
      .onConflictDoNothing();
    const [cursor] = await tx
      .select()
      .from(chainCursors)
      .where(and(eq(chainCursors.chainId, config.CHAIN_ID), eq(chainCursors.contractAddress, contract)))
      .for("update", { skipLocked: true });
    if (!cursor) return { ...empty, skipped: "locked" as const };

    let last = cursor.lastProcessedBlock;
    let rewound = false;

    // Reorg guard: the block we last scanned must still have the hash we recorded.
    if (cursor.lastBlockHash) {
      const known = await chain.getBlock({ blockNumber: last }).catch(() => null);
      if (!known || known.hash !== cursor.lastBlockHash) {
        const target = last - BigInt(config.REORG_REWIND_BLOCKS);
        const floor = config.WATCHER_START_BLOCK !== undefined ? config.WATCHER_START_BLOCK - 1n : 0n;
        last = [target, head].reduce((a, b) => (a < b ? a : b));
        if (last < floor) last = floor;
        rewound = true;
        log.warn({ rewoundTo: last.toString(), head: head.toString() }, "chain reorg detected: rewinding watcher cursor");
      }
    }

    const from = last + 1n;
    if (from > head) {
      await tx
        .update(chainCursors)
        .set({ lastProcessedBlock: last, lastBlockHash: rewound ? null : cursor.lastBlockHash, updatedAt: new Date(nowMs(ctx)) })
        .where(and(eq(chainCursors.chainId, config.CHAIN_ID), eq(chainCursors.contractAddress, contract)));
      return { ...empty, rewound };
    }
    const to = from + BigInt(config.WATCHER_MAX_RANGE) - 1n < head ? from + BigInt(config.WATCHER_MAX_RANGE) - 1n : head;

    const logs = (await chain.getLogs({
      address: config.SPLITTER_ADDRESS,
      event: paymentSettledEvent,
      fromBlock: from,
      toBlock: to,
      strict: true,
    })) as unknown as SettledLog[]; // viem's inferred type for a dynamically looked-up ABI item is too loose to use
    logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

    const outcomes: Partial<Record<LogOutcome, number>> = {};
    for (const l of logs) {
      const outcome = await processSettledLog(tx, ctx, l, head);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }

    const toBlock = await chain.getBlock({ blockNumber: to });
    await tx
      .update(chainCursors)
      .set({ lastProcessedBlock: to, lastBlockHash: toBlock.hash, updatedAt: new Date(nowMs(ctx)) })
      .where(and(eq(chainCursors.chainId, config.CHAIN_ID), eq(chainCursors.contractAddress, contract)));

    if (logs.length > 0) {
      log.info({ from: from.toString(), to: to.toString(), logs: logs.length, outcomes }, "watcher processed range");
    }
    return { scannedFrom: from, scannedTo: to, logs: logs.length, outcomes, rewound, caughtUp: to >= head };
  });
}

const confirmationsFor = (head: bigint, block: bigint): number => (head >= block ? Number(head - block + 1n) : 0);

/** Processes one event inside the range transaction. Exported for tests. */
export async function processSettledLog(tx: DbTx, ctx: WorkerCtx, l: SettledLog, head: bigint): Promise<LogOutcome> {
  const { config, log } = ctx;
  const txHash = l.transactionHash.toLowerCase();
  const blockHash = l.blockHash.toLowerCase();

  const [existing] = await tx
    .select()
    .from(chainTransactions)
    .where(and(eq(chainTransactions.chainId, config.CHAIN_ID), eq(chainTransactions.txHash, txHash), eq(chainTransactions.logIndex, l.logIndex)))
    .limit(1);

  if (existing) {
    if (existing.blockHash === blockHash) return "duplicate";
    return handleBlockChanged(tx, ctx, existing.id, existing.intentId, l, head);
  }

  const rawEvent = {
    address: config.SPLITTER_ADDRESS,
    intentId: l.args.intentId,
    payer: l.args.payer,
    merchant: l.args.merchant,
    amount: l.args.amount.toString(),
    fee: l.args.fee.toString(),
    blockNumber: l.blockNumber.toString(),
    logIndex: l.logIndex,
  };
  const rowId = newId("ctx");
  await tx.insert(chainTransactions).values({
    id: rowId,
    chainId: config.CHAIN_ID,
    txHash,
    logIndex: l.logIndex,
    blockNumber: l.blockNumber,
    blockHash,
    eventName: "PaymentSettled",
    rawEvent,
  });

  const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.intentHash, l.args.intentId.toLowerCase())).limit(1);
  const finish = async (outcome: LogOutcome, intentId: string | null): Promise<LogOutcome> => {
    await tx
      .update(chainTransactions)
      .set({ intentId, processedAt: new Date(nowMs(ctx)) })
      .where(eq(chainTransactions.id, rowId));
    return outcome;
  };

  if (!intent) {
    log.warn({ txHash, intentHash: l.args.intentId }, "PaymentSettled for an unknown intent (reconciliation will report it)");
    return finish("unknown_intent", null);
  }

  const chainPatch = { txHash, blockNumber: l.blockNumber, blockHash, payerAddress: l.args.payer };

  // The contract enforces the signed terms, so a mismatch means a bug or a foreign signer. Never proceed silently.
  if (l.args.amount !== intent.amount || l.args.fee !== intent.feeAmount) {
    await flagForReview(tx, intent, "event_mismatch", { ...chainPatch }, {
      txHash,
      event_amount: l.args.amount.toString(),
      event_fee: l.args.fee.toString(),
      intent_amount: intent.amount.toString(),
      intent_fee: intent.feeAmount.toString(),
    });
    return finish("event_mismatch", intent.id);
  }

  switch (intent.status) {
    case "created":
    case "awaiting_payment":
    case "underpaid": {
      if (intent.status === "created") {
        await transitionIntent(tx, { intentId: intent.id, to: "awaiting_payment", actor: "system:watcher", reason: "payment_detected_without_checkout" });
      }
      await transitionIntent(tx, {
        intentId: intent.id,
        to: "confirming",
        actor: "system:watcher",
        reason: "payment_detected",
        data: { txHash, logIndex: l.logIndex, blockNumber: l.blockNumber.toString() },
        patch: { ...chainPatch, paymentMethod: intent.paymentMethod ?? "wallet", confirmations: confirmationsFor(head, l.blockNumber) },
      });
      return finish("detected", intent.id);
    }
    case "expired":
    case "canceled":
    case "failed": {
      // Money already moved on-chain to the merchant: record it and hand it to a human. Never drop it.
      await flagForReview(tx, intent, `late_payment_${intent.status}`, chainPatch, { txHash });
      return finish("late_payment", intent.id);
    }
    default: {
      // confirming / succeeded / refunded / partially_refunded
      if (intent.txHash?.toLowerCase() === txHash) return finish("duplicate", intent.id);
      await flagForReview(tx, intent, "duplicate_payment_event", {}, { txHash, existing_tx_hash: intent.txHash });
      return finish("duplicate_payment", intent.id);
    }
  }
}

/** Marks an intent for manual review (audit event + flag + `requires_review` webhook). Status is untouched. */
async function flagForReview(
  tx: DbTx,
  intent: IntentRow,
  reason: string,
  patch: Parameters<typeof recordIntentEvent>[1]["patch"],
  data: Record<string, unknown>,
): Promise<void> {
  await flagIntent(tx, intent, { actor: "system:watcher", reason, data, patch, discriminator: `${reason}:${String(data.txHash ?? "")}` });
}

/** The same tx/log now appears in a different block: the chain reorganized. Keep our records in step. */
async function handleBlockChanged(
  tx: DbTx,
  ctx: WorkerCtx,
  chainTxId: string,
  intentId: string | null,
  l: SettledLog,
  head: bigint,
): Promise<LogOutcome> {
  const blockHash = l.blockHash.toLowerCase();
  await tx
    .update(chainTransactions)
    .set({ blockNumber: l.blockNumber, blockHash, processedAt: new Date(nowMs(ctx)) })
    .where(eq(chainTransactions.id, chainTxId));
  if (!intentId) return "block_changed";

  const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
  if (!intent) return "block_changed";
  const data = { txHash: l.transactionHash.toLowerCase(), old_block_hash: intent.blockHash, new_block_hash: blockHash };

  if (intent.status === "confirming") {
    await recordIntentEvent(tx, {
      intentId,
      actor: "system:watcher",
      reason: "reorg_block_changed",
      data,
      patch: { blockNumber: l.blockNumber, blockHash, confirmations: confirmationsFor(head, l.blockNumber) },
    });
  } else {
    // Already final (or terminal) yet the block changed: this needs a human.
    await flagForReview(tx, intent, "block_changed_after_finality", { blockNumber: l.blockNumber, blockHash }, data);
  }
  ctx.log.warn({ intentId, ...data }, "payment re-mined in a different block");
  return "block_changed";
}
