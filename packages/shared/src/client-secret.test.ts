import { describe, expect, it } from "vitest";
import { deriveClientSecret, hashClientSecret, verifyClientSecret } from "./client-secret.js";

const KEY = "ab".repeat(32);

describe("client secret", () => {
  it("is deterministic, scoped to the intent, and verifiable", () => {
    const s = deriveClientSecret(KEY, "pi_1");
    expect(s).toMatch(/^pi_1_secret_[0-9a-f]{48}$/);
    expect(deriveClientSecret(KEY, "pi_1")).toBe(s);
    expect(deriveClientSecret(KEY, "pi_2")).not.toBe(s);
    expect(deriveClientSecret("cd".repeat(32), "pi_1")).not.toBe(s);
    expect(verifyClientSecret(s, hashClientSecret(s))).toBe(true);
    expect(verifyClientSecret(deriveClientSecret(KEY, "pi_2"), hashClientSecret(s))).toBe(false);
    expect(verifyClientSecret("junk", "zz")).toBe(false);
  });
});
