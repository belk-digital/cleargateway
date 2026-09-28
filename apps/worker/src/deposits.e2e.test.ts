import { predictDepositAddress, predictImplementationAddress, mockUsdcAbi, mockUsdcBytecode, defineEvmChain } from "@belk/chain";
import {
  createIntent,
  depositAddresses,
  depositTransfers,
  issueDepositAddress,
  newId,
  paymentEvents,
  paymentIntents,
  webhookDeliveries,
} from "@belk/db";
import { AppError } from "@belk/shared";
import { and, eq, sql } from "drizzle-orm";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChainWatcher } from "./jobs/chain-watcher.js";
import { runDepositWatcher } from "./jobs/deposit-watcher.js";
import { runExpiry } from "./jobs/expiry.js";
import {
  FIXED_TX,
  RPC_URL,
  apiClient,
  makeStack,
  mintTo,
  newAccount,
  seedMerchant,
  startReceiver,
  type Receiver,
  type SeededMerchant,
  type Stack,
} from "./test/harness.js";
import type { PrivateKeyAccount } from "viem/accounts";

let s: Stack;
let m: SeededMerchant;
let api: ReturnType<typeof apiClient>;
let receiver: Receiver;
const USDC = (n: number) => BigInt(n) * 1_000_000n;

beforeAll(async () => {
  s = await makeStack();
  m = await seedMerchant(s, 200);
  api = apiClient(s, m.apiKey);
  receiver = await startReceiver();
  expect((await api("POST", "/v1/webhook_endpoints", { url: receiver.url })).status).toBe(201);
});
afterAll(async () => {
  await receiver?.close();
  await s?.close();
});

// ------------------------------------------------------------------------------------------------ helpers

const intentRow = async (id: string) => (await s.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)))[0]!;
const depRow = async (intentId: string) => (await s.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, intentId)))[0]!;
const transfers = (intentId: string) => s.db.select().from(depositTransfers).where(eq(depositTransfers.intentId, intentId)).orderBy(depositTransfers.blockNumber);
const reasons = async (id: string) => (await s.db.select().from(paymentEvents).where(eq(paymentEvents.intentId, id)).orderBy(paymentEvents.createdAt)).map((e) => e.reason);
const deliveries = (type: string, intentId: string) =>
  s.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.eventType, type), sql`${webhookDeliveries.payload} #>> '{data,object,id}' = ${intentId}`));
const setExpiry = (id: string, at: Date) => s.db.execute(sql`update payment_intents set expires_at = ${at.toISOString()} where id = ${id}`);

/** A merchant intent that has been given a deposit address, exactly as the API will do in step 4. */
async function newDepositIntent(amount = USDC(100)): Promise<{ id: string; address: Address }> {
  const created = await api("POST", "/v1/payment_intents", { amount: amount.toString() });
  expect(created.status).toBe(201);
  const row = await intentRow(created.json.id);
  const address = predictDepositAddress({ factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, salt: row.intentHash as Hex });
  const head = await s.chain.publicClient.getBlockNumber();
  await s.db.transaction((tx) =>
    issueDepositAddress(tx, {
      intentId: row.id,
      chainId: 84532,
      address,
      factory: s.chain.depositFactory,
      implementation: s.chain.depositImplementation,
      salt: row.intentHash,
      creationBlock: head,
      actor: "test",
    }),
  );
  return { id: row.id, address };
}

