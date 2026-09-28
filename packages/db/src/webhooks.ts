import { createHash } from "node:crypto";
import type { Mode } from "@belk/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import { intentPublicFields } from "./intent-view.js";
import type { IntentRow } from "./state-machine.js";
import { webhookDeliveries, webhookEndpoints } from "./schema.js";

export const WEBHOOK_EVENT_TYPES = [
  "payment_intent.succeeded",
  "payment_intent.expired",
  "payment_intent.underpaid",
  "payment_intent.failed",
  "payment_intent.requires_review",
  "refund.created",
  "webhook.test",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Deterministic event id: the same logical event always gets the same id, so re-running a job can never
 * enqueue it twice (unique index on event_id + endpoint_id) and merchants can dedupe on it.
 */
export function eventId(type: WebhookEventType, subjectId: string, discriminator = ""): string {
  return `evt_${createHash("sha256").update(`${type}\n${subjectId}\n${discriminator}`).digest("hex").slice(0, 32)}`;
}

/**
 * Transactional outbox: writes one pending delivery per subscribed endpoint INSIDE the caller's DB transaction,
 * so an event exists if and only if the state change that caused it committed. The delivery worker sends them.
 * Returns the number of deliveries created (0 if the merchant has no matching endpoints, or already enqueued).
 */
export async function enqueueEvent(
  tx: DbTx,
  input: {
    merchantId: string;
    mode: Mode;
    type: WebhookEventType;
    subjectId: string;
    discriminator?: string;
    object: Record<string, unknown>;
    /** Deliver only to this endpoint (used by the "send test event" call). */
    endpointId?: string;
  },
): Promise<number> {
  const endpoints = await tx
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.merchantId, input.merchantId),
        eq(webhookEndpoints.mode, input.mode),
        eq(webhookEndpoints.status, "enabled"),
        isNull(webhookEndpoints.deletedAt),
        ...(input.endpointId ? [eq(webhookEndpoints.id, input.endpointId)] : []),
      ),
    );
  const subscribed = endpoints.filter((e) => e.enabledEvents.includes("*") || e.enabledEvents.includes(input.type));
  if (subscribed.length === 0) return 0;

  const id = eventId(input.type, input.subjectId, input.discriminator);
  const payload = {
    id,
    object: "event" as const,
    type: input.type,
    created: new Date().toISOString(),
    mode: input.mode,
    data: { object: input.object },
  };
  const inserted = await tx
    .insert(webhookDeliveries)
    .values(
      subscribed.map((e) => ({
        id: newId("wd"),
        endpointId: e.id,
        eventId: id,
        eventType: input.type,
        payload,
        status: "pending" as const,
        nextAttemptAt: new Date(),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  return inserted.length;
}

/** Convenience: enqueue an event whose object is the payment intent. */
export function enqueueIntentEvent(tx: DbTx, intent: IntentRow, type: WebhookEventType, discriminator?: string) {
  return enqueueEvent(tx, {
    merchantId: intent.merchantId,
    mode: intent.mode,
    type,
    subjectId: intent.id,
    discriminator,
    object: intentPublicFields(intent),
  });
}
