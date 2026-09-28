import { randomBytes } from "node:crypto";
import {
  adminUsers,
  apiKeys,
  createDb,
  createIntent,
  merchants,
  newId,
  onrampRouting,
  transitionIntent,
  type IntentRow,
  type PaymentStatus,
} from "@belk/db";
import type { OnrampProviderName } from "@belk/onramp";
import { generateApiKey, type Mode } from "@belk/shared";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { keccak256, stringToBytes } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { buildApp } from "../app.js";
import { loadConfig, type Config } from "../config.js";
import { EnvSigner } from "../signer/index.js";

export const SPLITTER = "0x1111111111111111111111111111111111111111";
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PLATFORM = "0x5555555555555555555555555555555555555555";
export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef0123456789abcdef";
export const DEPOSIT_FACTORY = "0x2222222222222222222222222222222222222222";
/** Deterministic stand-in for a chain client: no network calls, so these tests stay fast and offline. */
export const FAKE_BLOCK_NUMBER = 1_000_000n;

export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL as string,
    REDIS_URL: "redis://localhost:6379/1",
    RPC_URL: "https://sepolia.base.org",
    CHECKOUT_ORIGIN: "http://localhost:3001",
    CHECKOUT_BASE_URL: "http://localhost:3001/pay",
    CLIENT_SECRET_KEY: "cd".repeat(32),
    ENCRYPTION_KEY: "ef".repeat(32),
    WEBHOOK_ALLOW_PRIVATE_URLS: "true",
    CHAIN_WEBHOOK_MOCK_SECRET: "mock-chain-webhook-secret",
    ONRAMP_MOCK_SECRET: "mock-onramp-webhook-secret",
    ADMIN_TOKEN: ADMIN_TOKEN,
    SPLITTER_ADDRESS: SPLITTER,
    USDC_ADDRESS: USDC,
    DEPOSIT_FACTORY_ADDRESS: DEPOSIT_FACTORY,
    PLATFORM_WALLET_ADDRESS: PLATFORM,
    RATE_LIMIT_PER_KEY_PER_MIN: "100000",
    RATE_LIMIT_PER_IP_PER_MIN: "100000",
    AUTH_RATE_LIMIT_PER_MIN: "100000",
    ...overrides,
  };
}

export interface Harness {
  app: FastifyInstance;
  db: ReturnType<typeof createDb>["db"];
  config: Config;
  redis: Redis;
  signerAddress: `0x${string}`;
  close: () => Promise<void>;
}

export async function makeHarness(
  opts: {
    env?: Record<string, string>;
    signer?: boolean;
    /** false = simulate no chain reader configured (e.g. deposit-address returns 503 not_configured). */
    chain?: boolean;
    signalWatcher?: () => Promise<void>;
    enqueueReconcile?: () => Promise<void>;
  } = {},
): Promise<Harness> {
  const config = loadConfig(testEnv(opts.env));
  const { db, close } = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL);
  const key = generatePrivateKey();
  const signer = opts.signer === false ? undefined : new EnvSigner(key);
  const chain = opts.chain === false ? undefined : { getBlockNumber: async () => FAKE_BLOCK_NUMBER };
  const app = await buildApp({ config, db, redis, signer, chain, signalWatcher: opts.signalWatcher, enqueueReconcile: opts.enqueueReconcile });
  await app.ready();
  return {
    app,
    db,
    config,
    redis,
    signerAddress: privateKeyToAddress(key),
    close: async () => {
      await app.close();
      redis.disconnect();
      await close();
    },
  };
}

export interface SeededMerchant {
  merchantId: string;
  payoutWallet: `0x${string}`;
  apiKey: string;
}

export async function seedMerchant(
  h: Pick<Harness, "db">,
  o: { feeBps?: number; status?: "active" | "suspended" | "pending_kyb"; mode?: Mode } = {},
): Promise<SeededMerchant> {
  const merchantId = newId("mer");
  const payoutWallet = privateKeyToAddress(generatePrivateKey());
  await h.db.insert(merchants).values({
    id: merchantId,
    legalName: "Test Merchant LLC",
    displayName: "Test Merchant",
    status: o.status ?? "active",
    kybStatus: "approved",
    payoutWalletAddress: payoutWallet,
    feeBps: o.feeBps ?? 200,
    branding: { primary_color: "#0052ff" },
  });
  const key = generateApiKey(o.mode ?? "test");
  await h.db.insert(apiKeys).values({
    id: newId("key"),
    merchantId,
    mode: o.mode ?? "test",
    prefix: key.prefix,
    keyHash: key.hash,
  });
  return { merchantId, payoutWallet, apiKey: key.raw };
}

