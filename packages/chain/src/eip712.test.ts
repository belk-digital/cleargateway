import { hashDomain, hashTypedData, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { PAYMENT_INTENT_TYPES, splitterDomain } from "./eip712.js";

// Fixed inputs mirrored from contracts/test/DigestVector.t.sol. The expected hashes were produced by the
// Solidity contract; viem must reproduce them or the backend's signatures would be rejected on-chain.
const SPLITTER = "0x1111111111111111111111111111111111111111";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

describe("EIP-712 parity with ClearGatewaySplitter.sol", () => {
  it("matches the contract's domain separator", () => {
    const domain = splitterDomain(84532, SPLITTER);
    expect(hashDomain({ domain, types: { EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ] } })).toBe("0x2298290c89de0096cccec4a5679e3f7a6d4bd9acebac1856fcba291f81a9c8a1");
  });

  it("matches the contract's payment intent digest", () => {
    const digest = hashTypedData({
      domain: splitterDomain(84532, SPLITTER),
      types: PAYMENT_INTENT_TYPES,
      primaryType: "PaymentIntent",
      message: {
        intentId: keccak256(toHex("pi_vector")),
        merchant: "0x2222222222222222222222222222222222222222",
        token: USDC,
        payer: "0x3333333333333333333333333333333333333333",
        amount: 100_000_000n,
        feeBps: 200n,
        expiry: 1_800_000_000n,
      },
    });
    expect(digest).toBe("0x674e5df85b0bb2ae873e90a4535582598bef6c7e7ae779a23c3ed5c590763e81");
  });
});
