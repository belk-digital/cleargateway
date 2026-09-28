import { clearGatewaySplitterAbi } from "@belk/chain";
import {
  enqueueIntentEvent,
  paymentEvents,
  paymentIntents,
  postPaymentSettled,
  recordIntentEvent,
  touchConfirmations,
  transitionIntent,
  type DbTx,
  type IntentRow,
} from "@belk/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { parseEventLogs, type Hex, type TransactionReceipt } from "viem";
import { isReceiptNotFound, nowMs, type WorkerCtx } from "../context.js";

export type ConfirmOutcome =
  | "succeeded"
  | "waiting" // fewer than N confirmations
  | "block_changed" // reorg moved the payment; counting restarts
  | "receipt_missing" // tx not on the canonical chain (yet); grace period running
  | "failed" // reverted or reorged out beyond the grace period
  | "flagged" // final re-check disagreed with our records: needs a human
  | "skipped"; // not confirming anymore, or locked by another worker

export interface ConfirmationsResult {
  head: bigint;
  outcomes: Partial<Record<ConfirmOutcome, number>>;
}

const BATCH = 100;
const confirmationsFor = (head: bigint, block: bigint): number => (head >= block ? Number(head - block + 1n) : 0);

/**
 * Moves `confirming` intents to `succeeded` once the payment has N confirmations AND a final re-check of the
 * block hash and the on-chain event still agrees. On success, in ONE database transaction: status change +
 * audit event + balanced ledger entries + webhook enqueue. Idempotent and safe to run concurrently.
 */
export async function runConfirmations(ctx: WorkerCtx): Promise<ConfirmationsResult> {
  const head = await ctx.chain.getBlockNumber();
  const rows = await ctx.db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(eq(paymentIntents.status, "confirming"))
    .orderBy(asc(paymentIntents.updatedAt))
    .limit(BATCH);

  const outcomes: ConfirmationsResult["outcomes"] = {};
  for (const { id } of rows) {
    let outcome: ConfirmOutcome;
    try {
      outcome = await confirmOne(ctx, id, head);
    } catch (err) {
      // One bad intent (e.g. an RPC hiccup) must not block the rest of the batch; it is retried next tick.
      ctx.log.error({ err, intentId: id }, "confirmation check failed");
      continue;
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { head, outcomes };
}

async function getReceipt(ctx: WorkerCtx, hash: Hex): Promise<TransactionReceipt | null> {
  try {
    return await ctx.chain.getTransactionReceipt({ hash });
  } catch (err) {
    // ONLY "not found" means the tx is missing. Any other error (network, rate limit) must not be read as a reorg.
    if (isReceiptNotFound(err)) return null;
    throw err;
  }
}

async function confirmOne(ctx: WorkerCtx, intentId: string, head: bigint): Promise<ConfirmOutcome> {
  const { db, chain, config } = ctx;
  return db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.status, "confirming")))
      .for("update", { skipLocked: true });
    if (!intent?.txHash) return "skipped";

    const receipt = await getReceipt(ctx, intent.txHash as Hex);
    if (!receipt) return handleMissingReceipt(tx, ctx, intent);

    // Receipt is back after a gap: close the gap so a later reorg starts a fresh grace period.
    const marker = await lastReceiptMarker(tx, intent.id);
    if (marker?.reason === "receipt_missing") {
      await recordIntentEvent(tx, { intentId: intent.id, actor: "system:confirmations", reason: "receipt_restored" });
    }

    if (receipt.status !== "success") {
      const failed = await transitionIntent(tx, {
        intentId: intent.id,
        to: "failed",
        actor: "system:confirmations",
        reason: "tx_reverted",
        data: { txHash: intent.txHash },
      });
      await enqueueIntentEvent(tx, failed, "payment_intent.failed");
      return "failed";
    }

    const conf = confirmationsFor(head, receipt.blockNumber);

    if (receipt.blockHash.toLowerCase() !== intent.blockHash?.toLowerCase()) {
      await recordIntentEvent(tx, {
        intentId: intent.id,
        actor: "system:confirmations",
        reason: "reorg_block_changed",
        data: { old_block_hash: intent.blockHash, new_block_hash: receipt.blockHash },
        patch: { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash.toLowerCase(), confirmations: conf },
      });
      return "block_changed";
    }

    if (conf < config.CONFIRMATIONS) {
      if (conf !== intent.confirmations) await touchConfirmations(tx, intent.id, conf);
      return "waiting";
    }

    // ---- Final re-check before money is marked settled ----
    // 1) The block that holds the payment must still be canonical at the height we recorded.
    const canonical = await chain.getBlock({ blockNumber: receipt.blockNumber });
    if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      await recordIntentEvent(tx, {
        intentId: intent.id,
        actor: "system:confirmations",
        reason: "final_check_block_mismatch",
        data: { receipt_block_hash: receipt.blockHash, canonical_block_hash: canonical.hash },
      });
      return "block_changed";
    }
    // 2) The receipt must still contain exactly the event we were told about (right contract, intent, amounts).
    const events = parseEventLogs({ abi: clearGatewaySplitterAbi, eventName: "PaymentSettled", logs: receipt.logs });
    const match = events.find(
      (e) =>
        e.address.toLowerCase() === config.SPLITTER_ADDRESS.toLowerCase() &&
        e.args.intentId.toLowerCase() === intent.intentHash.toLowerCase() &&
        e.args.amount === intent.amount &&
        e.args.fee === intent.feeAmount,
    );
    if (!match) {
      const flagged = await recordIntentEvent(tx, {
        intentId: intent.id,
        actor: "system:confirmations",
        reason: "final_check_event_mismatch",
        data: { txHash: intent.txHash },
        patch: { needsReview: true, reviewReason: "final_check_event_mismatch" },
      });
      await enqueueIntentEvent(tx, flagged, "payment_intent.requires_review", "final_check_event_mismatch");
      return "flagged";
    }

    const done = await transitionIntent(tx, {
      intentId: intent.id,
      to: "succeeded",
      actor: "system:confirmations",
      reason: "confirmed_on_chain",
      data: { txHash: intent.txHash, confirmations: conf, blockHash: receipt.blockHash },
      patch: { succeededAt: new Date(nowMs(ctx)), confirmations: conf },
    });
    await postPaymentSettled(tx, done);
    await enqueueIntentEvent(tx, done, "payment_intent.succeeded");
    ctx.log.info({ intentId: intent.id, txHash: intent.txHash, confirmations: conf }, "payment succeeded");
    return "succeeded";
  });
}

