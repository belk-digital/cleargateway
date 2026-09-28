import { randomBytes } from "node:crypto";
import { enqueueEvent, newId, webhookEndpoints, WEBHOOK_EVENT_TYPES, type Db } from "@belk/db";
import { AppError, assertWebhookUrlAllowed, encryptSecret } from "@belk/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authed, merchantAuth } from "../../auth/merchant-auth.js";
import type { Config } from "../../config.js";
import { runIdempotent } from "../../idempotency/idempotency.js";

interface Opts {
  db: Db;
  config: Config;
  keyRateLimit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const MAX_ENDPOINTS_PER_MODE = 10;
const security = [{ bearerAuth: [] }];
const idempotencyHeader = z.object({ "idempotency-key": z.string().min(1).max(255) }).passthrough();

const subscribable = WEBHOOK_EVENT_TYPES.filter((t) => t !== "webhook.test");
const eventList = z.array(z.enum(["*", ...(subscribable as [string, ...string[]])])).min(1).max(20);

const idParam = z.object({ id: z.string().regex(/^we_[0-9a-f]{32}$/) }).strict();
const createBody = z
  .object({ url: z.string().url().max(2048), enabled_events: eventList.default(["*"]) })
  .strict();

const endpointView = z.object({
  id: z.string(),
  object: z.literal("webhook_endpoint"),
  mode: z.enum(["test", "live"]),
  url: z.string(),
  enabled_events: z.array(z.string()),
  status: z.enum(["enabled", "disabled"]),
  created_at: z.string(),
  /** Present ONLY in the create response. Store it now; it cannot be retrieved again. */
  secret: z.string().optional(),
});

type Row = typeof webhookEndpoints.$inferSelect;
const view = (r: Row, secret?: string): z.infer<typeof endpointView> => ({
  id: r.id,
  object: "webhook_endpoint",
  mode: r.mode,
  url: r.url,
  enabled_events: r.enabledEvents,
  status: r.status,
  created_at: r.createdAt.toISOString(),
  ...(secret ? { secret } : {}),
});

export const webhookEndpointRoutes: FastifyPluginAsync<Opts> = async (instance, { db, config, keyRateLimit }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const preHandler = [merchantAuth(db), keyRateLimit];

  const load = async (merchantId: string, mode: "test" | "live", id: string): Promise<Row> => {
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.mode, mode), isNull(webhookEndpoints.deletedAt)))
      .limit(1);
    if (!row) throw new AppError("not_found", "Webhook endpoint not found");
    return row;
  };

  app.post(
    "/webhook_endpoints",
    {
      preHandler,
      schema: {
        tags: ["webhook_endpoints"],
        summary: "Create a webhook endpoint",
        description:
          "Returns the signing `secret` exactly once. Deliveries carry `ClearGateway-Signature: t=<unix>,v1=<HMAC-SHA256 of \"<t>.<raw body>\">`. " +
          "In production the URL must be https and must not resolve to a private address.",
        security,
        headers: idempotencyHeader,
        body: createBody,
        response: { 201: endpointView },
      },
    },
    async (req, reply) => {
      const { merchant, mode } = authed(req);
      if (!config.ENCRYPTION_KEY) throw new AppError("not_configured", "ENCRYPTION_KEY is not configured");
      const encryptionKey = config.ENCRYPTION_KEY;
      await assertWebhookUrlAllowed(req.body.url, { allowPrivate: config.WEBHOOK_ALLOW_PRIVATE_URLS });

      const result = await runIdempotent(db, req, reply, merchant.id, async (tx) => {
        const existing = await tx
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(and(eq(webhookEndpoints.merchantId, merchant.id), eq(webhookEndpoints.mode, mode), isNull(webhookEndpoints.deletedAt)));
        if (existing.length >= MAX_ENDPOINTS_PER_MODE) {
          throw new AppError("conflict", `At most ${MAX_ENDPOINTS_PER_MODE} webhook endpoints per mode`);
        }
        const secret = `whsec_${randomBytes(24).toString("hex")}`;
        const [row] = await tx
          .insert(webhookEndpoints)
          .values({
            id: newId("we"),
            merchantId: merchant.id,
            mode,
            url: req.body.url,
            secretEncrypted: encryptSecret(secret, encryptionKey),
            enabledEvents: req.body.enabled_events,
          })
          .returning();
        if (!row) throw new Error("failed to insert webhook endpoint");
        return { status: 201, body: view(row, secret) };
      });
      return reply.status(201).send(result.body as z.infer<typeof endpointView>);
    },
  );

  app.get(
    "/webhook_endpoints",
    {
      preHandler,
      schema: {
        tags: ["webhook_endpoints"],
        summary: "List webhook endpoints",
        security,
        response: { 200: z.object({ object: z.literal("list"), data: z.array(endpointView) }) },
      },
    },
    async (req) => {
      const { merchant, mode } = authed(req);
      const rows = await db
        .select()
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.merchantId, merchant.id), eq(webhookEndpoints.mode, mode), isNull(webhookEndpoints.deletedAt)))
        .orderBy(webhookEndpoints.createdAt);
      return { object: "list" as const, data: rows.map((r) => view(r)) };
    },
  );

  app.get(
    "/webhook_endpoints/:id",
    { preHandler, schema: { tags: ["webhook_endpoints"], summary: "Retrieve a webhook endpoint", security, params: idParam, response: { 200: endpointView } } },
    async (req) => {
      const { merchant, mode } = authed(req);
      return view(await load(merchant.id, mode, req.params.id));
    },
  );

  app.delete(
    "/webhook_endpoints/:id",
    {
      preHandler,
      schema: {
        tags: ["webhook_endpoints"],
        summary: "Delete a webhook endpoint",
        description: "Stops future deliveries; pending deliveries to it are abandoned.",
        security,
        params: idParam,
        response: { 200: z.object({ id: z.string(), object: z.literal("webhook_endpoint"), deleted: z.literal(true) }) },
      },
    },
    async (req) => {
      const { merchant, mode } = authed(req);
      const row = await load(merchant.id, mode, req.params.id);
      await db.update(webhookEndpoints).set({ deletedAt: new Date(), status: "disabled" }).where(eq(webhookEndpoints.id, row.id));
      return { id: row.id, object: "webhook_endpoint" as const, deleted: true as const };
    },
  );

  app.post(
    "/webhook_endpoints/:id/test",
    {
      preHandler,
      schema: {
        tags: ["webhook_endpoints"],
        summary: "Send a test event to this endpoint",
        description: "Queues a `webhook.test` event; the delivery worker sends it like any other event.",
        security,
        params: idParam,
        headers: idempotencyHeader,
        response: { 202: z.object({ object: z.literal("webhook_test"), endpoint_id: z.string(), queued: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const { merchant, mode } = authed(req);
      const row = await load(merchant.id, mode, req.params.id);
      const result = await runIdempotent(db, req, reply, merchant.id, async (tx) => {
        const queued = await enqueueEvent(tx, {
          merchantId: merchant.id,
          mode,
          type: "webhook.test",
          subjectId: row.id,
          discriminator: newId("evt"), // each explicit test call sends a fresh event
          object: { message: "This is a test event from ClearGateway." },
          endpointId: row.id,
        });
        return { status: 202, body: { object: "webhook_test", endpoint_id: row.id, queued: queued > 0 } };
      });
      return reply.status(202).send(result.body as { object: "webhook_test"; endpoint_id: string; queued: boolean });
    },
  );
};
