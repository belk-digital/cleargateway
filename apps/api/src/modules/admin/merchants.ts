import {
  apiKeys,
  merchants,
  newId,
  onrampRouting,
  recordAdminAudit,
  type Db,
} from "@belk/db";
import { ONRAMP_PROVIDER_NAMES } from "@belk/onramp";
import { AppError, MAX_FEE_BPS, generateApiKey } from "@belk/shared";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminOf } from "../../auth/admin-auth.js";
import { evmAddress, paginationQuery } from "../../lib/zod-common.js";
import { merchantView, toMerchantView } from "./views.js";

interface Opts {
  db: Db;
}

const merchantId = z.object({ id: z.string().regex(/^mer_[0-9a-f]{32}$/) }).strict();
const branding = z
  .object({ logo_url: z.string().url().max(2048).optional(), primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })
  .strict();

const createBody = z
  .object({
    legal_name: z.string().min(1).max(200),
    display_name: z.string().min(1).max(100),
    payout_wallet_address: evmAddress,
    fee_bps: z.number().int().min(0).max(MAX_FEE_BPS),
    branding: branding.optional(),
  })
  .strict();

const patchBody = z
  .object({
    legal_name: z.string().min(1).max(200).optional(),
    display_name: z.string().min(1).max(100).optional(),
    payout_wallet_address: evmAddress.optional(),
    branding: branding.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "provide at least one field to change");

const listQuery = z.object({ ...paginationQuery, status: z.enum(["pending_kyb", "active", "suspended"]).optional() }).strict();
const feeBody = z.object({ fee_bps: z.number().int().min(0).max(MAX_FEE_BPS) }).strict();
const noteBody = z.object({ note: z.string().max(1000).optional() }).strict();
const apiKeyBody = z.object({ mode: z.enum(["test", "live"]) }).strict();
const keyParams = z.object({ id: z.string().regex(/^mer_[0-9a-f]{32}$/), keyId: z.string().regex(/^key_[0-9a-f]{32}$/) }).strict();
const routingBody = z
  .object({
    providers: z
      .array(z.object({ provider: z.enum(ONRAMP_PROVIDER_NAMES), priority: z.number().int().min(0).max(1000).default(0), enabled: z.boolean().default(true) }).strict())
      .max(ONRAMP_PROVIDER_NAMES.length)
      .refine((rows) => new Set(rows.map((r) => r.provider)).size === rows.length, "each provider may appear once"),
  })
  .strict();

const apiKeyView = z.object({
  id: z.string(),
  object: z.literal("api_key"),
  merchant_id: z.string(),
  mode: z.enum(["test", "live"]),
  prefix: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
const toKeyView = (k: typeof apiKeys.$inferSelect): z.infer<typeof apiKeyView> => ({
  id: k.id,
  object: "api_key",
  merchant_id: k.merchantId,
  mode: k.mode,
  prefix: k.prefix,
  last_used_at: k.lastUsedAt?.toISOString() ?? null,
  revoked_at: k.revokedAt?.toISOString() ?? null,
  created_at: k.createdAt.toISOString(),
});

const security = [{ adminAuth: [] }];
const tags = ["internal: merchants"];

export const adminMerchantRoutes: FastifyPluginAsync<Opts> = async (instance, { db }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const load = async (id: string) => {
    const [m] = await db.select().from(merchants).where(eq(merchants.id, id)).limit(1);
    if (!m) throw new AppError("not_found", "Merchant not found");
    return m;
  };

  app.post(
    "/merchants",
    {
      schema: {
        tags,
        summary: "Create a merchant (starts as pending_kyb: cannot take payments until KYB is approved)",
        description: "Not idempotency-keyed (staff action, low volume): a retried request creates a second merchant, visible in the list.",
        security,
        body: createBody,
        response: { 201: merchantView },
      },
    },
    async (req, reply) => {
      const admin = adminOf(req);
      const b = req.body;
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(merchants)
          .values({
            id: newId("mer"),
            legalName: b.legal_name,
            displayName: b.display_name,
            payoutWalletAddress: b.payout_wallet_address,
            feeBps: b.fee_bps,
            branding: b.branding ?? {},
          })
          .returning();
        if (!created) throw new Error("failed to insert merchant");
        await recordAdminAudit(tx, {
          adminId: admin.id,
          action: "merchant.create",
          targetType: "merchant",
          targetId: created.id,
          data: { legal_name: b.legal_name, payout_wallet_address: b.payout_wallet_address, fee_bps: b.fee_bps },
        });
        return created;
      });
      return reply.status(201).send(toMerchantView(row));
    },
  );

  app.get(
    "/merchants",
    {
      schema: {
        tags,
        summary: "List merchants (newest first, cursor pagination)",
        security,
        querystring: listQuery,
        response: { 200: z.object({ object: z.literal("list"), data: z.array(merchantView), has_more: z.boolean(), next_cursor: z.string().nullable() }) },
      },
    },
    async (req) => {
      const q = req.query;
      const conds: SQL[] = [];
      if (q.status) conds.push(eq(merchants.status, q.status));
      if (q.starting_after) {
        await load(q.starting_after).catch(() => {
          throw new AppError("invalid_request", "starting_after does not refer to a merchant");
        });
        conds.push(sql`(${merchants.createdAt}, ${merchants.id}) < (select created_at, id from merchants where id = ${q.starting_after})`);
      }
      const rows = await db
        .select()
        .from(merchants)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(merchants.createdAt), desc(merchants.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const hasMore = rows.length > q.limit;
      return { object: "list" as const, data: page.map(toMerchantView), has_more: hasMore, next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null };
    },
  );

  app.get("/merchants/:id", { schema: { tags, summary: "Retrieve a merchant", security, params: merchantId, response: { 200: merchantView } } }, async (req) =>
    toMerchantView(await load(req.params.id)),
  );

  app.patch(
    "/merchants/:id",
    {
      schema: {
        tags,
        summary: "Update profile fields, including the payout wallet",
        description:
          "SENSITIVE: changing `payout_wallet_address` redirects where future payments (and deposit-address sweeps) pay out. " +
          "It applies to new signatures only, is audited with before/after values, and should get a second person's approval before production.",
        security,
        params: merchantId,
        body: patchBody,
        response: { 200: merchantView },
      },
    },
    async (req) => {
      const admin = adminOf(req);
      const b = req.body;
      return db.transaction(async (tx) => {
        const [before] = await tx.select().from(merchants).where(eq(merchants.id, req.params.id)).for("update");
        if (!before) throw new AppError("not_found", "Merchant not found");
        const patch = {
          ...(b.legal_name !== undefined ? { legalName: b.legal_name } : {}),
          ...(b.display_name !== undefined ? { displayName: b.display_name } : {}),
          ...(b.payout_wallet_address !== undefined ? { payoutWalletAddress: b.payout_wallet_address } : {}),
          ...(b.branding !== undefined ? { branding: b.branding } : {}),
        };
        const [after] = await tx.update(merchants).set({ ...patch, updatedAt: new Date() }).where(eq(merchants.id, before.id)).returning();
        if (!after) throw new Error("failed to update merchant");
        await recordAdminAudit(tx, {
          adminId: admin.id,
          action: "merchant.update",
          targetType: "merchant",
          targetId: before.id,
          data: {
            changed: Object.keys(b),
            ...(b.payout_wallet_address !== undefined ? { payout_wallet_before: before.payoutWalletAddress, payout_wallet_after: after.payoutWalletAddress } : {}),
          },
        });
        return toMerchantView(after);
      });
    },
  );

  // ---- KYB / lifecycle. Each transition is idempotent: repeating it returns the current state without a second audit line.
  const transition = (
    path: string,
    summary: string,
    action: string,
    decide: (m: typeof merchants.$inferSelect) => { status?: "pending_kyb" | "active" | "suspended"; kybStatus?: "approved" | "rejected" } | "noop",
  ) =>
    app.post(
      path,
      { schema: { tags, summary, security, params: merchantId, body: noteBody.nullish(), response: { 200: merchantView } } },
      async (req) => {
        const admin = adminOf(req);
        return db.transaction(async (tx) => {
          const [m] = await tx.select().from(merchants).where(eq(merchants.id, req.params.id)).for("update");
          if (!m) throw new AppError("not_found", "Merchant not found");
          const change = decide(m);
          if (change === "noop") return toMerchantView(m);
          const [after] = await tx
            .update(merchants)
            .set({ ...(change.status ? { status: change.status } : {}), ...(change.kybStatus ? { kybStatus: change.kybStatus } : {}), updatedAt: new Date() })
            .where(eq(merchants.id, m.id))
            .returning();
          if (!after) throw new Error("failed to update merchant");
          await recordAdminAudit(tx, {
            adminId: admin.id,
            action,
            targetType: "merchant",
            targetId: m.id,
            data: { from: { status: m.status, kyb_status: m.kybStatus }, to: { status: after.status, kyb_status: after.kybStatus }, note: req.body?.note ?? null },
          });
          return toMerchantView(after);
        });
      },
    );

  transition("/merchants/:id/approve-kyb", "Approve KYB and activate the merchant", "merchant.approve_kyb", (m) => {
    if (m.status === "active" && m.kybStatus === "approved") return "noop";
    if (m.status === "suspended") throw new AppError("invalid_state_transition", "Merchant is suspended: reinstate it instead");
    return { status: "active", kybStatus: "approved" };
  });
  transition("/merchants/:id/reject-kyb", "Reject KYB (an active merchant is also suspended)", "merchant.reject_kyb", (m) => {
    if (m.kybStatus === "rejected") return "noop";
    return { kybStatus: "rejected", ...(m.status === "active" ? { status: "suspended" as const } : {}) };
  });
  transition("/merchants/:id/suspend", "Suspend a merchant: its API keys stop working immediately", "merchant.suspend", (m) => {
    if (m.status === "suspended") return "noop";
    return { status: "suspended" };
  });
  transition("/merchants/:id/reinstate", "Reinstate a suspended merchant (requires approved KYB)", "merchant.reinstate", (m) => {
    if (m.status === "active") return "noop";
    if (m.status !== "suspended") throw new AppError("invalid_state_transition", "Only a suspended merchant can be reinstated");
    if (m.kybStatus !== "approved") throw new AppError("invalid_state_transition", "KYB is not approved: approve it instead");
    return { status: "active" };
  });

  app.patch(
    "/merchants/:id/fee",
    {
      schema: {
        tags,
        summary: "Set the merchant's fee in basis points (0-1000)",
        description: "Applies to payment intents created AFTER this call; existing intents keep the fee snapshotted at creation.",
        security,
        params: merchantId,
        body: feeBody,
        response: { 200: merchantView },
      },
    },
    async (req) => {
      const admin = adminOf(req);
      return db.transaction(async (tx) => {
        const [m] = await tx.select().from(merchants).where(eq(merchants.id, req.params.id)).for("update");
        if (!m) throw new AppError("not_found", "Merchant not found");
        if (m.feeBps === req.body.fee_bps) return toMerchantView(m);
        const [after] = await tx.update(merchants).set({ feeBps: req.body.fee_bps, updatedAt: new Date() }).where(eq(merchants.id, m.id)).returning();
        if (!after) throw new Error("failed to update merchant");
        await recordAdminAudit(tx, { adminId: admin.id, action: "merchant.set_fee", targetType: "merchant", targetId: m.id, data: { fee_bps_before: m.feeBps, fee_bps_after: after.feeBps } });
        return toMerchantView(after);
      });
    },
  );

  // ---- API keys. The raw key exists only in the create response; only its hash is stored, and it is never logged.
  app.post(
    "/merchants/:id/api-keys",
    {
      schema: {
        tags,
        summary: "Create an API key. The raw key is returned ONCE and cannot be retrieved again.",
        description: "Live keys can be created but are rejected at authentication while the platform is testnet-only.",
        security,
        params: merchantId,
        body: apiKeyBody,
        response: { 201: apiKeyView.extend({ key: z.string() }) },
      },
    },
    async (req, reply) => {
      const admin = adminOf(req);
      await load(req.params.id);
      const generated = generateApiKey(req.body.mode);
      const row = await db.transaction(async (tx) => {
        const [k] = await tx
          .insert(apiKeys)
          .values({ id: newId("key"), merchantId: req.params.id, mode: req.body.mode, prefix: generated.prefix, keyHash: generated.hash })
          .returning();
        if (!k) throw new Error("failed to insert api key");
        await recordAdminAudit(tx, {
          adminId: admin.id,
          action: "api_key.create",
          targetType: "merchant",
          targetId: req.params.id,
          data: { key_id: k.id, mode: k.mode, prefix: k.prefix }, // never the raw key or its hash
        });
        return k;
      });
      return reply.status(201).send({ ...toKeyView(row), key: generated.raw });
    },
  );

  app.get(
    "/merchants/:id/api-keys",
    {
      schema: { tags, summary: "List a merchant's API keys (prefix and status only; never the key or its hash)", security, params: merchantId, response: { 200: z.object({ object: z.literal("list"), data: z.array(apiKeyView) }) } },
    },
    async (req) => {
      await load(req.params.id);
      const rows = await db.select().from(apiKeys).where(eq(apiKeys.merchantId, req.params.id)).orderBy(desc(apiKeys.createdAt));
      return { object: "list" as const, data: rows.map(toKeyView) };
    },
  );

  app.delete(
    "/merchants/:id/api-keys/:keyId",
    { schema: { tags, summary: "Revoke an API key (takes effect immediately; idempotent)", security, params: keyParams, response: { 200: apiKeyView } } },
    async (req) => {
      const admin = adminOf(req);
      return db.transaction(async (tx) => {
        const [k] = await tx
          .select()
          .from(apiKeys)
          .where(and(eq(apiKeys.id, req.params.keyId), eq(apiKeys.merchantId, req.params.id)))
          .for("update");
        if (!k) throw new AppError("not_found", "API key not found");
        if (k.revokedAt) return toKeyView(k);
        const [after] = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, k.id)).returning();
        if (!after) throw new Error("failed to revoke api key");
        await recordAdminAudit(tx, { adminId: admin.id, action: "api_key.revoke", targetType: "merchant", targetId: k.merchantId, data: { key_id: k.id, prefix: k.prefix } });
        return toKeyView(after);
      });
    },
  );

  // ---- On-ramp routing (which provider a merchant's card checkout uses, in priority order).
  app.put(
    "/merchants/:id/onramp-routing",
    {
      schema: {
        tags,
        summary: "Replace the merchant's on-ramp provider routing",
        description: "Highest `priority` wins; disabled rows are skipped. An empty list disables card checkout for the merchant.",
        security,
        params: merchantId,
        body: routingBody,
        response: { 200: z.object({ object: z.literal("list"), data: z.array(z.object({ provider: z.string(), priority: z.number(), enabled: z.boolean() })) }) },
      },
    },
    async (req) => {
      const admin = adminOf(req);
      return db.transaction(async (tx) => {
        const [m] = await tx.select().from(merchants).where(eq(merchants.id, req.params.id)).for("update");
        if (!m) throw new AppError("not_found", "Merchant not found");
        const before = await tx.select().from(onrampRouting).where(eq(onrampRouting.merchantId, m.id));
        await tx.delete(onrampRouting).where(eq(onrampRouting.merchantId, m.id));
        const rows = req.body.providers.length
          ? await tx
              .insert(onrampRouting)
              .values(req.body.providers.map((p) => ({ id: newId("ors"), merchantId: m.id, provider: p.provider, priority: p.priority, enabled: p.enabled })))
              .returning()
          : [];
        await recordAdminAudit(tx, {
          adminId: admin.id,
          action: "merchant.set_onramp_routing",
          targetType: "merchant",
          targetId: m.id,
          data: {
            before: before.map((r) => ({ provider: r.provider, priority: r.priority, enabled: r.enabled })),
            after: rows.map((r) => ({ provider: r.provider, priority: r.priority, enabled: r.enabled })),
          },
        });
        return { object: "list" as const, data: rows.map((r) => ({ provider: r.provider, priority: r.priority, enabled: r.enabled })) };
      });
    },
  );
};
