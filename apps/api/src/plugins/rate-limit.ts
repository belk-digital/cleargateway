import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Config } from "../config.js";

export type KeyRateLimit = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const tooMany = (after: string) => Object.assign(new Error(`Rate limit exceeded, retry in ${after}`), { statusCode: 429 });

/**
 * Two independent layers, Redis-backed when a client is provided (in-memory otherwise, e.g. unit tests):
 *  1. per-IP limit on every route (global route hook);
 *  2. per-API-key limit for merchant routes, returned as a preHandler that runs AFTER authentication.
 *
 * Layer 2 uses `createRateLimit` rather than `fastify.rateLimit()`: the latter is skipped for any request the
 * global hook already counted (the plugin's per-request `rateLimitRan` flag), which silently disables it.
 * Behind a proxy set TRUST_PROXY=true, otherwise req.ip is the proxy's address.
 */
export async function registerRateLimit(app: FastifyInstance, config: Config, redis?: Redis): Promise<KeyRateLimit> {
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_IP_PER_MIN,
    timeWindow: "1 minute",
    redis,
    nameSpace: "belk:rl:",
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => tooMany(String(ctx.after)),
  });

  const checkKey = app.createRateLimit({
    max: config.RATE_LIMIT_PER_KEY_PER_MIN,
    timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) => req.apiKeyPrefix ?? req.ip,
  });

  return async (req, reply) => {
    const r = await checkKey(req);
    if (r.isAllowed || !r.isExceeded) return;
    reply.header("retry-after", r.ttlInSeconds);
    throw tooMany(`${r.ttlInSeconds}s`);
  };
}
