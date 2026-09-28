import { paymentIntents, reconciliationRuns, recordAdminAudit, recordIntentEvent, refunds, REFUND_STATUSES, type Db } from "@belk/db";
import { AppError } from "@belk/shared";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminOf } from "../../auth/admin-auth.js";
import { paginationQuery } from "../../lib/zod-common.js";
import { refundView, toRefundView } from "./views.js";

interface Opts {
  db: Db;
  /** Wakes the worker's reconciliation job. Reconciliation runs in the worker (it needs the chain); this only asks. */
  enqueueReconcile: (() => Promise<void>) | undefined;
}

const security = [{ adminAuth: [] }];
const refundParams = z.object({ id: z.string().regex(/^re_[0-9a-f]{32}$/) }).strict();
const listQuery = z
  .object({
    ...paginationQuery,
    status: z.enum(REFUND_STATUSES).optional(),
    merchant_id: z.string().max(100).optional(),
    payment_intent_id: z.string().regex(/^pi_[0-9a-f]{32}$/).optional(),
  })
  .strict();

const runView = z.object({
  id: z.string(),
  trigger: z.enum(["schedule", "manual"]),
  status: z.enum(["ok", "mismatch", "error"]),
  mismatch_count: z.number(),
  started_at: z.string(),
  finished_at: z.string(),
  report: z.record(z.unknown()),
});
const toRunView = (r: typeof reconciliationRuns.$inferSelect): z.infer<typeof runView> => ({
  id: r.id,
  trigger: r.trigger,
  status: r.status,
  mismatch_count: r.mismatchCount,
  started_at: r.startedAt.toISOString(),
  finished_at: r.finishedAt.toISOString(),
  report: r.report,
});

export const adminRefundAndReconciliationRoutes: FastifyPluginAsync<Opts> = async (instance, { db, enqueueReconcile }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------------------------------------ refunds
  app.get(
    "/refunds",
    {
      schema: {
        tags: ["internal: refunds"],
        summary: "List refund requests across all merchants",
        security,
        querystring: listQuery,
        response: { 200: z.object({ object: z.literal("list"), data: z.array(refundView), has_more: z.boolean(), next_cursor: z.string().nullable() }) },
      },
    },
    async (req) => {
      const q = req.query;
      const conds: SQL[] = [];
      if (q.status) conds.push(eq(refunds.status, q.status));
      if (q.merchant_id) conds.push(eq(paymentIntents.merchantId, q.merchant_id));
      if (q.payment_intent_id) conds.push(eq(refunds.intentId, q.payment_intent_id));
      if (q.starting_after) {
        const [c] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.id, q.starting_after)).limit(1);
        if (!c) throw new AppError("invalid_request", "starting_after does not refer to a refund");
        conds.push(sql`(${refunds.createdAt}, ${refunds.id}) < (select created_at, id from refunds where id = ${q.starting_after})`);
      }
      const rows = await db
        .select({ refund: refunds })
        .from(refunds)
        .innerJoin(paymentIntents, eq(paymentIntents.id, refunds.intentId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(refunds.createdAt), desc(refunds.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const hasMore = rows.length > q.limit;
      return { object: "list" as const, data: page.map((r) => toRefundView(r.refund)), has_more: hasMore, next_cursor: hasMore ? (page.at(-1)?.refund.id ?? null) : null };
    },
  );

  /** requested -> approved / rejected and approved -> rejected. Anything already executing or finished cannot be undone here. */
  const decide = (path: "approve" | "reject") =>
    app.post(
      `/refunds/:id/${path}`,
      {
        schema: {
          tags: ["internal: refunds"],
          summary: path === "approve" ? "Approve a refund request (execution itself is a later phase)" : "Reject a refund request",
          description: "Idempotent: repeating the same decision returns the refund without a second audit line.",
          security,
          params: refundParams,
          body: path === "reject" ? z.object({ note: z.string().min(1).max(1000) }).strict() : z.object({ note: z.string().max(1000).optional() }).strict().nullish(),
          response: { 200: refundView },
        },
      },
      async (req) => {
        const admin = adminOf(req);
        const target = path === "approve" ? "approved" : "rejected";
        const note = (req.body as { note?: string } | undefined)?.note ?? null;
        return db.transaction(async (tx) => {
          const [r] = await tx.select().from(refunds).where(eq(refunds.id, req.params.id)).for("update");
          if (!r) throw new AppError("not_found", "Refund not found");
          if (r.status === target) return toRefundView(r);
          const allowed = path === "approve" ? r.status === "requested" : r.status === "requested" || r.status === "approved";
          if (!allowed) throw new AppError("invalid_state_transition", `A ${r.status} refund cannot be ${target}`, { from: r.status, to: target });
          const [after] = await tx.update(refunds).set({ status: target, updatedAt: new Date() }).where(eq(refunds.id, r.id)).returning();
          if (!after) throw new Error("failed to update refund");
          await recordIntentEvent(tx, { intentId: r.intentId, actor: admin.actor, reason: `refund_${target}`, data: { refund_id: r.id, note } });
          await recordAdminAudit(tx, { adminId: admin.id, action: `refund.${path}`, targetType: "refund", targetId: r.id, data: { from: r.status, to: target, note } });
          return toRefundView(after);
        });
      },
    );
  decide("approve");
  decide("reject");

  // ------------------------------------------------------------------------------------------------ reconciliation
  app.post(
    "/reconciliation/run",
    {
      schema: {
        tags: ["internal: reconciliation"],
        summary: "Queue a reconciliation run now (in addition to the daily one)",
        description: "Compares contract events, payments and the ledger. It only REPORTS; it never fixes money. Poll `/reconciliation/runs` for the result.",
        security,
        response: { 202: z.object({ queued: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const admin = adminOf(req);
      if (!enqueueReconcile) throw new AppError("not_configured", "Reconciliation queue is not configured");
      await enqueueReconcile();
      await db.transaction((tx) => recordAdminAudit(tx, { adminId: admin.id, action: "reconciliation.run", targetType: "reconciliation", targetId: "manual" }));
      return reply.status(202).send({ queued: true as const });
    },
  );

  app.get(
    "/reconciliation/runs",
    {
      schema: {
        tags: ["internal: reconciliation"],
        summary: "Recent reconciliation runs, newest first",
        security,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict(),
        response: { 200: z.object({ object: z.literal("list"), data: z.array(runView) }) },
      },
    },
    async (req) => {
      const rows = await db.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.startedAt)).limit(req.query.limit);
      return { object: "list" as const, data: rows.map(toRunView) };
    },
  );

  app.get(
    "/reconciliation/runs/:id",
    { schema: { tags: ["internal: reconciliation"], summary: "One reconciliation run with its full report", security, params: z.object({ id: z.string().min(1).max(100) }).strict(), response: { 200: runView } } },
    async (req) => {
      const [row] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, req.params.id)).limit(1);
      if (!row) throw new AppError("not_found", "Reconciliation run not found");
      return toRunView(row);
    },
  );
};
