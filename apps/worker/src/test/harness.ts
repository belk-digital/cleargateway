import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "@belk/api/app";
import { loadConfig, type Config } from "@belk/api/config";
import {
  clearGatewaySplitterAbi,
  clearGatewaySplitterBytecode,
  createChainClient,
  depositFactoryAbi,
  depositFactoryBytecode,
  defineEvmChain,
  EnvSigner,
  mockUsdcAbi,
  mockUsdcBytecode,
} from "@belk/chain";
import { apiKeys, createDb, merchants, newId, onrampRouting } from "@belk/db";
import { MockOnrampProvider, SimplexOnrampProvider, WertOnrampProvider, type OnrampProviderName } from "@belk/onramp";
import { generateApiKey } from "@belk/shared";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import {
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loadWorkerConfig, type WorkerConfig } from "../config.js";
import { silentLogger, type WorkerCtx } from "../context.js";

export const RPC_URL = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN_ID = 84532;
const ONE_ETH = 10n ** 18n;

export interface Chain {
  publicClient: PublicClient;
  mine: (blocks: number) => Promise<void>;
  snapshot: () => Promise<Hex>;
  revert: (id: Hex) => Promise<void>;
  fund: (address: Address) => Promise<void>;
  wallet: (account: PrivateKeyAccount) => WalletClient<HttpTransport, ReturnType<typeof defineEvmChain>, PrivateKeyAccount>;
  usdc: Address;
  splitter: Address;
  deployBlock: bigint;
  signerAccount: PrivateKeyAccount;
  platform: Address;
  usdcAbi: typeof mockUsdcAbi;
  splitterAbi: typeof clearGatewaySplitterAbi;
  depositFactory: Address;
  depositImplementation: Address;
  depositFactoryAbi: typeof depositFactoryAbi;
}

/** Deploys a fresh MockUSDC + ClearGatewaySplitter to the local Anvil (chain id 84532) with a new signer. */
export async function deployChain(): Promise<Chain> {
  const chainDef = defineEvmChain(CHAIN_ID, RPC_URL);
  const publicClient = createChainClient(RPC_URL, CHAIN_ID);
  // Long timeout: evm_revert/mine can be slow when the machine is busy, and that must not fail a test.
  const testClient = createTestClient({ chain: chainDef, mode: "anvil", transport: http(RPC_URL, { timeout: 60_000 }) });
  const fund = async (a: Address) => testClient.setBalance({ address: a, value: 100n * ONE_ETH });
  const wallet = (account: PrivateKeyAccount) => createWalletClient({ account, chain: chainDef, transport: http(RPC_URL, { timeout: 60_000 }) });

  const deployer = privateKeyToAccount(generatePrivateKey());
  const signerAccount = newAccount();
  const platform = privateKeyToAccount(generatePrivateKey()).address;
  await fund(deployer.address);
  const w = wallet(deployer);

  const usdcHash = await w.deployContract({ abi: mockUsdcAbi, bytecode: mockUsdcBytecode, args: [], chain: chainDef });
  const usdc = (await publicClient.waitForTransactionReceipt({ hash: usdcHash })).contractAddress as Address;
  const splitterHash = await w.deployContract({
    abi: clearGatewaySplitterAbi,
    bytecode: clearGatewaySplitterBytecode,
    args: [usdc, signerAccount.address, platform, 1000n, deployer.address],
    chain: chainDef,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: splitterHash });
  const splitter = receipt.contractAddress as Address;

  const factoryHash = await w.deployContract({ abi: depositFactoryAbi, bytecode: depositFactoryBytecode, args: [splitter], chain: chainDef });
  const depositFactory = (await publicClient.waitForTransactionReceipt({ hash: factoryHash })).contractAddress as Address;
  const depositImplementation = (await publicClient.readContract({ address: depositFactory, abi: depositFactoryAbi, functionName: "implementation" })) as Address;

  return {
    publicClient,
    mine: async (blocks) => testClient.mine({ blocks }),
    snapshot: async () => testClient.snapshot(),
    revert: async (id) => testClient.revert({ id }),
    fund,
    wallet,
    usdc,
    splitter,
    deployBlock: receipt.blockNumber,
    signerAccount,
    platform,
    usdcAbi: mockUsdcAbi,
    splitterAbi: clearGatewaySplitterAbi,
    depositFactory,
    depositImplementation,
    depositFactoryAbi,
  };
}

export interface Stack {
  chain: Chain;
  db: ReturnType<typeof createDb>["db"];
  app: FastifyInstance;
  apiConfig: Config;
  redis: Redis;
  ctx: WorkerCtx;
  workerConfig: WorkerConfig;
  relayerAccount: PrivateKeyAccount;
  close: () => Promise<void>;
}

