import { randomBytes } from "node:crypto";
import {
  depositAddresses,
  issueDepositAddress,
  merchants,
  onrampRouting,
  paymentIntents,
  recordIntentEvent,
  recordOnrampSession,
  transitionIntent,
  type Db,
  type IntentRow,
} from "@belk/db";
import {
  PAYMENT_INTENT_TYPES,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  predictDepositAddress,
  predictImplementationAddress,
  splitterDomain,
  usdcDomain,
  type PaymentIntentMessage,
} from "@belk/chain";
import { assertSafeCustomerWallet, pickOnrampProvider, type OnrampProvider, type OnrampProviderName } from "@belk/onramp";
import { AppError, verifyClientSecret } from "@belk/shared";
import { and, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { Config } from "../../config.js";
import type { ChainBlockReader } from "../../lib/chain-reader.js";
import { effectiveStatus } from "../../lib/serialize.js";
import type { IntentSigner } from "../../signer/index.js";

/**
 * Resolves an intent from its id + client secret. Unknown id and wrong secret are indistinguishable (404),
 * so intent ids can't be enumerated.
 */
export async function loadIntentWithSecret(db: Db, intentId: string, secret: string | undefined): Promise<IntentRow> {
  const [row] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
  const presented = secret && secret.startsWith(`${intentId}_secret_`) ? secret : "";
  const ok = verifyClientSecret(presented || "invalid", row?.clientSecretHash ?? "0".repeat(64));
  if (!row || !ok || !presented) throw new AppError("not_found", "Payment intent not found");
  return row;
}

export async function publicCheckoutView(db: Db, row: IntentRow, config: Config) {
  const [m] = await db
    .select({ displayName: merchants.displayName, branding: merchants.branding })
    .from(merchants)
    .where(eq(merchants.id, row.merchantId))
    .limit(1);
  const [dep] = row.depositAddress
    ? await db.select().from(depositAddresses).where(eq(depositAddresses.intentId, row.id)).limit(1)
    : [];
  return {
    id: row.id,
    status: effectiveStatus(row),
    amount: row.amount.toString(),
    currency: row.currency,
    decimals: 6,
    merchant: { display_name: m?.displayName ?? "", branding: m?.branding ?? {} },
    expires_at: row.expiresAt.toISOString(),
    success_url: row.successUrl,
    cancel_url: row.cancelUrl,
    chain_id: row.chainId,
    contract_address: row.contractAddress ?? config.SPLITTER_ADDRESS ?? null,
    token_address: config.USDC_ADDRESS ?? null,
    tx_hash: row.txHash,
    deposit_address: row.depositAddress
      ? {
          address: row.depositAddress,
          detected_amount: dep?.detectedAmount.toString() ?? "0",
          confirmed_amount: dep?.confirmedAmount.toString() ?? "0",
          status: dep?.status ?? "awaiting_deposit",
        }
      : null,
    // "completed" here means the customer's own wallet is funded, not that the merchant has been paid; that only
    // happens once the same wallet pays the splitter (see /wallet-payment) and the chain watcher confirms it.
    onramp: row.onrampProvider
      ? { provider: row.onrampProvider, status: row.onrampStatus }
      : null,
  };
}

export async function checkoutStatus(db: Db, intentId: string) {
  const [row] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
  if (!row) throw new AppError("not_found", "Payment intent not found");
  return {
    id: row.id,
    status: effectiveStatus(row),
    tx_hash: row.txHash,
    confirmations: row.confirmations,
    required_confirmations: null as number | null,
    updated_at: row.updatedAt.toISOString(),
  };
}

export type WalletMethod = "approve" | "authorization";

/**
 * Issues the signed payload a customer's wallet needs to pay the splitter, and moves the intent
 * created -> awaiting_payment (audited). Safe to call repeatedly while the intent is open.
 */
export async function createWalletPayment(
  db: Db,
  deps: { config: Config; signer: IntentSigner | undefined },
  intentId: string,
  input: { payer: Address; method: WalletMethod },
) {
  const { config, signer } = deps;
  const splitter = config.SPLITTER_ADDRESS;
  const token = config.USDC_ADDRESS;
  if (!splitter || !token || !signer) {
    throw new AppError("not_configured", "Wallet payments are not configured (splitter, USDC address or signer missing)");
  }
  const lower = (a: string) => a.toLowerCase();
  if (lower(input.payer) === lower(splitter) || lower(input.payer) === lower(token)) {
    throw new AppError("invalid_request", "payer_address cannot be the payment contract or the token contract");
  }

  return db.transaction(async (tx) => {
    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).for("update");
    if (!intent) throw new AppError("not_found", "Payment intent not found");
    if (intent.status !== "created" && intent.status !== "awaiting_payment") {
      throw new AppError("conflict", `Payment intent is ${intent.status} and can no longer be paid`);
    }
    const now = Date.now();
    if (intent.expiresAt.getTime() <= now) throw new AppError("conflict", "Payment intent has expired");

    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, intent.merchantId)).limit(1);
    if (!merchant || merchant.status !== "active") throw new AppError("forbidden", "Merchant cannot accept payments");
    if (lower(input.payer) === lower(merchant.payoutWalletAddress)) {
      throw new AppError("invalid_request", "payer_address cannot be the merchant's payout wallet");
    }

    // Signature validity: capped so a leaked payload is only usable briefly, and never outlives the intent.
    const expiryMs = Math.min(intent.expiresAt.getTime(), now + config.SIGNATURE_MAX_TTL_SECONDS * 1000);
    const expiry = BigInt(Math.floor(expiryMs / 1000));

    const message: PaymentIntentMessage = {
      intentId: intent.intentHash as `0x${string}`,
      merchant: merchant.payoutWalletAddress as Address,
      token,
      payer: input.payer,
      amount: intent.amount,
      feeBps: BigInt(intent.feeBps),
      expiry,
    };
    const domain = splitterDomain(config.CHAIN_ID, splitter);
    const signature = await signer.signPaymentIntent(domain, message);

    // Preserve "onramp" as the recorded method if the customer got here via an on-ramp session (their wallet is now
    // funded and paying the same way a connected wallet would); otherwise this is a plain wallet payment.
    const patch = {
      payerAddress: input.payer,
      paymentMethod: intent.paymentMethod === "onramp" ? ("onramp" as const) : ("wallet" as const),
      contractAddress: splitter,
    };
    const audit = { method: input.method, payer: input.payer, signature_expiry: Number(expiry) };
    if (intent.status === "created") {
      await transitionIntent(tx, {
        intentId,
        to: "awaiting_payment",
        actor: "system:checkout",
        reason: "wallet_payload_issued",
        data: audit,
        patch,
      });
    } else {
      await recordIntentEvent(tx, { intentId, actor: "system:checkout", reason: "wallet_payload_reissued", data: audit, patch });
    }

    const intentStruct = {
      intentId: message.intentId,
      merchant: message.merchant,
      payer: message.payer,
      amount: message.amount.toString(),
      feeBps: message.feeBps.toString(),
      expiry: message.expiry.toString(),
    };
    const common = {
      intent_id: intent.id,
      chain_id: config.CHAIN_ID,
      contract_address: splitter,
      token_address: token,
      method: input.method,
      payment_intent: intentStruct,
      intent_signature: signature,
      eip712: { domain, types: PAYMENT_INTENT_TYPES, primary_type: "PaymentIntent" as const },
    };

    if (input.method === "approve") {
      return {
        ...common,
        // 1) token.approve(spender, amount)  2) splitter.pay(payment_intent, intent_signature)
        approval: { token, spender: splitter, amount: message.amount.toString() },
        call: { contract: splitter, function: "pay", args: ["payment_intent", "intent_signature"] },
      };
    }
    return {
      ...common,
      // Customer signs `authorization.typed_data` (USDC EIP-3009, payee = splitter, nonce = intentId), then anyone
      // submits splitter.payWithAuthorization(payment_intent, intent_signature, valid_after, valid_before, signature).
      authorization: {
        valid_after: "0",
        valid_before: expiry.toString(),
        typed_data: {
          domain: usdcDomain(config.CHAIN_ID, token),
          types: RECEIVE_WITH_AUTHORIZATION_TYPES,
          primary_type: "ReceiveWithAuthorization" as const,
          message: {
            from: input.payer,
            to: splitter,
            value: message.amount.toString(),
            validAfter: "0",
            validBefore: expiry.toString(),
            nonce: message.intentId,
          },
        },
      },
      call: {
        contract: splitter,
        function: "payWithAuthorization",
        args: ["payment_intent", "intent_signature", "valid_after", "valid_before", "authorization_signature"],
      },
    };
  });
}

