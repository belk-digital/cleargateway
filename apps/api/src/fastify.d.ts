import type { Mode } from "@belk/shared";
import type { merchants } from "@belk/db";

type MerchantRow = typeof merchants.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the merchant auth hook. */
    merchant?: MerchantRow;
    apiMode?: Mode;
    /** Non-secret key prefix of the authenticated API key (rate-limit key, audit actor). */
    apiKeyPrefix?: string;
    /** Set by the admin auth hook: the ClearGateway staff member making an internal API call. */
    admin?: { id: string; email: string };
    /** Set when a merchant dashboard user (session token) made the request instead of an API key. */
    merchantUser?: { id: string; email: string; role: "owner" | "admin" | "developer" | "viewer" };
  }
}
