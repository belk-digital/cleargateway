import {
  createIntent,
  newId,
  paymentIntents,
  transitionIntent,
  type Db,
  type DbTx,
  type IntentRow,
} from "@belk/db";
import {
  AppError,
  MAX_AMOUNT_UNITS,
  MIN_AMOUNT_UNITS,
  hashClientSecret,
  deriveClientSecret,
  splitAmount,
  type Mode,
} from "@belk/shared";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import type { Config } from "../../config.js";
import type { CreateIntentBody, ListIntentsQuery } from "./schemas.js";

type MerchantRow = NonNullable<import("fastify").FastifyRequest["merchant"]>;

const PG_UNIQUE_VIOLATION = "23505";

export async function createPaymentIntent(
  tx: DbTx,
  ctx: { merchant: MerchantRow; mode: Mode; actor: string; config: Config },
  input: CreateIntentBody,
): Promise<IntentRow> {
  const { merchant, mode, actor, config } = ctx;
  if (!config.CLIENT_SECRET_KEY) throw new AppError("not_configured", "CLIENT_SECRET_KEY is not configured");

  const amount = BigInt(input.amount);
  if (amount < MIN_AMOUNT_UNITS || amount > MAX_AMOUNT_UNITS) {
    throw new AppError("invalid_request", "amount is outside the allowed range", {
      min: MIN_AMOUNT_UNITS.toString(),
      max: MAX_AMOUNT_UNITS.toString(),
    });
  }

  if (input.merchant_order_id) {
    const [dup] = await tx
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.merchantId, merchant.id),
          eq(paymentIntents.mode, mode),
          eq(paymentIntents.merchantOrderId, input.merchant_order_id),
        ),
      )
      .limit(1);
    if (dup) {
      throw new AppError("conflict", "A payment intent already exists for this merchant_order_id", {
        payment_intent_id: dup.id,
      });
    }
  }

  // Fee is snapshotted now: later changes to the merchant's fee never alter an existing intent.
  const { fee, merchantAmount } = splitAmount(amount, merchant.feeBps);
  const id = newId("pi");
  const clientSecret = deriveClientSecret(config.CLIENT_SECRET_KEY, id);

  try {
    return await createIntent(
      tx,
      {
        id,
        merchantId: merchant.id,
        mode,
        amount,
        currency: input.currency,
        feeBps: merchant.feeBps,
        feeAmount: fee,
        merchantAmount,
        merchantOrderId: input.merchant_order_id ?? null,
        metadata: input.metadata,
        customerEmail: input.customer_email ?? null,
        successUrl: input.success_url ?? null,
        cancelUrl: input.cancel_url ?? null,
        clientSecretHash: hashClientSecret(clientSecret),
        chainId: config.CHAIN_ID,
        contractAddress: config.SPLITTER_ADDRESS ?? null,
        // bytes32 id used on-chain (PaymentSettled.intentId): keccak256 of the public intent id.
        intentHash: keccak256(stringToBytes(id)),
        expiresAt: new Date(Date.now() + input.expires_in_seconds * 1000),
      },
      actor,
    );
  } catch (err) {
    if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      throw new AppError("conflict", "A payment intent already exists for this merchant_order_id");
    }
    throw err;
  }
}

export async function getPaymentIntent(db: Db, merchantId: string, mode: Mode, id: string): Promise<IntentRow> {
  const [row] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, id), eq(paymentIntents.merchantId, merchantId), eq(paymentIntents.mode, mode)))
    .limit(1);
  // 404 (not 403) for other merchants' ids, so ids can't be probed.
  if (!row) throw new AppError("not_found", "Payment intent not found");
  return row;
}

export async function listPaymentIntents(
  db: Db,
  merchantId: string,
  mode: Mode,
  q: ListIntentsQuery,
): Promise<{ rows: IntentRow[]; hasMore: boolean }> {
  const conds: SQL[] = [eq(paymentIntents.merchantId, merchantId), eq(paymentIntents.mode, mode)];
  if (q.status) conds.push(eq(paymentIntents.status, q.status));
  if (q.created_gte) conds.push(gte(paymentIntents.createdAt, new Date(q.created_gte)));
  if (q.created_lte) conds.push(lte(paymentIntents.createdAt, new Date(q.created_lte)));

  if (q.starting_after) {
    // Compare against the cursor row in SQL so microsecond timestamps are never truncated by JS Dates.
    await getPaymentIntent(db, merchantId, mode, q.starting_after).catch(() => {
      throw new AppError("invalid_request", "starting_after does not refer to one of your payment intents");
    });
    conds.push(
      sql`(${paymentIntents.createdAt}, ${paymentIntents.id}) < (select created_at, id from payment_intents where id = ${q.starting_after})`,
    );
  }

  const rows = await db
    .select()
    .from(paymentIntents)
    .where(and(...conds))
    .orderBy(desc(paymentIntents.createdAt), desc(paymentIntents.id))
    .limit(q.limit + 1);
  return { rows: rows.slice(0, q.limit), hasMore: rows.length > q.limit };
}

export async function cancelPaymentIntent(
  tx: DbTx,
  ctx: { merchantId: string; mode: Mode; actor: string },
  id: string,
): Promise<IntentRow> {
  const [row] = await tx
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, id), eq(paymentIntents.merchantId, ctx.merchantId), eq(paymentIntents.mode, ctx.mode)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Payment intent not found");
  // Legal only from created / awaiting_payment; the state machine rejects everything else with 409.
  return transitionIntent(tx, { intentId: id, to: "canceled", actor: ctx.actor, reason: "canceled_by_merchant" });
}