/**
 * Issues (or returns the already-issued) deposit address for an intent: a per-payment address a customer can send
 * USDC to from an exchange. The address itself needs no on-chain call to compute (CREATE2 is deterministic); the
 * one chain read is the current block, recorded as where the deposit watcher may safely start scanning for it.
 * Safe to call repeatedly: returns the same address every time.
 */
export async function createOrGetDepositAddress(
  db: Db,
  deps: { config: Config; chain: ChainBlockReader | undefined },
  intentId: string,
) {
  const { config, chain } = deps;
  const factory = config.DEPOSIT_FACTORY_ADDRESS;
  if (!factory || !config.USDC_ADDRESS || !chain) {
    throw new AppError("not_configured", "Deposit addresses are not configured (factory, USDC address or chain reader missing)");
  }
  const implementation = predictImplementationAddress(factory);

  return db.transaction(async (tx) => {
    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).for("update");
    if (!intent) throw new AppError("not_found", "Payment intent not found");

    const address = predictDepositAddress({ factory, implementation, salt: intent.intentHash as Hex });
    const head = await chain.getBlockNumber();
    await issueDepositAddress(tx, {
      intentId,
      chainId: config.CHAIN_ID,
      address,
      factory,
      implementation,
      salt: intent.intentHash,
      creationBlock: head,
      actor: "system:checkout",
    });
    return {
      intent_id: intentId,
      chain_id: config.CHAIN_ID,
      // Checksummed, computed deterministically; identical to what was stored, on the first call or a repeat.
      address,
      token_address: config.USDC_ADDRESS,
      amount: intent.amount.toString(),
      currency: intent.currency,
      decimals: 6,
      expires_at: intent.expiresAt.toISOString(),
      warning: "Send USDC on Base only. Sending any other network or token to this address may result in permanent loss of funds.",
    };
  });
}

