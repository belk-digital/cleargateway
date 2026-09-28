import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "./money";

describe("money", () => {
  it("formats base units exactly", () => {
    expect(formatUsdc("100000000")).toBe("100.00");
    expect(formatUsdc("1")).toBe("0.000001");
    expect(formatUsdc("1234567890")).toBe("1,234.56789");
    expect(formatUsdc("0")).toBe("0.00");
    expect(formatUsdc("9007199254740993")).toBe("9,007,199,254.740993"); // beyond float precision
  });
  it("parses without floats and rejects bad input", () => {
    expect(parseUsdc("12.5")).toBe("12500000");
    expect(parseUsdc("0.000001")).toBe("1");
    expect(parseUsdc("100")).toBe("100000000");
    for (const bad of ["", "0", "0.0", "-1", "1.1234567", "1e3", "abc", "1,000", ".5", "1."]) expect(parseUsdc(bad), bad).toBeNull();
  });
  it("round-trips", () => {
    for (const u of ["1", "999999", "1000000", "123456789012345"]) expect(parseUsdc(formatUsdc(u).replace(/,/g, ""))).toBe(u);
  });
});
