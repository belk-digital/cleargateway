import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { formatUsdc } from "@belk/shared";
import type { CreateSessionInput, CreateSessionResult, OnrampEvent, OnrampEventType, OnrampProvider } from "./provider.js";
import { ONRAMP_EVENT_TYPES } from "./provider.js";

export const MOCK_SIGNATURE_HEADER = "x-mock-onramp-signature";

/**
 * Fully working local/test provider. Simulates a real on-ramp closely enough for development and CI:
 *  - `createSession` returns a widget config a test frontend can render (or a test can call directly).
 *  - `verifyWebhook` checks an HMAC-SHA256 signature over the raw body, exactly like the real webhook intake will
 *    require, so tests exercise the same code path as a real provider integration.
 *  - `parseWebhook` accepts `{ session_id, status, tx_hash? }` JSON, matching the neutral shape this module expects.
 *
 * `secret` is required only for `verifyWebhook`; a worker that only calls `parseWebhook` may omit it.
 */
export class MockOnrampProvider implements OnrampProvider {
  readonly name = "mock" as const;

  constructor(private readonly secret?: string) {}

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    return {
      sessionId: input.sessionId,
      widgetConfig: {
        provider: "mock",
        widget_url: `https://mock-onramp.cleargateway.test/session/${input.sessionId}`,
        session_id: input.sessionId,
        wallet_address: input.customerWalletAddress,
        amount: formatUsdc(input.amountUsdc),
        currency: "USDC",
        network: input.network,
        customer_email: input.customerEmail ?? null,
      },
    };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    if (!this.secret) throw new Error("MockOnrampProvider: secret is required to verify webhooks");
    const sig = headers[MOCK_SIGNATURE_HEADER];
    if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) return false;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest();
    const got = Buffer.from(sig, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  parseWebhook(rawBody: string): OnrampEvent {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new Error("MockOnrampProvider: webhook body is not valid JSON");
    }
    if (typeof body !== "object" || body === null) throw new Error("MockOnrampProvider: webhook body must be an object");
    const { session_id, status, tx_hash } = body as Record<string, unknown>;
    if (typeof session_id !== "string" || !session_id) throw new Error("MockOnrampProvider: missing session_id");
    if (typeof status !== "string" || !(ONRAMP_EVENT_TYPES as readonly string[]).includes(status)) {
      throw new Error(`MockOnrampProvider: unknown status "${String(status)}"`);
    }
    if (tx_hash !== undefined && typeof tx_hash !== "string") throw new Error("MockOnrampProvider: tx_hash must be a string");
    return { sessionId: session_id, type: status as OnrampEventType, txHash: tx_hash, raw: body };
  }
}

/** Signs a mock webhook body the way a test "provider" would before sending it to our intake endpoint. */
export function signMockOnrampWebhook(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** A fresh mock session id, distinguishable in logs from real provider ids. */
export function newMockSessionId(): string {
  return `mock_ses_${createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 24)}`;
}
