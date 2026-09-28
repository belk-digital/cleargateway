import type { OnrampProvider, OnrampProviderName } from "./provider.js";

export interface RoutingRow {
  provider: OnrampProviderName;
  enabled: boolean;
  priority: number;
}

/**
 * Picks the highest-priority enabled, available provider for a merchant. Pure and side-effect free: callers
 * supply the merchant's routing rows (from `onramp_routing`) and the registry of providers actually constructed
 * (which may be a subset of all provider names, e.g. only "mock" in dev).
 */
export function pickOnrampProvider(
  routing: readonly RoutingRow[],
  available: Partial<Record<OnrampProviderName, OnrampProvider>>,
): OnrampProvider {
  const candidates = routing.filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
  for (const row of candidates) {
    const provider = available[row.provider];
    if (provider) return provider;
  }
  throw new Error("No on-ramp provider is configured and available for this merchant");
}
