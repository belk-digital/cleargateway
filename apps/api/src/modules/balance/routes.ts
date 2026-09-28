import type { Db } from "@belk/db";
import { USDC_DECIMALS } from "@belk/shared";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authed, merchantAuth } from "../../auth/merchant-auth.js";

interface Opts {
  db: Db;
  keyRateLimit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const balanceResponse = z.object({
  object: z.literal("balance"),
  mode: z.enum(["test", "live"]),
  currency: z.string(),
  decimals: z.number(),
  settled: z.string(),
  refunded: z.string(),
  net: z.string(),
  settled_payments: z.number(),
});

export const balanceRoutes: FastifyPluginAsync<Opts> = async (instance, { db, keyRateLimit }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/balance",
    {
      preHandler: [merchantAuth(db), keyRateLimit],
      schema: {
        tags: ["balance"],
        summary: "Merchant totals, computed from the double-entry ledger",
        description:
          "Derived from ledger entries on the merchant's receivable account, never by summing payment intents. " +
          "Only confirmed (on-chain, final) payments and recorded refunds appear here.",
        security: [{ bearerAuth: [] }],
        response: { 200: balanceResponse },
      },
    },
    async (req) => {
      const { merchant, mode } = authed(req);
      const rows = await db.execute<{ settled: string; refunded: string; payments: string }>(sql`
        select
          coalesce(sum(e.amount) filter (where t.kind = 'payment_settled' and e.direction = 'credit'), 0)::text as settled,
          coalesce(sum(e.amount) filter (where t.kind = 'refund' and e.direction = 'debit'), 0)::text as refunded,
          count(distinct t.id) filter (where t.kind = 'payment_settled')::text as payments
        from ledger_entries e
        join ledger_transactions t on t.id = e.transaction_id
        join ledger_accounts a on a.id = e.account_id
        where a.type = 'merchant_receivable' and a.merchant_id = ${merchant.id} and a.mode = ${mode}
      `);
      const r = rows[0] ?? { settled: "0", refunded: "0", payments: "0" };
      const settled = BigInt(r.settled);
      const refunded = BigInt(r.refunded);
      return {
        object: "balance" as const,
        mode,
        currency: "USDC",
        decimals: USDC_DECIMALS,
        settled: settled.toString(),
        refunded: refunded.toString(),
        net: (settled - refunded).toString(),
        settled_payments: Number(r.payments),
      };
    },
  );
};
