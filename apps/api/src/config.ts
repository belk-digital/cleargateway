import { CHAIN_IDS } from "@belk/shared";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

/** Empty strings from .env count as "unset". */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/** Checksummed-or-lowercase hex address in, EIP-55 checksummed address out. */
const address = z
  .string()
  .refine((v) => isAddress(v), "must be a valid EVM address")
  .transform((v) => getAddress(v));

const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes of hex (64 chars)");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Phase 1 is testnet only: mainnet must be enabled deliberately in a later phase.
  CHAIN_ID: z.coerce.number().int().refine((v) => v === CHAIN_IDS.baseSepolia, {
    message: "Only Base Sepolia (84532) is enabled in Phase 1",
  }).default(CHAIN_IDS.baseSepolia),
  RPC_URL: z.string().url(),
  USDC_ADDRESS: optional(address),
  SPLITTER_ADDRESS: optional(address),
  /** DepositFactory for per-payment deposit addresses. Unset = the deposit-address checkout method is disabled. */
  DEPOSIT_FACTORY_ADDRESS: optional(address),
  CONFIRMATIONS: z.coerce.number().int().min(0).max(1000).default(5),

  PLATFORM_WALLET_ADDRESS: optional(address),
  CHECKOUT_ORIGIN: z.string().url(),
  CHECKOUT_BASE_URL: z.string().url(),

  ADMIN_TOKEN: optional(z.string().min(32)),
  ENCRYPTION_KEY: optional(hex32),
  /** HMAC key deriving checkout client secrets. Required to create payment intents. */
  CLIENT_SECRET_KEY: optional(hex32),
  SIGNER_PRIVATE_KEY: optional(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),

  /** Trust X-Forwarded-For. Enable ONLY behind a proxy you control, or clients can spoof their IP. */
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Dev/test only: allow http:// and private-network webhook URLs (SSRF guard off). Never enable in production. */
  WEBHOOK_ALLOW_PRIVATE_URLS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Shared secret for the "mock" chain-webhook provider (local dev / tests). */
  CHAIN_WEBHOOK_MOCK_SECRET: optional(z.string().min(16)),
  /** Shared secret for the "mock" on-ramp provider (local dev / tests). Real providers (Wert/Simplex) are stubs. */
  ONRAMP_MOCK_SECRET: optional(z.string().min(16)),
  RATE_LIMIT_PER_KEY_PER_MIN: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_PER_IP_PER_MIN: z.coerce.number().int().min(1).default(300),
  /** Sign-in and invite routes are public, so they get a much lower per-IP limit than the rest of the API. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
  /** Max lifetime of a signed wallet-payment payload (also capped by the intent's own expiry). */
  SIGNATURE_MAX_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1800),

  SENTRY_DSN: optional(z.string().url()),
});

export type Config = z.infer<typeof envSchema>;

/** Parse and validate environment variables. Throws a readable error listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
