import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit TOTP secret, base32 (what authenticator apps expect). */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** RFC 6238 (HMAC-SHA1, 30 s, 6 digits). */
export function totpCode(secretBase32: string, timeMs: number): string {
  return hotp(base32Decode(secretBase32), Math.floor(timeMs / 1000 / STEP_SECONDS));
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Checks a code within +/-1 step of clock drift. Returns the matched time step (so the caller can refuse to accept the
 * same step twice: a code must not be replayable), or null.
 */
export function verifyTotp(secretBase32: string, code: string, timeMs: number, lastUsedStep?: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const now = Math.floor(timeMs / 1000 / STEP_SECONDS);
  let matched: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const a = Buffer.from(hotp(key, step));
    if (timingSafeEqual(a, Buffer.from(code)) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (lastUsedStep != null && matched <= lastUsedStep) return null;
  return matched;
}

export const totpUri = (secretBase32: string, account: string, issuer = "ClearGateway"): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
