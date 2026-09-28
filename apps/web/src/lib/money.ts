/** USDC has 6 decimals. All amounts are integer base-unit strings; floats never touch money. */
export const USDC_DECIMALS = 6;

/** "100000000" -> "100.00" (at least 2 decimals, trailing zeros beyond that trimmed). */
export function formatUsdc(units: string | bigint): string {
  const v = typeof units === "bigint" ? units : BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (abs % base).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** "12.5" -> "12500000". Returns null for anything that is not a positive amount with at most 6 decimals. */
export function parseUsdc(input: string): string | null {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!m) return null;
  const units = BigInt(m[1]!) * 10n ** 6n + BigInt((m[2] ?? "").padEnd(6, "0"));
  return units > 0n ? units.toString() : null;
}
