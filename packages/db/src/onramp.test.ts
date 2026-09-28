import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { applyOnrampEvent, recordOnrampSession } from "./onramp.js";
import { merchants, onrampSessions, paymentEvents, paymentIntents } from "./schema.js";
import { createIntent, type IntentRow } from "./state-machine.js";

const ctx = createDb(process.env.TEST_DATABASE_URL as string);
let merchantId: string;

async function newIntent(status: "created" | "awaiting_payment" | "expired" = "created", expiresAt?: Date): Promise<IntentRow> {
  const id = newId("pi");
  const row = await ctx.db.transaction((tx) =>
    createIntent(
      tx,
      {
        id, merchantId, mode: "test", amount: 100_000_000n, feeBps: 200, feeAmount: 2_000_000n, merchantAmount: 98_000_000n,
        clientSecretHash: "0".repeat(64), chainId: 84532, intentHash: `0x${id}`,
        expiresAt: expiresAt ?? new Date(Date.now() + (status === "expired" ? -1000 : 3_600_000)),
      },
      "test",
    ),
  );
  if (status === "awaiting_payment") {
    const { transitionIntent } = await import("./state-machine.js");
    return ctx.db.transaction((tx) => transitionIntent(tx, { intentId: id, to: "awaiting_payment", actor: "test" }));
  }
  return row;
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

describe("recordOnrampSession", () => {
  it("stores the session and moves created -> awaiting_payment, audited", async () => {
    const intent = await newIntent("created");
    const row = await ctx.db.transaction((tx) =>
      recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "mock_ses_1", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" }),
    );
    expect(row).toMatchObject({ provider: "mock", providerSessionId: "mock_ses_1", status: "created", customerWalletAddress: "0xabc0000000000000000000000000000000000d" });

    const [updated] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
    expect(updated).toMatchObject({ status: "awaiting_payment", paymentMethod: "onramp", onrampProvider: "mock", onrampOrderId: "mock_ses_1", onrampStatus: "created" });
    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id));
    expect(events.at(-1)).toMatchObject({ fromStatus: "created", toStatus: "awaiting_payment", reason: "onramp_session_created" });
  });

  it("re-issuing for an already awaiting_payment intent audits without a status transition", async () => {
    const intent = await newIntent("awaiting_payment");
    await ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "mock_ses_2", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" }));
    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
    expect(row?.status).toBe("awaiting_payment");
    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id));
    expect(events.at(-1)).toMatchObject({ fromStatus: "awaiting_payment", toStatus: "awaiting_payment", reason: "onramp_session_created" });
  });

  it("refuses an expired intent", async () => {
    const intent = await newIntent("expired");
    await expect(
      ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "s3", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses an unknown intent", async () => {
    await expect(
      ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: "pi_nope", provider: "mock", providerSessionId: "s4", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("applyOnrampEvent", () => {
  it("updates the session and the intent's onramp_status, but never the payment status", async () => {
    const intent = await newIntent("created");
    await ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "s5", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" }));

    const r1 = await ctx.db.transaction((tx) => applyOnrampEvent(tx, { provider: "mock", sessionId: "s5", status: "pending", actor: "system:onramp" }));
    expect(r1).toEqual({ applied: true, intentId: intent.id });
    let [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
    expect(row).toMatchObject({ status: "awaiting_payment", onrampStatus: "pending" });

    const r2 = await ctx.db.transaction((tx) => applyOnrampEvent(tx, { provider: "mock", sessionId: "s5", status: "completed", txHash: "0xdeadbeef", actor: "system:onramp" }));
    expect(r2.applied).toBe(true);
    [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
    // "completed" on the on-ramp means the CUSTOMER'S wallet is funded, not that the merchant was paid.
    expect(row).toMatchObject({ status: "awaiting_payment", onrampStatus: "completed", txHash: null });

    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id));
    const last = events.at(-1);
    expect(last).toMatchObject({ reason: "onramp_status_changed" });
    expect(last?.data).toMatchObject({ status: "completed", onramp_tx_hash: "0xdeadbeef" });

    const [session] = await ctx.db.select().from(onrampSessions).where(eq(onrampSessions.providerSessionId, "s5"));
    expect(session?.status).toBe("completed");
  });

  it("is a no-op for an unknown (provider, sessionId) pair", async () => {
    const r = await ctx.db.transaction((tx) => applyOnrampEvent(tx, { provider: "mock", sessionId: "does-not-exist", status: "completed", actor: "test" }));
    expect(r).toEqual({ applied: false });
  });

  it("records the session update but skips the intent event if a newer session has since replaced it", async () => {
    const intent = await newIntent("created");
    await ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "s6", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" }));
    // Customer retried and got a second session for the same intent.
    await ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "s7", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" }));

    const before = (await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id))).length;
    const r = await ctx.db.transaction((tx) => applyOnrampEvent(tx, { provider: "mock", sessionId: "s6", status: "failed", actor: "test" }));
    expect(r.applied).toBe(true);
    const [session] = await ctx.db.select().from(onrampSessions).where(eq(onrampSessions.providerSessionId, "s6"));
    expect(session?.status).toBe("failed"); // the stale session's own record still updates
    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
    expect(row?.onrampOrderId).toBe("s7"); // the intent still points at the current session
    const after = (await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id))).length;
    expect(after).toBe(before); // no misleading audit event against the wrong session
  });

  it("is safe to apply repeatedly: no side effect beyond one audit line per call (on-ramp webhooks are at-least-once)", async () => {
    const intent = await newIntent("created");
    await ctx.db.transaction((tx) => recordOnrampSession(tx, { intentId: intent.id, provider: "mock", providerSessionId: "s8", customerWalletAddress: "0xAbC0000000000000000000000000000000000d", actor: "test" }));
    await ctx.db.transaction((tx) => applyOnrampEvent(tx, { provider: "mock", sessionId: "s8", status: "pending", actor: "test" }));
    const before = (await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id))).length;
    await ctx.db.transaction((tx) => applyOnrampEvent(tx, { provider: "mock", sessionId: "s8", status: "pending", actor: "test" }));
    const after = (await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, intent.id))).length;
    expect(after).toBe(before + 1); // an audit line each time, never a status change or ledger effect
    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
    expect(row?.status).toBe("awaiting_payment");
  });
});
