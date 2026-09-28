import { describe, expect, it } from "vitest";
import { MockOnrampProvider } from "./mock.js";
import type { OnrampProvider } from "./provider.js";
import { pickOnrampProvider, type RoutingRow } from "./router.js";
import { WertOnrampProvider } from "./wert.js";

const mock = new MockOnrampProvider();
const wert = new WertOnrampProvider();

describe("pickOnrampProvider", () => {
  it("picks the highest-priority enabled provider", () => {
    const routing: RoutingRow[] = [
      { provider: "mock", enabled: true, priority: 0 },
      { provider: "wert", enabled: true, priority: 10 },
    ];
    const chosen = pickOnrampProvider(routing, { mock, wert });
    expect(chosen.name).toBe("wert");
  });

  it("skips disabled rows", () => {
    const routing: RoutingRow[] = [
      { provider: "wert", enabled: false, priority: 10 },
      { provider: "mock", enabled: true, priority: 0 },
    ];
    expect(pickOnrampProvider(routing, { mock, wert }).name).toBe("mock");
  });

  it("skips a provider that is not actually available (not constructed in the registry)", () => {
    const routing: RoutingRow[] = [
      { provider: "wert", enabled: true, priority: 10 },
      { provider: "mock", enabled: true, priority: 0 },
    ];
    const available: Partial<Record<string, OnrampProvider>> = { mock }; // wert not registered
    expect(pickOnrampProvider(routing, available).name).toBe("mock");
  });

  it("throws when no configured provider is available", () => {
    expect(() => pickOnrampProvider([{ provider: "wert", enabled: true, priority: 0 }], { mock })).toThrow(/No on-ramp provider/);
    expect(() => pickOnrampProvider([], { mock })).toThrow(/No on-ramp provider/);
    expect(() => pickOnrampProvider([{ provider: "mock", enabled: false, priority: 0 }], { mock })).toThrow(/No on-ramp provider/);
  });

  it("ties break in list order (stable sort)", () => {
    const routing: RoutingRow[] = [
      { provider: "mock", enabled: true, priority: 5 },
      { provider: "wert", enabled: true, priority: 5 },
    ];
    expect(pickOnrampProvider(routing, { mock, wert }).name).toBe("mock");
  });
});
