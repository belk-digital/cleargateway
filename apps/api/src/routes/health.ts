import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

interface HealthOptions {
  readinessChecks: Record<string, () => Promise<void>>;
}

const readySchema = z.object({ status: z.string(), checks: z.record(z.string()) });

export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (instance, opts) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  // Probes are exempt from rate limiting so orchestrators never get 429s.
  app.get(
    "/health",
    {
      config: { rateLimit: false },
      schema: { tags: ["system"], response: { 200: z.object({ status: z.string() }) } },
    },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/ready",
    {
      config: { rateLimit: false },
      schema: { tags: ["system"], response: { 200: readySchema, 503: readySchema } },
    },
    async (_req, reply) => {
      const checks: Record<string, string> = {};
      await Promise.all(
        Object.entries(opts.readinessChecks).map(async ([name, fn]) => {
          try {
            await fn();
            checks[name] = "ok";
          } catch {
            checks[name] = "fail";
          }
        }),
      );
      const ok = Object.values(checks).every((v) => v === "ok");
      return reply.status(ok ? 200 : 503).send({ status: ok ? "ready" : "not_ready", checks });
    },
  );
};
