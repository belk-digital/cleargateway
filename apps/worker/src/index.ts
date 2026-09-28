import { createChainClient, defineEvmChain, EnvSigner } from "@belk/chain";
import { createDb } from "@belk/db";
import { MockOnrampProvider, SimplexOnrampProvider, WertOnrampProvider } from "@belk/onramp";
import * as Sentry from "@sentry/node";
import { pino } from "pino";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadWorkerConfig } from "./config.js";
import type { WorkerCtx } from "./context.js";
import { startWorkers } from "./queues.js";

const config = loadWorkerConfig();
const log = pino({ level: config.LOG_LEVEL, base: { app: "worker" } });
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });

const { db, close: closeDb } = createDb(config.DATABASE_URL);
const chain = createChainClient(config.RPC_URL, config.CHAIN_ID);

// Testnet/dev signer + relayer from env. Production swaps the signer for a KmsSigner (see @belk/chain).
const signer = config.SIGNER_PRIVATE_KEY ? new EnvSigner(config.SIGNER_PRIVATE_KEY as `0x${string}`) : undefined;
const relayer = config.RELAYER_PRIVATE_KEY
  ? createWalletClient({
      account: privateKeyToAccount(config.RELAYER_PRIVATE_KEY as `0x${string}`),
      chain: defineEvmChain(config.CHAIN_ID, config.RPC_URL),
      transport: http(config.RPC_URL, { timeout: 15_000, retryCount: 2 }),
    })
  : undefined;
if (config.DEPOSIT_FACTORY_ADDRESS && (!signer || !relayer)) {
  log.warn("DEPOSIT_FACTORY_ADDRESS set but SIGNER_PRIVATE_KEY/RELAYER_PRIVATE_KEY missing: sweeping is disabled");
}
// Only parseWebhook is ever called on these (already-verified payloads); no secret is needed for that.
const onrampProviders = { mock: new MockOnrampProvider(), wert: new WertOnrampProvider(), simplex: new SimplexOnrampProvider() };
const ctx: WorkerCtx = { db, chain, config, log, signer, relayer, onrampProviders };

const running = await startWorkers(ctx, config.REDIS_URL, (err, queue) => {
  Sentry.captureException(err, { tags: { queue } });
});
log.info({ chainId: config.CHAIN_ID, splitter: config.SPLITTER_ADDRESS, confirmations: config.CONFIRMATIONS }, "worker started");

const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  await running.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
