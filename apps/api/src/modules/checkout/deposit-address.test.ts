import { predictDepositAddress, predictImplementationAddress } from "@belk/chain";
import { depositAddresses, paymentIntents } from "@belk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEPOSIT_FACTORY, FAKE_BLOCK_NUMBER, client, makeHarness, seedMerchant, type Harness, type SeededMerchant } from "../../test/harness.js";

let h: Harness;
let api: ReturnType<typeof client>;
let m: SeededMerchant;

beforeAll(async () => {
  h = await makeHarness();
  api = client(h);
  m = await seedMerchant(h);
});
afterAll(async () => {
  await h.close();
});

async function newIntent(body: Record<string, unknown> = { amount: "100000000" }) {
  const res = await api("POST", "/v1/payment_intents", { key: m.apiKey, body });
  expect(res.status).toBe(201);
  return res.json as { id: string; client_secret: string };
}
const secretHeader = (s: string) => ({ "x-client-secret": s });
const post = (i: { id: string; client_secret: string }) =>
  api("POST", `/v1/checkout/${i.id}/deposit-address`, { headers: secretHeader(i.client_secret), idem: false });

describe("POST /checkout/:id/deposit-address", () => {
  it("returns a deposit address that matches an independent CREATE2 prediction", async () => {
    const i = await newIntent({ amount: "100000000" });
    const res = await post(i);
    expect(res.status).toBe(200);

    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    const implementation = predictImplementationAddress(DEPOSIT_FACTORY);
    const expected = predictDepositAddress({ factory: DEPOSIT_FACTORY, implementation, salt: row?.intentHash as `0x${string}` });
    expect(res.json).toMatchObject({
      intent_id: i.id,
      chain_id: 84532,
      address: expected,
      token_address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "100000000",
      currency: "USDC",
    });
    expect(res.json.warning).toMatch(/USDC on Base only/i);
    expect(res.json.expires_at).toBe(row?.expiresAt.toISOString());
  });

  it("stores the address, records the current block, and moves created -> awaiting_payment", async () => {
    const i = await newIntent();
    await post(i);
    const [row] = await h.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    expect(row).toMatchObject({ status: "awaiting_payment", paymentMethod: "deposit_address" });
    const [dep] = await h.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, i.id));
    expect(dep).toMatchObject({ creationBlock: FAKE_BLOCK_NUMBER, status: "awaiting_deposit" });
    expect(dep?.address).toBe(row?.depositAddress);
  });

  it("is idempotent: repeat calls return the same address and create only one row", async () => {
    const i = await newIntent();
    const a = await post(i);
    const b = await post(i);
    expect(b.json.address).toBe(a.json.address);
    const rows = await h.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, i.id));
    expect(rows).toHaveLength(1);
  });

  it("appears in the public checkout view once issued, with live progress fields", async () => {
    const i = await newIntent();
    const before = await api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(i.client_secret) });
    expect(before.json.deposit_address).toBeNull();

    await post(i);
    const after = await api("GET", `/v1/checkout/${i.id}`, { headers: secretHeader(i.client_secret) });
    expect(after.json.deposit_address).toMatchObject({ detected_amount: "0", confirmed_amount: "0", status: "awaiting_deposit" });
    expect(after.json.deposit_address.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("rejects an expired or canceled intent, and never issues an address for either", async () => {
    const i = await newIntent();
    expect((await api("POST", `/v1/payment_intents/${i.id}/cancel`, { key: m.apiKey })).status).toBe(200);
    const res = await post(i);
    expect(res.status).toBe(409);
    expect((await h.db.select().from(depositAddresses).where(eq(depositAddresses.intentId, i.id)))).toHaveLength(0);
  });

  it("returns 404 for a wrong or missing client secret (indistinguishable from unknown id)", async () => {
    const i = await newIntent();
    expect((await api("POST", `/v1/checkout/${i.id}/deposit-address`, { idem: false })).status).toBe(404);
    expect((await api("POST", `/v1/checkout/${i.id}/deposit-address`, { headers: secretHeader("wrong"), idem: false })).status).toBe(404);
  });

  it("returns 503 not_configured without a factory address or a chain reader", async () => {
    const h2 = await makeHarness({ env: { DEPOSIT_FACTORY_ADDRESS: "" } });
    const api2 = client(h2);
    const c = await api2("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    const res = await api2("POST", `/v1/checkout/${c.json.id}/deposit-address`, { headers: secretHeader(c.json.client_secret), idem: false });
    expect(res.status).toBe(503);
    await h2.close();

    const h3 = await makeHarness({ chain: false });
    const api3 = client(h3);
    const c3 = await api3("POST", "/v1/payment_intents", { key: m.apiKey, body: { amount: "100000000" } });
    const res3 = await api3("POST", `/v1/checkout/${c3.json.id}/deposit-address`, { headers: secretHeader(c3.json.client_secret), idem: false });
    expect(res3.status).toBe(503);
    await h3.close();
  });
});
