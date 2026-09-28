import { createChainClient } from "@belk/chain";
import { createDb } from "@belk/db";
import { pino } from "pino";
import { loadWorkerConfig } from "./config.js";
import { runReconciliation } from "./jobs/reconciliation.js";

// On-demand reconciliation: `pnpm --filter @belk/worker reconcile`. Reports only; exits 1 on any mismatch.
const config = loadWorkerConfig();
const { db, close } = createDb(config.DATABASE_URL);
const chain = createChainClient(config.RPC_URL, config.CHAIN_ID);
const result = await runReconciliation({ db, chain, config, log: pino({ level: config.LOG_LEVEL }) }, { trigger: "manual" });
console.log(JSON.stringify({ runId: result.runId, status: result.status, ...result.report }, null, 2));
await close();
process.exit(result.status === "ok" ? 0 : 1);