/** Full stack: deployed contracts + the real API app + worker context, all against the test database. */
export async function makeStack(o: { worker?: Record<string, string>; api?: Record<string, string>; chain?: Chain } = {}): Promise<Stack> {
  const chain = o.chain ?? (await deployChain());
  const dbUrl = process.env.TEST_DATABASE_URL as string;
  const shared = {
    NODE_ENV: "test",
    DATABASE_URL: dbUrl,
    REDIS_URL: "redis://localhost:6379/2",
    RPC_URL,
    CHAIN_ID: String(CHAIN_ID),
    SPLITTER_ADDRESS: chain.splitter,
    USDC_ADDRESS: chain.usdc,
    DEPOSIT_FACTORY_ADDRESS: chain.depositFactory,
    CONFIRMATIONS: "3",
    ENCRYPTION_KEY: "ef".repeat(32),
    WEBHOOK_ALLOW_PRIVATE_URLS: "true",
  };
  const apiConfig = loadConfig({
    ...shared,
    PLATFORM_WALLET_ADDRESS: chain.platform,
    CHECKOUT_ORIGIN: "http://localhost:3001",
    CHECKOUT_BASE_URL: "http://localhost:3001/pay",
    CLIENT_SECRET_KEY: "cd".repeat(32),
    ONRAMP_MOCK_SECRET: "e2e-onramp-webhook-secret",
    RATE_LIMIT_PER_KEY_PER_MIN: "100000",
    RATE_LIMIT_PER_IP_PER_MIN: "100000",
    ...o.api,
  });
  const workerConfig = loadWorkerConfig({
    ...shared,
    WATCHER_START_BLOCK: chain.deployBlock.toString(),
    REORG_GRACE_SECONDS: "0",
    EXPIRY_GRACE_SECONDS: "0",
    // Generous: a busy CI/laptop must not turn a slow local receiver into a false failure. The timeout test overrides it.
    WEBHOOK_TIMEOUT_MS: "15000",
    ...o.worker,
  });
  const { db, close } = createDb(dbUrl);
  const redis = new Redis(apiConfig.REDIS_URL);
  const app = await buildApp({
    config: apiConfig,
    db,
    redis,
    signer: new EnvSigner(await exportKey(chain.signerAccount)),
    // Real on-chain reads, exactly as the production server would use: the checkout API's deposit-address
    // endpoint calls getBlockNumber() on the same Anvil node the rest of this stack runs against.
    chain: chain.publicClient,
  });
  await app.ready();

  // Same backend signer key the API uses (sweeps and wallet payments are both signed by the same key), plus a
  // separate gas-only relayer account, funded on Anvil, exactly as production keeps the two roles apart.
  const signer = new EnvSigner(await exportKey(chain.signerAccount));
  const relayerAccount = newAccount();
  await chain.fund(relayerAccount.address);
  const relayer = chain.wallet(relayerAccount);
  // Only parseWebhook is ever exercised here (an already-verified payload); no secret is needed for that.
  const onrampProviders = { mock: new MockOnrampProvider(), wert: new WertOnrampProvider(), simplex: new SimplexOnrampProvider() };
  const ctx: WorkerCtx = { db, chain: chain.publicClient, config: workerConfig, log: silentLogger, signer, relayer, onrampProviders };
  return {
    chain,
    db,
    app,
    apiConfig,
    redis,
    ctx,
    workerConfig,
    relayerAccount,
    close: async () => {
      await app.close();
      redis.disconnect();
      await close();
    },
  };
}

// The signer key is generated per run in deployChain(); recover it from the account for the API's EnvSigner.
const keys = new WeakMap<PrivateKeyAccount, Hex>();
export function newAccount(): PrivateKeyAccount {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  keys.set(account, key);
  return account;
}
async function exportKey(account: PrivateKeyAccount): Promise<Hex> {
  const k = keys.get(account);
  if (!k) throw new Error("account was not created with newAccount()");
  return k;
}

export interface SeededMerchant {
  merchantId: string;
  payoutWallet: Address;
  apiKey: string;
}

export async function seedMerchant(s: Pick<Stack, "db">, feeBps = 200): Promise<SeededMerchant> {
  const merchantId = newId("mer");
  const payoutWallet = privateKeyToAccount(generatePrivateKey()).address;
  await s.db.insert(merchants).values({
    id: merchantId,
    legalName: "E2E Merchant",
    displayName: "E2E Merchant",
    status: "active",
    kybStatus: "approved",
    payoutWalletAddress: payoutWallet,
    feeBps,
  });
  const key = generateApiKey("test");
  await s.db.insert(apiKeys).values({ id: newId("key"), merchantId, mode: "test", prefix: key.prefix, keyHash: key.hash });
  return { merchantId, payoutWallet, apiKey: key.raw };
}

