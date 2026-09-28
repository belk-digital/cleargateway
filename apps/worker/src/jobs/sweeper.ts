import { depositFactoryAbi, splitterDomain, type PaymentIntentMessage } from "@belk/chain";
import { depositAddresses, merchants, paymentIntents } from "@belk/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { type Address, type Hex } from "viem";
import { isReceiptNotFound, nowMs, type WorkerCtx } from "../context.js";
import { flagForReview } from "./review.js";

export type SweepOutcome =
  | "submitted" // a sweep transaction was sent (first attempt or a stuck-mempool retry)
  | "pending" // a previous sweep transaction is still unconfirmed; not yet due for retry
  | "succeeded" // the swept transaction confirmed on-chain (PaymentSettled still comes from the chain watcher)
  | "reverted" // the swept transaction reverted; will retry after backoff
  | "already_settled" // the intent reached confirming/succeeded via some other path; nothing to sweep
  | "not_eligible" // the intent is terminal (expired/canceled/failed): funds need a manual rescue, not a sweep
  | "abandoned" // attempts exhausted: flagged for review, no further automatic retries
  | "locked"; // another worker holds the row lock

export interface SweeperResult {
  skipped?: "not_configured";
  outcomes: Partial<Record<SweepOutcome, number>>;
}

const BATCH = 50;
const SETTLED = new Set(["confirming", "succeeded", "refunded", "partially_refunded"]);
const TERMINAL = new Set(["expired", "canceled", "failed"]);
const ACTOR = "system:sweeper";

/**
 * Sweeps funded deposit addresses: signs a fresh short-lived payment intent (payer = the deposit address, merchant =
 * the merchant's CURRENT payout wallet) and submits `DepositFactory.sweep` through a gas-only relayer. The relayer
 * holds no special authority — `sweep` is permissionless and its recipients are fixed by the signature — so a
 * compromised relayer key can, at worst, waste gas or delay sweeps, never redirect funds.
 *
 * The signature is minted at send time, not in advance, and expires in SWEEP_SIGNATURE_TTL_SECONDS. Sweeping never
 * marks a payment succeeded: the existing chain watcher and confirmation worker do that from the resulting
 * `PaymentSettled` event, exactly as for a direct wallet payment.
 */