/**
 * Creates an on-ramp session so the customer can buy USDC by card/Apple Pay into a wallet THEY own (never the
 * merchant or our contract — enforced below). The provider used is picked per merchant from `onramp_routing`.
 * Once the on-ramp completes, the same (now-funded) wallet pays through `/wallet-payment` like any connected
 * wallet; this endpoint never moves money and never marks the intent paid.
 */
export async function createOnrampSession(
  db: Db,
  deps: { config: Config; providers: Record<OnrampProviderName, OnrampProvider> },
  intentId: string,
  input: { customerWalletAddress: Address; customerEmail?: string },
) {
  const { config, providers } = deps;
  const splitter = config.SPLITTER_ADDRESS;
  const token = config.USDC_ADDRESS;
  if (!splitter || !token) throw new AppError("not_configured", "On-ramp sessions are not configured (splitter or USDC address missing)");

  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
  if (!intent) throw new AppError("not_found", "Payment intent not found");
  if (intent.status !== "created" && intent.status !== "awaiting_payment") {
    throw new AppError("conflict", `Payment intent is ${intent.status} and can no longer be paid`);
  }
  if (intent.expiresAt.getTime() <= Date.now()) throw new AppError("conflict", "Payment intent has expired");

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, intent.merchantId)).limit(1);
  if (!merchant || merchant.status !== "active") throw new AppError("forbidden", "Merchant cannot accept payments");

  try {
    assertSafeCustomerWallet(input.customerWalletAddress, {
      merchantPayoutWallet: merchant.payoutWalletAddress,
      splitterAddress: splitter,
      usdcAddress: token,
    });
  } catch (err) {
    throw new AppError("invalid_request", err instanceof Error ? err.message : "customerWalletAddress is not allowed");
  }

  const routing = await db
    .select({ provider: onrampRouting.provider, priority: onrampRouting.priority, enabled: onrampRouting.enabled })
    .from(onrampRouting)
    .where(and(eq(onrampRouting.merchantId, intent.merchantId), eq(onrampRouting.enabled, true)));
  let provider: OnrampProvider;
  try {
    provider = pickOnrampProvider(routing, providers);
  } catch (err) {
    throw new AppError("not_configured", err instanceof Error ? err.message : "No on-ramp provider is configured for this merchant");
  }

  const sessionRef = `oref_${randomBytes(16).toString("hex")}`;
  let result;
  try {
    result = await provider.createSession({
      intentId,
      sessionId: sessionRef,
      amountUsdc: intent.amount,
      customerWalletAddress: input.customerWalletAddress,
      customerEmail: input.customerEmail,
      network: "base",
    });
  } catch (err) {
    // Wert/Simplex are stubs today and throw a TODO(verify) error; surface that plainly rather than a raw 500.
    throw new AppError("not_implemented", err instanceof Error ? err.message : `${provider.name} on-ramp is not implemented`);
  }

  await db.transaction((tx) =>
    recordOnrampSession(tx, {
      intentId,
      provider: provider.name,
      providerSessionId: result.sessionId,
      customerWalletAddress: input.customerWalletAddress,
      actor: "system:checkout",
    }),
  );

  return {
    intent_id: intentId,
    provider: provider.name,
    session_id: result.sessionId,
    chain_id: config.CHAIN_ID,
    token_address: token,
    customer_wallet_address: input.customerWalletAddress,
    amount: intent.amount.toString(),
    currency: intent.currency,
    widget_config: result.widgetConfig,
  };
}
