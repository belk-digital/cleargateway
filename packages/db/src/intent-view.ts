import { USDC_DECIMALS } from "@belk/shared";
import type { IntentRow } from "./state-machine.js";

/**
 * The merchant-facing fields of a payment intent, shared by API responses and webhook payloads so both
 * always agree. Money is always an integer string in USDC base units. Contains no secrets.
 */
export function intentPublicFields(row: IntentRow) {
  return {
    id: row.id,
    object: "payment_intent" as const,
    mode: row.mode,
    amount: row.amount.toString(),
    currency: row.currency,
    decimals: USDC_DECIMALS,
    fee_bps: row.feeBps,
    fee_amount: row.feeAmount.toString(),
    merchant_amount: row.merchantAmount.toString(),
    status: row.status,
    payment_method: row.paymentMethod,
    merchant_order_id: row.merchantOrderId,
    metadata: row.metadata,
    customer_email: row.customerEmail,
    payer_address: row.payerAddress,
    success_url: row.successUrl,
    cancel_url: row.cancelUrl,
    tx_hash: row.txHash,
    confirmations: row.confirmations,
    requires_review: row.needsReview,
    expires_at: row.expiresAt.toISOString(),
    succeeded_at: row.succeededAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
