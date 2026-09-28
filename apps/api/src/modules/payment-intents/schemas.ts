import { z } from "zod";
import { PAYMENT_STATUSES } from "@belk/db";

/** Integer string in USDC base units (6 decimals): "100000000" = 100 USDC. Never a JSON number. */
export const unitsString = z.string().regex(/^[1-9]\d{0,17}$/, "must be a positive integer string in USDC base units");

const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), "must be an http(s) URL");

export const intentIdParam = z.object({ id: z.string().regex(/^pi_[0-9a-f]{32}$/, "invalid payment intent id") }).strict();

export const createIntentBody = z
  .object({
    amount: unitsString,
    currency: z.literal("USDC").default("USDC"),
    merchant_order_id: z.string().min(1).max(255).optional(),
    metadata: z
      .record(z.string().min(1).max(40), z.string().max(500))
      .refine((m) => Object.keys(m).length <= 50, "at most 50 metadata keys")
      .default({}),
    customer_email: z.string().email().max(320).optional(),
    success_url: httpUrl.optional(),
    cancel_url: httpUrl.optional(),
    expires_in_seconds: z.number().int().min(300).max(86_400).default(3600),
  })
  .strict();
export type CreateIntentBody = z.infer<typeof createIntentBody>;

export const listIntentsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
    starting_after: z.string().regex(/^pi_[0-9a-f]{32}$/).optional(),
    status: z.enum(PAYMENT_STATUSES).optional(),
    created_gte: z.string().datetime().optional(),
    created_lte: z.string().datetime().optional(),
  })
  .strict();
export type ListIntentsQuery = z.infer<typeof listIntentsQuery>;

export const intentResponse = z.object({
  id: z.string(),
  object: z.literal("payment_intent"),
  mode: z.enum(["test", "live"]),
  amount: z.string(),
  currency: z.string(),
  decimals: z.number(),
  fee_bps: z.number(),
  fee_amount: z.string(),
  merchant_amount: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  payment_method: z.string().nullable(),
  merchant_order_id: z.string().nullable(),
  metadata: z.record(z.string()),
  customer_email: z.string().nullable(),
  payer_address: z.string().nullable(),
  success_url: z.string().nullable(),
  cancel_url: z.string().nullable(),
  tx_hash: z.string().nullable(),
  confirmations: z.number(),
  requires_review: z.boolean(),
  expires_at: z.string(),
  succeeded_at: z.string().nullable(),
  created_at: z.string(),
  client_secret: z.string().nullable(),
  checkout_url: z.string().nullable(),
});

export const intentListResponse = z.object({
  object: z.literal("list"),
  data: z.array(intentResponse),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});
