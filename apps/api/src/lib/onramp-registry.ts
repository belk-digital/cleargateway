import { MockOnrampProvider, SimplexOnrampProvider, WertOnrampProvider, type OnrampProvider, type OnrampProviderName } from "@belk/onramp";
import type { Config } from "../config.js";

/**
 * Every provider is registered so routing can select any of them; Wert and Simplex are stubs that throw a clear
 * TODO(verify) error the moment they are actually called (see @belk/onramp), rather than being silently absent.
 */
export function buildOnrampRegistry(config: Pick<Config, "ONRAMP_MOCK_SECRET">): Record<OnrampProviderName, OnrampProvider> {
  return {
    mock: new MockOnrampProvider(config.ONRAMP_MOCK_SECRET),
    wert: new WertOnrampProvider(),
    simplex: new SimplexOnrampProvider(),
  };
}
