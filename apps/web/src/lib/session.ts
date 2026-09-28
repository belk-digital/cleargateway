import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/** The web session is just the API's own session token (issued at sign-in, revocable server-side), sealed in a cookie. */
export interface Session {
  kind: "merchant" | "admin";
  token: string;
}

const COOKIE = { merchant: "cleargateway_merchant", admin: "cleargateway_admin" } as const;

function secretKey(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (min 32 chars)");
  return createHash("sha256").update(s).digest();
}

/** AES-256-GCM: the cookie is confidential and tamper-evident. */
function seal(s: Session, expMs: number): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ ...s, exp: expMs }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

function open(kind: Session["kind"], value: string): Session | null {
  try {
    const raw = Buffer.from(value, "base64url");
    const d = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as Session & { exp: number };
    if (parsed.kind !== kind || parsed.exp < Date.now() || typeof parsed.token !== "string") return null;
    return { kind: parsed.kind, token: parsed.token };
  } catch {
    return null;
  }
}

export async function getSession(kind: Session["kind"]): Promise<Session | null> {
  const v = (await cookies()).get(COOKIE[kind])?.value;
  return v ? open(kind, v) : null;
}

export async function setSession(s: Session, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE[s.kind], seal(s, expiresAt.getTime()), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession(kind: Session["kind"]): Promise<void> {
  (await cookies()).delete(COOKIE[kind]);
}
