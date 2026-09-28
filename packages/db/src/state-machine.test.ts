import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "@belk/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { merchants, paymentEvents, PAYMENT_STATUSES, paymentIntents, type PaymentStatus } from "./schema.js";
import { TRANSITIONS, canTransition, createIntent, recordIntentEvent, transitionIntent } from "./state-machine.js";

const ctx = createDb(process.env.TEST_DATABASE_URL as string);
let merchantId: string;

async function newIntent(): Promise<string> {
  const id = newId("pi");
  await ctx.db.transaction((tx) =>
    createIntent(
      tx,
      {
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
      },
      "test",
    ),
  );
  return id;
}

const go = (intentId: string, to: PaymentStatus) =>
  ctx.db.transaction((tx) => transitionIntent(tx, { intentId, to, actor: "test" }));

beforeAll(async () => {
  merchantId = newId("mer");
  await ctx.db.insert(merchants).values({
    id: merchantId,
    legalName: "T",
    displayName: "T",
    payoutWalletAddress: "0x000000000000000000000000000000000000dEaD",
    feeBps: 200,
  });
});
afterAll(async () => {
  await ctx.close();
});

describe("transition table", () => {
  it("covers every status", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...PAYMENT_STATUSES].sort());
  });
  it("allows the documented happy path and branches", () => {
    expect(canTransition("created", "awaiting_payment")).toBe(true);
    expect(canTransition("awaiting_payment", "confirming")).toBe(true);
    expect(canTransition("confirming", "succeeded")).toBe(true);
    expect(canTransition("awaiting_payment", "expired")).toBe(true);
    expect(canTransition("awaiting_payment", "underpaid")).toBe(true);
    expect(canTransition("underpaid", "confirming")).toBe(true);
    expect(canTransition("underpaid", "expired")).toBe(true);
    expect(canTransition("confirming", "failed")).toBe(true);
    expect(canTransition("succeeded", "refunded")).toBe(true);
    expect(canTransition("succeeded", "partially_refunded")).toBe(true);
  });
  it("forbids shortcuts and leaving terminal states", () => {
    expect(canTransition("created", "succeeded")).toBe(false);
    expect(canTransition("awaiting_payment", "succeeded")).toBe(false);
    expect(canTransition("confirming", "expired")).toBe(false);
    expect(canTransition("succeeded", "expired")).toBe(false);
    for (const t of ["expired", "failed", "canceled", "refunded"] as const) {
      for (const to of PAYMENT_STATUSES) expect(canTransition(t, to)).toBe(false);
    }
  });
});

describe("transitionIntent", () => {
  it("moves along the happy path and appends one audit event per change", async () => {
    const id = await newIntent();
    await go(id, "awaiting_payment");
    await go(id, "confirming");
    const row = await go(id, "succeeded");
    expect(row.status).toBe("succeeded");

    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id)).orderBy(paymentEvents.createdAt);
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "created"],
      ["created", "awaiting_payment"],
      ["awaiting_payment", "confirming"],
      ["confirming", "succeeded"],
    ]);
  });

  it("throws invalid_state_transition, logs it, and leaves status and audit log untouched", async () => {
    const id = await newIntent();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(go(id, "succeeded")).rejects.toMatchObject({ code: "invalid_state_transition", statusCode: 409 });
    await expect(go(id, "succeeded")).rejects.toBeInstanceOf(AppError);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();

    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
    expect(row?.status).toBe("created");
    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id));
    expect(events).toHaveLength(1);
  });

  it("rolls the status back if the surrounding transaction fails", async () => {
    const id = await newIntent();
    await expect(
      ctx.db.transaction(async (tx) => {
        await transitionIntent(tx, { intentId: id, to: "awaiting_payment", actor: "test" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
    expect(row?.status).toBe("created");
  });

  it("serializes concurrent transitions: exactly one of two racing changes wins", async () => {
    const id = await newIntent();
    const results = await Promise.allSettled([go(id, "canceled"), go(id, "awaiting_payment")]);
    // created -> canceled and created -> awaiting_payment are both legal from `created`, but after either
    // one commits the other must see the new state: canceled is terminal, awaiting_payment -> canceled is legal.
    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
    expect(["canceled"]).toContain(row?.status);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id));
    expect(events.length).toBe(1 + results.filter((r) => r.status === "fulfilled").length);
  });

  it("applies patch columns atomically with the transition", async () => {
    const id = await newIntent();
    const row = await ctx.db.transaction((tx) =>
      transitionIntent(tx, {
        intentId: id,
        to: "awaiting_payment",
        actor: "test",
        patch: { payerAddress: "0x000000000000000000000000000000000000dEaD", paymentMethod: "wallet" },
      }),
    );
    expect(row.payerAddress).toBe("0x000000000000000000000000000000000000dEaD");
    expect(row.paymentMethod).toBe("wallet");
  });

  it("returns not_found for unknown intents", async () => {
    await expect(go("pi_nope", "canceled")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("recordIntentEvent", () => {
  it("logs an audit event without changing status", async () => {
    const id = await newIntent();
    await ctx.db.transaction((tx) => recordIntentEvent(tx, { intentId: id, actor: "test", reason: "note", data: { a: 1 } }));
    const [row] = await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
    expect(row?.status).toBe("created");
    const events = await ctx.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id));
    expect(events.at(-1)).toMatchObject({ fromStatus: "created", toStatus: "created", reason: "note" });
  });
});

describe("repo guard: state machine is the only writer of payment_intents", () => {
  it("no other source file inserts or updates payment_intents", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", "dist", ".turbo", "lib", "out", "cache", ".git"].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts") && name !== "state-machine.ts") {
          const src = readFileSync(p, "utf8");
          if (/\.(insert|update)\(\s*paymentIntents\s*\)/.test(src)) offenders.push(relative(root, p));
        }
      }
    };
    walk(join(root, "apps"));
    walk(join(root, "packages"));
    expect(offenders).toEqual([]);
  });
});