/** What an exchange does: a plain ERC-20 transfer from its own hot wallet. */
async function prepareExchange(amount: bigint): Promise<PrivateKeyAccount> {
  const account = newAccount();
  await s.chain.fund(account.address);
  await mintTo(s.chain, account.address, amount);
  return account;
}
async function exchangeTransfer(from: PrivateKeyAccount, to: Address, amount: bigint, fixed = false): Promise<Hex> {
  return s.chain.wallet(from).writeContract({
    address: s.chain.usdc,
    abi: s.chain.usdcAbi,
    functionName: "transfer",
    args: [to, amount],
    chain: null,
    ...(fixed ? FIXED_TX : {}),
  });
}
async function exchangeSend(to: Address, amount: bigint): Promise<Hex> {
  const ex = await prepareExchange(amount);
  const hash = await exchangeTransfer(ex, to, amount);
  await s.chain.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
const confirm = async () => {
  await s.chain.mine(2); // N = 3 confirmations
  return runDepositWatcher(s.ctx);
};

// ------------------------------------------------------------------------------------------------ address derivation

describe("deposit address derivation (TypeScript == on-chain)", () => {
  it("viem's CREATE2 prediction equals DepositFactory.predict() for many intents", async () => {
    for (let i = 0; i < 5; i++) {
      const salt = keccak256(stringToBytes(`parity-${i}-${Date.now()}`));
      const onChain = (await s.chain.publicClient.readContract({ address: s.chain.depositFactory, abi: s.chain.depositFactoryAbi, functionName: "predict", args: [salt] })) as Address;
      expect(predictDepositAddress({ factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, salt })).toBe(onChain);
      expect(await s.chain.publicClient.getCode({ address: onChain })).toBeUndefined(); // counterfactual
    }
  });

  it("the implementation address is the factory's first creation (nonce 1)", () => {
    expect(predictImplementationAddress(s.chain.depositFactory)).toBe(s.chain.depositImplementation);
  });
});

describe("issueDepositAddress", () => {
  it("attaches the address, moves created -> awaiting_payment with an audit event, and is idempotent", async () => {
    const { id, address } = await newDepositIntent();
    const row = await intentRow(id);
    expect(row).toMatchObject({ status: "awaiting_payment", paymentMethod: "deposit_address", depositAddress: address.toLowerCase() });
    expect(await reasons(id)).toEqual(["intent_created", "deposit_address_issued"]);

    const again = await s.db.transaction((tx) =>
      issueDepositAddress(tx, { intentId: id, chainId: 84532, address, factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, salt: row.intentHash, creationBlock: 1n, actor: "test" }),
    );
    expect(again.created).toBe(false);
    expect((await s.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, id))).length).toBe(1);
  });

  it("refuses expired, canceled and wrong-salt requests", async () => {
    const created = await api("POST", "/v1/payment_intents", { amount: USDC(10).toString() });
    const row = await intentRow(created.json.id);
    const base = { intentId: row.id, chainId: 84532, address: newAccount().address, factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, creationBlock: 1n, actor: "test" };
    await expect(s.db.transaction((tx) => issueDepositAddress(tx, { ...base, salt: keccak256(stringToBytes("other")) }))).rejects.toBeInstanceOf(AppError);

    await setExpiry(row.id, new Date(Date.now() - 1000));
    await expect(s.db.transaction((tx) => issueDepositAddress(tx, { ...base, salt: row.intentHash }))).rejects.toMatchObject({ code: "conflict" });

    const c2 = await api("POST", "/v1/payment_intents", { amount: USDC(10).toString() });
    await api("POST", `/v1/payment_intents/${c2.json.id}/cancel`);
    const r2 = await intentRow(c2.json.id);
    await expect(s.db.transaction((tx) => issueDepositAddress(tx, { ...base, intentId: r2.id, salt: r2.intentHash }))).rejects.toMatchObject({ code: "conflict" });
  });
});

// ------------------------------------------------------------------------------------------------ detection

