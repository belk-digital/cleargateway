import {
  PAYMENT_STATUSES,
  depositAddresses,
  paymentIntents,
  recordAdminAudit,
  recordIntentEvent,
  type Db,
} from "@belk/db";
import { AppError } from "@belk/shared";
import { and, desc, eq, gte, inArray, like, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminOf } from "../../auth/admin-auth.js";
import { paginationQuery } from "../../lib/zod-common.js";
import { REASON_GROUPS, REVIEW_CATEGORIES, adminIntentView, toAdminIntentView, type ReviewCategory } from "./views.js";

interface Opts {
  db: Db;
}

const intentId = z.string().regex(/^pi_[0-9a-f]{32}$/);
const security = [{ adminAuth: [] }];
const listResponse = z.object({ object: z.literal("list"), data: z.array(adminIntentView), has_more: z.boolean(), next_cursor: z.string().nullable() });

const searchQuery = z
  .object({
    ...paginationQuery,
    id: intentId.optional(),
    merchant_id: z.string().max(100).optional(),
    merchant_order_id: z.string().max(255).optional(),
    status: z.enum(PAYMENT_STATUSES).optional(),
    mode: z.enum(["test", "live"]).optional(),
    needs_review: z.enum(["true", "false"]).optional(),
    tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    created_gte: z.string().datetime().optional(),
    created_lte: z.string().datetime().optional(),
  })
  .strict();

const reviewQuery = z.object({ ...paginationQuery, category: z.enum(REVIEW_CATEGORIES).optional() }).strict();

const resolveBody = z
  .object({
    resolution: z.enum(["acknowledged", "refund_recorded", "refunded_externally", "no_action_needed", "escalated"]),
    note: z.string().min(1).max(1000),
  })
  .strict();

/** SQL predicate for each review category, mirroring `categoryOf` so filtering and labelling never disagree. */
function categoryPredicate(cat: ReviewCategory): SQL {
  // coalesce: a NULL reason must not turn `not (reason in (...))` into NULL and silently drop the row.
  const reason = sql`coalesce(${paymentIntents.reviewReason}, '')`;
  const stuck = inArray(reason, REASON_GROUPS.STUCK);
  const mismatch = inArray(reason, REASON_GROUPS.MISMATCH);
  const overpaid = inArray(reason, REASON_GROUPS.OVERPAID);
  const late = or(like(reason, "late\\_payment\\_%"), like(reason, "late\\_deposit\\_%")) as SQL;
  const underpaid = eq(paymentIntents.status, "underpaid");
  switch (cat) {
    case "stuck_deposit":
      return stuck;
    case "chain_mismatch":
      return mismatch;
    case "overpaid":
      return overpaid;
    case "late_payment":
      return late;
    case "underpaid":
      return and(underpaid, sql`not (${stuck}) and not (${mismatch}) and not (${overpaid}) and not (${late})`) as SQL;
    case "other":
      return and(
        eq(paymentIntents.needsReview, true),
        ne(paymentIntents.status, "underpaid"),
        sql`(not (${stuck}) and not (${mismatch}) and not (${overpaid}) and not (${late}))`,
      ) as SQL;
  }
}

