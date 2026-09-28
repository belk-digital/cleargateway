import type { Db } from "@belk/db";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authed, merchantAuth } from "../../auth/merchant-auth.js";
import type { Config } from "../../config.js";
import { runIdempotent } from "../../idempotency/idempotency.js";
import { serializeIntent } from "../../lib/serialize.js";
import {
  cancelPaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
  listPaymentIntents,
} from "./service.js";
import { createIntentBody, intentIdParam, intentListResponse, intentResponse, listIntentsQuery } from "./schemas.js";

interface Opts {
  db: Db;
  config: Config;
  /** Per-API-key limiter, applied after authentication. */
  keyRateLimit: (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
}

const security = [{ bearerAuth: [] }];
const idempotencyHeader = z.object({ "idempotency-key": z.string().min(1).max(255) });

export const paymentIntentRoutes: FastifyPluginAsync<Opts> = async (instance, { db, config, keyRateLimit }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const preHandler = [merchantAuth(db), keyRateLimit];

  app.post(
    "/payment_intents",
    {
      preHandler,
      schema: {
        tags: ["payment_intents"],
        summary: "Create a payment intent",
        description:
          "Requires an `Idempotency-Key` header. `amount` is an integer string in USDC base units (6 decimals). " +
          "The response includes `checkout_url` for the hosted checkout page.",
        security,
        headers: idempotencyHeader.passthrough(),
        body: createIntentBody,
        response: { 201: intentResponse },
      },
    },
    async (req, reply) => {
      const { merchant, mode, actor } = authed(req);
      const result = await runIdempotent(db, req, reply, merchant.id, async (tx) => {
        const row = await createPaymentIntent(tx, { merchant, mode, actor, config }, req.body);
        return { status: 201, body: serializeIntent(row, config) };
      });
      return reply.status(201).send(result.body as z.infer<typeof intentResponse>);
    },
  );

  app.get(
    "/payment_intents/:id",
    {
      preHandler,
      schema: {
        tags: ["payment_intents"],
        summary: "Retrieve a payment intent",
        security,
        params: intentIdParam,
        response: { 200: intentResponse },
      },
    },
    async (req) => {
      const { merchant, mode } = authed(req);
      return serializeIntent(await getPaymentIntent(db, merchant.id, mode, req.params.id), config);
    },
  );

  app.get(
    "/payment_intents",
    {
      preHandler,
      schema: {
        tags: ["payment_intents"],
        summary: "List payment intents (cursor pagination, newest first)",
        description: "Pass the last id of a page as `starting_after` to fetch the next page.",
        security,
        querystring: listIntentsQuery,
        response: { 200: intentListResponse },
      },
    },
    async (req) => {
      const { merchant, mode } = authed(req);
      const { rows, hasMore } = await listPaymentIntents(db, merchant.id, mode, req.query);
      return {
        object: "list" as const,
        data: rows.map((r) => serializeIntent(r, config)),
        has_more: hasMore,
        next_cursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    "/payment_intents/:id/cancel",
    {
      preHandler,
      schema: {
        tags: ["payment_intents"],
        summary: "Cancel an unpaid payment intent",
        description:
          "Allowed only while `created` or `awaiting_payment`. A wallet payload already issued stays valid on-chain " +
          "until its signature expiry; a payment landing after cancellation is flagged for review, never dropped.",
        security,
        params: intentIdParam,
        headers: idempotencyHeader.passthrough(),
        response: { 200: intentResponse },
      },
    },
    async (req, reply) => {
      const { merchant, mode, actor } = authed(req);
      const result = await runIdempotent(db, req, reply, merchant.id, async (tx) => {
        const row = await cancelPaymentIntent(tx, { merchantId: merchant.id, mode, actor }, req.params.id);
        return { status: 200, body: serializeIntent(row, config) };
      });
      return reply.status(200).send(result.body as z.infer<typeof intentResponse>);
    },
  );
};
