import { adminUsers, createInvite, merchantUsers, merchants, newId, recordAdminAudit, revokeUserSessions, type Db } from "@belk/db";
import { AppError } from "@belk/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminOf } from "../../auth/admin-auth.js";
import type { Config } from "../../config.js";

interface Opts {
  db: Db;
  config: Config;
}

const security = [{ adminAuth: [] }];
const email = z.string().email().max(320).transform((v) => v.toLowerCase());
const ROLES = ["owner", "admin", "developer", "viewer"] as const;
const idOf = (prefix: string) => z.object({ id: z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`)) }).strict();

const inviteView = z.object({ token: z.string(), expires_at: z.string(), totp_setup: z.boolean() });
const staffView = z.object({
  id: z.string(),
  email: z.string(),
  status: z.enum(["invited", "active", "disabled"]),
  two_factor: z.boolean(),
  created_at: z.string(),
});
const merchantUserView = z.object({
  id: z.string(),
  merchant_id: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  status: z.enum(["invited", "active", "disabled"]),
  created_at: z.string(),
});

const statusOf = (u: { passwordHash: string | null; disabledAt: Date | null }) => (u.disabledAt ? "disabled" : u.passwordHash ? "active" : "invited");
const toStaff = (u: typeof adminUsers.$inferSelect): z.infer<typeof staffView> => ({
  id: u.id,
  email: u.email,
  status: statusOf(u),
  two_factor: !!u.totpSecretEncrypted,
  created_at: u.createdAt.toISOString(),
});
const toMerchantUser = (u: typeof merchantUsers.$inferSelect): z.infer<typeof merchantUserView> => ({
  id: u.id,
  merchant_id: u.merchantId,
  email: u.email,
  role: u.role,
  status: statusOf(u),
  created_at: u.createdAt.toISOString(),
});

/**
 * Staff and merchant-user account management. There is no email service yet, so an invite is a one-time link token
 * shown to the inviter once; they deliver it. Tokens are never written to the audit log.
 */
export const adminUserRoutes: FastifyPluginAsync<Opts> = async (instance, { db, config }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const tagStaff = ["internal: staff"];
  const tagUsers = ["internal: merchant users"];

  const requireKey = () => {
    if (!config.ENCRYPTION_KEY) throw new AppError("not_configured", "ENCRYPTION_KEY is required to enrol staff two-factor");
    return config.ENCRYPTION_KEY;
  };
  const inviteOut = (i: { token: string; expiresAt: Date; totpSecret: string | null }) => ({ token: i.token, expires_at: i.expiresAt.toISOString(), totp_setup: i.totpSecret !== null });

  // ------------------------------------------------------------------------------------------------ staff
  app.get("/staff", { schema: { tags: tagStaff, summary: "List staff accounts", security, response: { 200: z.object({ object: z.literal("list"), data: z.array(staffView) }) } } }, async () => {
    const rows = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
    return { object: "list" as const, data: rows.map(toStaff) };
  });

  app.post(
    "/staff",
    { schema: { tags: tagStaff, summary: "Invite a staff member", security, body: z.object({ email }).strict(), response: { 201: z.object({ user: staffView, invite: inviteView }) } } },
    async (req, reply) => {
      const admin = adminOf(req);
      const key = requireKey();
      const out = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(adminUsers).where(eq(adminUsers.email, req.body.email)).limit(1);
        if (existing) throw new AppError("conflict", "A staff account with this email already exists");
        const [u] = await tx.insert(adminUsers).values({ id: newId("adm"), email: req.body.email }).returning();
        if (!u) throw new Error("failed to create staff");
        const invite = await createInvite(tx, { kind: "admin", userId: u.id, purpose: "invite", createdBy: admin.id, encryptionKey: key });
        await recordAdminAudit(tx, { adminId: admin.id, action: "staff.invite", targetType: "staff", targetId: u.id, data: { email: u.email } });
        return { user: toStaff(u), invite: inviteOut(invite) };
      });
      return reply.status(201).send(out);
    },
  );

  const staffAction = (path: "reset" | "disable" | "enable", summary: string) =>
    app.post(
      `/staff/:id/${path}`,
      { schema: { tags: tagStaff, summary, security, params: idOf("adm"), response: { 200: z.object({ user: staffView, invite: inviteView.optional() }) } } },
      async (req) => {
        const admin = adminOf(req);
        return db.transaction(async (tx) => {
          const [u] = await tx.select().from(adminUsers).where(eq(adminUsers.id, req.params.id)).for("update");
          if (!u) throw new AppError("not_found", "Staff account not found");
          if (u.id === admin.id && path !== "reset") throw new AppError("invalid_state_transition", "You cannot disable your own account");
          if (path === "reset") {
            // Lost password or phone: wipe the credentials now (so a stolen password stops working) and issue a fresh link.
            const [after] = await tx.update(adminUsers).set({ passwordHash: null, totpSecretEncrypted: null, totpLastStep: null, failedAttempts: 0, lockedUntil: null }).where(eq(adminUsers.id, u.id)).returning();
            await revokeUserSessions(tx, "admin", u.id);
            const invite = await createInvite(tx, { kind: "admin", userId: u.id, purpose: "reset", createdBy: admin.id, encryptionKey: requireKey() });
            await recordAdminAudit(tx, { adminId: admin.id, action: "staff.reset", targetType: "staff", targetId: u.id });
            return { user: toStaff(after ?? u), invite: inviteOut(invite) };
          }
          const disabling = path === "disable";
          if (disabling === !!u.disabledAt) return { user: toStaff(u) }; // already in that state: idempotent, no second audit line
          const [after] = await tx.update(adminUsers).set({ disabledAt: disabling ? new Date() : null }).where(eq(adminUsers.id, u.id)).returning();
          if (disabling) await revokeUserSessions(tx, "admin", u.id);
          await recordAdminAudit(tx, { adminId: admin.id, action: `staff.${path}`, targetType: "staff", targetId: u.id });
          return { user: toStaff(after ?? u) };
        });
      },
    );
  staffAction("reset", "Reset a staff member's password and two-factor (issues a new one-time link)");
  staffAction("disable", "Disable a staff account and end its sessions");
  staffAction("enable", "Re-enable a staff account");

  // ------------------------------------------------------------------------------------------------ merchant users
  app.get(
    "/merchants/:id/users",
    { schema: { tags: tagUsers, summary: "List a merchant's dashboard users", security, params: idOf("mer"), response: { 200: z.object({ object: z.literal("list"), data: z.array(merchantUserView) }) } } },
    async (req) => {
      const rows = await db.select().from(merchantUsers).where(eq(merchantUsers.merchantId, req.params.id)).orderBy(asc(merchantUsers.createdAt));
      return { object: "list" as const, data: rows.map(toMerchantUser) };
    },
  );

  app.post(
    "/merchants/:id/users",
    {
      schema: {
        tags: tagUsers,
        summary: "Invite a dashboard user for a merchant",
        description: "Roles: owner, admin, developer (full access) and viewer (read-only).",
        security,
        params: idOf("mer"),
        body: z.object({ email, role: z.enum(ROLES) }).strict(),
        response: { 201: z.object({ user: merchantUserView, invite: inviteView }) },
      },
    },
    async (req, reply) => {
      const admin = adminOf(req);
      const out = await db.transaction(async (tx) => {
        const [m] = await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, req.params.id)).limit(1);
        if (!m) throw new AppError("not_found", "Merchant not found");
        const [existing] = await tx.select().from(merchantUsers).where(eq(merchantUsers.email, req.body.email)).limit(1);
        if (existing) throw new AppError("conflict", "A dashboard user with this email already exists");
        const [u] = await tx.insert(merchantUsers).values({ id: newId("mus"), merchantId: m.id, email: req.body.email, role: req.body.role }).returning();
        if (!u) throw new Error("failed to create user");
        const invite = await createInvite(tx, { kind: "merchant", userId: u.id, purpose: "invite", createdBy: admin.id });
        await recordAdminAudit(tx, { adminId: admin.id, action: "merchant_user.invite", targetType: "merchant_user", targetId: u.id, data: { merchant_id: m.id, email: u.email, role: u.role } });
        return { user: toMerchantUser(u), invite: inviteOut(invite) };
      });
      return reply.status(201).send(out);
    },
  );

  app.patch(
    "/merchant-users/:id",
    { schema: { tags: tagUsers, summary: "Change a dashboard user's role", security, params: idOf("mus"), body: z.object({ role: z.enum(ROLES) }).strict(), response: { 200: merchantUserView } } },
    async (req) => {
      const admin = adminOf(req);
      return db.transaction(async (tx) => {
        const [u] = await tx.select().from(merchantUsers).where(eq(merchantUsers.id, req.params.id)).for("update");
        if (!u) throw new AppError("not_found", "User not found");
        if (u.role === req.body.role) return toMerchantUser(u);
        const [after] = await tx.update(merchantUsers).set({ role: req.body.role }).where(eq(merchantUsers.id, u.id)).returning();
        await recordAdminAudit(tx, { adminId: admin.id, action: "merchant_user.set_role", targetType: "merchant_user", targetId: u.id, data: { from: u.role, to: req.body.role } });
        return toMerchantUser(after ?? u);
      });
    },
  );

  const userAction = (path: "reset" | "disable" | "enable", summary: string) =>
    app.post(
      `/merchant-users/:id/${path}`,
      { schema: { tags: tagUsers, summary, security, params: idOf("mus"), response: { 200: z.object({ user: merchantUserView, invite: inviteView.optional() }) } } },
      async (req) => {
        const admin = adminOf(req);
        return db.transaction(async (tx) => {
          const [u] = await tx.select().from(merchantUsers).where(eq(merchantUsers.id, req.params.id)).for("update");
          if (!u) throw new AppError("not_found", "User not found");
          if (path === "reset") {
            const [after] = await tx.update(merchantUsers).set({ passwordHash: null, failedAttempts: 0, lockedUntil: null }).where(eq(merchantUsers.id, u.id)).returning();
            await revokeUserSessions(tx, "merchant", u.id);
            const invite = await createInvite(tx, { kind: "merchant", userId: u.id, purpose: "reset", createdBy: admin.id });
            await recordAdminAudit(tx, { adminId: admin.id, action: "merchant_user.reset", targetType: "merchant_user", targetId: u.id });
            return { user: toMerchantUser(after ?? u), invite: inviteOut(invite) };
          }
          const disabling = path === "disable";
          if (disabling === !!u.disabledAt) return { user: toMerchantUser(u) };
          const [after] = await tx.update(merchantUsers).set({ disabledAt: disabling ? new Date() : null }).where(and(eq(merchantUsers.id, u.id))).returning();
          if (disabling) await revokeUserSessions(tx, "merchant", u.id);
          await recordAdminAudit(tx, { adminId: admin.id, action: `merchant_user.${path}`, targetType: "merchant_user", targetId: u.id });
          return { user: toMerchantUser(after ?? u) };
        });
      },
    );
  userAction("reset", "Reset a dashboard user's password (issues a new one-time link)");
  userAction("disable", "Disable a dashboard user and end their sessions");
  userAction("enable", "Re-enable a dashboard user");
};
