import type { CreateSessionInput, CreateSessionResult, OnrampEvent, OnrampProvider } from "./provider.js";

/**
 * Stub. Simplex/Nuvei's real quote + payment-request API and its webhook signature/payload shape are NOT
 * implemented here: guessing at a payments provider's request or response fields is worse than refusing outright.
 * Implement once sandbox credentials and the official docs are available; every method below is a clearly
 * marked TODO(verify).
 */
export class SimplexOnrampProvider implements OnrampProvider {
  readonly name = "simplex" as const;

  async createSession(_input: CreateSessionInput): Promise<CreateSessionResult> {
    throw new Error(
      "SimplexOnrampProvider.createSession: TODO(verify) — Simplex/Nuvei's quote + payment-request API is not " +
        "implemented. Obtain sandbox credentials and the official API docs first.",
    );
  }

  verifyWebhook(_headers: Record<string, string | string[] | undefined>, _rawBody: string): boolean {
    throw new Error("SimplexOnrampProvider.verifyWebhook: TODO(verify) — Simplex's webhook signature scheme is not implemented.");
  }

  parseWebhook(_rawBody: string): OnrampEvent {
    throw new Error("SimplexOnrampProvider.parseWebhook: TODO(verify) — Simplex's webhook payload shape is not implemented.");
  }
}
