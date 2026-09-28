import { createHash, randomBytes } from "node:crypto";

export type SessionKind = "merchant" | "admin";

/** Opaque bearer tokens: `bsm_` (merchant user session), `bsa_` (staff session), `binv_` (one-time invite/reset). Only a SHA-256 is stored. */
const PREFIX = { merchant: "bsm_", admin: "bsa_", invite: "binv_" } as const;

export function newToken(kind: SessionKind | "invite"): { raw: string; hash: string } {
  const raw = `${PREFIX[kind]}${randomBytes(32).toString("hex")}`;
  return { raw, hash: hashToken(raw) };
}

export const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

export function sessionKindOf(raw: string): SessionKind | null {
  if (/^bsm_[0-9a-f]{64}$/.test(raw)) return "merchant";
  if (/^bsa_[0-9a-f]{64}$/.test(raw)) return "admin";
  return null;
}
export const isInviteToken = (raw: string): boolean => /^binv_[0-9a-f]{64}$/.test(raw);
