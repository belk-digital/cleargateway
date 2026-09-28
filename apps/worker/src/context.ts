import type { IntentSigner } from "@belk/chain";
import type { Db } from "@belk/db";
import type { OnrampProvider, OnrampProviderName } from "@belk/onramp";
import type { Account, Chain, Transport, WalletClient } from "viem";
import type { PublicClient } from "viem";
import type { WorkerConfig } from "./config.js";

/** Minimal logger surface (pino satisfies it); tests pass a silent one. */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Everything a job needs. Jobs are plain functions of (ctx) so tests can run them deterministically. */
export interface WorkerCtx {
  db: Db;
  chain: PublicClient;
  config: WorkerConfig;
  log: Logger;
  /** Injectable clock (unix ms) for time-dependent jobs. Defaults to Date.now. */
  now?: () => number;
  /** Signs sweep (and future rescue) intents. Sweeping is disabled without one. */
  signer?: IntentSigner;
  /** Gas-only account that submits sweep transactions. Sweeping is disabled without one. */
  relayer?: WalletClient<Transport, Chain, Account>;
  /** Providers used to parse already-verified, already-stored on-ramp webhooks. Only `parseWebhook` is called here. */
  onrampProviders?: Record<OnrampProviderName, OnrampProvider>;
}

export const nowMs = (ctx: WorkerCtx): number => (ctx.now ? ctx.now() : Date.now());

/**
 * True only for viem's "receipt not found" error. Matched by name, not `instanceof`: with more than one copy of viem in the
 * workspace (pnpm can install variants per peer-dependency set) the class seen here may differ from the one the client threw.
 * Any other error (network, rate limit) must NOT be read as "the tx is missing".
 */
export function isReceiptNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === "TransactionReceiptNotFoundError";
}
