import { createHash } from "node:crypto";
import { idempotencyKeys, newId, type Db, type DbTx } from "@belk/db";
import { AppError } from "@belk/shared";
import { and, eq, lt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/; // printable ASCII, no spaces

export interface IdempotentResult {
  status: number;
  body: unknown;
}

/** JSON with sorted keys, so semantically identical bodies hash identically. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

/**
 * Runs `handler` at most once per (merchant, Idempotency-Key).
 *
 * The key row, the handler's writes and the stored response all commit in ONE database transaction:
 *  - a crash can never leave "work done, response not stored" (or the reverse);
 *  - a concurrent duplicate blocks on the unique index until the first request commits, then replays it;
 *  - a failed handler rolls everything back, including the key, so the client may safely retry.
 * Same key + different request => 409 idempotency_conflict.
 */
export async function runIdempotent(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  merchantId: string,
  handler: (tx: DbTx) => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw new AppError("invalid_request", "Idempotency-Key header is required (1-255 printable ASCII characters)");
  }
  const path = req.url.split("?")[0] ?? req.url;
  const hash = requestHash(req.method, path, req.body);

  const outcome = await db.transaction(async (tx) => {
    const now = new Date();
    // Free an expired key for this merchant (if any) so it can be reused as new.
    await tx
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.merchantId, merchantId), eq(idempotencyKeys.key, key), lt(idempotencyKeys.expiresAt, now)));
    const [inserted] = await tx
      .insert(idempotencyKeys)
      .values({
        id: newId("idem"),
        merchantId,
        key,
        method: req.method,
        path,
        requestHash: hash,
        lockedAt: now,
        expiresAt: new Date(now.getTime() + KEY_TTL_MS),
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    if (inserted) {
      const result = await handler(tx);
      await tx
        .update(idempotencyKeys)
        .set({ responseStatus: result.status, responseBody: result.body ?? null })
        .where(eq(idempotencyKeys.id, inserted.id));
      return { result, replayed: false };
    }

    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.merchantId, merchantId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!existing) throw new AppError("conflict", "Idempotency key was concurrently removed; retry");
    if (existing.requestHash !== hash) {
      throw new AppError("idempotency_conflict", "Idempotency-Key was already used with a different request");
    }
    if (existing.responseStatus === null) throw new AppError("conflict", "A request with this key is still in progress");
    return { result: { status: existing.responseStatus, body: existing.responseBody }, replayed: true };
  });

  if (outcome.replayed) reply.header("idempotent-replayed", "true");
  return outcome.result;
}
