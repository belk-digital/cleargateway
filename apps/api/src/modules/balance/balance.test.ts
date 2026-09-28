import { ledgerAccounts, ledgerEntries, ledgerTransactions, newId } from "@belk/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, makeHarness, seedMerchant, type Harness } from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  h = await makeHarness();
  api = client(h);
});
afterAll(async () => {
  await h.close();
});

describe("GET /v1/balance", () => {
  it("is all zeros for a merchant with no ledger activity", async () => {
    const m = await seedMerchant(h);
    const res = await api("GET", "/v1/balance", { key: m.apiKey });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ mode: "test", currency: "USDC", settled: "0", refunded: "0", net: "0", settled_payments: 0 });
  });

  it("is derived from ledger entries, not from payment intents", async () => {
    const m = await seedMerchant(h);
    const other = await seedMerchant(h);

    const mk = async (merchantId: string) => {
      const [clearing, fee, recv] = [newId("acc"), newId("acc"), newId("acc")];
      await h.db.insert(ledgerAccounts).values([
        { id: clearing, type: "customer_payments_clearing", mode: "test", currency: `USDC-${merchantId}` },
        { id: fee, type: "platform_fee_revenue", mode: "test", currency: `USDC-${merchantId}` },
        { id: recv, type: "merchant_receivable", merchantId, mode: "test" },
      ]);
      return { clearing, fee, recv };
    };
    const a = await mk(m.merchantId);
    const b = await mk(other.merchantId);

    const settle = async (acc: { clearing: string; fee: string; recv: string }, total: bigint, fee: bigint) => {
      const txId = newId("ltx");
      await h.db.transaction(async (tx) => {
        await tx.insert(ledgerTransactions).values({ id: txId, kind: "payment_settled" });
        await tx.insert(ledgerEntries).values([
          { id: newId("lent"), transactionId: txId, accountId: acc.clearing, direction: "debit", amount: total },
          { id: newId("lent"), transactionId: txId, accountId: acc.recv, direction: "credit", amount: total - fee },
          { id: newId("lent"), transactionId: txId, accountId: acc.fee, direction: "credit", amount: fee },
        ]);
      });
    };
    await settle(a, 100_000_000n, 2_000_000n);
    await settle(a, 50_000_000n, 1_000_000n);
    await settle(b, 999_000_000n, 1n); // another merchant's activity must not leak in

    // A refund of 10 USDC reverses receivable/clearing.
    const refundTx = newId("ltx");
    await h.db.transaction(async (tx) => {
      await tx.insert(ledgerTransactions).values({ id: refundTx, kind: "refund" });
      await tx.insert(ledgerEntries).values([
        { id: newId("lent"), transactionId: refundTx, accountId: a.recv, direction: "debit", amount: 10_000_000n },
        { id: newId("lent"), transactionId: refundTx, accountId: a.clearing, direction: "credit", amount: 10_000_000n },
      ]);
    });

    const res = await api("GET", "/v1/balance", { key: m.apiKey });
    expect(res.json).toMatchObject({
      settled: "147000000", // (100 - 2) + (50 - 1) USDC
      refunded: "10000000",
      net: "137000000",
      settled_payments: 2,
    });
  });

  it("requires authentication", async () => {
    expect((await api("GET", "/v1/balance")).status).toBe(401);
  });
});
