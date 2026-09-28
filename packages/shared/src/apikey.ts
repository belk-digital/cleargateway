import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Mode } from "./constants.js";

export interface GeneratedApiKey {
  /** Full key. Shown to the merchant exactly once; never persisted. */
  raw: string;
  /** Non-secret lookup prefix stored in the DB (e.g. "sk_test_ab12cd34"). */
  prefix: string;
  /** SHA-256 hex of the raw key. Safe because the secret part is 256 bits of entropy. */
  hash: string;
}

const PREFIX_RANDOM_CHARS = 8;

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(mode: Mode): GeneratedApiKey {
  const secret = randomBytes(32).toString("hex");
  const raw = `sk_${mode}_${secret}`;
  return { raw, prefix: apiKeyPrefix(raw), hash: hashApiKey(raw) };
}

/** "sk_test_" + first 8 chars of the secret. Returns "" for malformed keys. */
export function apiKeyPrefix(raw: string): string {
  const m = /^(sk_(?:test|live)_)([0-9a-f]{64})$/.exec(raw);
  return m ? `${m[1]}${m[2]!.slice(0, PREFIX_RANDOM_CHARS)}` : "";
}

export function apiKeyMode(raw: string): Mode | null {
  if (raw.startsWith("sk_test_")) return "test";
  if (raw.startsWith("sk_live_")) return "live";
  return null;
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyApiKey(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
