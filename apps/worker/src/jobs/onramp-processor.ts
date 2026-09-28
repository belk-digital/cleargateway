import { applyOnrampEvent, inboundWebhookEvents } from "@belk/db";
import { ONRAMP_EVENT_TYPES } from "@belk/onramp";
import { and, asc, eq, isNull } from "drizzle-orm";
import { nowMs, type WorkerCtx } from "../context.js";

export interface OnrampProcessorResult {
  skipped?: "not_configured";
  processed: number;
  applied: number;
  /** Rows whose provider or payload could not be handled (unknown provider, malformed body). Marked processed
   *  anyway so a permanently bad row never retries forever; never crashes the batch. */
  errored: number;
}

/**
 * Applies stored, already-signature-verified on-ramp webhooks (`inbound_webhook_events` with source="onramp").
 * There is no independent blockchain to re-check an on-ramp order against — unlike the chain watcher, which treats
 * a webhook as a mere "check now" hint, this job's parsed payload IS the update, which is why the API only stores
 * it after verifying the signature. Applying it can only ever change on-ramp status fields (via `applyOnrampEvent`);
 * it can never mark a payment succeeded. Idempotent: re-running never double-applies (each row is processed once).
 */
export async function runOnrampProcessor(ctx: WorkerCtx): Promise<OnrampProcessorResult> {
  const { db, config } = ctx;
  const providers = ctx.onrampProviders;
  if (!providers) return { processed: 0, applied: 0, errored: 0, skipped: "not_configured" };

  const rows = await db
    .select()
    .from(inboundWebhookEvents)
    .where(and(eq(inboundWebhookEvents.source, "onramp"), isNull(inboundWebhookEvents.processedAt)))
    .orderBy(asc(inboundWebhookEvents.createdAt))
    .limit(config.ONRAMP_BATCH_SIZE);

  const result: OnrampProcessorResult = { processed: 0, applied: 0, errored: 0 };
  for (const row of rows) {
    result.processed++;

    // Parsing is pure and deterministic: a failure here (unknown provider, malformed body) is permanent, so the
    // row is marked processed regardless, or it would retry forever without ever succeeding.
    let event;
    try {
      const provider = (providers as Record<string, (typeof providers)["mock"]>)[row.provider];
      if (!provider) throw new Error(`unknown on-ramp provider "${row.provider}"`);
      event = provider.parseWebhook(row.rawBody);
      if (!(ONRAMP_EVENT_TYPES as readonly string[]).includes(event.type)) throw new Error(`unrecognized event type "${event.type}"`);
    } catch (err) {
      result.errored++;
      ctx.log.error({ err, inboundWebhookEventId: row.id, provider: row.provider }, "onramp webhook could not be parsed; giving up on this row");
      await db.update(inboundWebhookEvents).set({ processedAt: new Date(nowMs(ctx)) }).where(eq(inboundWebhookEvents.id, row.id));
      continue;
    }

    // Applying it writes to the database: a failure here may be transient (e.g. a connection blip), so the row is
    // deliberately left unprocessed and will be retried on the next tick, rather than silently dropped.
    try {
      const applied = await db.transaction((tx) =>
        applyOnrampEvent(tx, { provider: row.provider, sessionId: event.sessionId, status: event.type, txHash: event.txHash, actor: "system:onramp" }),
      );
      if (applied.applied) result.applied++;
      else ctx.log.warn({ provider: row.provider, sessionId: event.sessionId }, "onramp webhook has no matching session; ignoring");
      await db.update(inboundWebhookEvents).set({ processedAt: new Date(nowMs(ctx)) }).where(eq(inboundWebhookEvents.id, row.id));
    } catch (err) {
      result.errored++;
      ctx.log.error({ err, inboundWebhookEventId: row.id, provider: row.provider }, "failed to apply onramp webhook; will retry");
    }
  }
  return result;
}