export const adminPaymentRoutes: FastifyPluginAsync<Opts> = async (instance, { db }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  /** Attaches deposit-address progress to a page of intents with one extra query (no N+1). */
  async function present(rows: (typeof paymentIntents.$inferSelect)[]) {
    const withDeposit = rows.filter((r) => r.depositAddress).map((r) => r.id);
    const deps = withDeposit.length ? await db.select().from(depositAddresses).where(inArray(depositAddresses.intentId, withDeposit)) : [];
    const byIntent = new Map(deps.map((d) => [d.intentId, d]));
    return rows.map((r) => toAdminIntentView(r, byIntent.get(r.id)));
  }

  async function page(conds: SQL[], q: { limit: number; starting_after?: string | undefined }) {
    const where = [...conds];
    if (q.starting_after) {
      const [cursor] = await db.select({ id: paymentIntents.id }).from(paymentIntents).where(eq(paymentIntents.id, q.starting_after)).limit(1);
      if (!cursor) throw new AppError("invalid_request", "starting_after does not refer to a payment intent");
      // Compared in SQL so microsecond timestamps are never truncated by JS Dates.
      where.push(sql`(${paymentIntents.createdAt}, ${paymentIntents.id}) < (select created_at, id from payment_intents where id = ${q.starting_after})`);
    }
    const rows = await db
      .select()
      .from(paymentIntents)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(paymentIntents.createdAt), desc(paymentIntents.id))
      .limit(q.limit + 1);
    const slice = rows.slice(0, q.limit);
    const hasMore = rows.length > q.limit;
    return { object: "list" as const, data: await present(slice), has_more: hasMore, next_cursor: hasMore ? (slice.at(-1)?.id ?? null) : null };
  }

  app.get(
    "/payment_intents",
    { schema: { tags: ["internal: payments"], summary: "Search payments across all merchants", security, querystring: searchQuery, response: { 200: listResponse } } },
    async (req) => {
      const q = req.query;
      const conds: SQL[] = [];
      if (q.id) conds.push(eq(paymentIntents.id, q.id));
      if (q.merchant_id) conds.push(eq(paymentIntents.merchantId, q.merchant_id));
      if (q.merchant_order_id) conds.push(eq(paymentIntents.merchantOrderId, q.merchant_order_id));
      if (q.status) conds.push(eq(paymentIntents.status, q.status));
      if (q.mode) conds.push(eq(paymentIntents.mode, q.mode));
      if (q.needs_review) conds.push(eq(paymentIntents.needsReview, q.needs_review === "true"));
      if (q.tx_hash) conds.push(eq(paymentIntents.txHash, q.tx_hash.toLowerCase()));
      if (q.created_gte) conds.push(gte(paymentIntents.createdAt, new Date(q.created_gte)));
      if (q.created_lte) conds.push(lte(paymentIntents.createdAt, new Date(q.created_lte)));
      return page(conds, q);
    },
  );

  app.get(
    "/payment_intents/:id",
    {
      schema: {
        tags: ["internal: payments"],
        summary: "One payment with its full audit trail",
        security,
        params: z.object({ id: intentId }).strict(),
        response: {
          200: z.object({
            payment_intent: adminIntentView,
            events: z.array(z.object({ id: z.string(), from_status: z.string().nullable(), to_status: z.string(), reason: z.string().nullable(), actor: z.string(), data: z.record(z.unknown()), created_at: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      const [row] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, req.params.id)).limit(1);
      if (!row) throw new AppError("not_found", "Payment intent not found");
      const events = await db.execute<{ id: string; from_status: string | null; to_status: string; reason: string | null; actor: string; data: Record<string, unknown>; created_at: Date }>(
        sql`select id, from_status, to_status, reason, actor, data, created_at from payment_events where intent_id = ${row.id} order by created_at, id`,
      );
      const [view] = await present([row]);
      return { payment_intent: view as NonNullable<typeof view>, events: [...events].map((e) => ({ ...e, created_at: new Date(e.created_at).toISOString() })) };
    },
  );

  app.get(
    "/review-queue",
    {
      schema: {
        tags: ["internal: review"],
        summary: "Payments needing a human: late, underpaid, overpaid, stuck deposits, chain mismatches",
        description:
          "Contains every payment flagged `needs_review` plus every payment currently `underpaid`. Items with `requires_review: true` " +
          "can be resolved; an `underpaid` item leaves the queue by itself when it is paid up or expires.",
        security,
        querystring: reviewQuery,
        response: { 200: listResponse },
      },
    },
    async (req) => {
      const base = or(eq(paymentIntents.needsReview, true), eq(paymentIntents.status, "underpaid")) as SQL;
      const conds = [base];
      if (req.query.category) conds.push(categoryPredicate(req.query.category));
      return page(conds, req.query);
    },
  );

  app.post(
    "/review-queue/:intentId/resolve",
    {
      schema: {
        tags: ["internal: review"],
        summary: "Mark a flagged payment as handled",
        description:
          "Clears the review flag and records who resolved it and why (audit trail + admin audit log). It NEVER changes the payment's " +
          "status or moves money: refunds and rescues are separate, deliberate actions.",
        security,
        params: z.object({ intentId }).strict(),
        body: resolveBody,
        response: { 200: adminIntentView },
      },
    },
    async (req) => {
      const admin = adminOf(req);
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, req.params.intentId)).for("update");
        if (!row) throw new AppError("not_found", "Payment intent not found");
        if (!row.needsReview) throw new AppError("conflict", "This payment is not flagged for review");
        const result = await recordIntentEvent(tx, {
          intentId: row.id,
          actor: admin.actor,
          reason: "review_resolved",
          data: { resolution: req.body.resolution, note: req.body.note, previous_reason: row.reviewReason },
          patch: { needsReview: false, reviewReason: null },
        });
        await recordAdminAudit(tx, {
          adminId: admin.id,
          action: "review.resolve",
          targetType: "payment_intent",
          targetId: row.id,
          data: { resolution: req.body.resolution, note: req.body.note, previous_reason: row.reviewReason },
        });
        return result;
      });
      const [view] = await present([updated]);
      return view as NonNullable<typeof view>;
    },
  );
};
