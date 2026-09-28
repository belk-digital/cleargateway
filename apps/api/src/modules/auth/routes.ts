import { adminUsers, authInvites, authSessions, merchantUsers, revokeUserSessions, type Db } from "@belk/db";
import {
  AppError,
  decryptSecret,
  dummyPasswordHash,
  hashPassword,
  hashToken,
  isInviteToken,
  passwordProblem,
  sessionKindOf,
  totpUri,
  verifyPassword,
  verifyTotp,
  type SessionKind,
} from "@belk/shared";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createSession, resolveAdminSession, resolveMerchantSession, revokeSession } from "../../auth/sessions.js";
import type { Config } from "../../config.js";

interface Opts {
  db: Db;
  config: Config;
}

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const GENERIC = "Invalid email or password";

const loginBody = z
  .object({ email: z.string().email().max(320), password: z.string().min(1).max(256), totp_code: z.string().regex(/^\d{6}$/).optional() })
  .strict();
const password = z.string().min(1).max(256);
const tokenParam = z.object({ token: z.string().regex(/^binv_[0-9a-f]{64}$/) }).strict();

const bearer = (req: FastifyRequest): string => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

/**
 * Sign-in for merchant dashboard users and ClearGateway staff. Sessions are server-side and revocable; passwords are scrypt;
 * staff must also present a TOTP code. Every failure is generic (no account enumeration) and accounts lock after repeated
 * failures. The routes here are public (no API key), so they are rate limited harder than the rest of the API.
 */
