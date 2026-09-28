import { and, eq, isNull } from "drizzle-orm";
import type { Mode } from "@belk/shared";
import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import type { IntentRow } from "./state-machine.js";
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from "./schema.js";

type AccountType = (typeof ledgerAccounts.$inferSelect)["type"];

async function getOrCreateAccount(
  tx: DbTx,
  spec: { type: AccountType; merchantId: string | null; mode: Mode },
): Promise<string> {
  const find = async () => {
    const [row] = await tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.type, spec.type),
          spec.merchantId ? eq(ledgerAccounts.merchantId, spec.merchantId) : isNull(ledgerAccounts.merchantId),
          eq(ledgerAccounts.mode, spec.mode),
          eq(ledgerAccounts.currency, "USDC"),
        ),
      )
      .limit(1);
    return row?.id;
  };
  const existing = await find();
  if (existing) return existing;
  // Concurrent creators race on the unique index; the loser's insert is a no-op and it re-reads.
  await tx.insert(ledgerAccounts).values({ id: newId("acc"), ...spec }).onConflictDoNothing();
  const created = await find();
  if (!created) throw new Error(`could not create ledger account ${spec.type}`);
  return created;
}

/**
 * Books a confirmed payment as ONE balanced ledger transaction:
 *   debit  customer_payments_clearing   amount
 *   credit merchant_receivable(m)       amount - fee
 *   credit platform_fee_revenue         fee
 * Idempotent: a payment already booked returns the existing transaction id. The database additionally enforces
 * one settled transaction per intent (unique index) and debits = credits per transaction (deferred trigger).
 * Must be called inside the same DB transaction that marks the intent `succeeded`.
 */
export async function postPaymentSettled(tx: DbTx, intent: IntentRow): Promise<{ ledgerTransactionId: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.intentId, intent.id), eq(ledgerTransactions.kind, "payment_settled")))
    .limit(1);
  if (existing) return { ledgerTransactionId: existing.id, created: false };

  const [clearing, feeRevenue, receivable] = await Promise.all([
    getOrCreateAccount(tx, { type: "customer_payments_clearing", merchantId: null, mode: intent.mode }),
    getOrCreateAccount(tx, { type: "platform_fee_revenue", merchantId: null, mode: intent.mode }),
    getOrCreateAccount(tx, { type: "merchant_receivable", merchantId: intent.merchantId, mode: intent.mode }),
  ]);

  const txId = newId("ltx");
  await tx.insert(ledgerTransactions).values({ id: txId, intentId: intent.id, kind: "payment_settled" });

  const entries: (typeof ledgerEntries.$inferInsert)[] = [
    { id: newId("lent"), transactionId: txId, accountId: clearing, direction: "debit", amount: intent.amount },
  ];
  if (intent.merchantAmount > 0n) {
    entries.push({ id: newId("lent"), transactionId: txId, accountId: receivable, direction: "credit", amount: intent.merchantAmount });
  }
  if (intent.feeAmount > 0n) {
    entries.push({ id: newId("lent"), transactionId: txId, accountId: feeRevenue, direction: "credit", amount: intent.feeAmount });
  }
  await tx.insert(ledgerEntries).values(entries);
  return { ledgerTransactionId: txId, created: true };
}
