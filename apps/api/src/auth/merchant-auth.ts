import { apiKeys, merchants, type Db } from "@belk/db";
import { AppError, apiKeyMode, apiKeyPrefix, hashApiKey, sessionKindOf, verifyApiKey } from "@belk/shared";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { resolveMerchantSession } from "./sessions.js";

const LAST_USED_THROTTLE_MS = 60_000;
/** Compared against when the key is unknown, so lookup misses and hash mismatches cost the same. */
const DUMMY_HASH = hashApiKey("sk_test_dummy");

/**
 * Authenticates `Authorization: Bearer sk_test_... | sk_live_...`.
 * - only a SHA-256 of the key is stored; comparison is constant-time
 * - live keys are rejected while the platform is testnet-only (Phase 1)
 * - test keys only ever see test-mode data (mode is fixed by the key and enforced in every query)
 */
export function merchantAuth(db: Db) {
  return async function authenticate(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization;
    const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";

    // A signed-in dashboard user (session token) is authorised exactly like an API key for their merchant, with two
    // differences: viewers are read-only, and the actor in audit trails is the person, not the merchant.
    if (sessionKindOf(raw) === "merchant") {
      const { session, user, merchant } = await resolveMerchantSession(db, raw);
      if (merchant.status !== "active") throw new AppError("forbidden", merchant.status === "suspended" ? "Merchant account is suspended" : "Merchant account is not active");
      if (user.role === "viewer" && req.method !== "GET" && req.method !== "HEAD") throw new AppError("forbidden", "Your role is read-only");
      req.merchant = merchant;
      req.apiMode = session.mode;
      req.apiKeyPrefix = `user:${user.id}`;
      req.merchantUser = { id: user.id, email: user.email, role: user.role };
      return;
    }

    const prefix = apiKeyPrefix(raw);
    const mode = apiKeyMode(raw);
    if (!prefix || !mode) throw new AppError("unauthorized", "Missing or malformed API key");

    const [row] = await db
      .select({ key: apiKeys, merchant: merchants })
      .from(apiKeys)
      .innerJoin(merchants, eq(merchants.id, apiKeys.merchantId))
      .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)))
      .limit(1);

    const ok = verifyApiKey(raw, row?.key.keyHash ?? DUMMY_HASH);
    if (!row || !ok) throw new AppError("unauthorized", "Invalid API key");

    if (row.key.mode === "live") {
      throw new AppError("live_mode_disabled", "Live mode is not enabled yet; use a test key (sk_test_...)");
    }
    if (row.merchant.status === "suspended") throw new AppError("forbidden", "Merchant account is suspended");
    if (row.merchant.status !== "active") throw new AppError("forbidden", "Merchant account is not active");

    req.merchant = row.merchant;
    req.apiMode = row.key.mode;
    req.apiKeyPrefix = prefix;

    // Best effort, throttled so hot keys don't turn every request into a write.
    const cutoff = new Date(Date.now() - LAST_USED_THROTTLE_MS);
    db.update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(and(eq(apiKeys.id, row.key.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, cutoff))))
      .catch((err: unknown) => req.log.warn({ err }, "failed to update api key last_used_at"));
  };
}

/** Narrowing helper for handlers behind `merchantAuth`. */
export function authed(req: FastifyRequest) {
  if (!req.merchant || !req.apiMode) throw new AppError("unauthorized", "Not authenticated");
  return { merchant: req.merchant, mode: req.apiMode, actor: req.merchantUser ? `user:${req.merchantUser.id}` : `merchant:${req.merchant.id}` };
}
