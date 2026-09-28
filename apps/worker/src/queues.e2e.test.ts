import { paymentIntents, reconciliationRuns } from "@belk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWorkers, type RunningWorkers } from "./queues.js";
import {
  apiClient,
  makeStack,
  mintTo,
  newAccount,
  payWithApprove,
  seedMerchant,
  startReceiver,
  type Receiver,
  type Stack,
  type WalletPayload,
} from "./test/harness.js";

let s: Stack;
let receiver: Receiver;
let running: RunningWorkers | undefined;

beforeAll(async () => {
  // Fast schedules so the real BullMQ wiring finishes within seconds.
  s = await makeStack({
    worker: { WATCHER_INTERVAL_MS: "300", CONFIRMATIONS_INTERVAL_MS: "300", EXPIRY_INTERVAL_MS: "600", WEBHOOK_INTERVAL_MS: "300", CONFIRMATIONS: "2" },
  });
  receiver = await startReceiver();
});
afterAll(async () => {
  await running?.close();
  await receiver?.close();
  await s?.close();
});

const until = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 250));
  }
};

describe("BullMQ wiring (schedulers + workers running for real)", () => {
  it("processes a payment end to end with no manual job calls, and runs reconciliation on demand", async () => {
    const m = await seedMerchant(s);
    const api = apiClient(s, m.apiKey);
    await api("POST", "/v1/webhook_endpoints", { url: receiver.url });

    // Clean slate for this Redis DB (test isolation), then start the real workers.
    await s.redis.flushdb();
    running = await startWorkers(s.ctx, s.apiConfig.REDIS_URL);

    const payer = newAccount();
    await s.chain.fund(payer.address);
    await mintTo(s.chain, payer.address, 50_000_000n);
    const created = await api("POST", "/v1/payment_intents", { amount: "50000000" });
    const wp = await s.app.inject({
      method: "POST",
      url: `/v1/checkout/${created.json.id}/wallet-payment`,
      headers: { "x-client-secret": created.json.client_secret, "content-type": "application/json" },
      payload: JSON.stringify({ payer_address: payer.address }),
    });
    const payHash = await payWithApprove(s.chain, payer, wp.json() as WalletPayload);
    await s.chain.publicClient.waitForTransactionReceipt({ hash: payHash });

    // The watcher (scheduled job) picks it up; keep the chain moving so confirmations accrue.
    await until(async () => (await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, created.json.id)))[0]?.status === "confirming");
    await s.chain.mine(2);
    const done = await until(async () => {
      const [row] = await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, created.json.id));
      return row?.status === "succeeded" ? row : false;
    });
    expect(done.txHash).toBe(payHash.toLowerCase());

    // Webhook delivery job sent it.
    const hook = await until(async () => receiver.received.find((r) => r.body.includes(created.json.id) && r.body.includes("payment_intent.succeeded")));
    expect(hook.headers["cleargateway-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // On-demand reconciliation through the queue.
    const before = (await s.db.select().from(reconciliationRuns)).length;
    await running.enqueueReconcile();
    await until(async () => (await s.db.select().from(reconciliationRuns)).length > before);
    // An on-demand run is recorded as such (scheduled runs use "schedule").
    const runs = await s.db.select().from(reconciliationRuns);
    expect(runs.some((r) => r.trigger === "manual")).toBe(true);
  });
});
