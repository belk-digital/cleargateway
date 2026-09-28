import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, makeHarness, seedMerchant, type Harness } from "../test/harness.js";

let h: Harness;

beforeAll(async () => {
  // Tiny limits so the tests can exhaust them; Redis-backed like production.
  h = await makeHarness({ env: { RATE_LIMIT_PER_KEY_PER_MIN: "3", RATE_LIMIT_PER_IP_PER_MIN: "8" } });
  await h.redis.flushdb();
});
afterAll(async () => {
  await h.redis.flushdb();
  await h.close();
});

describe("rate limiting (Redis-backed)", () => {
  it("limits per API key: the 4th request in a window gets 429 in the standard envelope", async () => {
    const api = client(h);
    const a = await seedMerchant(h);
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 4; i++) {
      last = await api("GET", "/v1/payment_intents", { key: a.apiKey });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last?.json.error.code).toBe("rate_limited");
    expect(last?.json.error.request_id).toMatch(/^req_/);
    expect(last?.headers["retry-after"]).toBeDefined();
  });

  it("gives another key its own budget", async () => {
    const api = client(h);
    const b = await seedMerchant(h);
    expect((await api("GET", "/v1/payment_intents", { key: b.apiKey })).status).toBe(200);
  });

  it("stores its counters in Redis, not process memory", async () => {
    const keys = await h.redis.keys("belk:rl:*");
    expect(keys.length).toBeGreaterThan(0);
  });

  it("limits per IP across unauthenticated traffic (brute-force protection)", async () => {
    await h.redis.flushdb();
    const api = client(h);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await api("GET", "/v1/payment_intents", { key: `sk_test_${"c".repeat(64)}` })).status);
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
  });

  it("never rate-limits health probes", async () => {
    for (let i = 0; i < 15; i++) expect((await h.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});
