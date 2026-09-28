import { AppError } from "@belk/shared";
import { eq } from "drizzle-orm";
import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import { depositAddresses, paymentIntents } from "./schema.js";
import { recordIntentEvent, transitionIntent } from "./state-machine.js";

export type DepositAddressRow = typeof depositAddresses.$inferSelect;

/**
 * Attaches a deposit address to a payment intent and moves it created -> awaiting_payment (audited).
 * Idempotent: an intent that already has an address returns the existing row, so the customer always sees the same
 * address. The address itself is computed by the caller (see `predictDepositAddress` in @belk/chain), which also
 * reads the current chain head as `creationBlock` so scanning never starts before the address existed.
 *
 * Only intents that can still be paid may get an address.
 */
export async function issueDepositAddress(
  tx: DbTx,
  input: {
    intentId: string;
    chainId: number;
    address: string;
    factory: string;
    implementation: string;
    salt: string;
    creationBlock: bigint;
    actor: string;
  },
): Promise<{ row: DepositAddressRow; created: boolean }> {
  const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, input.intentId)).for("update");
  if (!intent) throw new AppError("not_found", "Payment intent not found");

  const [existing] = await tx.select().from(depositAddresses).where(eq(depositAddresses.intentId, input.intentId)).limit(1);
  if (existing) return { row: existing, created: false };

  if (intent.status !== "created" && intent.status !== "awaiting_payment") {
    throw new AppError("conflict", `Payment intent is ${intent.status} and can no longer be paid`);
  }
  if (intent.expiresAt.getTime() <= Date.now()) throw new AppError("conflict", "Payment intent has expired");
  if (intent.intentHash.toLowerCase() !== input.salt.toLowerCase()) {
    throw new AppError("invalid_request", "Deposit address salt must be the payment intent's on-chain id");
  }

  const address = input.address.toLowerCase();
  const [row] = await tx
    .insert(depositAddresses)
    .values({
      id: newId("dep"),
      intentId: input.intentId,
      chainId: input.chainId,
      address,
      factoryAddress: input.factory.toLowerCase(),
      implementationAddress: input.implementation.toLowerCase(),
      salt: input.salt.toLowerCase(),
      creationBlock: input.creationBlock,
      scannedThroughBlock: input.creationBlock - 1n < 0n ? 0n : input.creationBlock - 1n,
    })
    .returning();
  if (!row) throw new Error("failed to insert deposit address");

  const patch = { depositAddress: address, paymentMethod: "deposit_address" as const };
  const data = { deposit_address: address };
  if (intent.status === "created") {
    await transitionIntent(tx, { intentId: input.intentId, to: "awaiting_payment", actor: input.actor, reason: "deposit_address_issued", data, patch });
  } else {
    await recordIntentEvent(tx, { intentId: input.intentId, actor: input.actor, reason: "deposit_address_issued", data, patch });
  }
  return { row, created: true };
}
