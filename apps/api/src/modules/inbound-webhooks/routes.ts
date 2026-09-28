import { createHmac, timingSafeEqual } from "node:crypto";
import { inboundWebhookEvents, newId, type Db } from "@belk/db";
import type { OnrampProvider, OnrampProviderName } from "@belk/onramp";
import { AppError } from "@belk/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { Config } from "../../config.js";

interface Opts {
  db: Db;
  config: Config;
  /** Wakes the chain watcher immediately. The poller stays the source of truth; this is only a hint. */
  signalWatcher?: () => Promise<void>;
  onrampProviders: Record<OnrampProviderName, OnrampProvider>;
}

const SAFE_HEADERS = /^(content-type|user-agent|x-.*)$/i;

/** Per-provider signature check over the RAW body. Returns false for anything malformed. */
function verifyChainWebhook(provider: string, rawBody: string, headers: Record<string, unknown>, config: Config): boolean {
  if (provider === "mock") {
    const secret = config.CHAIN_WEBHOOK_MOCK_SECRET;
    const sig = headers["x-cleargateway-mock-signature"];
    if (!secret || typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const got = Buffer.from(sig, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
  // TODO(verify): Alchemy (address-activity / custom webhooks) and QuickNode signature schemes. Do not guess:
  // implement from each provider's official docs once we have credentials.
  throw new AppError("not_implemented", `Chain webhook provider "${provider}" is not implemented yet`);
}

/**
 * POST /webhooks/chain/:provider - fast signal that something happened on-chain.
 * It never changes payment state: it stores the raw payload and asks the watcher to poll now.
 */
export const inboundWebhookRoutes: FastifyPluginAsync<Opts> = async (app, { db, config, signalWatcher, onrampProviders }) => {
  // Keep the exact bytes the provider signed: JSON is NOT re-serialized before verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post<{ Params: { provider: string }; Body: string }>(
    "/webhooks/chain/:provider",
    { schema: { hide: true } },
    async (req, reply) => {
      const provider = req.params.provider.toLowerCase();
      if (!/^[a-z0-9_-]{1,32}$/.test(provider)) throw new AppError("not_found", "Unknown provider");
      const rawBody = typeof req.body === "string" ? req.body : "";

      if (!verifyChainWebhook(provider, rawBody, req.headers, config)) {
        req.log.warn({ provider }, "chain webhook rejected: invalid signature");
        throw new AppError("unauthorized", "Invalid webhook signature");
      }

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (SAFE_HEADERS.test(k) && typeof v === "string") headers[k.toLowerCase()] = v;

      const id = newId("iwe");
      await db.insert(inboundWebhookEvents).values({ id, source: "chain", provider, headers, rawBody, signatureValid: true });
      if (signalWatcher) {
        await signalWatcher().catch((err: unknown) => req.log.warn({ err }, "failed to signal watcher"));
      }
      await db.update(inboundWebhookEvents).set({ processedAt: new Date() }).where(eq(inboundWebhookEvents.id, id));
      return reply.status(200).send({ received: true });
    },
  );

  /**
   * POST /webhooks/onramp/:provider - verifies the signature, stores the raw payload, and leaves it for the
   * worker's on-ramp processor to apply (unlike the chain route above, this is NOT marked processed here: there is
   * no independent blockchain to re-check against, so the stored, verified payload IS the update to apply).
   * Applying it only ever touches on-ramp status fields; it can never mark a payment succeeded.
   */
  app.post<{ Params: { provider: string }; Body: string }>(
    "/webhooks/onramp/:provider",
    { schema: { hide: true } },
    async (req, reply) => {
      const providerName = req.params.provider.toLowerCase();
      const provider = (onrampProviders as Record<string, OnrampProvider>)[providerName];
      if (!provider) throw new AppError("not_found", "Unknown provider");
      const rawBody = typeof req.body === "string" ? req.body : "";

      let valid: boolean;
      try {
        valid = provider.verifyWebhook(req.headers, rawBody);
      } catch (err) {
        // Wert/Simplex are stubs today; surface that plainly rather than a raw 500.
        throw new AppError("not_implemented", err instanceof Error ? err.message : `${providerName} on-ramp webhooks are not implemented`);
      }
      if (!valid) {
        req.log.warn({ provider: providerName }, "onramp webhook rejected: invalid signature");
        throw new AppError("unauthorized", "Invalid webhook signature");
      }

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (SAFE_HEADERS.test(k) && typeof v === "string") headers[k.toLowerCase()] = v;
      await db.insert(inboundWebhookEvents).values({ id: newId("iwe"), source: "onramp", provider: providerName, headers, rawBody, signatureValid: true });
      return reply.status(200).send({ received: true });
    },
  );
};
