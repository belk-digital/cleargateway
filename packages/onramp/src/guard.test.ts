import { describe, expect, it } from "vitest";
import { assertSafeCustomerWallet } from "./guard.js";

const forbidden = {
  merchantPayoutWallet: "0x1111111111111111111111111111111111111111",
  splitterAddress: "0x2222222222222222222222222222222222222222",
  usdcAddress: "0x3333333333333333333333333333333333333333",
};

describe("assertSafeCustomerWallet", () => {
  it("allows a distinct customer wallet", () => {
    expect(() => assertSafeCustomerWallet("0x4444444444444444444444444444444444444444", forbidden)).not.toThrow();
  });

  it.each(["merchantPayoutWallet", "splitterAddress", "usdcAddress"] as const)("rejects the %s, case-insensitively", (key) => {
    expect(() => assertSafeCustomerWallet(forbidden[key], forbidden)).toThrow();
    expect(() => assertSafeCustomerWallet(forbidden[key].toUpperCase().replace("0X", "0x"), forbidden)).toThrow();
  });
});
