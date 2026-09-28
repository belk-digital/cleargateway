import { adminUsers, authSessions, merchantUsers, merchants, newId, type Db } from "@belk/db";
import { AppError, hashToken, newToken, type SessionKind } from "@belk/shared";
import { and, eq, isNull, sql } from "drizzle-orm";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** A session unused for this long is dead even if its absolute lifetime has not ended. */
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_THROTTLE_MS = 60_000;

export async function createSession(db: Db, kind: SessionKind, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const t = newToken(kind);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessions).values({ id: newId("ses"), kind, userId, tokenHash: t.hash, mode: "test", expiresAt });
  return { token: t.raw, expiresAt };
}

export async function revokeSession(db: Db, raw: string): Promise<void> {
  await db.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.tokenHash, hashToken(raw)), isNull(authSessions.revokedAt)));
}

interface LiveSession {
  id: string;
  expiresAt: Date;
}

/** Loads a live session row for a token, or throws 401. Enforces revocation, absolute expiry and idle timeout. */
async function liveSession(db: Db, raw: string, kind: SessionKind): Promise<{ s: typeof authSessions.$inferSelect } & LiveSession> {
  const [s] = await db.select().from(authSessions).where(eq(authSessions.tokenHash, hashToken(raw))).limit(1);
  const now = Date.now();
  if (!s || s.kind !== kind || s.revokedAt || s.expiresAt.getTime() <= now || s.lastSeenAt.getTime() + SESSION_IDLE_MS <= now) {
    throw new AppError("unauthorized", "Your session has expired. Please sign in again.");
  }
  if (now - s.lastSeenAt.getTime() > TOUCH_THROTTLE_MS) {
    await db.update(authSessions).set({ lastSeenAt: sql`now()` }).where(eq(authSessions.id, s.id));
  }
  return { s, id: s.id, expiresAt: s.expiresAt };
}

export async function resolveMerchantSession(db: Db, raw: string) {
  const { s } = await liveSession(db, raw, "merchant");
  const [row] = await db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchants.id, merchantUsers.merchantId))
    .where(eq(merchantUsers.id, s.userId))
    .limit(1);
  if (!row || row.user.disabledAt) throw new AppError("unauthorized", "This account is disabled");
  return { session: s, user: row.user, merchant: row.merchant };
}

export async function resolveAdminSession(db: Db, raw: string) {
  const { s } = await liveSession(db, raw, "admin");
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, s.userId)).limit(1);
  if (!user || user.disabledAt) throw new AppError("unauthorized", "This account is disabled");
  return { session: s, user };
}
