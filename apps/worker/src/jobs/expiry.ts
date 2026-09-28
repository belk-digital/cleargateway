import { chainCursors, enqueueIntentEvent, paymentIntents, transitionIntent } from "@belk/db";
import { AppError } from "@belk/shared";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { nowMs, type WorkerCtx } from "../context.js";

export interface ExpiryResult {
  expired: number;
  /** Set when payable intents were NOT expired because the chain watcher looks unhealthy. */
  skippedPayable?: "watcher_stale";
}

const BATCH = 100;

/**
 * Expires unpaid intents past `expires_at`, enqueuing `payment_intent.expired` in the same transaction.
 *
 * Safety: an `awaiting_payment` intent may have a payment mined just before expiry that the watcher has not seen yet.
 * So those are expired only (a) EXPIRY_GRACE_SECONDS after `expires_at` (the signature can no longer be used on-chain
 * by then) and (b) while the watcher heartbeat is fresh. `created` intents never had a signed payload and expire on time.
 * A payment that still lands later is flagged for review by the watcher, never silently dropped.
 *
 * Deposit-address intents are additionally held back while: the deposit watcher has not scanned the address recently
 * (or ever), a deposit is still confirming, or the address is funded / being swept. Expiring then would strand money
 * that is already on its way to the merchant. An underpaid intent with only confirmed partial deposits does expire.
 */
export async function runExpiry(ctx: WorkerCtx): Promise<ExpiryResult> {
  const { db, config } = ctx;
  const now = nowMs(ctx);
  let expired = 0;
  let skippedPayable: ExpiryResult["skippedPayable"];

  const freshCutoffIso = new Date(now - config.WATCHER_STALE_SECONDS * 1000).toISOString();
  const targets: { status: "created" | "awaiting_payment" | "underpaid"; cutoff: Date }[] = [
    { status: "created", cutoff: new Date(now) },
  ];

  const [cursor] = await db
    .select({ updatedAt: chainCursors.updatedAt })
    .from(chainCursors)
    .where(and(eq(chainCursors.chainId, config.CHAIN_ID), eq(chainCursors.contractAddress, config.SPLITTER_ADDRESS.toLowerCase())))
    .limit(1);
  const watcherFresh = !!cursor && now - cursor.updatedAt.getTime() <= config.WATCHER_STALE_SECONDS * 1000;
  if (watcherFresh) {
    const payableCutoff = new Date(now - config.EXPIRY_GRACE_SECONDS * 1000);
    targets.push({ status: "awaiting_payment", cutoff: payableCutoff }, { status: "underpaid", cutoff: payableCutoff });
  } else {
    skippedPayable = "watcher_stale";
    ctx.log.warn({}, "watcher heartbeat stale or missing: not expiring payable intents");
  }

  for (const t of targets) {
    const conditions = [inArray(paymentIntents.status, [t.status]), lt(paymentIntents.expiresAt, t.cutoff)];
    if (t.status !== "created") conditions.push(depositHold(freshCutoffIso));
    const rows = await db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(and(...conditions))
      .limit(BATCH);
    for (const { id } of rows) {
      try {
        await db.transaction(async (tx) => {
          const row = await transitionIntent(tx, { intentId: id, to: "expired", actor: "system:expiry", reason: "intent_expired" });
          await enqueueIntentEvent(tx, row, "payment_intent.expired");
        });
        expired++;
      } catch (err) {
        // Lost a race (paid / canceled meanwhile): that is fine, the other path won.
        if (err instanceof AppError && err.code === "invalid_state_transition") continue;
        ctx.log.error({ err, intentId: id }, "expiry failed");
      }
    }
  }
  return { expired, ...(skippedPayable ? { skippedPayable } : {}) };
}

/** SQL condition: this intent has no deposit-address reason to postpone expiry. */
function depositHold(freshCutoffIso: string) {
  return sql`not exists (
    select 1 from deposit_addresses da
    where da.intent_id = ${paymentIntents.id}
      and (
        da.status in ('funded', 'sweeping')
        or da.last_scanned_at is null
        or da.last_scanned_at < ${freshCutoffIso}::timestamptz
        or exists (select 1 from deposit_transfers dt where dt.intent_id = da.intent_id and dt.status = 'detected')
      )
  )`;
}
