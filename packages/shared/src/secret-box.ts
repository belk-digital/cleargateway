import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets we must be able to read back (e.g. webhook signing secrets).
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>". `keyHex` is 32 bytes as 64 hex chars (ENCRYPTION_KEY).
 */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(boxed: string, keyHex: string): string {
  const [version, iv, tag, ct] = boxed.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
