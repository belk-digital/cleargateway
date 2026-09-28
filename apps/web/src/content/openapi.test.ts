import { describe, expect, it } from "vitest";
import spec from "./openapi.json";

// The docs render this file. It is generated from the API's route schemas: `pnpm --filter @belk/web gen:openapi`.
describe("generated OpenAPI spec used by the docs", () => {
  const paths = (spec as { paths: Record<string, Record<string, { summary?: string }>> }).paths;
  it("contains the public merchant endpoints", () => {
    for (const p of ["/v1/payment_intents", "/v1/payment_intents/{id}", "/v1/refunds", "/v1/webhook_endpoints", "/v1/balance"]) expect(paths[p], p).toBeDefined();
  });
  it("never leaks staff, sign-in or provider-inbound routes", () => {
    for (const p of Object.keys(paths)) expect(p.startsWith("/v1/"), p).toBe(true);
    expect(Object.keys(paths).some((p) => /internal|auth|webhooks\/(chain|onramp)/.test(p))).toBe(false);
  });
  it("documents every operation", () => {
    for (const [p, item] of Object.entries(paths)) for (const [m, op] of Object.entries(item)) expect(op.summary, `${m} ${p}`).toBeTruthy();
  });
});
