import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://belk:belk@localhost:5433/belkpay",
  REDIS_URL: "redis://localhost:6379",
  RPC_URL: "https://sepolia.base.org",
  CHECKOUT_ORIGIN: "http://localhost:3001",
  CHECKOUT_BASE_URL: "http://localhost:3001/pay",
};

describe("loadConfig", () => {
  it("accepts a minimal valid env and applies defaults", () => {
    const c = loadConfig(baseEnv);
    expect(c.CHAIN_ID).toBe(84532);
    expect(c.CONFIRMATIONS).toBe(5);
    expect(c.USDC_ADDRESS).toBeUndefined();
  });
  it("treats empty strings as unset and checksums addresses", () => {
    const c = loadConfig({
      ...baseEnv,
      SENTRY_DSN: "",
      PLATFORM_WALLET_ADDRESS: "0x000000000000000000000000000000000000dead",
    });
    expect(c.SENTRY_DSN).toBeUndefined();
    expect(c.PLATFORM_WALLET_ADDRESS).toBe("0x000000000000000000000000000000000000dEaD");
  });
  it("rejects mainnet, bad addresses and missing vars with all problems listed", () => {
    expect(() => loadConfig({ ...baseEnv, CHAIN_ID: "8453" })).toThrow(/Base Sepolia/);
    expect(() => loadConfig({ ...baseEnv, USDC_ADDRESS: "0x123" })).toThrow(/USDC_ADDRESS/);
    expect(() => loadConfig({ NODE_ENV: "test" })).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });
});

describe("app", () => {
  it("GET /health returns ok with a request id header", async () => {
    const app = await buildApp({ config: loadConfig(baseEnv) });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toMatch(/^req_/);
    await app.close();
  });
  it("GET /ready reports failing dependencies with 503", async () => {
    const app = await buildApp({
      config: loadConfig(baseEnv),
      readinessChecks: {
        good: async () => {},
        bad: async () => {
          throw new Error("down");
        },
      },
    });
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "not_ready", checks: { good: "ok", bad: "fail" } });
    await app.close();
  });
  it("returns the standard error envelope for unknown routes", async () => {
    const app = await buildApp({ config: loadConfig(baseEnv) });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.request_id).toBe(res.headers["x-request-id"]);
    await app.close();
  });
  it("rejects malformed JSON with invalid_request and no stack leak", async () => {
    const app = await buildApp({ config: loadConfig(baseEnv) });
    app.post("/echo", async (req) => req.body);
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{bad",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
    await app.close();
  });
  it("serves OpenAPI JSON at /docs/json", async () => {
    const app = await buildApp({ config: loadConfig(baseEnv) });
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toMatch(/^3\./);
    await app.close();
  });
  it("only allows the checkout origin via CORS", async () => {
    const app = await buildApp({ config: loadConfig(baseEnv) });
    const ok = await app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:3001" } });
    const bad = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
