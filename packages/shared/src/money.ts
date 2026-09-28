import { BPS_DENOMINATOR, MAX_FEE_BPS, USDC_DECIMALS } from "./constants.js";

const UNIT = 10n ** BigInt(USDC_DECIMALS);

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Parse a decimal string ("100", "100.5", "0.000001") into USDC base units.
 * Strict: no exponent notation, no sign, no more than 6 fractional digits.
 * Takes a string on purpose so a float never enters the money path.
 */
export function parseUsdc(value: string): bigint {
  if (typeof value !== "string" || !/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new MoneyError(`Invalid USDC amount: ${JSON.stringify(value)}`);
  }
  const [whole = "0", frac = ""] = value.split(".");
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

/** Format base units as a decimal string with trailing zeros trimmed ("98", "0.5"). */
export function formatUsdc(units: bigint): string {
  if (units < 0n) throw new MoneyError("Negative amounts are not supported");
  const whole = units / UNIT;
  const frac = (units % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function assertValidFeeBps(feeBps: number, maxFeeBps: number = MAX_FEE_BPS): void {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > maxFeeBps) {
    throw new MoneyError(`feeBps must be an integer in [0, ${maxFeeBps}], got ${feeBps}`);
  }
}

export interface FeeSplit {
  amount: bigint;
  fee: bigint;
  merchantAmount: bigint;
}

/**
 * Fee = floor(amount * feeBps / 10_000); merchant receives the remainder,
 * so fee + merchantAmount === amount always.
 * MUST match ClearGatewaySplitter.sol exactly (same integer division, same order of ops).
 */
export function splitAmount(amount: bigint, feeBps: number, maxFeeBps: number = MAX_FEE_BPS): FeeSplit {
  if (amount <= 0n) throw new MoneyError("amount must be positive");
  assertValidFeeBps(feeBps, maxFeeBps);
  const fee = (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
  return { amount, fee, merchantAmount: amount - fee };
}
