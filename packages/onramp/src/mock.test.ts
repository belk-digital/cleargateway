import { describe, expect, it } from "vitest";
import { MOCK_SIGNATURE_HEADER, MockOnrampProvider, newMockSessionId, signMockOnrampWebhook } from "./mock.js";

const SECRET = "mock-onramp-test-secret";

describe("MockOnrampProvider.createSession", () => {
  it("returns our session id and a widget config with the amount formatted in decimal USDC", async () => {
    const provider = new MockOnrampProvider(SECRET);
    const sessionId = newMockSessionId();
    const result = await provider.createSession({
      intentId: "pi_abc",
      sessionId,
      amountUsdc: 100_000_000n,
      customerWalletAddress: "0xAbC0000000000000000000000000000000000d",
      customerEmail: "buyer@example.com",
      network: "base",
    });
    expect(result.sessionId).toBe(sessionId);
    expect(result.widgetConfig).toMatchObject({
      provider: "mock",
      session_id: sessionId,
      wallet_address: "0xAbC0000000000000000000000000000000000d",
      amount: "100",
      currency: "USDC",
      network: "base",
      customer_email: "buyer@example.com",
    });
    expect(result.widgetConfig.widget_url).toContain(sessionId);
  });

  it("handles fractional amounts and a missing email", async () => {
    const provider = new MockOnrampProvider(SECRET);
    const result = await provider.createSession({
      intentId: "pi_x",
      sessionId: "s1",
      amountUsdc: 12_345_678n,
      customerWalletAddress: "0xAbC0000000000000000000000000000000000d",
      network: "base",
    });
    expect(result.widgetConfig.amount).toBe("12.345678");
    expect(result.widgetConfig.customer_email).toBeNull();
  });
});

describe("MockOnrampProvider webhook verification", () => {
  const body = JSON.stringify({ session_id: "s1", status: "completed", tx_hash: "0xdeadbeef" });

  it("accepts a correctly signed body and rejects a tampered one, a wrong secret, or a malformed header", () => {
    const provider = new MockOnrampProvider(SECRET);
    const sig = signMockOnrampWebhook(SECRET, body);
    expect(provider.verifyWebhook({ [MOCK_SIGNATURE_HEADER]: sig }, body)).toBe(true);
    expect(provider.verifyWebhook({ [MOCK_SIGNATURE_HEADER]: sig }, body + " ")).toBe(false);
    expect(new MockOnrampProvider("other-secret").verifyWebhook({ [MOCK_SIGNATURE_HEADER]: sig }, body)).toBe(false);
    expect(provider.verifyWebhook({}, body)).toBe(false);
    expect(provider.verifyWebhook({ [MOCK_SIGNATURE_HEADER]: "zz" }, body)).toBe(false);
    expect(provider.verifyWebhook({ [MOCK_SIGNATURE_HEADER]: ["a", "b"] }, body)).toBe(false);
  });

  it("throws if asked to verify without a secret configured", () => {
    const provider = new MockOnrampProvider();
    expect(() => provider.verifyWebhook({ [MOCK_SIGNATURE_HEADER]: "0".repeat(64) }, body)).toThrow(/secret is required/);
  });
});

describe("MockOnrampProvider.parseWebhook", () => {
  it("normalizes each known status and carries the tx hash when present", () => {
    const provider = new MockOnrampProvider();
    for (const status of ["created", "pending", "completed", "failed"] as const) {
      const body = JSON.stringify({ session_id: "s1", status });
      expect(provider.parseWebhook(body)).toEqual({ sessionId: "s1", type: status, txHash: undefined, raw: { session_id: "s1", status } });
    }
    const withTx = provider.parseWebhook(JSON.stringify({ session_id: "s1", status: "completed", tx_hash: "0xabc" }));
    expect(withTx.txHash).toBe("0xabc");
  });

  it("rejects malformed, incomplete or nonsensical bodies without guessing at intent", () => {
    const provider = new MockOnrampProvider();
    for (const bad of ["not json", "null", "42", '{"status":"completed"}', '{"session_id":"s1"}', '{"session_id":"s1","status":"bogus"}', '{"session_id":"s1","status":"completed","tx_hash":5}']) {
      expect(() => provider.parseWebhook(bad)).toThrow();
    }
  });

  it("works without a secret (parsing never needs one)", () => {
    const provider = new MockOnrampProvider();
    expect(provider.parseWebhook(JSON.stringify({ session_id: "s1", status: "pending" })).type).toBe("pending");
  });
});

describe("newMockSessionId", () => {
  it("is prefixed and unique", () => {
    const a = newMockSessionId();
    const b = newMockSessionId();
    expect(a).toMatch(/^mock_ses_[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
