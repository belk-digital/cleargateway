import { CHAIN_IDS } from "@belk/shared";

/**
 * Official Circle USDC addresses, verified against
 * https://developers.circle.com/stablecoins/usdc-contract-addresses (2026-09-25).
 * Runtime code should read the address from config (USDC_ADDRESS) and may use these to sanity-check it.
 */
export const CIRCLE_USDC = {
  [CHAIN_IDS.baseSepolia]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [CHAIN_IDS.base]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;
