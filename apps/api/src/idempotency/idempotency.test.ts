import { describe, expect, it } from "vitest";
import { canonicalJson, requestHash } from "./idempotency.js";

describe("request hashing", () => {
  it("is independent of key order, including nested objects", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(requestHash("POST", "/v1/x", { a: 1, b: 2 })).toBe(requestHash("POST", "/v1/x", { b: 2, a: 1 }));
  });
  it("changes with method, path or any value", () => {
    const base = requestHash("POST", "/v1/x", { a: 1 });
    expect(requestHash("PUT", "/v1/x", { a: 1 })).not.toBe(base);
    expect(requestHash("POST", "/v1/y", { a: 1 })).not.toBe(base);
    expect(requestHash("POST", "/v1/x", { a: 2 })).not.toBe(base);
    expect(requestHash("POST", "/v1/x", { a: "1" })).not.toBe(base);
  });
  it("preserves array order and handles an empty body", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(undefined)).toBe("");
    expect(requestHash("POST", "/v1/x", undefined)).toBe(requestHash("POST", "/v1/x", undefined));
  });
});