/** A staff account for the internal API. */
export async function seedAdmin(h: Pick<Harness, "db">): Promise<{ id: string; email: string }> {
  const id = newId("adm");
  const email = `${id}@cleargateway.test`;
  await h.db.insert(adminUsers).values({ id, email });
  return { id, email };
}

/** Client for /internal/v1: bearer ADMIN_TOKEN plus the acting staff member's email. */
export function adminClient(h: Pick<Harness, "app">, admin: { email: string }) {
  return async (
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    o: { body?: unknown; token?: string | null; email?: string | null } = {},
  ): Promise<ApiResponse> => {
    const headers: Record<string, string> = {};
    if (o.token !== null) headers.authorization = `Bearer ${o.token ?? ADMIN_TOKEN}`;
    if (o.email !== null) headers["x-admin-email"] = o.email ?? admin.email;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await h.app.inject({ method, url: `/internal/v1${url}`, headers, payload: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, json, headers: res.headers };
  };
}

export async function seedOnrampRouting(
  h: Pick<Harness, "db">,
  merchantId: string,
  rows: { provider: OnrampProviderName; priority?: number; enabled?: boolean }[],
): Promise<void> {
  await h.db.insert(onrampRouting).values(
    rows.map((r) => ({ id: newId("ors"), merchantId, provider: r.provider, priority: r.priority ?? 0, enabled: r.enabled ?? true })),
  );
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: response shapes are asserted per test
  json: any;
  headers: Record<string, unknown>;
}

export function client(h: Pick<Harness, "app">) {
  return async (
    method: "GET" | "POST" | "DELETE",
    url: string,
    o: { key?: string; body?: unknown; headers?: Record<string, string>; idem?: string | false } = {},
  ): Promise<ApiResponse> => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.key) headers.authorization = `Bearer ${o.key}`;
    if (method === "POST" && o.idem !== false) headers["idempotency-key"] = o.idem ?? `idem_${randomBytes(8).toString("hex")}`;
    const res = await h.app.inject({
      method,
      url,
      headers: o.body !== undefined ? { "content-type": "application/json", ...headers } : headers,
      payload: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, json, headers: res.headers };
  };
}

/** Inserts an intent directly (bypassing the API) for merchant `merchantId`. Uses the state machine module. */
export async function insertIntent(
  h: Pick<Harness, "db">,
  merchantId: string,
  o: { mode?: Mode; status?: PaymentStatus; expiresAt?: Date; amount?: bigint; createdAt?: Date } = {},
): Promise<IntentRow> {
  const id = newId("pi");
  const amount = o.amount ?? 100_000_000n;
  const row = await h.db.transaction(async (tx) => {
    const created = await createIntent(
      tx,
      {
        id,
        merchantId,
        mode: o.mode ?? "test",
        amount,
        feeBps: 200,
        feeAmount: (amount * 200n) / 10_000n,
        merchantAmount: amount - (amount * 200n) / 10_000n,
        clientSecretHash: "0".repeat(64),
        chainId: 84532,
        intentHash: keccak256(stringToBytes(id)),
        expiresAt: o.expiresAt ?? new Date(Date.now() + 3600_000),
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
      "test",
    );
    // Walk the state machine to the requested status.
    const path: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
      awaiting_payment: ["awaiting_payment"],
      confirming: ["awaiting_payment", "confirming"],
      succeeded: ["awaiting_payment", "confirming", "succeeded"],
      expired: ["expired"],
      canceled: ["canceled"],
      failed: ["awaiting_payment", "confirming", "failed"],
    };
    let last = created;
    for (const to of path[o.status ?? "created"] ?? []) {
      last = await transitionIntent(tx, { intentId: id, to, actor: "test" });
    }
    return last;
  });
  return row;
}
