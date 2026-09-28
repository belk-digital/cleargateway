import { describe, expect, it } from "vitest";
import { apiKeyMode, apiKeyPrefix, generateApiKey, verifyApiKey } from "./apikey.js";

describe("api keys", () => {
  it("generates a test key with matching prefix and verifiable hash", () => {
    const k = generateApiKey("test");
    expect(k.raw).toMatch(/^sk_test_[0-9a-f]{64}$/);
    expect(k.prefix).toBe(apiKeyPrefix(k.raw));
    expect(k.hash).not.toContain(k.raw);
    expect(verifyApiKey(k.raw, k.hash)).toBe(true);
    expect(apiKeyMode(k.raw)).toBe("test");
  });
  it("rejects a different key and malformed input", () => {
    const a = generateApiKey("live");
    const b = generateApiKey("live");
    expect(verifyApiKey(b.raw, a.hash)).toBe(false);
    expect(verifyApiKey("garbage", a.hash)).toBe(false);
    expect(verifyApiKey(a.raw, "zz")).toBe(false);
    expect(apiKeyPrefix("sk_test_short")).toBe("");
    expect(apiKeyMode("nope")).toBeNull();
  });
});
