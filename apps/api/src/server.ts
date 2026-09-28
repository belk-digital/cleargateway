import { createChainClient } from "@belk/chain";
import { createDb } from "@belk/db";
import { sql } from "drizzle-orm";
import { QUEUE_NAMES } from "@belk/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { EnvSigner } from "./signer/index.js";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });

// Testnet/dev signer from env. Production swaps in KmsSigner (see signer/kms-signer.ts).
const signer = config.SIGNER_PRIVATE_KEY ? new EnvSigner(config.SIGNER_PRIVATE_KEY as `0x${string}`) : undefined;
// Only used to read the current block when issuing a deposit address; no writes, no signing.
const chain = createChainClient(config.RPC_URL, config.CHAIN_ID);

// Chain-webhook fast signal: ask the worker to poll the chain right now (deduped for 1s). The poller stays authoritative.
const watcherQueue = new Queue(QUEUE_NAMES.chainWatcher, { connection: new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }), prefix: "belk" });

const reconcileQueue = new Queue(QUEUE_NAMES.reconciliation, { connection: new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }), prefix: "belk" });

const app = await buildApp({
  config,
  db,
  redis,
  signer,
  chain,
  // Internal API: ask the worker to run reconciliation now. The job itself (which needs the chain) runs in the worker.
  enqueueReconcile: async () => {
    await reconcileQueue.add("manual", {}, { removeOnComplete: 20, removeOnFail: 100 });
  },
  signalWatcher: async () => {
    await watcherQueue.add("watch-now", {}, { deduplication: { id: "watch-now", ttl: 1000 }, removeOnComplete: 20, removeOnFail: 50 });
  },
  readinessChecks: {
    postgres: async () => {
      await db.execute(sql`select 1`);
    },
    redis: async () => {
      await redis.ping();
    },
  },
});

if (!signer) app.log.warn("SIGNER_PRIVATE_KEY not set: wallet payments will return 503 not_configured");
if (!config.SPLITTER_ADDRESS) app.log.warn("SPLITTER_ADDRESS not set: wallet payments will return 503 not_configured");
if (!config.DEPOSIT_FACTORY_ADDRESS) app.log.warn("DEPOSIT_FACTORY_ADDRESS not set: deposit addresses will return 503 not_configured");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await watcherQueue.close();
  await reconcileQueue.close();
  redis.disconnect();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.PORT, host: config.HOST });
