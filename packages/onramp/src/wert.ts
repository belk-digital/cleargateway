import type { CreateSessionInput, CreateSessionResult, OnrampEvent, OnrampProvider } from "./provider.js";

/**
 * Stub. Wert's real session-creation API (signed widget parameters — `partner_id`, `click_id`, `signature` —
 * see https://docs.wert.io) and its webhook signature/payload shape are NOT implemented here: guessing at a
 * payments provider's request or response fields is worse than refusing outright. Implement once sandbox
 * credentials and the official docs are available; every method below is a clearly marked TODO(verify).
 */
export class WertOnrampProvider implements OnrampProvider {
  readonly name = "wert" as const;

  async createSession(_input: CreateSessionInput): Promise<CreateSessionResult> {
    throw new Error(
      "WertOnrampProvider.createSession: TODO(verify) — Wert's widget session API (partner_id, click_id, " +
        "signed parameters) is not implemented. See https://docs.wert.io and obtain sandbox credentials first.",
    );
  }

  verifyWebhook(_headers: Record<string, string | string[] | undefined>, _rawBody: string): boolean {
    throw new Error("WertOnrampProvider.verifyWebhook: TODO(verify) — Wert's webhook signature scheme is not implemented.");
  }

  parseWebhook(_rawBody: string): OnrampEvent {
    throw new Error("WertOnrampProvider.parseWebhook: TODO(verify) — Wert's webhook payload shape is not implemented.");
  }
}
