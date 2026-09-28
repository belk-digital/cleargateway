/** Response shapes of the ClearGateway API, as the UI uses them. */
export interface Intent {
  id: string;
  mode: "test" | "live";
  amount: string;
  fee_bps: number;
  fee_amount: string;
  merchant_amount: string;
  status: string;
  payment_method: string | null;
  merchant_order_id: string | null;
  customer_email: string | null;
  payer_address: string | null;
  tx_hash: string | null;
  confirmations: number;
  requires_review: boolean;
  expires_at: string;
  succeeded_at: string | null;
  created_at: string;
  client_secret: string | null;
  checkout_url: string | null;
}
export interface AdminIntent extends Omit<Intent, "client_secret" | "checkout_url"> {
  merchant_id: string;
  review_reason: string | null;
  underpaid_amount: string;
  overpaid_amount: string;
  deposit_address: string | null;
  deposit: { status: string; detected_amount: string; confirmed_amount: string; sweep_tx_hash: string | null } | null;
  onramp_provider: string | null;
  onramp_status: string | null;
  category: string | null;
}
export interface Refund {
  id: string;
  payment_intent_id: string;
  amount: string;
  status: string;
  to_address: string;
  tx_hash: string | null;
  reason: string | null;
  requested_by: string;
  created_at: string;
}
export interface Balance {
  mode: string;
  settled: string;
  refunded: string;
  net: string;
  settled_payments: number;
}
export interface WebhookEndpoint {
  id: string;
  url: string;
  enabled_events: string[];
  status: string;
  created_at: string;
  secret?: string;
}
export interface Merchant {
  id: string;
  legal_name: string;
  display_name: string;
  status: string;
  kyb_status: string;
  payout_wallet_address: string;
  fee_bps: number;
  created_at: string;
}
export interface ApiKeyRow {
  id: string;
  mode: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
export interface Run {
  id: string;
  trigger: string;
  status: string;
  mismatch_count: number;
  started_at: string;
  finished_at: string;
  report: Record<string, unknown>;
}
