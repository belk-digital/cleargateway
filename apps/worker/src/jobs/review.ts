import { enqueueIntentEvent, recordIntentEvent, type DbTx, type IntentRow } from "@belk/db";

/**
 * Marks an intent for manual review: audit event + `needs_review` flag + `payment_intent.requires_review` webhook.
 * Status is untouched. `discriminator` makes the webhook event id unique per distinct problem (same problem twice =
 * one webhook), so callers can safely re-run.
 */
export async function flagForReview(
  tx: DbTx,
  intent: IntentRow,
  input: {
    actor: string;
    reason: string;
    data: Record<string, unknown>;
    patch?: Parameters<typeof recordIntentEvent>[1]["patch"];
    discriminator?: string;
  },
): Promise<IntentRow> {
  const updated = await recordIntentEvent(tx, {
    intentId: intent.id,
    actor: input.actor,
    reason: input.reason,
    data: input.data,
    patch: { ...input.patch, needsReview: true, reviewReason: input.reason },
  });
  await enqueueIntentEvent(tx, updated, "payment_intent.requires_review", input.discriminator ?? `${input.reason}:${JSON.stringify(input.data)}`);
  return updated;
}
