import { AppError } from "@belk/shared";
import { eq } from "drizzle-orm";
import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import { paymentEvents, paymentIntents, type PaymentStatus } from "./schema.js";

/**
 * THE ONLY module allowed to write `payment_intents.status`.
 * (A repo guard test fails if any other file updates or inserts into payment_intents.)
 *
 * Every change runs inside the caller's DB transaction, locks the row, checks the transitions table,
 * and appends an audit row to `payment_events`, so status and audit trail can never diverge.
 */
export const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  created: ["awaiting_payment", "expired", "canceled"],
  awaiting_payment: ["confirming", "underpaid", "expired", "canceled"],
  underpaid: ["confirming", "expired"],
  confirming: ["succeeded", "failed"],
  succeeded: ["refunded", "partially_refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  // Terminal
  expired: [],
  failed: [],
  canceled: [],
  refunded: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type IntentRow = typeof paymentIntents.$inferSelect;
export type NewIntent = Omit<typeof paymentIntents.$inferInsert, "status">;

/** Columns callers may set alongside a transition. `status` is deliberately excluded. */
export type IntentPatch = Partial<Omit<typeof paymentIntents.$inferInsert, "id" | "status" | "createdAt">>;

export interface TransitionInput {
  intentId: string;
  to: PaymentStatus;
  /** Who caused it: "merchant:mer_x", "system:worker", "system:checkout", "admin:adm_x"... */
  actor: string;
  reason?: string;
  data?: Record<string, unknown>;
  patch?: IntentPatch;
}

/** Inserts a new intent in `created` and writes its first audit event. */
export async function createIntent(tx: DbTx, values: NewIntent, actor: string): Promise<IntentRow> {
  const [row] = await tx.insert(paymentIntents).values({ ...values, status: "created" }).returning();
  if (!row) throw new Error("failed to insert payment intent");
  await tx.insert(paymentEvents).values({
    id: newId("evt"),
    intentId: row.id,
    fromStatus: null,
    toStatus: "created",
    reason: "intent_created",
    actor,
    data: {},
  });
  return row;
}

export async function transitionIntent(tx: DbTx, input: TransitionInput): Promise<IntentRow> {
  const [current] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, input.intentId)).for("update");
  if (!current) throw new AppError("not_found", "Payment intent not found");

  if (!canTransition(current.status, input.to)) {
    // Illegal transitions are bugs or attacks: fail loudly, never silently coerce.
    console.error(
      JSON.stringify({
        level: "error",
        msg: "illegal payment state transition",
        intentId: input.intentId,
        from: current.status,
        to: input.to,
        actor: input.actor,
      }),
    );
    throw new AppError("invalid_state_transition", `Cannot move payment from ${current.status} to ${input.to}`, {
      from: current.status,
      to: input.to,
    });
  }

  const [updated] = await tx
    .update(paymentIntents)
    .set({ ...input.patch, status: input.to, updatedAt: new Date() })
    .where(eq(paymentIntents.id, input.intentId))
    .returning();
  if (!updated) throw new Error("failed to update payment intent");

  await tx.insert(paymentEvents).values({
    id: newId("evt"),
    intentId: input.intentId,
    fromStatus: current.status,
    toStatus: input.to,
    reason: input.reason ?? null,
    actor: input.actor,
    data: input.data ?? {},
  });
  return updated;
}

/**
 * Audit-only entry for things that matter but are not status changes
 * (signed payload issued, late payment flagged, ...). Optionally patches non-status columns.
 */
export async function recordIntentEvent(
  tx: DbTx,
  input: { intentId: string; actor: string; reason: string; data?: Record<string, unknown>; patch?: IntentPatch },
): Promise<IntentRow> {
  const [current] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, input.intentId)).for("update");
  if (!current) throw new AppError("not_found", "Payment intent not found");

  let row = current;
  if (input.patch) {
    const [updated] = await tx
      .update(paymentIntents)
      .set({ ...input.patch, updatedAt: new Date() })
      .where(eq(paymentIntents.id, input.intentId))
      .returning();
    if (!updated) throw new Error("failed to update payment intent");
    row = updated;
  }
  await tx.insert(paymentEvents).values({
    id: newId("evt"),
    intentId: input.intentId,
    fromStatus: current.status,
    toStatus: current.status,
    reason: input.reason,
    actor: input.actor,
    data: input.data ?? {},
  });
  return row;
}

/**
 * Updates the confirmation counter (and nothing else) without an audit event: it changes on every block, and
 * the meaningful transitions (confirming -> succeeded) are audited separately. Status is never touched.
 */
export async function touchConfirmations(tx: DbTx, intentId: string, confirmations: number): Promise<void> {
  await tx.update(paymentIntents).set({ confirmations, updatedAt: new Date() }).where(eq(paymentIntents.id, intentId));
}