export const authRoutes: FastifyPluginAsync<Opts> = async (instance, { db, config }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const strict = app.createRateLimit({ max: config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => req.ip });
  const limit = async (req: FastifyRequest, reply: FastifyReply) => {
    const r = await strict(req);
    if (r.isAllowed || !r.isExceeded) return;
    reply.header("retry-after", r.ttlInSeconds);
    throw new AppError("rate_limited", `Too many attempts. Try again in ${r.ttlInSeconds}s.`);
  };
  const tags = ["auth"];
  const loginResponse = z.object({ token: z.string(), expires_at: z.string(), user: z.record(z.string()) });

  async function login(kind: SessionKind, body: z.infer<typeof loginBody>): Promise<z.infer<typeof loginResponse>> {
    const email = body.email.toLowerCase();
    const now = Date.now();

    if (kind === "admin") {
      const [u] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
      if (u?.lockedUntil && u.lockedUntil.getTime() > now) throw new AppError("rate_limited", "Too many failed attempts. Try again in a few minutes.");
      // Always spend a hash, even for unknown/disabled/not-yet-activated accounts, so timing does not reveal which exist.
      const usable = !!u && !!u.passwordHash && !u.disabledAt;
      const passwordOk = await verifyPassword(body.password, usable ? u.passwordHash! : await dummyPasswordHash());
      const fail = async (): Promise<never> => {
        if (u) {
          const attempts = u.failedAttempts + 1;
          const lock = attempts >= MAX_FAILED;
          await db
            .update(adminUsers)
            .set({ failedAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(now + LOCK_MS) : u.lockedUntil })
            .where(eq(adminUsers.id, u.id));
        }
        throw new AppError("unauthorized", GENERIC);
      };
      if (!u || !usable || !passwordOk) return fail();
      if (!config.ENCRYPTION_KEY || !u.totpSecretEncrypted) {
        throw new AppError("forbidden", "Two-factor is not set up for this account. Ask a colleague for a new invite link.");
      }
      if (!body.totp_code) throw new AppError("unauthorized", "Enter the 6-digit code from your authenticator app", { totp_required: true });
      const step = verifyTotp(decryptSecret(u.totpSecretEncrypted, config.ENCRYPTION_KEY), body.totp_code, now, u.totpLastStep);
      if (step === null) return fail();
      // Atomic replay guard: only one request can advance the step.
      const advanced = await db
        .update(adminUsers)
        .set({ totpLastStep: step, failedAttempts: 0, lockedUntil: null })
        .where(and(eq(adminUsers.id, u.id), or(isNull(adminUsers.totpLastStep), lt(adminUsers.totpLastStep, step))))
        .returning({ id: adminUsers.id });
      if (advanced.length === 0) return fail();
      const session = await createSession(db, "admin", u.id);
      return { token: session.token, expires_at: session.expiresAt.toISOString(), user: { id: u.id, email: u.email } };
    }

    const [u] = await db.select().from(merchantUsers).where(eq(merchantUsers.email, email)).limit(1);
    if (u?.lockedUntil && u.lockedUntil.getTime() > now) throw new AppError("rate_limited", "Too many failed attempts. Try again in a few minutes.");
    const usable = !!u && !!u.passwordHash && !u.disabledAt;
    const passwordOk = await verifyPassword(body.password, usable ? u.passwordHash! : await dummyPasswordHash());
    if (!u || !usable || !passwordOk) {
      if (u) {
        const attempts = u.failedAttempts + 1;
        const lock = attempts >= MAX_FAILED;
        await db
          .update(merchantUsers)
          .set({ failedAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(now + LOCK_MS) : u.lockedUntil })
          .where(eq(merchantUsers.id, u.id));
      }
      throw new AppError("unauthorized", GENERIC);
    }
    await db.update(merchantUsers).set({ failedAttempts: 0, lockedUntil: null }).where(eq(merchantUsers.id, u.id));
    const session = await createSession(db, "merchant", u.id);
    return { token: session.token, expires_at: session.expiresAt.toISOString(), user: { id: u.id, email: u.email, role: u.role, merchant_id: u.merchantId } };
  }

  for (const kind of ["merchant", "admin"] as const) {
    app.post(
      `/${kind}/login`,
      { preHandler: limit, schema: { tags, summary: `Sign in (${kind})`, body: loginBody, response: { 200: loginResponse } } },
      async (req) => login(kind, req.body),
    );
  }

  app.post("/logout", { schema: { tags, summary: "Sign out (revokes this session)" } }, async (req) => {
    const raw = bearer(req);
    if (!sessionKindOf(raw)) throw new AppError("unauthorized", "Not signed in");
    await revokeSession(db, raw);
    return { ok: true };
  });

  async function whoami(req: FastifyRequest) {
    const raw = bearer(req);
    const kind = sessionKindOf(raw);
    if (kind === "merchant") {
      const { session, user, merchant } = await resolveMerchantSession(db, raw);
      return { kind, id: user.id, email: user.email, role: user.role as string | null, merchant_id: merchant.id as string | null, merchant_name: merchant.displayName as string | null, expires_at: session.expiresAt.toISOString() };
    }
    if (kind === "admin") {
      const { session, user } = await resolveAdminSession(db, raw);
      return { kind, id: user.id, email: user.email, role: null, merchant_id: null, merchant_name: null, expires_at: session.expiresAt.toISOString() };
    }
    throw new AppError("unauthorized", "Not signed in");
  }
  app.get("/me", { schema: { tags, summary: "Who is signed in" } }, async (req) => whoami(req));

  app.post(
    "/password",
    { preHandler: limit, schema: { tags, summary: "Change your own password (signs out your other sessions)", body: z.object({ current_password: password, new_password: password }).strict() } },
    async (req) => {
      const me = await whoami(req);
      const [u] =
        me.kind === "admin"
          ? await db.select({ hash: adminUsers.passwordHash }).from(adminUsers).where(eq(adminUsers.id, me.id)).limit(1)
          : await db.select({ hash: merchantUsers.passwordHash }).from(merchantUsers).where(eq(merchantUsers.id, me.id)).limit(1);
      if (!u?.hash || !(await verifyPassword(req.body.current_password, u.hash))) throw new AppError("forbidden", "Current password is incorrect");
      const problem = passwordProblem(req.body.new_password, { email: me.email });
      if (problem) throw new AppError("invalid_request", problem);
      const hash = await hashPassword(req.body.new_password);
      const current = hashToken(bearer(req));
      await db.transaction(async (tx) => {
        if (me.kind === "admin") await tx.update(adminUsers).set({ passwordHash: hash }).where(eq(adminUsers.id, me.id));
        else await tx.update(merchantUsers).set({ passwordHash: hash }).where(eq(merchantUsers.id, me.id));
        await tx
          .update(authSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(authSessions.kind, me.kind), eq(authSessions.userId, me.id), isNull(authSessions.revokedAt), sql`${authSessions.tokenHash} <> ${current}`));
      });
      return { ok: true };
    },
  );

  // ---- invites / resets (public, authenticated by the one-time token)
  const invalid = () => new AppError("not_found", "This link is invalid, expired or already used. Ask for a new one.");
  async function loadInvite(raw: string) {
    if (!isInviteToken(raw)) throw invalid();
    const [inv] = await db
      .select()
      .from(authInvites)
      .where(and(eq(authInvites.tokenHash, hashToken(raw)), isNull(authInvites.usedAt), gt(authInvites.expiresAt, new Date())))
      .limit(1);
    if (!inv) throw invalid();
    const [u] =
      inv.kind === "admin"
        ? await db.select({ email: adminUsers.email, disabledAt: adminUsers.disabledAt }).from(adminUsers).where(eq(adminUsers.id, inv.userId)).limit(1)
        : await db.select({ email: merchantUsers.email, disabledAt: merchantUsers.disabledAt }).from(merchantUsers).where(eq(merchantUsers.id, inv.userId)).limit(1);
    if (!u || u.disabledAt) throw invalid();
    return { inv, email: u.email };
  }

  app.get("/invites/:token", { preHandler: limit, schema: { tags, summary: "Inspect an invite/reset link", params: tokenParam } }, async (req) => {
    const { inv, email } = await loadInvite(req.params.token);
    const secret = inv.totpSecretEncrypted && config.ENCRYPTION_KEY ? decryptSecret(inv.totpSecretEncrypted, config.ENCRYPTION_KEY) : null;
    return {
      kind: inv.kind,
      purpose: inv.purpose,
      email,
      expires_at: inv.expiresAt.toISOString(),
      totp: secret ? { secret, uri: totpUri(secret, email) } : null,
    };
  });

  app.post(
    "/invites/:token/accept",
    {
      preHandler: limit,
      schema: {
        tags,
        summary: "Set your password (and, for staff, confirm two-factor) using an invite/reset link",
        params: tokenParam,
        body: z.object({ password, totp_code: z.string().regex(/^\d{6}$/).optional() }).strict(),
      },
    },
    async (req) => {
      const { inv, email } = await loadInvite(req.params.token);
      const problem = passwordProblem(req.body.password, { email });
      if (problem) throw new AppError("invalid_request", problem);

      let totpStep: number | null = null;
      if (inv.kind === "admin") {
        if (!inv.totpSecretEncrypted || !config.ENCRYPTION_KEY) throw new AppError("not_configured", "Two-factor enrolment is unavailable");
        if (!req.body.totp_code) throw new AppError("invalid_request", "Enter the 6-digit code from your authenticator app to confirm setup");
        totpStep = verifyTotp(decryptSecret(inv.totpSecretEncrypted, config.ENCRYPTION_KEY), req.body.totp_code, Date.now());
        if (totpStep === null) throw new AppError("invalid_request", "That code is not correct. Check your authenticator app and try again.");
      }
      const hash = await hashPassword(req.body.password);

      await db.transaction(async (tx) => {
        // Claim the link atomically: two simultaneous accepts cannot both succeed.
        const claimed = await tx
          .update(authInvites)
          .set({ usedAt: new Date() })
          .where(and(eq(authInvites.id, inv.id), isNull(authInvites.usedAt), gt(authInvites.expiresAt, new Date())))
          .returning({ id: authInvites.id });
        if (claimed.length === 0) throw invalid();
        if (inv.kind === "admin") {
          await tx
            .update(adminUsers)
            .set({ passwordHash: hash, totpSecretEncrypted: inv.totpSecretEncrypted, totpLastStep: totpStep, failedAttempts: 0, lockedUntil: null })
            .where(eq(adminUsers.id, inv.userId));
        } else {
          await tx.update(merchantUsers).set({ passwordHash: hash, failedAttempts: 0, lockedUntil: null }).where(eq(merchantUsers.id, inv.userId));
        }
        await revokeUserSessions(tx, inv.kind, inv.userId);
      });
      return { ok: true };
    },
  );
};
