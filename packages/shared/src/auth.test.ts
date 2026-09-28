import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password.js";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from "./totp.js";
import { hashToken, newToken, sessionKindOf } from "./auth-tokens.js";

describe("password", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("enforces the policy", () => {
    expect(passwordProblem("short")).toMatch(/at least 12/);
    expect(passwordProblem("a".repeat(129))).toMatch(/at most/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(passwordProblem("my-alice@x.com-pass", { email: "alice@x.com" })).toMatch(/email/);
    expect(passwordProblem("Password123456")).toMatch(/common/);
    expect(passwordProblem("correct horse battery staple")).toBeNull();
  });
});

describe("totp", () => {
  it("matches the RFC 6238 SHA-1 test vectors (last 6 digits)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(secret, 20_000_000_000_000)).toBe("353130");
  });
  it("base32 round-trips", () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("accepts +/-1 step, rejects outside, and refuses replay of a used step", () => {
    const s = generateTotpSecret();
    const t = 1_700_000_000_000;
    const step = Math.floor(t / 30_000);
    expect(verifyTotp(s, totpCode(s, t), t)).toBe(step);
    expect(verifyTotp(s, totpCode(s, t - 30_000), t)).toBe(step - 1);
    expect(verifyTotp(s, totpCode(s, t + 30_000), t)).toBe(step + 1);
    expect(verifyTotp(s, totpCode(s, t - 90_000), t)).toBeNull();
    expect(verifyTotp(s, totpCode(s, t), t, step)).toBeNull(); // same step already used
    expect(verifyTotp(s, "12345", t)).toBeNull();
    expect(verifyTotp(s, "abcdef", t)).toBeNull();
  });
});

describe("tokens", () => {
  it("stores only a hash and tells kinds apart", () => {
    const t = newToken("admin");
    expect(t.hash).toBe(hashToken(t.raw));
    expect(t.hash).not.toContain(t.raw);
    expect(sessionKindOf(t.raw)).toBe("admin");
    expect(sessionKindOf(newToken("merchant").raw)).toBe("merchant");
    expect(sessionKindOf(newToken("invite").raw)).toBeNull();
    expect(sessionKindOf("sk_test_" + "a".repeat(64))).toBeNull();
  });
});
