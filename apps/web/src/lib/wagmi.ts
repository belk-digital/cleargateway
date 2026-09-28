import { createConfig, http, injected } from "wagmi";
import { baseSepolia } from "wagmi/chains";

/** Base Sepolia (84532) only. No mainnet in Phase 1. */
export const CHAIN = baseSepolia;

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http() },
  ssr: true,
});

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const splitterPayAbi = [
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "intentId", type: "bytes32" },
          { name: "merchant", type: "address" },
          { name: "payer", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      },
      { name: "intentSignature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
