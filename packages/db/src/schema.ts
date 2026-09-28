import { sql } from "drizzle-orm";
import {
  bigint as pgBigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** USDC base units: numeric(78,0) in Postgres, bigint in TypeScript. Never a float. */
export const amount = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(78,0)",
  toDriver: (v) => v.toString(),
  fromDriver: (v) => BigInt(v),
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const merchants = pgTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["pending_kyb", "active", "suspended"] }).notNull().default("pending_kyb"),
    kybStatus: text("kyb_status", { enum: ["not_started", "in_review", "approved", "rejected"] })
      .notNull()
      .default("not_started"),
    payoutWalletAddress: text("payout_wallet_address").notNull(),
    feeBps: integer("fee_bps").notNull(),
    settlementToken: text("settlement_token").notNull().default("USDC"),
    branding: jsonb("branding").$type<{ logo_url?: string; primary_color?: string }>().notNull().default({}),
    webhookUrl: text("webhook_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("merchants_fee_bps_range", sql`${t.feeBps} BETWEEN 0 AND 1000`)],
);

export const merchantUsers = pgTable(
  "merchant_users",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "admin", "developer", "viewer"] }).notNull(),
    passwordHash: text("password_hash"),
    /** Reserved for SSO: the identity provider's subject id. Unused until an IdP is chosen. */
    authProviderId: text("auth_provider_id"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: ts("locked_until"),
    disabledAt: ts("disabled_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("merchant_users_email_uq").on(t.email)],
);

export const adminUsers = pgTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** scrypt hash. NULL until the person accepts their invite (they cannot sign in before that). */
  passwordHash: text("password_hash"),
  /** AES-GCM encrypted TOTP secret. Staff must have two-factor enabled to sign in. */
  totpSecretEncrypted: text("totp_secret_encrypted"),
  /** Last accepted TOTP time step: a code cannot be used twice. */
  totpLastStep: pgBigint("totp_last_step", { mode: "number" }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  disabledAt: ts("disabled_at"),
  createdAt: createdAt(),
});

