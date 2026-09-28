import { describe, expect, it } from "vitest";
import type { OnrampProvider } from "./provider.js";
import { SimplexOnrampProvider } from "./simplex.js";
import { WertOnrampProvider } from "./wert.js";

const providers: [string, OnrampProvider][] = [
  ["wert", new WertOnrampProvider()],
  ["simplex", new SimplexOnrampProvider()],
];

describe.each(providers)("%s stub (not implemented)", (_label, provider) => {
  it("has the correct name and never claims to succeed", async () => {
    await expect(
      provider.createSession({ intentId: "pi_x", sessionId: "s1", amountUsdc: 1_000_000n, customerWalletAddress: "0xAbC0000000000000000000000000000000000d", network: "base" }),
    ).rejects.toThrow(/TODO\(verify\)/);
    expect(() => provider.verifyWebhook({}, "{}")).toThrow(/TODO\(verify\)/);
    expect(() => provider.parseWebhook("{}")).toThrow(/TODO\(verify\)/);
  });
});

describe("stub identity", () => {
  it("each stub reports its own provider name", () => {
    expect(new WertOnrampProvider().name).toBe("wert");
    expect(new SimplexOnrampProvider().name).toBe("simplex");
  });
});
