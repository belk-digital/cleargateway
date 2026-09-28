/** Browser calls to the hosted-checkout API. Authenticated by the payment's client secret only. */
const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export interface CheckoutView {
  id: string;
  status: string;
  amount: string;
  decimals: number;
  merchant: { display_name: string; branding: Record<string, string> };
  expires_at: string;
  success_url: string | null;
  cancel_url: string | null;
  chain_id: number;
  contract_address: string | null;
  token_address: string | null;
  tx_hash: string | null;
  deposit_address: { address: string; detected_amount: string; confirmed_amount: string; status: string } | null;
  onramp: { provider: string; status: string | null } | null;
}
export interface CheckoutStatus {
  status: string;
  tx_hash: string | null;
  confirmations: number;
  required_confirmations: number | null;
}
export interface WalletPayload {
  chain_id: number;
  contract_address: `0x${string}`;
  token_address: `0x${string}`;
  payment_intent: { intentId: `0x${string}`; merchant: `0x${string}`; payer: `0x${string}`; amount: string; feeBps: string; expiry: string };
  intent_signature: `0x${string}`;
  approval: { token: `0x${string}`; spender: `0x${string}`; amount: string };
}

export async function checkoutCall<T>(id: string, secret: string, path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const headers: Record<string, string> = { "x-client-secret": secret };
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetch(`${BASE}/v1/checkout/${id}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok) return { ok: false, error: j?.error?.message ?? `Request failed (${res.status})` };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, error: "Cannot reach the payment server. Check your connection and try again." };
  }
}

/** Only ever navigate to plain http(s) URLs from the merchant. */
export const safeUrl = (u: string | null): string | null => (u && /^https?:\/\//i.test(u) ? u : null);