/** Server-side sessions. Only a SHA-256 of the bearer token is stored, so a database leak cannot be replayed. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["merchant", "admin"] }).notNull(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    mode: text("mode", { enum: ["test", "live"] }).notNull().default("test"),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.kind, t.userId)],
);

/** One-time links: an invite (first password) or a reset (new password). Only the token's hash is stored. */
export const authInvites = pgTable(
  "auth_invites",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["merchant", "admin"] }).notNull(),
    purpose: text("purpose", { enum: ["invite", "reset"] }).notNull(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** Staff only: the TOTP secret being enrolled, encrypted; it becomes the account's secret when the invite is accepted. */
    totpSecretEncrypted: text("totp_secret_encrypted"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_invites_user_idx").on(t.kind, t.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    mode: text("mode", { enum: ["test", "live"] }).notNull(),
    /** Non-secret lookup prefix, e.g. "sk_test_ab12cd34". */
    prefix: text("prefix").notNull(),
    /** SHA-256 hex of the raw key. The raw key is shown once and never stored. */
    keyHash: text("key_hash").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_prefix_uq").on(t.prefix), index("api_keys_merchant_idx").on(t.merchantId)],
);

export const PAYMENT_STATUSES = [
  "created",
  "awaiting_payment",
  "confirming",
  "succeeded",
  "expired",
  "underpaid",
  "failed",
  "canceled",
  "refunded",
  "partially_refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    mode: text("mode", { enum: ["test", "live"] }).notNull(),
    amount: amount("amount").notNull(),
    currency: text("currency").notNull().default("USDC"),
    feeBps: integer("fee_bps").notNull(),
    feeAmount: amount("fee_amount").notNull(),
    merchantAmount: amount("merchant_amount").notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("created"),
    paymentMethod: text("payment_method", { enum: ["wallet", "deposit_address", "onramp"] }),
    merchantOrderId: text("merchant_order_id"),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    customerEmail: text("customer_email"),
    payerAddress: text("payer_address"),
    successUrl: text("success_url"),
    cancelUrl: text("cancel_url"),
    clientSecretHash: text("client_secret_hash").notNull(),
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address"),
    /** bytes32 identifier passed to the splitter contract. */
    intentHash: text("intent_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    depositAddress: text("deposit_address"),
    onrampProvider: text("onramp_provider"),
    onrampOrderId: text("onramp_order_id"),
    onrampStatus: text("onramp_status"),
    txHash: text("tx_hash"),
    blockNumber: pgBigint("block_number", { mode: "bigint" }),
    blockHash: text("block_hash"),
    confirmations: integer("confirmations").notNull().default(0),
    overpaidAmount: amount("overpaid_amount").notNull().default(sql`0`),
    underpaidAmount: amount("underpaid_amount").notNull().default(sql`0`),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewReason: text("review_reason"),
    succeededAt: ts("succeeded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("payment_intents_amount_positive", sql`${t.amount} > 0`),
    check("payment_intents_split_sums", sql`${t.feeAmount} + ${t.merchantAmount} = ${t.amount}`),
    index("payment_intents_merchant_created_idx").on(t.merchantId, t.mode, t.createdAt.desc(), t.id),
    index("payment_intents_status_expires_idx").on(t.status, t.expiresAt),
    uniqueIndex("payment_intents_order_uq")
      .on(t.merchantId, t.mode, t.merchantOrderId)
      .where(sql`${t.merchantOrderId} IS NOT NULL`),
    uniqueIndex("payment_intents_intent_hash_uq").on(t.intentHash),
    index("payment_intents_tx_hash_idx").on(t.txHash),
  ],
);

/** Append-only audit log (UPDATE/DELETE blocked by trigger, see custom migration). */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").notNull().references(() => paymentIntents.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actor: text("actor").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("payment_events_intent_idx").on(t.intentId, t.createdAt)],
);

export const chainTransactions = pgTable(
  "chain_transactions",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: pgBigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    eventName: text("event_name").notNull(),
    rawEvent: jsonb("raw_event").$type<Record<string, unknown>>().notNull(),
    intentId: text("intent_id").references(() => paymentIntents.id),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chain_tx_hash_log_uq").on(t.chainId, t.txHash, t.logIndex)],
);

export const chainCursors = pgTable(
  "chain_cursors",
  {
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    lastProcessedBlock: pgBigint("last_processed_block", { mode: "bigint" }).notNull(),
    lastBlockHash: text("last_block_hash"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("chain_cursors_uq").on(t.chainId, t.contractAddress)],
);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: ["merchant_receivable", "platform_fee_revenue", "customer_payments_clearing"],
    }).notNull(),
    merchantId: text("merchant_id").references(() => merchants.id),
    mode: text("mode", { enum: ["test", "live"] }).notNull(),
    currency: text("currency").notNull().default("USDC"),
    createdAt: createdAt(),
  },
  (t) => [
    // COALESCE so platform-level accounts (null merchant) are unique per type/mode too.
    uniqueIndex("ledger_accounts_uq").on(t.type, sql`COALESCE(${t.merchantId}, '')`, t.mode, t.currency),
  ],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").references(() => paymentIntents.id),
    kind: text("kind", { enum: ["payment_settled", "refund"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // A payment can be booked at most once, even if two workers race.
    uniqueIndex("ledger_tx_settled_once")
      .on(t.intentId)
      .where(sql`${t.kind} = 'payment_settled'`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull().references(() => ledgerTransactions.id),
    accountId: text("account_id").notNull().references(() => ledgerAccounts.id),
    direction: text("direction", { enum: ["debit", "credit"] }).notNull(),
    amount: amount("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("ledger_entries_amount_positive", sql`${t.amount} > 0`),
    index("ledger_entries_tx_idx").on(t.transactionId),
    index("ledger_entries_account_idx").on(t.accountId),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    mode: text("mode", { enum: ["test", "live"] }).notNull(),
    url: text("url").notNull(),
    /** AES-256-GCM encrypted signing secret (the plaintext is needed to sign). */
    secretEncrypted: text("secret_encrypted").notNull(),
    enabledEvents: jsonb("enabled_events").$type<string[]>().notNull().default(["*"]),
    status: text("status", { enum: ["enabled", "disabled"] }).notNull().default("enabled"),
    createdAt: createdAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("webhook_endpoints_merchant_idx").on(t.merchantId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at"),
    lastResponseCode: integer("last_response_code"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_event_endpoint_uq").on(t.eventId, t.endpointId),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const webhookAttempts = pgTable("webhook_attempts", {
  id: text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => webhookDeliveries.id),
  attemptNumber: integer("attempt_number").notNull(),
  responseCode: integer("response_code"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: createdAt(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    lockedAt: ts("locked_at"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [uniqueIndex("idempotency_keys_uq").on(t.merchantId, t.key)],
);

export const REFUND_STATUSES = ["requested", "approved", "processing", "succeeded", "failed", "rejected"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").notNull().references(() => paymentIntents.id),
    amount: amount("amount").notNull(),
    status: text("status", { enum: REFUND_STATUSES }).notNull().default("requested"),
    toAddress: text("to_address").notNull(),
    txHash: text("tx_hash"),
    requestedBy: text("requested_by").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("refunds_intent_idx").on(t.intentId, t.status)],
);

/**
 * Append-only record of every action a ClearGateway staff member takes through the internal API (UPDATE/DELETE blocked by
 * trigger, see the custom migration). Merchant-level changes have no payment_events row to hang off, so they live here.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id").notNull().references(() => adminUsers.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /** Before/after values and free-text notes. Never secrets (raw API keys are never stored or logged). */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_target_idx").on(t.targetType, t.targetId, t.createdAt)],
);

export const onrampRouting = pgTable(
  "onramp_routing",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    provider: text("provider", { enum: ["mock", "wert", "simplex"] }).notNull(),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [uniqueIndex("onramp_routing_uq").on(t.merchantId, t.provider)],
);

export const onrampSessions = pgTable(
  "onramp_sessions",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").notNull().references(() => paymentIntents.id),
    provider: text("provider").notNull(),
    /** OUR session reference (see packages/onramp), echoed back by the provider in every webhook for this session. */
    providerSessionId: text("provider_session_id").notNull(),
    customerWalletAddress: text("customer_wallet_address").notNull(),
    status: text("status", { enum: ["created", "pending", "completed", "failed"] }).notNull().default("created"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("onramp_sessions_provider_ref_uq").on(t.provider, t.providerSessionId)],
);

export const inboundWebhookEvents = pgTable(
  "inbound_webhook_events",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["onramp", "chain"] }).notNull(),
    provider: text("provider").notNull(),
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    /** Raw body stored before any parsing. */
    rawBody: text("raw_body").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("inbound_webhook_events_unprocessed_idx").on(t.processedAt)],
);

/** Output of each reconciliation run. Reconciliation only reports; it never fixes money. */
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
  status: text("status", { enum: ["ok", "mismatch", "error"] }).notNull(),
  mismatchCount: integer("mismatch_count").notNull().default(0),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at").notNull(),
});

/**
 * One deposit address per payment intent (DepositFactory clone, CREATE2, salt = intent id). Created when the customer
 * chooses "send from an exchange". The address exists before any code is deployed at it.
 */
export const depositAddresses = pgTable(
  "deposit_addresses",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").notNull().references(() => paymentIntents.id),
    chainId: integer("chain_id").notNull(),
    /** Lowercase 0x address. */
    address: text("address").notNull(),
    factoryAddress: text("factory_address").notNull(),
    implementationAddress: text("implementation_address").notNull(),
    /** bytes32 CREATE2 salt (= payment_intents.intent_hash). */
    salt: text("salt").notNull(),
    /** Chain head when the address was issued; scanning never starts before it. */
    creationBlock: pgBigint("creation_block", { mode: "bigint" }).notNull(),
    scannedThroughBlock: pgBigint("scanned_through_block", { mode: "bigint" }).notNull(),
    /** Heartbeat: last time the deposit watcher scanned this address. Expiry is paused while it is stale. */
    lastScannedAt: ts("last_scanned_at"),
    status: text("status", { enum: ["awaiting_deposit", "funded", "sweeping", "swept", "abandoned"] }).notNull().default("awaiting_deposit"),
    /** Sum of non-reorged deposits (including ones still confirming). */
    detectedAmount: amount("detected_amount").notNull().default(sql`0`),
    /** Sum of deposits with enough confirmations. Sweeping starts only when this covers the intent amount. */
    confirmedAmount: amount("confirmed_amount").notNull().default(sql`0`),
    fundedAt: ts("funded_at"),
    // Sweep bookkeeping (used by the sweeper).
    sweepTxHash: text("sweep_tx_hash"),
    sweepAttempts: integer("sweep_attempts").notNull().default(0),
    sweptAt: ts("swept_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deposit_addresses_intent_uq").on(t.intentId),
    uniqueIndex("deposit_addresses_address_uq").on(t.chainId, t.address),
    index("deposit_addresses_open_idx").on(t.status),
  ],
);

/** A USDC `Transfer` into a deposit address, as observed on the canonical chain. */
export const depositTransfers = pgTable(
  "deposit_transfers",
  {
    id: text("id").primaryKey(),
    depositAddressId: text("deposit_address_id").notNull().references(() => depositAddresses.id),
    intentId: text("intent_id").notNull().references(() => paymentIntents.id),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: pgBigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    /** Informational (an exchange hot wallet, usually). Never treated as the payer. */
    fromAddress: text("from_address").notNull(),
    amount: amount("amount").notNull(),
    /** detected: seen, fewer than N confirmations. confirmed: N confirmations. reorged: no longer on the canonical chain. */
    status: text("status", { enum: ["detected", "confirmed", "reorged"] }).notNull().default("detected"),
    confirmations: integer("confirmations").notNull().default(0),
    /** Set once this transfer has been reported for manual review (late / excess / after success), so it is never re-reported. */
    flaggedAt: ts("flagged_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deposit_transfers_log_uq").on(t.chainId, t.txHash, t.logIndex),
    index("deposit_transfers_intent_idx").on(t.intentId, t.status),
  ],
);
