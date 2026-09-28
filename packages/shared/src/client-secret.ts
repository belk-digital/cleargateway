import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checkout client secret: "<intentId>_secret_<48 hex>", derived as HMAC-SHA256(key, "client_secret:" + intentId).
 * Deterministic so merchants can always rebuild the checkout URL; only its SHA-256 is stored for verification.
 * Grants access ONLY to the public checkout endpoints of that one intent.
 */
export function deriveClientSecret(key: string, intentId: string): string {
  const mac = createHmac("sha256", Buffer.from(key, "hex")).update(`client_secret:${intentId}`).digest("hex");
  return `${intentId}_secret_${mac.slice(0, 48)}`;
}

export function hashClientSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time check of a presented secret against the stored hash. */
export function verifyClientSecret(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashClientSecret(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
