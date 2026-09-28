import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { ledgerAccounts, ledgerEntries, ledgerTransactions, merchants, paymentEvents, paymentIntents } from "./schema.js";

// Requires Postgres (docker compose up -d). vitest.global-setup.ts creates + migrates a throwaway database.
const testUrl = process.env.TEST_DATABASE_URL as string;

let ctx: ReturnType<typeof createDb>;
let merchantId: string;
let clearingId: string;
let feeId: string;
let receivableId: string;

async function makeIntent() {
  const id = newId("pi");
  await ctx.db.insert(paymentIntents).values({
    id,
    merchantId,
    mode: "test",
    amount: 100_000_000n,
    feeBps: 200,
    feeAmount: 2_000_000n,
    merchantAmount: 98_000_000n,
    clientSecretHash: "x",
    chainId: 84532,
    intentHash: `0x${id}`,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return id;
}

beforeAll(async () => {
  ctx = createDb(testUrl);

  merchantId = newId("mer");
  await ctx.db.insert(merchants).values({
    id: merchantId,
    legalName: "T",
    displayName: "T",
    payoutWalletAddress: "0x000000000000000000000000000000000000dEaD",
    feeBps: 200,
  });
  [clearingId, feeId, receivableId] = [newId("acc"), newId("acc"), newId("acc")];
  await ctx.db.insert(ledgerAccounts).values([
    // Distinct currency label keeps these platform-level accounts from colliding with other test files.
    { id: clearingId, type: "customer_payments_clearing", mode: "test", currency: "USDC-integrity" },
    { id: feeId, type: "platform_fee_revenue", mode: "test", currency: "USDC-integrity" },
    { id: receivableId, type: "merchant_receivable", merchantId, mode: "test" },
  ]);
});

afterAll(async () => {
  await ctx?.close();
});

describe("payment_intents constraints", () => {
  it("round-trips bigint amounts above 2^53 without precision loss", async () => {
    const id = newId("pi");
    const big = 9_007_199_254_740_993n * 10n;
    await ctx.db.insert(paymentIntents).values({
      id,
      merchantId,
      mode: "test",
      amount: big,
      feeBps: 0,
      feeAmount: 0n,
      merchantAmount: big,
      clientSecretHash: "x",
      chainId: 84532,
      intentHash: `0x${id}`,
      expiresAt: new Date(),
    });
    const [row] = await ctx.db.select().from(paymentIntents).where(sql`${paymentIntents.id} = ${id}`);
    expect(row?.amount).toBe(big);
  });

  it("rejects fee + merchant amount that do not sum to the total", async () => {
    const id = newId("pi");
    await expect(
      ctx.db.insert(paymentIntents).values({
        id,
        merchantId,
        mode: "test",
        amount: 100n,
        feeBps: 200,
        feeAmount: 2n,
        merchantAmount: 99n,
        clientSecretHash: "x",
        chainId: 84532,
        intentHash: `0x${id}`,
        expiresAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe("append-only audit log", () => {
  it("allows inserts but blocks UPDATE and DELETE on payment_events", async () => {
    const intentId = await makeIntent();
    const eventId = newId("evt");
    await ctx.db.insert(paymentEvents).values({ id: eventId, intentId, toStatus: "created", actor: "test" });
    await expect(ctx.db.execute(sql`UPDATE payment_events SET reason = 'x' WHERE id = ${eventId}`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`DELETE FROM payment_events WHERE id = ${eventId}`)).rejects.toThrow();
  });
});

describe("double-entry ledger", () => {
  const entry = (transactionId: string, accountId: string, direction: "debit" | "credit", amount: bigint) => ({
    id: newId("lent"),
    transactionId,
    accountId,
    direction,
    amount,
  });

  it("commits a balanced transaction (100 = 98 + 2)", async () => {
    const intentId = await makeIntent();
    const txId = newId("ltx");
    await ctx.db.transaction(async (tx) => {
      await tx.insert(ledgerTransactions).values({ id: txId, intentId, kind: "payment_settled" });
      await tx.insert(ledgerEntries).values([
        entry(txId, clearingId, "debit", 100_000_000n),
        entry(txId, receivableId, "credit", 98_000_000n),
        entry(txId, feeId, "credit", 2_000_000n),
      ]);
    });
    const rows = await ctx.db.select().from(ledgerEntries).where(sql`${ledgerEntries.transactionId} = ${txId}`);
    expect(rows).toHaveLength(3);
  });

  it("rejects an unbalanced transaction at commit", async () => {
    const intentId = await makeIntent();
    const txId = newId("ltx");
    await expect(
      ctx.db.transaction(async (tx) => {
        await tx.insert(ledgerTransactions).values({ id: txId, intentId, kind: "payment_settled" });
        await tx.insert(ledgerEntries).values([
          entry(txId, clearingId, "debit", 100_000_000n),
          entry(txId, receivableId, "credit", 98_000_000n),
        ]);
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it("blocks UPDATE and DELETE on ledger entries", async () => {
    await expect(ctx.db.execute(sql`UPDATE ledger_entries SET amount = 1`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`DELETE FROM ledger_entries`)).rejects.toThrow();
  });
});
