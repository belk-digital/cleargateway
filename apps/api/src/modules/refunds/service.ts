import { enqueueEvent, newId, paymentIntents, recordIntentEvent, refunds, type DbTx } from "@belk/db";
import { AppError, MAX_AMOUNT_UNITS, type Mode } from "@belk/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import { toRefundView } from "../admin/views.js";

type MerchantRow = NonNullable<import("fastify").FastifyRequest["merchant"]>;

/** Refunds that still count against the payment: anything not rejected or failed. */
export const COMMITTED_REFUND_STATUSES = ["requested", "approved", "processing", "succeeded"] as const;

/**
 * Records a refund REQUEST for a paid payment. Nothing moves on-chain here (execution is a later phase, and the
 * platform never holds funds: the merchant already received theirs). What this enforces:
 *  - the payment belongs to this merchant and mode, and actually succeeded;
 *  - the total of all live refunds can never exceed what the customer paid (checked under a row lock, so two
 *    concurrent requests cannot both squeeze under the cap);
 *  - the destination is an explicit, checksum-valid address that is not one of our own contracts.
 * The payment's status is NOT changed here: succeeded -> (partially_)refunded happens when a refund executes.
 *
 * Product decision still open (flagged in the summary): the cap is the GROSS amount paid. Whether the platform fee is
 * returned on a refund needs a rule before execution is built.
 */
export async function recordRefundRequest(
  tx: DbTx,
  ctx: { merchant: MerchantRow; mode: Mode; actor: string; config: Config },
  input: { intentId: string; amount?: bigint; toAddress: string; reason?: string },
) {
  const [intent] = await tx
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, input.intentId), eq(paymentIntents.merchantId, ctx.merchant.id), eq(paymentIntents.mode, ctx.mode)))
    .for("update");
  if (!intent) throw new AppError("not_found", "Payment intent not found");
  if (intent.status !== "succeeded" && intent.status !== "partially_refunded") {
    throw new AppError("conflict", `Only a succeeded payment can be refunded; this one is ${intent.status}`);
  }

  const lower = (a: string) => a.toLowerCase();
  const forbidden = [ctx.config.SPLITTER_ADDRESS, ctx.config.USDC_ADDRESS, ctx.config.DEPOSIT_FACTORY_ADDRESS, "0x0000000000000000000000000000000000000000"];
  if (forbidden.some((a) => a && lower(a) === lower(input.toAddress))) {
    throw new AppError("invalid_request", "to_address cannot be a protocol contract or the zero address");
  }

  const [{ committed } = { committed: "0" }] = await tx
    .select({ committed: sql<string>`coalesce(sum(${refunds.amount}), 0)::text` })
    .from(refunds)
    .where(and(eq(refunds.intentId, intent.id), inArray(refunds.status, [...COMMITTED_REFUND_STATUSES])));
  const remaining = intent.amount - BigInt(committed);
  const amount = input.amount ?? remaining;
  if (amount <= 0n || amount > MAX_AMOUNT_UNITS || amount > remaining) {
    throw new AppError("invalid_request", "Refund amount exceeds what is still refundable for this payment", {
      paid: intent.amount.toString(),
      already_requested: committed,
      remaining: remaining.toString(),
    });
  }

  const [row] = await tx
    .insert(refunds)
    .values({
      id: newId("re"),
      intentId: intent.id,
      amount,
      toAddress: input.toAddress,
      requestedBy: ctx.actor,
      reason: input.reason ?? null,
    })
    .returning();
  if (!row) throw new Error("failed to insert refund");

  await recordIntentEvent(tx, {
    intentId: intent.id,
    actor: ctx.actor,
    reason: "refund_requested",
    data: { refund_id: row.id, amount: amount.toString(), to_address: input.toAddress },
  });
  await enqueueEvent(tx, {
    merchantId: intent.merchantId,
    mode: intent.mode,
    type: "refund.created",
    subjectId: row.id,
    object: toRefundView(row),
  });
  return row;
}
