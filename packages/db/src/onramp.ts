import { AppError } from "@belk/shared";
import { and, eq } from "drizzle-orm";
import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import { onrampSessions, paymentIntents } from "./schema.js";
import { recordIntentEvent, transitionIntent } from "./state-machine.js";

export type OnrampSessionRow = typeof onrampSessions.$inferSelect;
export type OnrampSessionStatus = OnrampSessionRow["status"];

/**
 * Records a newly created on-ramp session and moves the intent created -> awaiting_payment (audited), mirroring
 * `issueDepositAddress` / `createWalletPayment`. The provider session itself was already created by the caller
 * (packages/onramp); this only persists the result.
 */
export async function recordOnrampSession(
  tx: DbTx,
  input: {
    intentId: string;
    provider: string;
    providerSessionId: string;
    customerWalletAddress: string;
    actor: string;
  },
): Promise<OnrampSessionRow> {
  const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, input.intentId)).for("update");
  if (!intent) throw new AppError("not_found", "Payment intent not found");
  if (intent.status !== "created" && intent.status !== "awaiting_payment") {
    throw new AppError("conflict", `Payment intent is ${intent.status} and can no longer be paid`);
  }
  if (intent.expiresAt.getTime() <= Date.now()) throw new AppError("conflict", "Payment intent has expired");

  const [row] = await tx
    .insert(onrampSessions)
    .values({
      id: newId("orx"),
      intentId: input.intentId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      customerWalletAddress: input.customerWalletAddress.toLowerCase(),
    })
    .returning();
  if (!row) throw new Error("failed to insert onramp session");

  const patch = { onrampProvider: input.provider, onrampOrderId: input.providerSessionId, onrampStatus: "created" as const, paymentMethod: "onramp" as const };
  const data = { provider: input.provider, session_id: input.providerSessionId };
  if (intent.status === "created") {
    await transitionIntent(tx, { intentId: input.intentId, to: "awaiting_payment", actor: input.actor, reason: "onramp_session_created", data, patch });
  } else {
    await recordIntentEvent(tx, { intentId: input.intentId, actor: input.actor, reason: "onramp_session_created", data, patch });
  }
  return row;
}

/**
 * Applies a verified, parsed on-ramp webhook event: updates the session and the intent's `onramp_status` field,
 * and appends an audit event. Deliberately NEVER changes `payment_intents.status` — only the chain watcher, from
 * an actual on-chain `PaymentSettled` event, may do that. An on-ramp "completed" means the customer's own wallet
 * now holds USDC; it does not mean the merchant has been paid.
 */
export async function applyOnrampEvent(
  tx: DbTx,
  input: { provider: string; sessionId: string; status: OnrampSessionStatus; txHash?: string; actor: string },
): Promise<{ applied: boolean; intentId?: string }> {
  const [session] = await tx
    .select()
    .from(onrampSessions)
    .where(and(eq(onrampSessions.provider, input.provider), eq(onrampSessions.providerSessionId, input.sessionId)))
    .for("update");
  if (!session) return { applied: false };

  await tx.update(onrampSessions).set({ status: input.status, updatedAt: new Date() }).where(eq(onrampSessions.id, session.id));

  const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, session.intentId)).for("update");
  if (!intent) return { applied: false };

  // The intent may have moved on (e.g. already succeeded from an actual on-chain payment) by the time a webhook
  // arrives; the session status is still recorded above, but the intent's onramp_status field is left alone.
  if (intent.onrampOrderId !== input.sessionId) return { applied: true, intentId: intent.id };

  await recordIntentEvent(tx, {
    intentId: intent.id,
    actor: input.actor,
    reason: "onramp_status_changed",
    // The on-ramp's own transfer tx (into the customer's wallet), if reported. Never written to payment_intents.tx_hash.
    data: { provider: input.provider, session_id: input.sessionId, status: input.status, onramp_tx_hash: input.txHash ?? null },
    patch: { onrampStatus: input.status },
  });
  return { applied: true, intentId: intent.id };
}
