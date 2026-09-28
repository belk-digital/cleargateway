import { CHAIN_IDS } from "@belk/shared";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const address = z.string().refine((v) => isAddress(v), "must be a valid EVM address").transform((v) => getAddress(v));
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Phase 1 is testnet only (a local Anvil is started with --chain-id 84532).
  CHAIN_ID: z.coerce.number().int().refine((v) => v === CHAIN_IDS.baseSepolia, "Only Base Sepolia (84532) is enabled in Phase 1").default(CHAIN_IDS.baseSepolia),
  RPC_URL: z.string().url(),
  SPLITTER_ADDRESS: address,
  USDC_ADDRESS: optional(address),
  /** DepositFactory for per-payment deposit addresses. Unset = deposit-address support disabled. */
  DEPOSIT_FACTORY_ADDRESS: optional(address),
  /** How long after creation a deposit address keeps being watched (late deposits are flagged for review). */
  DEPOSIT_LATE_LOOKBACK_DAYS: int(30, 1),
  /** Backend signer for sweep intents (and, later, rescues). Same key/role as the API's wallet-payment signer. */
  SIGNER_PRIVATE_KEY: optional(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
  /** Gas-only relayer that submits sweep transactions. Holds no special authority: DepositFactory.sweep() is
   *  permissionless and recipients are fixed by the signed intent, so this key can only pay gas, never redirect funds. */
  RELAYER_PRIVATE_KEY: optional(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
  /** How long a sweep signature stays valid for; minted fresh at send time, never in advance. */
  SWEEP_SIGNATURE_TTL_SECONDS: int(600, 60),
  /** Give up on a sweep attempt after this many tries and flag the intent for review. */
  SWEEP_MAX_ATTEMPTS: int(10, 1),
  /** Minimum time between sweep attempts for the same address (avoids hot-looping a permanent failure). */
  SWEEP_RETRY_BACKOFF_SECONDS: int(30, 1),
  /** Confirmations required before a payment is final. */
  CONFIRMATIONS: int(5),

  /** First block to scan on a fresh database. Set to the splitter's deployment block. Unset = start at the chain head. */
  WATCHER_START_BLOCK: optional(z.coerce.bigint().min(0n)),
  WATCHER_MAX_RANGE: int(1000, 1),
  /** How far back to rewind the cursor when the last scanned block's hash changed (reorg). */
  REORG_REWIND_BLOCKS: int(20, 1),
  /** How long a confirming payment may have a missing receipt before it is failed as reorged-out. */
  REORG_GRACE_SECONDS: int(600),
  /** Unpaid awaiting_payment intents are expired only this long after expires_at (in-flight tx safety margin). */
  EXPIRY_GRACE_SECONDS: int(120),
  /** If the watcher heartbeat is older than this, expiry of on-chain-payable intents is paused. */
  WATCHER_STALE_SECONDS: int(300, 1),
  /** Reconciliation looks back at most this many blocks when WATCHER_START_BLOCK is unset. */
  RECONCILE_MAX_LOOKBACK_BLOCKS: int(200_000, 1),

  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes of hex"),
  WEBHOOK_TIMEOUT_MS: int(10_000, 100),
  /** Dev/test only: allow http:// and private-network webhook targets. Never enable in production. */
  WEBHOOK_ALLOW_PRIVATE_URLS: bool,

  WATCHER_INTERVAL_MS: int(5_000, 100),
  CONFIRMATIONS_INTERVAL_MS: int(5_000, 100),
  EXPIRY_INTERVAL_MS: int(30_000, 100),
  WEBHOOK_INTERVAL_MS: int(5_000, 100),
  DEPOSIT_INTERVAL_MS: int(5_000, 100),
  SWEEP_INTERVAL_MS: int(5_000, 100),
  ONRAMP_INTERVAL_MS: int(5_000, 100),
  /** How many unprocessed on-ramp webhook rows to apply per tick. */
  ONRAMP_BATCH_SIZE: int(50, 1),
  /** Cron for the daily reconciliation run (server time). */
  RECONCILE_CRON: z.string().default("0 3 * * *"),
  SENTRY_DSN: optional(z.string().url()),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid worker configuration:\n${problems}`);
  }
  return parsed.data;
}
