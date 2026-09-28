import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { PAYMENT_INTENT_TYPES, type PaymentIntentMessage, type splitterDomain } from "./eip712.js";

/**
 * Signs ClearGatewaySplitter payment intents. Deliberately narrow: the signer can ONLY sign a PaymentIntent
 * (never arbitrary typed data or raw digests), so a compromised API or worker cannot be turned into a general
 * signing oracle. Production implementations sit in front of a cloud KMS. Shared by the API (wallet payments)
 * and the worker (deposit-address sweeps), since both sign the same kind of payload with the same key.
 */
export interface IntentSigner {
  address(): Promise<Address>;
  signPaymentIntent(domain: ReturnType<typeof splitterDomain>, message: PaymentIntentMessage): Promise<Hex>;
}

/** Local development / testnet signer backed by an env private key. NEVER use for real funds. */
export class EnvSigner implements IntentSigner {
  private readonly account;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  async address(): Promise<Address> {
    return this.account.address;
  }

  async signPaymentIntent(domain: ReturnType<typeof splitterDomain>, message: PaymentIntentMessage): Promise<Hex> {
    return this.account.signTypedData({
      domain,
      types: PAYMENT_INTENT_TYPES,
      primaryType: "PaymentIntent",
      message,
    });
  }
}

/**
 * Production signer stub. To implement: hash the EIP-712 payload (viem `hashTypedData`), have the cloud KMS
 * (secp256k1 key, e.g. AWS KMS ECC_SECG_P256K1 / GCP EC_SIGN_SECP256K1_SHA256) sign the 32-byte digest,
 * convert the DER signature to (r, s, v) with low-s normalization, and derive `address()` from the public key.
 * TODO(verify): pick the KMS provider and confirm its secp256k1 signing API before implementing.
 */
export class KmsSigner implements IntentSigner {
  async address(): Promise<Address> {
    throw new Error("KmsSigner is not implemented");
  }

  async signPaymentIntent(_domain: ReturnType<typeof splitterDomain>, _message: PaymentIntentMessage): Promise<Hex> {
    throw new Error("KmsSigner is not implemented");
  }
}
