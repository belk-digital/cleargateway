/**
 * Provider-agnostic on-ramp interface. An on-ramp only gets USDC into a wallet the CUSTOMER owns; it never pays
 * the merchant or the splitter directly (real on-ramps require the destination to belong to the buyer). Once
 * funded, that wallet pays through the existing wallet-payment flow (Milestone 3), so this module never touches
 * the blockchain — it only creates sessions and normalizes provider webhooks.
 */

export const ONRAMP_PROVIDER_NAMES = ["mock", "wert", "simplex"] as const;
export type OnrampProviderName = (typeof ONRAMP_PROVIDER_NAMES)[number];

export interface CreateSessionInput {
  /** Our payment intent id. Passed to the provider as a reference so its webhook can be matched back to it. */
  intentId: string;
  /** Our own session reference (generated before calling the provider), echoed back in every webhook for this session. */
  sessionId: string;
  /** Amount in USDC base units (6 decimals). */
  amountUsdc: bigint;
  /** Must belong to the customer; enforced by `assertSafeCustomerWallet` before this is ever called. */
  customerWalletAddress: string;
  customerEmail?: string;
  network: "base";
}

export interface CreateSessionResult {
  /** Our own reference (same as the input `sessionId`), for callers that only see the result. */
  sessionId: string;
  /** Whatever the frontend widget needs to render (provider-specific). */
  widgetConfig: Record<string, unknown>;
}

export const ONRAMP_EVENT_TYPES = ["created", "pending", "completed", "failed"] as const;
export type OnrampEventType = (typeof ONRAMP_EVENT_TYPES)[number];

export interface OnrampEvent {
  /** Our session reference, extracted from the webhook payload. */
  sessionId: string;
  type: OnrampEventType;
  /** The on-ramp's OWN transfer into the customer's wallet, if the provider reports one. This is NOT a splitter
   *  payment and must never be written to `payment_intents.tx_hash` (only the chain watcher writes that). */
  txHash?: string;
  raw: unknown;
}

/**
 * One instance per provider. `createSession` and `verifyWebhook` are the only methods that touch provider
 * credentials; `parseWebhook` is pure and safe to call on an already-verified, already-stored payload.
 */
export interface OnrampProvider {
  readonly name: OnrampProviderName;
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
  /** Verifies the raw request against the provider's signature scheme. Must be checked BEFORE parsing or storing. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  /** Normalizes an already-verified raw webhook body. Throws on a body it cannot understand. */
  parseWebhook(rawBody: string): OnrampEvent;
}
