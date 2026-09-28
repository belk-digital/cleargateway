import { erc20TransferEvent } from "@belk/chain";
import {
  depositAddresses,
  depositTransfers,
  enqueueIntentEvent,
  newId,
  paymentIntents,
  recordIntentEvent,
  transitionIntent,
  type DbTx,
  type IntentRow,
} from "@belk/db";
import { and, eq, gte, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { nowMs, type WorkerCtx } from "../context.js";
import { flagForReview } from "./review.js";

/** A decoded USDC `Transfer` log (strict mode guarantees the fields are present). */
export interface TransferLog {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  args: { from: Address; to: Address; value: bigint };
}

export interface DepositWatcherResult {
  skipped?: "not_configured" | "locked";
  addresses: number;
  newTransfers: number;
  reorged: number;
  funded: number;
  underpaid: number;
  flagged: number;
}

const ADDRESS_CHUNK = 100;
const TERMINAL = new Set(["expired", "canceled", "failed"]);
const ACTOR = "system:deposits";
const empty = (): DepositWatcherResult => ({ addresses: 0, newTransfers: 0, reorged: 0, funded: 0, underpaid: 0, flagged: 0 });

/**
 * Detects USDC deposits into per-payment deposit addresses and tracks them until they are safe to sweep.
 *
 * How: every tick, ONE filtered `Transfer(to in [open addresses])` query over a small overlapping window (never
 * "all USDC transfers" and never balance polling). Because the window always overlaps the previous scan by
 * REORG_REWIND_BLOCKS, a deposit that vanished from the canonical chain is noticed as "stored but no longer found"
 * and marked reorged, and one that is re-mined in another block is updated in place. Rows are keyed by
 * (chain, tx hash, log index), so re-scanning is idempotent.
 *
 * What it does NOT do: it never marks a payment succeeded. It records deposits, moves the intent to `underpaid` when a
 * confirmed partial deposit exists, marks the address `funded` when confirmed deposits cover the amount (the sweeper
 * acts on that), and flags late / excess deposits for manual review. Only the chain watcher + confirmation worker can
 * finalize a payment, from the splitter's `PaymentSettled` event.
 *
 * Single-flight per database via a transaction-scoped advisory lock.
 */
export async function runDepositWatcher(ctx: WorkerCtx): Promise<DepositWatcherResult> {
  const { db, chain, config } = ctx;
  if (!config.DEPOSIT_FACTORY_ADDRESS || !config.USDC_ADDRESS) return { ...empty(), skipped: "not_configured" };
  const usdc = config.USDC_ADDRESS;
  const factory = config.DEPOSIT_FACTORY_ADDRESS;
  const head = await chain.getBlockNumber();
  const lookbackCutoff = new Date(nowMs(ctx) - config.DEPOSIT_LATE_LOOKBACK_DAYS * 86_400_000);

  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('belk:deposit-watcher')) as locked`);
    if (!lock[0]?.locked) return { ...empty(), skipped: "locked" as const };

    const open = await tx
      .select({ dep: depositAddresses, intentId: paymentIntents.id })
      .from(depositAddresses)
      .innerJoin(paymentIntents, eq(paymentIntents.id, depositAddresses.intentId))
      .where(
        and(
          eq(depositAddresses.chainId, config.CHAIN_ID),
          // Scoped to the currently configured factory (see the sweeper for why this matters if it is ever rotated).
          eq(depositAddresses.factoryAddress, factory.toLowerCase()),
          ne(depositAddresses.status, "abandoned"),
          gte(depositAddresses.createdAt, lookbackCutoff),
        ),
      );
    const result = empty();
    result.addresses = open.length;
    if (open.length === 0) return result;

    // Per-address scan start: overlap the previous scan so reorgs are caught; never before the address existed.
    const rewind = BigInt(config.REORG_REWIND_BLOCKS);
    const scanFrom = new Map<string, bigint>();
    for (const { dep } of open) {
      const through = dep.scannedThroughBlock < head ? dep.scannedThroughBlock : head; // chain may have got shorter
      const from = through - rewind + 1n;
      scanFrom.set(dep.id, from > dep.creationBlock ? from : dep.creationBlock);
    }
    const globalFrom = [...scanFrom.values()].reduce((a, b) => (a < b ? a : b));

    // One filtered query per (address chunk, block range).
    const byAddress = new Map<string, TransferLog[]>();
    const addresses = open.map((o) => o.dep.address as Address);
    for (let i = 0; i < addresses.length; i += ADDRESS_CHUNK) {
      const chunk = addresses.slice(i, i + ADDRESS_CHUNK);
      for (let start = globalFrom; start <= head; start += BigInt(config.WATCHER_MAX_RANGE)) {
        const end = start + BigInt(config.WATCHER_MAX_RANGE) - 1n < head ? start + BigInt(config.WATCHER_MAX_RANGE) - 1n : head;
        const logs = (await chain.getLogs({
          address: usdc,
          event: erc20TransferEvent,
          args: { to: chunk },
          fromBlock: start,
          toBlock: end,
          strict: true,
        })) as unknown as TransferLog[]; // viem's inferred log type for a parsed ABI item is broader than what strict mode returns
        for (const l of logs) {
          const key = l.args.to.toLowerCase();
          byAddress.set(key, [...(byAddress.get(key) ?? []), l]);
        }
      }
    }

    for (const { dep, intentId } of open) {
      await processAddress(tx, ctx, {
        depId: dep.id,
        intentId,
        address: dep.address,
        from: scanFrom.get(dep.id) as bigint,
        logs: byAddress.get(dep.address.toLowerCase()) ?? [],
        head,
        result,
      });
    }
    return result;
  });
}

interface AddressJob {
  depId: string;
  intentId: string;
  address: string;
  from: bigint;
  logs: TransferLog[];
  head: bigint;
  result: DepositWatcherResult;
}

const confirmationsFor = (head: bigint, block: bigint): number => (head >= block ? Number(head - block + 1n) : 0);

async function processAddress(tx: DbTx, ctx: WorkerCtx, job: AddressJob): Promise<void> {
  const { depId, intentId, head, result } = job;
  const N = ctx.config.CONFIRMATIONS;
  const now = new Date(nowMs(ctx));

  // Lock the intent for the whole address update so nothing else changes its state underneath us.
  const [locked] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).for("update");
  if (!locked) return;
  let intent: IntentRow = locked;

  const existing = await tx.select().from(depositTransfers).where(eq(depositTransfers.depositAddressId, depId));
  const byKey = new Map(existing.map((t) => [`${t.txHash}:${t.logIndex}`, t]));
  const seen = new Set<string>();

  // ---- 1. Reflect what the canonical chain says right now ----
  for (const l of job.logs) {
    const txHash = l.transactionHash.toLowerCase();
    const blockHash = l.blockHash.toLowerCase();
    const key = `${txHash}:${l.logIndex}`;
    seen.add(key);
    const row = byKey.get(key);

    if (!row) {
      await tx.insert(depositTransfers).values({
        id: newId("dtr"),
        depositAddressId: depId,
        intentId,
        chainId: ctx.config.CHAIN_ID,
        txHash,
        logIndex: l.logIndex,
        blockNumber: l.blockNumber,
        blockHash,
        fromAddress: l.args.from.toLowerCase(),
        amount: l.args.value,
        status: "detected",
        confirmations: confirmationsFor(head, l.blockNumber),
      });
      result.newTransfers++;
      await recordIntentEvent(tx, {
        intentId,
        actor: ACTOR,
        reason: "deposit_detected",
        data: { txHash, amount: l.args.value.toString(), from: l.args.from.toLowerCase(), blockNumber: l.blockNumber.toString() },
      });
    } else if (row.blockHash !== blockHash || row.status === "reorged") {
      // Re-mined in a different block (or briefly missing and back): the same transfer, new block details.
      await tx
        .update(depositTransfers)
        .set({ blockNumber: l.blockNumber, blockHash, status: "detected", confirmations: confirmationsFor(head, l.blockNumber), updatedAt: now })
        .where(eq(depositTransfers.id, row.id));
      await recordIntentEvent(tx, {
        intentId,
        actor: ACTOR,
        reason: row.status === "reorged" ? "deposit_restored" : "deposit_block_changed",
        data: { txHash, old_block_hash: row.blockHash, new_block_hash: blockHash },
      });
    }
  }

  // ---- 2. Stored deposits inside the scanned window that the chain no longer has: reorged out ----
  for (const row of existing) {
    if (row.status === "reorged") continue;
    if (row.blockNumber >= job.from && !seen.has(`${row.txHash}:${row.logIndex}`)) {
      await tx.update(depositTransfers).set({ status: "reorged", confirmations: 0, updatedAt: now }).where(eq(depositTransfers.id, row.id));
      result.reorged++;
      await recordIntentEvent(tx, {
        intentId,
        actor: ACTOR,
        reason: "deposit_reorged",
        data: { txHash: row.txHash, amount: row.amount.toString() },
      });
    }
  }

  // ---- 3. Recompute confirmations / status for every live deposit ----
  const rows = await tx.select().from(depositTransfers).where(eq(depositTransfers.depositAddressId, depId));
  let detected = 0n;
  let confirmed = 0n;
  for (const t of rows) {
    if (t.status === "reorged") continue;
    const conf = confirmationsFor(head, t.blockNumber);
    const status = conf >= N ? "confirmed" : "detected";
    if (conf !== t.confirmations || status !== t.status) {
      await tx.update(depositTransfers).set({ confirmations: conf, status, updatedAt: now }).where(eq(depositTransfers.id, t.id));
    }
    detected += t.amount;
    if (status === "confirmed") confirmed += t.amount;
  }

  const [dep] = await tx.select().from(depositAddresses).where(eq(depositAddresses.id, depId)).limit(1);
  if (!dep) return;
  await tx
    .update(depositAddresses)
    .set({ detectedAmount: detected, confirmedAmount: confirmed, scannedThroughBlock: head, lastScannedAt: now, updatedAt: now })
    .where(eq(depositAddresses.id, depId));

  // ---- 4. Effect on the payment intent ----
  if (detected > 0n && intent.status === "created") {
    intent = await transitionIntent(tx, {
      intentId,
      to: "awaiting_payment",
      actor: ACTOR,
      reason: "deposit_detected_without_checkout",
      patch: { paymentMethod: "deposit_address", depositAddress: job.address },
    });
  }

  const status = intent.status;
  if (TERMINAL.has(status)) {
    // The payment window is over: any deposit is now a late deposit. Report each transfer once.
    for (const t of rows.filter((r) => r.status !== "reorged" && r.flaggedAt === null)) {
      intent = await flagForReview(tx, intent, {
        actor: ACTOR,
        reason: `late_deposit_${status}`,
        data: { txHash: t.txHash, amount: t.amount.toString(), confirmed_total: confirmed.toString(), intent_amount: intent.amount.toString() },
        discriminator: `late_deposit_${status}:${t.txHash}:${t.logIndex}`,
      });
      await tx.update(depositTransfers).set({ flaggedAt: now }).where(eq(depositTransfers.id, t.id));
      result.flagged++;
    }
    return;
  }

  if (status === "awaiting_payment" || status === "underpaid") {
    if (confirmed > 0n && confirmed < intent.amount) {
      const missing = intent.amount - confirmed;
      if (status === "awaiting_payment") {
        intent = await transitionIntent(tx, {
          intentId,
          to: "underpaid",
          actor: ACTOR,
          reason: "deposit_below_amount",
          data: { confirmed: confirmed.toString(), missing: missing.toString() },
          patch: { underpaidAmount: missing },
        });
        await enqueueIntentEvent(tx, intent, "payment_intent.underpaid");
        result.underpaid++;
      } else if (intent.underpaidAmount !== missing) {
        intent = await recordIntentEvent(tx, {
          intentId,
          actor: ACTOR,
          reason: "deposit_partial_update",
          data: { confirmed: confirmed.toString(), missing: missing.toString() },
          patch: { underpaidAmount: missing },
        });
      }
    } else if (confirmed >= intent.amount && dep.status === "awaiting_deposit") {
      await tx.update(depositAddresses).set({ status: "funded", fundedAt: now, updatedAt: now }).where(eq(depositAddresses.id, depId));
      intent = await recordIntentEvent(tx, {
        intentId,
        actor: ACTOR,
        reason: "deposit_funded",
        data: { confirmed: confirmed.toString(), amount: intent.amount.toString() },
        patch: { underpaidAmount: 0n },
      });
      result.funded++;
    }
  }

  // ---- 5. Excess over the intent amount (open, in-flight or already paid) ----
  // The sweep moves exactly `intent.amount`; anything above stays at the address and needs a human (rescue).
  const excess = detected > intent.amount ? detected - intent.amount : 0n;
  if (excess > intent.overpaidAmount) {
    intent = await flagForReview(tx, intent, {
      actor: ACTOR,
      reason: "deposit_overpaid",
      data: { excess: excess.toString(), detected_total: detected.toString(), intent_amount: intent.amount.toString() },
      patch: { overpaidAmount: excess },
      discriminator: `deposit_overpaid:${excess}`,
    });
    result.flagged++;
  }
  // (If earlier deposits were reorged out and the excess shrank, the number is corrected without a new alert.)
  if (excess < intent.overpaidAmount) {
    await recordIntentEvent(tx, { intentId, actor: ACTOR, reason: "deposit_excess_updated", data: { excess: excess.toString() }, patch: { overpaidAmount: excess } });
  }
}