describe("deposit detection and confirmation", () => {
  it("full deposit: detected -> confirming deposit -> confirmed -> address funded (intent stays awaiting_payment)", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    const tx = await exchangeSend(address, USDC(100));

    const r1 = await runDepositWatcher(s.ctx);
    expect(r1.newTransfers).toBe(1);
    let [t] = await transfers(id);
    expect(t).toMatchObject({ txHash: tx.toLowerCase(), status: "detected", confirmations: 1, amount: USDC(100) });
    expect(t?.fromAddress).not.toBe(address.toLowerCase()); // sender is the exchange wallet, never treated as the payer
    let dep = await depRow(id);
    expect(dep).toMatchObject({ status: "awaiting_deposit", detectedAmount: USDC(100), confirmedAmount: 0n });
    expect((await intentRow(id)).status).toBe("awaiting_payment");

    const r2 = await confirm();
    expect(r2.funded).toBe(1);
    [t] = await transfers(id);
    expect(t).toMatchObject({ status: "confirmed", confirmations: 3 });
    dep = await depRow(id);
    expect(dep).toMatchObject({ status: "funded", confirmedAmount: USDC(100) });
    expect(dep.fundedAt).toBeInstanceOf(Date);

    // The deposit watcher never finalizes a payment: that only happens from the splitter event.
    const row = await intentRow(id);
    expect(row.status).toBe("awaiting_payment");
    expect(row.succeededAt).toBeNull();
    expect(await reasons(id)).toEqual(["intent_created", "deposit_address_issued", "deposit_detected", "deposit_funded"]);

    // Idempotent: another tick changes nothing.
    const before = (await reasons(id)).length;
    const r3 = await runDepositWatcher(s.ctx);
    expect(r3).toMatchObject({ newTransfers: 0, funded: 0, flagged: 0, reorged: 0 });
    expect((await reasons(id)).length).toBe(before);
  });

  it("underpaid: partial confirmed deposit moves the intent to underpaid; top-ups complete it", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    await exchangeSend(address, USDC(60));
    await runDepositWatcher(s.ctx);
    expect((await intentRow(id)).status).toBe("awaiting_payment"); // unconfirmed deposits alone don't change the status

    const r = await confirm();
    expect(r.underpaid).toBe(1);
    let row = await intentRow(id);
    expect(row).toMatchObject({ status: "underpaid", underpaidAmount: USDC(40) });
    expect((await depRow(id)).status).toBe("awaiting_deposit");
    expect(await deliveries("payment_intent.underpaid", id)).toHaveLength(1);

    // A second partial deposit updates the missing amount without a new status change.
    await exchangeSend(address, USDC(10));
    await runDepositWatcher(s.ctx);
    await confirm();
    row = await intentRow(id);
    expect(row).toMatchObject({ status: "underpaid", underpaidAmount: USDC(30) });
    expect(await deliveries("payment_intent.underpaid", id)).toHaveLength(1);

    // Final top-up from a different sender covers the amount.
    await exchangeSend(address, USDC(30));
    await runDepositWatcher(s.ctx);
    const done = await confirm();
    expect(done.funded).toBe(1);
    row = await intentRow(id);
    expect(row).toMatchObject({ status: "underpaid", underpaidAmount: 0n }); // becomes confirming when the sweep pays
    expect(await depRow(id)).toMatchObject({ status: "funded", confirmedAmount: USDC(100), detectedAmount: USDC(100) });
    expect((await transfers(id)).map((t) => t.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  it("overpaid: funded, excess recorded, flagged for review once per increase (excess stays for rescue)", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    await exchangeSend(address, USDC(150));
    await runDepositWatcher(s.ctx);
    await confirm();
    let row = await intentRow(id);
    expect(row).toMatchObject({ overpaidAmount: USDC(50), needsReview: true, reviewReason: "deposit_overpaid" });
    expect(await depRow(id)).toMatchObject({ status: "funded" });
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(1);

    await runDepositWatcher(s.ctx);
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(1); // no repeat alert

    await exchangeSend(address, USDC(10));
    await runDepositWatcher(s.ctx);
    row = await intentRow(id);
    expect(row.overpaidAmount).toBe(USDC(60));
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(2); // a new, larger excess
  });

  it("sums deposits from several senders and ignores unrelated tokens and other addresses", async () => {
    const a = await newDepositIntent(USDC(100));
    const b = await newDepositIntent(USDC(100));
    await exchangeSend(a.address, USDC(40));
    await exchangeSend(b.address, USDC(100));
    await exchangeSend(a.address, USDC(60));

    // A different ERC-20 sent to the same address must never count as USDC.
    const chainDef = defineEvmChain(84532, RPC_URL);
    const deployer = newAccount();
    await s.chain.fund(deployer.address);
    const w = s.chain.wallet(deployer);
    const otherHash = await w.deployContract({ abi: mockUsdcAbi, bytecode: mockUsdcBytecode, args: [], chain: chainDef });
    const other = (await s.chain.publicClient.waitForTransactionReceipt({ hash: otherHash })).contractAddress as Address;
    const minted = await w.writeContract({ address: other, abi: mockUsdcAbi, functionName: "mint", args: [a.address, USDC(999)], chain: null });
    await s.chain.publicClient.waitForTransactionReceipt({ hash: minted });

    await runDepositWatcher(s.ctx);
    await confirm();
    expect(await depRow(a.id)).toMatchObject({ status: "funded", confirmedAmount: USDC(100) });
    expect(await depRow(b.id)).toMatchObject({ status: "funded", confirmedAmount: USDC(100) });
    expect(await transfers(a.id)).toHaveLength(2);
  });

  it("a deposit that arrives for an intent still in `created` moves it to awaiting_payment", async () => {
    const id = newId("pi");
    const hash = keccak256(stringToBytes(id));
    await s.db.transaction((tx) =>
      createIntent(tx, { id, merchantId: m.merchantId, mode: "test", amount: USDC(50), feeBps: 200, feeAmount: 1_000_000n, merchantAmount: USDC(49), clientSecretHash: "0".repeat(64), chainId: 84532, intentHash: hash, expiresAt: new Date(Date.now() + 3_600_000) }, "test"),
    );
    const address = predictDepositAddress({ factory: s.chain.depositFactory, implementation: s.chain.depositImplementation, salt: hash });
    await s.db.insert(depositAddresses).values({ id: newId("dep"), intentId: id, chainId: 84532, address: address.toLowerCase(), factoryAddress: s.chain.depositFactory.toLowerCase(), implementationAddress: s.chain.depositImplementation.toLowerCase(), salt: hash, creationBlock: 1n, scannedThroughBlock: (await s.chain.publicClient.getBlockNumber()) - 1n });
    await exchangeSend(address, USDC(50));
    await runDepositWatcher(s.ctx);
    expect(await intentRow(id)).toMatchObject({ status: "awaiting_payment", paymentMethod: "deposit_address" });
    expect(await reasons(id)).toContain("deposit_detected_without_checkout");
  });

  it("does nothing (and says so) when deposit addresses are not configured", async () => {
    const r = await runDepositWatcher({ ...s.ctx, config: { ...s.ctx.config, DEPOSIT_FACTORY_ADDRESS: undefined } });
    expect(r.skipped).toBe("not_configured");
  });

  it("re-scanning history is idempotent (no duplicate rows, events or alerts)", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    await exchangeSend(address, USDC(100));
    await runDepositWatcher(s.ctx);
    await confirm();
    const before = { events: (await reasons(id)).length, transfers: (await transfers(id)).length };
    await s.db.update(depositAddresses).set({ scannedThroughBlock: 0n }).where(eq(depositAddresses.intentId, id));
    await s.db.execute(sql`update deposit_addresses set scanned_through_block = creation_block where intent_id = ${id}`);
    await runDepositWatcher(s.ctx);
    expect({ events: (await reasons(id)).length, transfers: (await transfers(id)).length }).toEqual(before);
  });

  it("two watchers racing produce each deposit exactly once", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    await exchangeSend(address, USDC(100));
    const results = await Promise.all([runDepositWatcher(s.ctx), runDepositWatcher(s.ctx)]);
    expect(results.reduce((n, r) => n + r.newTransfers, 0)).toBe(1);
    expect(await transfers(id)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ late / terminal

describe("deposits after the payment window", () => {
  it("expired intent: each late deposit is flagged for review exactly once and notifies the merchant", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    await runChainWatcher(s.ctx);
    await runDepositWatcher(s.ctx); // heartbeat
    await setExpiry(id, new Date(Date.now() - 60_000));
    await runExpiry(s.ctx);
    expect((await intentRow(id)).status).toBe("expired");

    await exchangeSend(address, USDC(100));
    const r = await runDepositWatcher(s.ctx);
    expect(r.flagged).toBe(1);
    const row = await intentRow(id);
    expect(row).toMatchObject({ status: "expired", needsReview: true, reviewReason: "late_deposit_expired" });
    expect((await transfers(id))[0]?.flaggedAt).toBeInstanceOf(Date);
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(1);

    await runDepositWatcher(s.ctx);
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(1); // not re-reported

    await exchangeSend(address, USDC(5));
    await runDepositWatcher(s.ctx);
    expect(await deliveries("payment_intent.requires_review", id)).toHaveLength(2); // a second late deposit is its own alert
    expect((await intentRow(id)).status).toBe("expired"); // never revived
  });

  it("canceled intent: a deposit is flagged, not dropped", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    expect((await api("POST", `/v1/payment_intents/${id}/cancel`)).status).toBe(200);
    await exchangeSend(address, USDC(100));
    await runDepositWatcher(s.ctx);
    expect(await intentRow(id)).toMatchObject({ status: "canceled", needsReview: true, reviewReason: "late_deposit_canceled" });
  });
});

describe("expiry never strands deposits", () => {
  it("holds an intent while a deposit is unconfirmed or funded, and while the address was never / not recently scanned", async () => {
    await runChainWatcher(s.ctx);

    // (a) never scanned by the deposit watcher: held
    const never = await newDepositIntent(USDC(100));
    await setExpiry(never.id, new Date(Date.now() - 60_000));
    await runExpiry(s.ctx);
    expect((await intentRow(never.id)).status).toBe("awaiting_payment");
    await runDepositWatcher(s.ctx);
    await runChainWatcher(s.ctx);
    await runExpiry(s.ctx);
    expect((await intentRow(never.id)).status).toBe("expired"); // scanned, nothing arrived -> expires

    // (b) unconfirmed deposit: held
    const pending = await newDepositIntent(USDC(100));
    await exchangeSend(pending.address, USDC(100));
    await runDepositWatcher(s.ctx);
    await setExpiry(pending.id, new Date(Date.now() - 60_000));
    await runExpiry(s.ctx);
    expect((await intentRow(pending.id)).status).toBe("awaiting_payment");

    // (c) funded, waiting for the sweep: held indefinitely
    await confirm();
    expect((await depRow(pending.id)).status).toBe("funded");
    await runChainWatcher(s.ctx);
    await runExpiry(s.ctx);
    expect((await intentRow(pending.id)).status).toBe("awaiting_payment");

    // (d) stale deposit-watcher heartbeat: held
    const stale = await newDepositIntent(USDC(100));
    await runDepositWatcher(s.ctx);
    await setExpiry(stale.id, new Date(Date.now() - 60_000));
    await runChainWatcher(s.ctx);
    const future = { ...s.ctx, now: () => Date.now() + 10 * 60_000 };
    await runExpiry(future);
    expect((await intentRow(stale.id)).status).toBe("awaiting_payment");
  });

  it("an underpaid intent with only confirmed partial deposits does expire (funds go through the rescue path)", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    await exchangeSend(address, USDC(30));
    await runDepositWatcher(s.ctx);
    await confirm();
    expect((await intentRow(id)).status).toBe("underpaid");
    await setExpiry(id, new Date(Date.now() - 60_000));
    await runChainWatcher(s.ctx);
    await runDepositWatcher(s.ctx);
    await runExpiry(s.ctx);
    expect((await intentRow(id)).status).toBe("expired");
    await runDepositWatcher(s.ctx);
    expect(await intentRow(id)).toMatchObject({ status: "expired", needsReview: true, reviewReason: "late_deposit_expired" });
  });
});

// ------------------------------------------------------------------------------------------------ reorgs

describe("deposit reorganizations", () => {
  it("a deposit reorged out is marked reorged and stops counting", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    const ex = await prepareExchange(USDC(100));
    const snap = await s.chain.snapshot();
    const hash = await exchangeTransfer(ex, address, USDC(100));
    await s.chain.publicClient.waitForTransactionReceipt({ hash });
    await runDepositWatcher(s.ctx);
    expect((await depRow(id)).detectedAmount).toBe(USDC(100));

    await s.chain.revert(snap);
    await s.chain.mine(2);
    const r = await runDepositWatcher(s.ctx);
    expect(r.reorged).toBe(1);
    expect((await transfers(id))[0]).toMatchObject({ status: "reorged", confirmations: 0 });
    expect(await depRow(id)).toMatchObject({ detectedAmount: 0n, confirmedAmount: 0n, status: "awaiting_deposit" });
    expect(await reasons(id)).toContain("deposit_reorged");
  });

  it("a reorged deposit that is re-mined comes back, and only then confirms and funds", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    const ex = await prepareExchange(USDC(100));
    const snap = await s.chain.snapshot();
    const tx1 = await exchangeTransfer(ex, address, USDC(100), true);
    const r1 = await s.chain.publicClient.waitForTransactionReceipt({ hash: tx1 });
    await runDepositWatcher(s.ctx);
    await s.chain.mine(2); // it looked confirmed...
    await s.chain.revert(snap); // ...but the chain reorganized
    await s.chain.mine(1);
    await runDepositWatcher(s.ctx);
    expect((await transfers(id))[0]?.status).toBe("reorged");
    expect((await depRow(id)).status).toBe("awaiting_deposit");

    const tx2 = await exchangeTransfer(ex, address, USDC(100), true); // same transaction, different block
    const r2 = await s.chain.publicClient.waitForTransactionReceipt({ hash: tx2 });
    expect(tx2).toBe(tx1);
    expect(r2.blockHash).not.toBe(r1.blockHash);

    await runDepositWatcher(s.ctx);
    const [t] = await transfers(id);
    expect(t).toMatchObject({ status: "detected", blockHash: r2.blockHash.toLowerCase() });
    expect(await reasons(id)).toContain("deposit_restored");
    expect((await depRow(id)).status).toBe("awaiting_deposit");

    const done = await confirm();
    expect(done.funded).toBe(1);
    expect(await depRow(id)).toMatchObject({ status: "funded", confirmedAmount: USDC(100) });
    expect((await transfers(id)).length).toBe(1); // still exactly one row for this transfer
  });

  it("a deposit re-mined in another block before we noticed the reorg just has its block updated", async () => {
    const { id, address } = await newDepositIntent(USDC(100));
    const ex = await prepareExchange(USDC(100));
    const snap = await s.chain.snapshot();
    const tx1 = await exchangeTransfer(ex, address, USDC(100), true);
    const r1 = await s.chain.publicClient.waitForTransactionReceipt({ hash: tx1 });
    await runDepositWatcher(s.ctx);
    await s.chain.revert(snap);
    await s.chain.mine(2);
    const tx2 = await exchangeTransfer(ex, address, USDC(100), true);
    const r2 = await s.chain.publicClient.waitForTransactionReceipt({ hash: tx2 });
    expect(r2.blockHash).not.toBe(r1.blockHash);

    await runDepositWatcher(s.ctx);
    const rows = await transfers(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "detected", blockHash: r2.blockHash.toLowerCase() });
    expect(await reasons(id)).toContain("deposit_block_changed");
    expect((await depRow(id)).detectedAmount).toBe(USDC(100)); // counted once, not twice
  });
});
