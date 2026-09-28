import { encryptSecret, generateTotpSecret, newToken, type SessionKind } from "@belk/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import { authInvites, authSessions } from "./schema.js";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Issues a one-time invite/reset link for a user and supersedes any earlier unused ones. The raw token is returned once
 * and is not stored (only its hash). Staff invites also carry a fresh TOTP secret: two-factor is mandatory for staff, so
 * the person enrols it while accepting the invite.
 */
export async function createInvite(
  tx: DbTx,
  input: { kind: SessionKind; userId: string; purpose: "invite" | "reset"; createdBy: string | null; encryptionKey?: string },
): Promise<{ token: string; expiresAt: Date; totpSecret: string | null }> {
  let totpSecret: string | null = null;
  if (input.kind === "admin") {
    if (!input.encryptionKey) throw new Error("ENCRYPTION_KEY is required to enrol two-factor for staff");
    totpSecret = generateTotpSecret();
  }
  await tx
    .update(authInvites)
    .set({ usedAt: new Date() })
    .where(and(eq(authInvites.kind, input.kind), eq(authInvites.userId, input.userId), isNull(authInvites.usedAt)));
  const t = newToken("invite");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await tx.insert(authInvites).values({
    id: newId("inv"),
    kind: input.kind,
    purpose: input.purpose,
    userId: input.userId,
    tokenHash: t.hash,
    totpSecretEncrypted: totpSecret && input.encryptionKey ? encryptSecret(totpSecret, input.encryptionKey) : null,
    expiresAt,
    createdBy: input.createdBy,
  });
  return { token: t.raw, expiresAt, totpSecret };
}

/** Revokes every live session of a user (password change, reset, disable). */
export async function revokeUserSessions(tx: DbTx, kind: SessionKind, userId: string): Promise<void> {
  await tx
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.kind, kind), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
}
