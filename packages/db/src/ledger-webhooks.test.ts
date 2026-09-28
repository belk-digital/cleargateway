import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { postPaymentSettled } from "./ledger.js";
import { ledgerEntries, ledgerTransactions, merchants, webhookDeliveries, webhookEndpoints } from "./schema.js";
import { createIntent, type IntentRow } from "./state-machine.js";
import { enqueueIntentEvent, eventId } from "./webhooks.js";

const ctx = createDb(process.env.TEST_DATABASE_URL as string);
let merchantId: string;

async function newIntent(amount: bigint, feeBps: number): Promise<IntentRow> {
  const id = newId("pi");
  const fee = (amount * BigInt(feeBps)) / 10_000n;
  return ctx.db.transaction((tx) =>
    createIntent(
      tx,
      {
        id, merchantId, mode: "test", amount, feeBps, feeAmount: fee, merchantAmount: amount - fee,
        clientSecretHash: "x", chainId: 84532, intentHash: `0x${id}`, expiresAt: new Date(Date.now() + 3600_000),
      },
      "test",
    ),
  );
}

beforeAll(async () => {
  merchantId = newId("mer");
  await ctx.db.insert(merchants).values({
    id: merchantId, legalName: "T", displayName: "T", payoutWalletAddress: "0x000000000000000000000000000000000000dEaD", feeBps: 200,
  });
});
afterAll(async () => {
  await ctx.close();
});

describe("postPaymentSettled", () => {
  it("books one balanced transaction: debit clearing 100, credit merchant 98 + fee 2", async () => {
    const intent = await newIntent(100_000_000n, 200);
    const r = await ctx.db.transaction((tx) => postPaymentSettled(tx, intent));
    expect(r.created).toBe(true);
    const entries = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, r.ledgerTransactionId));
    const sum = (d: string) => entries.filter((e) => e.direction === d).reduce((a, e) => a + e.amount, 0n);
    expect(sum("debit")).toBe(100_000_000n);
    expect(sum("credit")).toBe(100_000_000n);
    expect(entries).toHaveLength(3);
  });

  it("is idempotent: booking twice creates nothing new", async () => {
    const intent = await newIntent(50_000_000n, 200);
    const a = await ctx.db.transaction((tx) => postPaymentSettled(tx, intent));
    const b = await ctx.db.transaction((tx) => postPaymentSettled(tx, intent));
    expect(b).toEqual({ ledgerTransactionId: a.ledgerTransactionId, created: false });
    const txs = await ctx.db.select().from(ledgerTransactions).where(and(eq(ledgerTransactions.intentId, intent.id)));
    expect(txs).toHaveLength(1);
  });

  it("survives a race: two concurrent bookings yield exactly one ledger transaction", async () => {
    const intent = await newIntent(75_000_000n, 300);
    const results = await Promise.allSettled([
      ctx.db.transaction((tx) => postPaymentSettled(tx, intent)),
      ctx.db.transaction((tx) => postPaymentSettled(tx, intent)),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const txs = await ctx.db.select().from(ledgerTransactions).where(eq(ledgerTransactions.intentId, intent.id));
    expect(txs).toHaveLength(1);
  });

  it("skips zero-value legs (0 bps fee -> 2 entries) and stays balanced", async () => {
    const intent = await newIntent(10_000_000n, 0);
    const r = await ctx.db.transaction((tx) => postPaymentSettled(tx, intent));
    const entries = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, r.ledgerTransactionId));
    expect(entries).toHaveLength(2);
  });

  it("the database refuses a second settled transaction for the same intent even if code is bypassed", async () => {
    const intent = await newIntent(1_000_000n, 200);
    await ctx.db.transaction((tx) => postPaymentSettled(tx, intent));
    await expect(
      ctx.db.insert(ledgerTransactions).values({ id: newId("ltx"), intentId: intent.id, kind: "payment_settled" }),
    ).rejects.toThrow();
  });
});

describe("webhook outbox", () => {
  it("event ids are deterministic and depend on type, subject and discriminator", () => {
    expect(eventId("payment_intent.succeeded", "pi_1")).toBe(eventId("payment_intent.succeeded", "pi_1"));
    expect(eventId("payment_intent.succeeded", "pi_1")).not.toBe(eventId("payment_intent.expired", "pi_1"));
    expect(eventId("payment_intent.requires_review", "pi_1", "a")).not.toBe(eventId("payment_intent.requires_review", "pi_1", "b"));
    expect(eventId("payment_intent.succeeded", "pi_1")).toMatch(/^evt_[0-9a-f]{32}$/);
  });

  it("enqueues one delivery per subscribed endpoint, skips disabled/deleted/unsubscribed, and is idempotent", async () => {
    const mid = newId("mer");
    await ctx.db.insert(merchants).values({
      id: mid, legalName: "W", displayName: "W", payoutWalletAddress: "0x000000000000000000000000000000000000dEaD", feeBps: 200,
    });
    const mk = (over: Partial<typeof webhookEndpoints.$inferInsert>) =>
      ctx.db.insert(webhookEndpoints).values({ id: newId("we"), merchantId: mid, mode: "test", url: "http://x", secretEncrypted: "s", ...over }).returning();
    const [all] = await mk({});
    const [only] = await mk({ enabledEvents: ["payment_intent.succeeded"] });
    await mk({ enabledEvents: ["payment_intent.expired"] });
    await mk({ status: "disabled" });
    await mk({ deletedAt: new Date() });
    await mk({ mode: "live" });

    const intent = await ctx.db.transaction((tx) =>
      createIntent(
        tx,
        { id: newId("pi"), merchantId: mid, mode: "test", amount: 1_000_000n, feeBps: 0, feeAmount: 0n, merchantAmount: 1_000_000n,
          clientSecretHash: "x", chainId: 84532, intentHash: `0x${newId("pi")}`, expiresAt: new Date(Date.now() + 1000) },
        "test",
      ),
    );
    const n1 = await ctx.db.transaction((tx) => enqueueIntentEvent(tx, intent, "payment_intent.succeeded"));
    const n2 = await ctx.db.transaction((tx) => enqueueIntentEvent(tx, intent, "payment_intent.succeeded"));
    expect(n1).toBe(2);
    expect(n2).toBe(0);
    const rows = await ctx.db.select().from(webhookDeliveries);
    const mine = rows.filter((r) => [all?.id, only?.id].includes(r.endpointId));
    expect(mine).toHaveLength(2);
    expect(mine[0]?.payload).toMatchObject({ type: "payment_intent.succeeded", data: { object: { id: intent.id, amount: "1000000" } } });
    expect(new Set(mine.map((r) => r.eventId)).size).toBe(1);
  });

  it("enqueues nothing (and rolls back cleanly) when the surrounding transaction fails", async () => {
    const before = (await ctx.db.select().from(webhookDeliveries)).length;
    const intent = await newIntent(1_000_000n, 0);
    await expect(
      ctx.db.transaction(async (tx) => {
        await enqueueIntentEvent(tx, intent, "payment_intent.failed");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await ctx.db.select().from(webhookDeliveries)).length).toBe(before);
  });
});
