import { createPublicClient, defineChain, getAbiItem, http, parseAbiItem, type PublicClient } from "viem";
import { clearGatewaySplitterAbi } from "./abis/ClearGatewaySplitter.js";

/** `PaymentSettled(bytes32 indexed intentId, address indexed payer, address indexed merchant, uint256 amount, uint256 fee)` */
export const paymentSettledEvent = getAbiItem({ abi: clearGatewaySplitterAbi, name: "PaymentSettled" });

/** Chain definition for any EVM RPC (Base Sepolia 84532 in Phase 1; a local Anvil is started with --chain-id 84532). */
export function defineEvmChain(id: number, rpcUrl: string) {
  return defineChain({
    id,
    name: id === 84532 ? "Base Sepolia" : `chain-${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function createChainClient(rpcUrl: string, chainId: number): PublicClient {
  // Explicit timeout + retries: a flaky RPC must not hang a worker tick.
  return createPublicClient({
    chain: defineEvmChain(chainId, rpcUrl),
    // viem caches getBlockNumber for ~4s by default; a payment watcher must always see the real head.
    cacheTime: 0,
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }),
  }) as PublicClient;
}

/** ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)`: how deposits to our addresses are detected. */
export const erc20TransferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
