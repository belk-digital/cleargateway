import type { Address, Hex } from "viem";

/**
 * EIP-712 types for ClearGatewaySplitter payment intents. MUST match PAYMENT_INTENT_TYPEHASH in ClearGatewaySplitter.sol:
 * "PaymentIntent(bytes32 intentId,address merchant,address token,address payer,uint256 amount,uint256 feeBps,uint256 expiry)"
 */
export const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: "intentId", type: "bytes32" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "payer", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "feeBps", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export interface PaymentIntentMessage {
  intentId: Hex;
  merchant: Address;
  token: Address;
  payer: Address;
  amount: bigint;
  feeBps: bigint;
  expiry: bigint;
}

/** EIP-712 domain of the deployed splitter (name/version fixed in the contract constructor). */
export function splitterDomain(chainId: number, verifyingContract: Address) {
  return { name: "ClearGatewaySplitter", version: "1", chainId, verifyingContract } as const;
}

/** EIP-3009 typed data USDC verifies for receiveWithAuthorization (nonce = intentId). */
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * EIP-712 domain of Circle's USDC, verified on-chain against Base Sepolia (2026-09-25):
 * DOMAIN_SEPARATOR() == hash(name "USDC", version "2", chainId 84532, verifyingContract).
 * TODO(verify): re-check `name`/`version` on Base mainnet USDC before any mainnet use.
 */
export function usdcDomain(chainId: number, verifyingContract: Address) {
  return { name: "USDC", version: "2", chainId, verifyingContract } as const;
}
