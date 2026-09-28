import type { Db } from "@belk/db";
import type { FastifyPluginAsync } from "fastify";
import { adminAuth } from "../../auth/admin-auth.js";
import type { Config } from "../../config.js";
import { adminMerchantRoutes } from "./merchants.js";
import { adminUserRoutes } from "./users.js";
import { adminPaymentRoutes } from "./payments.js";
import { adminRefundAndReconciliationRoutes } from "./refunds-and-reconciliation.js";

interface Opts {
  db: Db;
  config: Config;
  enqueueReconcile: (() => Promise<void>) | undefined;
}

/**
 * The internal API (`/internal/v1`, ClearGateway staff only). Authentication is a plugin-level hook, so a route added to this
 * plugin later cannot forget it. Every state-changing route writes to `admin_audit_log` in the same transaction.
 */
export const adminRoutes: FastifyPluginAsync<Opts> = async (app, { db, config, enqueueReconcile }) => {
  // onRequest (not preHandler): runs BEFORE body validation, so unauthenticated callers learn nothing about our schemas.
  app.addHook("onRequest", adminAuth(db, config));
  await app.register(adminMerchantRoutes, { db });
  await app.register(adminUserRoutes, { db, config });
  await app.register(adminPaymentRoutes, { db });
  await app.register(adminRefundAndReconciliationRoutes, { db, enqueueReconcile });
};