export async function runSweeper(ctx: WorkerCtx): Promise<SweeperResult> {
  const { db, config } = ctx;
  if (!config.DEPOSIT_FACTORY_ADDRESS || !ctx.signer || !ctx.relayer) return { outcomes: {}, skipped: "not_configured" };

  const rows = await db
    .select({ id: depositAddresses.id })
    .from(depositAddresses)
    .where(
      and(
        eq(depositAddresses.chainId, config.CHAIN_ID),
        // Scoped to the currently configured factory: if it is ever rotated, addresses tied to a retired factory
        // must never be attempted against the new one (their predicted address, and so their payer, would differ).
        eq(depositAddresses.factoryAddress, config.DEPOSIT_FACTORY_ADDRESS.toLowerCase()),
        inArray(depositAddresses.status, ["funded", "sweeping"]),
      ),
    )
    .limit(BATCH);

  const outcomes: SweeperResult["outcomes"] = {};
  for (const { id } of rows) {
    let outcome: SweepOutcome;
    try {
      outcome = await sweepOne(ctx, id);
    } catch (err) {
      ctx.log.error({ err, depositAddressId: id }, "sweep attempt failed unexpectedly");
      continue;
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { outcomes };
}

async function sweepOne(ctx: WorkerCtx, depositAddressId: string): Promise<SweepOutcome> {
  const { db, chain, config, signer, relayer } = ctx;
  // Narrows the optional config/ctx fields for TypeScript; the caller already checked all three are present.
  const factory = config.DEPOSIT_FACTORY_ADDRESS;
  const usdc = config.USDC_ADDRESS;
  if (!signer || !relayer || !factory || !usdc) return "not_eligible";

  return db.transaction(async (tx) => {
    const [dep] = await tx
      .select()
      .from(depositAddresses)
      .where(and(eq(depositAddresses.id, depositAddressId), ne(depositAddresses.status, "swept"), ne(depositAddresses.status, "abandoned")))
      .for("update", { skipLocked: true });
    if (!dep) return "locked";

    // A previous attempt is in flight: check whether it landed before doing anything else.
    if (dep.status === "sweeping" && dep.sweepTxHash) {
      const receipt = await getReceipt(chain, dep.sweepTxHash as Hex);
      if (receipt) {
        if (receipt.status === "success") {
          await tx.update(depositAddresses).set({ status: "swept", sweptAt: new Date(nowMs(ctx)), updatedAt: new Date(nowMs(ctx)) }).where(eq(depositAddresses.id, dep.id));
          return "succeeded";
        }
        // Reverted: fall through to (maybe) retry below, same as a fresh attempt.
      } else if (nowMs(ctx) - dep.updatedAt.getTime() < config.SWEEP_RETRY_BACKOFF_SECONDS * 1000) {
        return "pending"; // still in the mempool; give it time before resubmitting
      }
      // else: stuck long enough to retry (submits a second transaction; harmless if the first also lands, since
      // the splitter's one-payment-per-intent check makes the loser revert with no funds moved).
    }

    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, dep.intentId)).for("update");
    if (!intent) return "locked";

    if (SETTLED.has(intent.status)) {
      await tx.update(depositAddresses).set({ status: "swept", sweptAt: new Date(nowMs(ctx)), updatedAt: new Date(nowMs(ctx)) }).where(eq(depositAddresses.id, dep.id));
      return "already_settled";
    }
    if (TERMINAL.has(intent.status)) {
      // The intent was canceled (or expired/failed) after the deposit was already funded: money is sitting at the
      // address but must not be swept to the merchant. Stop retrying and hand it to a human (rescue path).
      await flagForReview(tx, intent, {
        actor: ACTOR,
        reason: "deposit_funded_after_terminal",
        data: { deposit_address: dep.address, confirmed: dep.confirmedAmount.toString(), intent_status: intent.status },
      });
      await tx.update(depositAddresses).set({ status: "abandoned", updatedAt: new Date(nowMs(ctx)) }).where(eq(depositAddresses.id, dep.id));
      return "not_eligible";
    }

    if (dep.sweepAttempts >= config.SWEEP_MAX_ATTEMPTS) {
      await flagForReview(tx, intent, {
        actor: ACTOR,
        reason: "sweep_attempts_exhausted",
        data: { deposit_address: dep.address, attempts: dep.sweepAttempts, last_tx_hash: dep.sweepTxHash },
      });
      await tx.update(depositAddresses).set({ status: "abandoned", updatedAt: new Date(nowMs(ctx)) }).where(eq(depositAddresses.id, dep.id));
      return "abandoned";
    }

    // Read the merchant's CURRENT payout wallet: sweeping never uses a value cached earlier than send time.
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, intent.merchantId)).limit(1);
    if (!merchant) throw new Error(`merchant ${intent.merchantId} not found for intent ${intent.id}`);

    const domain = splitterDomain(config.CHAIN_ID, config.SPLITTER_ADDRESS);
    const expiry = BigInt(Math.floor(nowMs(ctx) / 1000) + config.SWEEP_SIGNATURE_TTL_SECONDS);
    const message: PaymentIntentMessage = {
      intentId: intent.intentHash as Hex,
      merchant: merchant.payoutWalletAddress as Address,
      token: usdc,
      payer: dep.address as Address,
      amount: intent.amount,
      feeBps: BigInt(intent.feeBps),
      expiry,
    };
    const signature = await signer.signPaymentIntent(domain, message);
    const struct = { intentId: message.intentId, merchant: message.merchant, payer: message.payer, amount: message.amount, feeBps: message.feeBps, expiry: message.expiry };

    let txHash: Hex;
    try {
      txHash = await relayer.writeContract({
        address: factory,
        abi: depositFactoryAbi,
        functionName: "sweep",
        args: [struct, signature],
        chain: relayer.chain,
      });
    } catch (err) {
      // Submission itself failed (RPC error, nonce clash, insufficient relayer gas...): count the attempt and retry
      // later; do not treat this as a signature/state problem.
      await tx
        .update(depositAddresses)
        .set({ status: "sweeping", sweepAttempts: dep.sweepAttempts + 1, updatedAt: new Date(nowMs(ctx)) })
        .where(eq(depositAddresses.id, dep.id));
      ctx.log.warn({ err, depositAddressId: dep.id }, "failed to submit sweep transaction");
      return "reverted";
    }

    await tx
      .update(depositAddresses)
      .set({ status: "sweeping", sweepTxHash: txHash.toLowerCase(), sweepAttempts: dep.sweepAttempts + 1, updatedAt: new Date(nowMs(ctx)) })
      .where(eq(depositAddresses.id, dep.id));
    return "submitted";
  });
}

async function getReceipt(chain: WorkerCtx["chain"], hash: Hex) {
  try {
    return await chain.getTransactionReceipt({ hash });
  } catch (err) {
    if (isReceiptNotFound(err)) return null;
    throw err;
  }
}
