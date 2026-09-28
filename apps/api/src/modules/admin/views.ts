import { intentPublicFields, type IntentRow, merchants, refunds, type depositAddresses } from "@belk/db";
import { USDC_DECIMALS } from "@belk/shared";
import { z } from "zod";
import { intentResponse } from "../payment-intents/schemas.js";

type MerchantRow = typeof merchants.$inferSelect;
type RefundRow = typeof refunds.$inferSelect;
type DepositRow = typeof depositAddresses.$inferSelect;

export const merchantView = z.object({
  id: z.string(),
  object: z.literal("merchant"),
  legal_name: z.string(),
  display_name: z.string(),
  status: z.enum(["pending_kyb", "active", "suspended"]),
  kyb_status: z.enum(["not_started", "in_review", "approved", "rejected"]),
  payout_wallet_address: z.string(),
  fee_bps: z.number(),
  settlement_token: z.string(),
  branding: z.record(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

export const toMerchantView = (m: MerchantRow): z.infer<typeof merchantView> => ({
  id: m.id,
  object: "merchant",
  legal_name: m.legalName,
  display_name: m.displayName,
  status: m.status,
  kyb_status: m.kybStatus,
  payout_wallet_address: m.payoutWalletAddress,
  fee_bps: m.feeBps,
  settlement_token: m.settlementToken,
  branding: m.branding as Record<string, string>,
  created_at: m.createdAt.toISOString(),
  updated_at: m.updatedAt.toISOString(),
});

export const REVIEW_CATEGORIES = ["late_payment", "overpaid", "underpaid", "stuck_deposit", "chain_mismatch", "other"] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/** Review reasons written by the workers (flagForReview), grouped for the review queue. */
const STUCK = ["sweep_attempts_exhausted", "deposit_funded_after_terminal"];
const MISMATCH = ["event_mismatch", "duplicate_payment_event", "block_changed_after_finality", "final_check_event_mismatch"];
const OVERPAID = ["deposit_overpaid", "deposit_excess"];
export const REASON_GROUPS = { STUCK, MISMATCH, OVERPAID };

export function categoryOf(row: Pick<IntentRow, "status" | "reviewReason" | "needsReview">): ReviewCategory | null {
  const reason = row.reviewReason ?? "";
  if (STUCK.includes(reason)) return "stuck_deposit";
  if (MISMATCH.includes(reason)) return "chain_mismatch";
  if (OVERPAID.includes(reason)) return "overpaid";
  if (reason.startsWith("late_payment_") || reason.startsWith("late_deposit_")) return "late_payment";
  if (row.status === "underpaid") return "underpaid";
  return row.needsReview ? "other" : null;
}

/** Everything staff need about a payment. No client secret, no checkout URL, no API keys. */
export const adminIntentView = intentResponse.omit({ client_secret: true, checkout_url: true }).extend({
  merchant_id: z.string(),
  review_reason: z.string().nullable(),
  underpaid_amount: z.string(),
  overpaid_amount: z.string(),
  deposit_address: z.string().nullable(),
  deposit: z.object({ status: z.string(), detected_amount: z.string(), confirmed_amount: z.string(), sweep_tx_hash: z.string().nullable() }).nullable(),
  onramp_provider: z.string().nullable(),
  onramp_status: z.string().nullable(),
  category: z.enum(REVIEW_CATEGORIES).nullable(),
});

export const toAdminIntentView = (row: IntentRow, dep?: DepositRow): z.infer<typeof adminIntentView> => ({
  ...intentPublicFields(row),
  merchant_id: row.merchantId,
  review_reason: row.reviewReason,
  underpaid_amount: row.underpaidAmount.toString(),
  overpaid_amount: row.overpaidAmount.toString(),
  deposit_address: row.depositAddress,
  deposit: dep
    ? { status: dep.status, detected_amount: dep.detectedAmount.toString(), confirmed_amount: dep.confirmedAmount.toString(), sweep_tx_hash: dep.sweepTxHash }
    : null,
  onramp_provider: row.onrampProvider,
  onramp_status: row.onrampStatus,
  category: categoryOf(row),
});

export const refundView = z.object({
  id: z.string(),
  object: z.literal("refund"),
  payment_intent_id: z.string(),
  amount: z.string(),
  currency: z.string(),
  decimals: z.number(),
  status: z.enum(["requested", "approved", "processing", "succeeded", "failed", "rejected"]),
  to_address: z.string(),
  tx_hash: z.string().nullable(),
  reason: z.string().nullable(),
  requested_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const toRefundView = (r: RefundRow): z.infer<typeof refundView> => ({
  id: r.id,
  object: "refund",
  payment_intent_id: r.intentId,
  amount: r.amount.toString(),
  currency: "USDC",
  decimals: USDC_DECIMALS,
  status: r.status,
  to_address: r.toAddress,
  tx_hash: r.txHash,
  reason: r.reason,
  requested_by: r.requestedBy,
  created_at: r.createdAt.toISOString(),
  updated_at: r.updatedAt.toISOString(),
});
