import { QUEUE_NAMES } from "@belk/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { WorkerCtx } from "./context.js";
import { runChainWatcher } from "./jobs/chain-watcher.js";
import { runDepositWatcher } from "./jobs/deposit-watcher.js";
import { runSweeper } from "./jobs/sweeper.js";
import { runConfirmations } from "./jobs/confirmations.js";
import { runExpiry } from "./jobs/expiry.js";
import { runOnrampProcessor } from "./jobs/onramp-processor.js";
import { runReconciliation } from "./jobs/reconciliation.js";
import { runWebhookDelivery } from "./jobs/webhook-delivery.js";

interface JobDef {
  queue: string;
  /** Repeat every N ms, or on a cron pattern. */
  schedule: { every: number } | { pattern: string };
  run: (ctx: WorkerCtx, jobName: string) => Promise<unknown>;
}

function jobDefs(ctx: WorkerCtx): JobDef[] {
  const c = ctx.config;
  return [
    { queue: QUEUE_NAMES.chainWatcher, schedule: { every: c.WATCHER_INTERVAL_MS }, run: runChainWatcher },
    { queue: QUEUE_NAMES.depositWatcher, schedule: { every: c.DEPOSIT_INTERVAL_MS }, run: runDepositWatcher },
    { queue: QUEUE_NAMES.sweeper, schedule: { every: c.SWEEP_INTERVAL_MS }, run: runSweeper },
    { queue: QUEUE_NAMES.confirmations, schedule: { every: c.CONFIRMATIONS_INTERVAL_MS }, run: runConfirmations },
    { queue: QUEUE_NAMES.expiry, schedule: { every: c.EXPIRY_INTERVAL_MS }, run: runExpiry },
    { queue: QUEUE_NAMES.webhookDelivery, schedule: { every: c.WEBHOOK_INTERVAL_MS }, run: (x) => runWebhookDelivery(x) },
    { queue: QUEUE_NAMES.reconciliation, schedule: { pattern: c.RECONCILE_CRON }, run: (x, name) => runReconciliation(x, { trigger: name === "manual" ? "manual" : "schedule" }) },
    { queue: QUEUE_NAMES.onrampProcessor, schedule: { every: c.ONRAMP_INTERVAL_MS }, run: runOnrampProcessor },
  ];
}

export interface RunningWorkers {
  queues: Record<string, Queue>;
  /** Run reconciliation now (what the admin API triggers; recorded with trigger "manual"). */
  enqueueReconcile: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Starts one BullMQ Worker (concurrency 1) per job type plus a repeatable scheduler for each. Jobs are idempotent
 * and take row locks, so running several worker processes is safe; BullMQ additionally hands each tick to one worker.
 */
export async function startWorkers(ctx: WorkerCtx, redisUrl: string, onFailure?: (err: Error, queue: string) => void): Promise<RunningWorkers> {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }); // required by BullMQ workers
  const queues: Record<string, Queue> = {};
  const workers: Worker[] = [];

  for (const def of jobDefs(ctx)) {
    const queue = new Queue(def.queue, { connection, prefix: "belk" });
    queues[def.queue] = queue;
    await queue.upsertJobScheduler(
      `${def.queue}-scheduler`,
      def.schedule,
      { name: "tick", opts: { removeOnComplete: 20, removeOnFail: 100, attempts: 1 } },
    );

    const worker = new Worker(
      def.queue,
      async (job) => {
        const started = Date.now();
        const result = await def.run(ctx, job.name);
        ctx.log.info({ queue: def.queue, ms: Date.now() - started }, "job finished");
        return JSON.parse(JSON.stringify(result ?? null, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
      },
      { connection, prefix: "belk", concurrency: 1 },
    );
    worker.on("failed", (job, err) => {
      ctx.log.error({ queue: def.queue, jobId: job?.id, err }, "job failed");
      onFailure?.(err, def.queue);
    });
    workers.push(worker);
  }

  const reconcileQueue = queues[QUEUE_NAMES.reconciliation] as Queue;
  return {
    queues,
    enqueueReconcile: async () => {
      await reconcileQueue.add("manual", {}, { removeOnComplete: 20, removeOnFail: 100 });
    },
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(Object.values(queues).map((q) => q.close()));
      connection.disconnect();
    },
  };
}