async function lastReceiptMarker(tx: DbTx, intentId: string) {
  const [row] = await tx
    .select()
    .from(paymentEvents)
    .where(and(eq(paymentEvents.intentId, intentId), inArray(paymentEvents.reason, ["receipt_missing", "receipt_restored"])))
    .orderBy(desc(paymentEvents.createdAt))
    .limit(1);
  return row;
}

/**
 * The payment tx is not on the canonical chain (reorged out, or the RPC node is behind). Wait a grace period for it
 * to be re-mined (the watcher will refresh the block details), then fail the intent so it is never left dangling.
 */
async function handleMissingReceipt(tx: DbTx, ctx: WorkerCtx, intent: IntentRow): Promise<ConfirmOutcome> {
  const marker = await lastReceiptMarker(tx, intent.id);
  if (marker?.reason !== "receipt_missing") {
    await recordIntentEvent(tx, {
      intentId: intent.id,
      actor: "system:confirmations",
      reason: "receipt_missing",
      data: { txHash: intent.txHash },
      patch: { confirmations: 0 },
    });
    ctx.log.warn({ intentId: intent.id, txHash: intent.txHash }, "payment receipt missing: possible reorg");
    return "receipt_missing";
  }
  if (nowMs(ctx) - marker.createdAt.getTime() < ctx.config.REORG_GRACE_SECONDS * 1000) return "receipt_missing";

  const failed = await transitionIntent(tx, {
    intentId: intent.id,
    to: "failed",
    actor: "system:confirmations",
    reason: "tx_reorged_out",
    data: { txHash: intent.txHash },
  });
  await enqueueIntentEvent(tx, failed, "payment_intent.failed");
  return "failed";
}
