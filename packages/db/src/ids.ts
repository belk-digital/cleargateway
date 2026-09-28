import { randomBytes } from "node:crypto";

export type IdPrefix =
  | "mer"
  | "usr"
  | "adm"
  | "key"
  | "pi"
  | "evt"
  | "ctx"
  | "acc"
  | "ltx"
  | "lent"
  | "we"
  | "wd"
  | "wa"
  | "idem"
  | "re"
  | "ors"
  | "orr"
  | "iwe"
  | "dep"
  | "dtr"
  | "orx" // onramp session id ("ors" above is the onramp_routing row id)
  | "aud" // admin audit log entry
  | "mus" // merchant user
  | "ses"
  | "inv";

/** Prefixed random id, e.g. "pi_3f9a1c...". 128 bits of randomness. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}
