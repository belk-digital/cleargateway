import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const scryptAsync = (pw: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pw.normalize("NFKC"), salt, keylen, opts, (e, k) => (e ? reject(e) : resolve(k))));

/** scrypt (built into Node, memory-hard). Format: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real hash to verify against when the account does not exist, so a missing account costs the same as a wrong password. */
let dummy: Promise<string> | undefined;
export const dummyPasswordHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

/** Returns a human-readable problem, or null if the password is acceptable. Length beats complexity rules (NIST 800-63B). */
export function passwordProblem(password: string, context: { email?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (context.email && (lower.includes(context.email.toLowerCase()) || lower.includes(context.email.split("@")[0]!.toLowerCase()))) {
    return "The password must not contain your email address";
  }
  if (/^(.)\1+$/.test(password)) return "Choose a less repetitive password";
  const common = ["password", "123456789012", "qwertyuiop12", "letmein12345", "administrator"];
  if (common.some((c) => lower.includes(c))) return "That password is too common";
  return null;
}
