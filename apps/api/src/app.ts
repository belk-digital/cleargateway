import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Db } from "@belk/db";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";
import { adminRoutes } from "./modules/admin/index.js";
import { authRoutes } from "./modules/auth/routes.js";
import { balanceRoutes } from "./modules/balance/routes.js";
import { checkoutRoutes } from "./modules/checkout/routes.js";
import { webhookEndpointRoutes } from "./modules/webhook-endpoints/routes.js";
import { inboundWebhookRoutes } from "./modules/inbound-webhooks/routes.js";
import { paymentIntentRoutes } from "./modules/payment-intents/routes.js";
import { refundRoutes } from "./modules/refunds/routes.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import type { ChainBlockReader } from "./lib/chain-reader.js";
import { buildOnrampRegistry } from "./lib/onramp-registry.js";
import type { IntentSigner } from "./signer/index.js";

export interface AppDeps {
  config: Config;
  /** Optional so health/config behavior can be tested without a database; /v1 routes need it. */
  db?: Db;
  /** Redis for rate limiting. In-memory limiting is used when omitted (tests). */
  redis?: Redis;
  /** EIP-712 intent signer. Wallet payments return 503 not_configured without one. */
  signer?: IntentSigner;
  /** Reads the current block number. Required only for issuing deposit addresses. */
  chain?: ChainBlockReader;
  /** Asks the worker to run reconciliation now (internal API). The job itself runs in the worker. */
  enqueueReconcile?: () => Promise<void>;
  /** Wakes the chain watcher (used by the chain-webhook fast signal). */
  signalWatcher?: () => Promise<void>;
  /** Readiness probes, e.g. { postgres: () => ping } */
  readinessChecks?: Record<string, () => Promise<void>>;
}

const BODY_LIMIT_BYTES = 256 * 1024;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });

  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    // Structured JSON logs (pino); Fastify adds reqId to every request-scoped line.
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            // No PII / secrets in logs.
            redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["idempotency-key"]', 'req.headers["x-client-secret"]'],
          },
    requestIdHeader: "x-request-id",
    genReqId: () => `req_${randomUUID()}`,
    trustProxy: config.TRUST_PROXY,
  });

  // Zod validates every input (unknown fields are rejected by `.strict()` schemas) and OpenAPI is derived from it.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  await app.register(helmet);
  // CORS only for our checkout origin. Merchant API calls are server-to-server and need no CORS.
  await app.register(cors, { origin: [config.CHECKOUT_ORIGIN], credentials: false });

  await app.register(swagger, {
    openapi: {
      info: { title: "ClearGateway API", version: "1.0.0", description: "Non-custodial stablecoin payments (testnet)." },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          adminAuth: { type: "http", scheme: "bearer", description: "Internal API: ADMIN_TOKEN, plus an X-Admin-Email header naming a staff account." },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  registerErrorHandler(app);
  const keyRateLimit = await registerRateLimit(app, config, deps.redis);
  const onrampProviders = buildOnrampRegistry(config);

  await app.register(healthRoutes, { readinessChecks: deps.readinessChecks ?? {} });

  if (deps.db) {
    const { db } = deps;
    await app.register(
      async (v1) => {
        await v1.register(paymentIntentRoutes, { db, config, keyRateLimit });
        await v1.register(balanceRoutes, { db, keyRateLimit });
        await v1.register(webhookEndpointRoutes, { db, config, keyRateLimit });
        await v1.register(refundRoutes, { db, config, keyRateLimit });
        await v1.register(checkoutRoutes, { db, config, signer: deps.signer, chain: deps.chain, onrampProviders });
      },
      { prefix: "/v1" },
    );
  }

  if (deps.db) {
    await app.register(authRoutes, { db: deps.db, config, prefix: "/auth/v1" });
    await app.register(adminRoutes, { db: deps.db, config, enqueueReconcile: deps.enqueueReconcile, prefix: "/internal/v1" });
    await app.register(inboundWebhookRoutes, { db: deps.db, config, signalWatcher: deps.signalWatcher, onrampProviders });
  }

  return app;
}
