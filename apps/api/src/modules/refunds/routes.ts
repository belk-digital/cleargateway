import { paymentIntents, refunds, type Db } from "@belk/db";
import { AppError } from "@belk/shared";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authed, merchantAuth } from "../../auth/merchant-auth.js";
import type { Config } from "../../config.js";
import { runIdempotent } from "../../idempotency/idempotency.js";
import { evmAddress, paginationQuery, unitsString } from "../../lib/zod-common.js";
import { refundView, toRefundView } from "../admin/views.js";
import { recordRefundRequest } from "./service.js";

interface Opts {
  db: Db;
  config: Config;
  keyRateLimit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const security = [{ bearerAuth: [] }];
const idempotencyHeader = z.object({ "idempotency-key": z.string().min(1).max(255) }).passthrough();
const refundId = z.object({ id: z.string().regex(/^re_[0-9a-f]{32}$/) }).strict();

const createBody = z
  .object({
    payment_intent_id: z.string().regex(/^pi_[0-9a-f]{32}$/),
    amount: unitsString.optional(),
    to_address: evmAddress,
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

const listQuery = z.object({ ...paginationQuery, payment_intent_id: z.string().regex(/^pi_[0-9a-f]{32}$/).optional() }).strict();

export const refundRoutes: FastifyPluginAsync<Opts> = async (instance, { db, config, keyRateLimit }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const preHandler = [merchantAuth(db), keyRateLimit];

  app.post(
    "/refunds",
    {
      preHandler,
      schema: {
        tags: ["refunds"],
        summary: "Record a refund request",
        description:
          "Records the request only: nothing is sent on-chain yet. `amount` (USDC base units) defaults to everything still " +
          "refundable. The total of all live refunds can never exceed the amount the customer paid. Emits `refund.created`.",
        security,
        headers: idempotencyHeader,
        body: createBody,
        response: { 201: refundView },
      },
    },
    async (req, reply) => {
      const { merchant, mode, actor } = authed(req);
      const b = req.body;
      const result = await runIdempotent(db, req, reply, merchant.id, async (tx) => {
        const row = await recordRefundRequest(
          tx,
          { merchant, mode, actor, config },
          { intentId: b.payment_intent_id, amount: b.amount ? BigInt(b.amount) : undefined, toAddress: b.to_address, reason: b.reason },
        );
        return { status: 201, body: toRefundView(row) };
      });
      return reply.status(201).send(result.body as z.infer<typeof refundView>);
    },
  );

  app.get(
    "/refunds/:id",
    { preHandler, schema: { tags: ["refunds"], summary: "Retrieve a refund", security, params: refundId, response: { 200: refundView } } },
    async (req) => {
      const { merchant, mode } = authed(req);
      const [row] = await db
        .select({ refund: refunds })
        .from(refunds)
        .innerJoin(paymentIntents, eq(paymentIntents.id, refunds.intentId))
        .where(and(eq(refunds.id, req.params.id), eq(paymentIntents.merchantId, merchant.id), eq(paymentIntents.mode, mode)))
        .limit(1);
      if (!row) throw new AppError("not_found", "Refund not found");
      return toRefundView(row.refund);
    },
  );

  app.get(
    "/refunds",
    {
      preHandler,
      schema: {
        tags: ["refunds"],
        summary: "List your refunds (newest first, cursor pagination)",
        security,
        querystring: listQuery,
        response: { 200: z.object({ object: z.literal("list"), data: z.array(refundView), has_more: z.boolean(), next_cursor: z.string().nullable() }) },
      },
    },
    async (req) => {
      const { merchant, mode } = authed(req);
      const q = req.query;
      const conds: SQL[] = [eq(paymentIntents.merchantId, merchant.id), eq(paymentIntents.mode, mode)];
      if (q.payment_intent_id) conds.push(eq(refunds.intentId, q.payment_intent_id));
      if (q.starting_after) {
        const [cursor] = await db
          .select({ id: refunds.id })
          .from(refunds)
          .innerJoin(paymentIntents, eq(paymentIntents.id, refunds.intentId))
          .where(and(eq(refunds.id, q.starting_after), eq(paymentIntents.merchantId, merchant.id), eq(paymentIntents.mode, mode)))
          .limit(1);
        if (!cursor) throw new AppError("invalid_request", "starting_after does not refer to one of your refunds");
        conds.push(sql`(${refunds.createdAt}, ${refunds.id}) < (select created_at, id from refunds where id = ${q.starting_after})`);
      }
      const rows = await db
        .select({ refund: refunds })
        .from(refunds)
        .innerJoin(paymentIntents, eq(paymentIntents.id, refunds.intentId))
        .where(and(...conds))
        .orderBy(desc(refunds.createdAt), desc(refunds.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const hasMore = rows.length > q.limit;
      return { object: "list" as const, data: page.map((r) => toRefundView(r.refund)), has_more: hasMore, next_cursor: hasMore ? (page.at(-1)?.refund.id ?? null) : null };
    },
  );
};
