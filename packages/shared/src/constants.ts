export const USDC_DECIMALS = 6;
export const BPS_DENOMINATOR = 10_000n;
/** Hard ceiling on merchant fee; the contract enforces its own configurable max too. */
export const MAX_FEE_BPS = 1000;
export const CURRENCY_USDC = "USDC" as const;

export const CHAIN_IDS = { baseSepolia: 84532, base: 8453 } as const;

export const PAYMENT_METHODS = ["wallet", "deposit_address", "onramp"] as const;
export const MODES = ["test", "live"] as const;
export type Mode = (typeof MODES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Payment intent amount bounds in USDC base units: $0.01 to $1,000,000. */
export const MIN_AMOUNT_UNITS = 10_000n;
export const MAX_AMOUNT_UNITS = 1_000_000_000_000n;

/** BullMQ queue names shared by the API (producer of "watch now" signals) and the worker. */
export const QUEUE_NAMES = {
  chainWatcher: "chain-watcher",
  confirmations: "confirmations",
  expiry: "expiry",
  webhookDelivery: "webhook-delivery",
  reconciliation: "reconciliation",
  depositWatcher: "deposit-watcher",
  sweeper: "sweeper",
  onrampProcessor: "onramp-processor",
} as const;