export async function seedOnrampRouting(
  s: Pick<Stack, "db">,
  merchantId: string,
  rows: { provider: OnrampProviderName; priority?: number; enabled?: boolean }[],
): Promise<void> {
  await s.db.insert(onrampRouting).values(
    rows.map((r) => ({ id: newId("ors"), merchantId, provider: r.provider, priority: r.priority ?? 0, enabled: r.enabled ?? true })),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// API helper

export interface ApiRes {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: response shapes are asserted per test
  json: any;
}
export function apiClient(s: Pick<Stack, "app">, apiKey: string) {
  let n = 0;
  return async (method: "GET" | "POST" | "DELETE", url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiRes> => {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, ...extraHeaders };
    if (method === "POST") headers["idempotency-key"] = `e2e-${Date.now()}-${n++}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await s.app.inject({ method, url, headers, payload: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.statusCode, json: res.json() };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Customer-side payment helpers (what the future checkout frontend does with the API's wallet-payment payload)

export interface WalletPayload {
  payment_intent: { intentId: Hex; merchant: Address; payer: Address; amount: string; feeBps: string; expiry: string };
  intent_signature: Hex;
  authorization?: {
    valid_after: string;
    valid_before: string;
    typed_data: {
      domain: { name: string; version: string; chainId: number; verifyingContract: Address };
      types: Record<string, { name: string; type: string }[]>;
      primary_type: string;
      message: Record<string, string>;
    };
  };
}

const toStruct = (p: WalletPayload["payment_intent"]) => ({
  intentId: p.intentId,
  merchant: p.merchant,
  payer: p.payer,
  amount: BigInt(p.amount),
  feeBps: BigInt(p.feeBps),
  expiry: BigInt(p.expiry),
});

/** Fixed fee params so a re-sent transaction is byte-identical (same hash) for reorg tests. */
export const FIXED_TX = { gas: 600_000n, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n } as const;

export async function mintTo(chain: Chain, to: Address, amount: bigint): Promise<void> {
  const deployerLike = newAccount();
  await chain.fund(deployerLike.address);
  const hash = await chain.wallet(deployerLike).writeContract({
    address: chain.usdc,
    abi: chain.usdcAbi,
    functionName: "mint",
    args: [to, amount],
    chain: null,
  });
  await chain.publicClient.waitForTransactionReceipt({ hash });
}

/** approve + splitter.pay from the payer's wallet. Returns the pay tx hash. */
export async function payWithApprove(chain: Chain, payer: PrivateKeyAccount, payload: WalletPayload, fixed = false): Promise<Hex> {
  const w = chain.wallet(payer);
  const approveHash = await w.writeContract({
    address: chain.usdc,
    abi: chain.usdcAbi,
    functionName: "approve",
    args: [chain.splitter, BigInt(payload.payment_intent.amount)],
    chain: null,
  });
  await chain.publicClient.waitForTransactionReceipt({ hash: approveHash });
  return w.writeContract({
    address: chain.splitter,
    abi: chain.splitterAbi,
    functionName: "pay",
    args: [toStruct(payload.payment_intent), payload.intent_signature],
    chain: null,
    ...(fixed ? FIXED_TX : {}),
  });
}

/** Payer signs the EIP-3009 authorization; a separate relayer submits payWithAuthorization. */
export async function payWithAuthorization(chain: Chain, payer: PrivateKeyAccount, relayer: PrivateKeyAccount, payload: WalletPayload): Promise<Hex> {
  const auth = payload.authorization;
  if (!auth) throw new Error("payload has no authorization section");
  const td = auth.typed_data;
  const authSig = await payer.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primary_type,
    message: {
      from: td.message.from as Address,
      to: td.message.to as Address,
      value: BigInt(td.message.value ?? "0"),
      validAfter: BigInt(td.message.validAfter ?? "0"),
      validBefore: BigInt(td.message.validBefore ?? "0"),
      nonce: td.message.nonce as Hex,
    },
  });
  return chain.wallet(relayer).writeContract({
    address: chain.splitter,
    abi: chain.splitterAbi,
    functionName: "payWithAuthorization",
    args: [toStruct(payload.payment_intent), payload.intent_signature, BigInt(auth.valid_after), BigInt(auth.valid_before), authSig],
    chain: null,
  });
}

export async function balanceOf(chain: Chain, who: Address): Promise<bigint> {
  return chain.publicClient.readContract({ address: chain.usdc, abi: chain.usdcAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
}

// ---------------------------------------------------------------------------------------------------------------
// Webhook receiver

export interface ReceivedWebhook {
  headers: IncomingHttpHeaders;
  body: string;
}
export interface Receiver {
  url: string;
  received: ReceivedWebhook[];
  /** Status codes to answer with, consumed in order; then `defaultStatus`. */
  script: number[];
  defaultStatus: number;
  /** When set, the next response is delayed by this many ms (timeout tests). */
  delayMs: number;
  /** When set, respond with a redirect to this location. */
  redirectTo: string | null;
  close: () => Promise<void>;
}

export async function startReceiver(): Promise<Receiver> {
  const r: Receiver = { url: "", received: [], script: [], defaultStatus: 200, delayMs: 0, redirectTo: null, close: async () => {} };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      r.received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      const respond = () => {
        if (r.redirectTo) {
          res.writeHead(302, { location: r.redirectTo }).end();
          return;
        }
        res.writeHead(r.script.shift() ?? r.defaultStatus).end("ok");
      };
      if (r.delayMs > 0) setTimeout(respond, r.delayMs);
      else respond();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  r.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  r.close = () => new Promise((resolve) => server.close(() => resolve()));
  return r;
}

