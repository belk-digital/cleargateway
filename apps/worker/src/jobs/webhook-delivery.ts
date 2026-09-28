import { newId, webhookAttempts, webhookDeliveries, webhookEndpoints } from "@belk/db";
import { assertWebhookUrlAllowed, decryptSecret, signWebhookPayload } from "@belk/shared";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { nowMs, type WorkerCtx } from "../context.js";

/**
 * Minutes to wait before retry N (1-based). 13 retries + the first attempt = 14 attempts spanning ~3.2 days
 * (4,571 minutes), after which the delivery is marked failed.
 */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240, 360, 480, 720, 720, 720, 1440] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_MINUTES.length + 1;

/** While a worker is sending, the delivery is leased so nobody else sends it; a crash frees it after this. */
const LEASE_SECONDS = 60;
const BATCH = 20;
/** A run keeps claiming batches until nothing is due, up to this many, so a backlog never starves newer events. */
const MAX_BATCHES_PER_RUN = 10;

export interface DeliveryResult {
  attempted: number;
  succeeded: number;
  retrying: number;
  failed: number;
}

type Fetch = typeof fetch;

/**
 * Sends due webhook deliveries (transactional outbox rows). At-least-once: receivers dedupe on `ClearGateway-Event-Id`.
 * Each attempt is logged to `webhook_attempts`. Redirects are not followed and private targets are re-checked at
 * send time (SSRF / DNS-rebinding protection).
 */
export async function runWebhookDelivery(ctx: WorkerCtx, opts: { fetchImpl?: Fetch } = {}): Promise<DeliveryResult> {
  const { db, config } = ctx;
  const doFetch = opts.fetchImpl ?? fetch;
  const result: DeliveryResult = { attempted: 0, succeeded: 0, retrying: 0, failed: 0 };

  for (let batchNo = 0; batchNo < MAX_BATCHES_PER_RUN; batchNo++) {
  // Claim a batch by pushing next_attempt_at forward (a lease), so concurrent workers never double-send.
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date(nowMs(ctx)))))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(BATCH)
      .for("update", { skipLocked: true });
    if (due.length > 0) {
      await tx
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(nowMs(ctx) + LEASE_SECONDS * 1000) })
        .where(inArray(webhookDeliveries.id, due.map((d) => d.id)));
    }
    return due;
  });

  for (const d of claimed) {
    result.attempted++;
    const attemptNumber = d.attemptCount + 1;
    const startedAt = Date.now();
    let responseCode: number | null = null;
    let error: string | null = null;
    let permanent = false;

    const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId)).limit(1);
    if (!endpoint || endpoint.deletedAt || endpoint.status !== "enabled") {
      error = "endpoint_unavailable";
      permanent = true; // nobody to deliver to; do not retry for days
    } else {
      try {
        await assertWebhookUrlAllowed(endpoint.url, { allowPrivate: config.WEBHOOK_ALLOW_PRIVATE_URLS });
        const secret = decryptSecret(endpoint.secretEncrypted, config.ENCRYPTION_KEY);
        const body = JSON.stringify(d.payload); // signed bytes == sent bytes
        const res = await doFetch(endpoint.url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(config.WEBHOOK_TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "user-agent": "ClearGateway-Webhooks/1",
            "cleargateway-signature": signWebhookPayload(secret, body, Math.floor(nowMs(ctx) / 1000)),
            "cleargateway-event-id": d.eventId,
            "cleargateway-event-type": d.eventType,
            "cleargateway-delivery-attempt": String(attemptNumber),
          },
          body,
        });
        responseCode = res.status;
        await res.body?.cancel().catch(() => {}); // never read or store the merchant's response body
        if (res.status < 200 || res.status >= 300) error = `http_${res.status}`;
      } catch (err) {
        error = err instanceof Error ? err.message.slice(0, 300) : "unknown_error";
      }
    }

    const ok = error === null;
    const exhausted = attemptNumber >= WEBHOOK_MAX_ATTEMPTS;
    const status = ok ? "succeeded" : permanent || exhausted ? "failed" : "pending";
    const delayMin = WEBHOOK_BACKOFF_MINUTES[attemptNumber - 1];
    await db.transaction(async (tx) => {
      await tx.insert(webhookAttempts).values({
        id: newId("wa"),
        deliveryId: d.id,
        attemptNumber,
        responseCode,
        error,
        durationMs: Date.now() - startedAt,
      });
      await tx
        .update(webhookDeliveries)
        .set({
          status,
          attemptCount: attemptNumber,
          lastResponseCode: responseCode,
          nextAttemptAt: status === "pending" && delayMin !== undefined ? new Date(nowMs(ctx) + delayMin * 60_000) : null,
        })
        .where(eq(webhookDeliveries.id, d.id));
    });

    ctx.log.info(
      { deliveryId: d.id, eventId: d.eventId, eventType: d.eventType, attempt: attemptNumber, responseCode, error, status },
      "webhook delivery attempt",
    );
    if (status === "succeeded") result.succeeded++;
    else if (status === "failed") result.failed++;
    else result.retrying++;
  }
  if (claimed.length < BATCH) break; // nothing (more) due
  }
  return result;
}
