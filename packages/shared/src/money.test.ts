import { describe, expect, it } from "vitest";
import { MoneyError, formatUsdc, parseUsdc, splitAmount } from "./money.js";

describe("parseUsdc / formatUsdc", () => {
  it("parses whole and fractional amounts", () => {
    expect(parseUsdc("100")).toBe(100_000_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("12.5")).toBe(12_500_000n);
  });
  it.each(["", "-1", "1e6", "1.1234567", ".5", "1.", "abc", " 1"])("rejects %j", (v) => {
    expect(() => parseUsdc(v)).toThrow(MoneyError);
  });
  it("formats and round-trips", () => {
    expect(formatUsdc(98_000_000n)).toBe("98");
    expect(formatUsdc(500_000n)).toBe("0.5");
    expect(formatUsdc(1n)).toBe("0.000001");
    for (const s of ["0", "1", "99.99", "123456789.123456"]) expect(formatUsdc(parseUsdc(s))).toBe(s);
  });
  it("rejects negative units on format", () => {
    expect(() => formatUsdc(-1n)).toThrow(MoneyError);
  });
});

describe("splitAmount", () => {
  it("matches the brief's example: 100 USDC @ 200 bps -> 98 / 2", () => {
    const s = splitAmount(parseUsdc("100"), 200);
    expect(s.fee).toBe(2_000_000n);
    expect(s.merchantAmount).toBe(98_000_000n);
  });
  it("rounds the fee down and gives the remainder to the merchant", () => {
    // 1 base unit @ 200 bps: fee floor(0.02) = 0
    expect(splitAmount(1n, 200)).toEqual({ amount: 1n, fee: 0n, merchantAmount: 1n });
    // 999_999 * 250 / 10000 = 24999.975 -> 24999
    const s = splitAmount(999_999n, 250);
    expect(s.fee).toBe(24_999n);
    expect(s.merchantAmount).toBe(975_000n);
  });
  it("handles 0 bps and the max", () => {
    expect(splitAmount(1_000_000n, 0).fee).toBe(0n);
    expect(splitAmount(1_000_000n, 1000).fee).toBe(100_000n);
  });
  it("parts always sum to the total (deterministic sweep)", () => {
    let seed = 12345n;
    for (let i = 0; i < 5000; i++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
      const amount = (seed % 10n ** 15n) + 1n;
      const bps = Number(seed % 1001n);
      const s = splitAmount(amount, bps);
      expect(s.fee + s.merchantAmount).toBe(amount);
      expect(s.fee).toBeLessThanOrEqual(amount);
    }
  });
  it("handles very large amounts without overflow", () => {
    const big = 10n ** 30n;
    expect(splitAmount(big, 1000).fee).toBe(10n ** 29n);
  });
  it("rejects invalid input", () => {
    expect(() => splitAmount(0n, 100)).toThrow(MoneyError);
    expect(() => splitAmount(-5n, 100)).toThrow(MoneyError);
    expect(() => splitAmount(100n, -1)).toThrow(MoneyError);
    expect(() => splitAmount(100n, 1001)).toThrow(MoneyError);
    expect(() => splitAmount(100n, 1.5)).toThrow(MoneyError);
    expect(() => splitAmount(100n, 600, 500)).toThrow(MoneyError);
  });
});
