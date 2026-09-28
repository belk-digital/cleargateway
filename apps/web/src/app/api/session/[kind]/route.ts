import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/csrf";
import { clearSession, getSession, setSession, type Session } from "@/lib/session";
import { API_BASE, upstreamHeaders } from "@/lib/upstream";

type Ctx = { params: Promise<{ kind: string }> };
const kindOf = (k: string): Session["kind"] | null => (k === "merchant" || k === "admin" ? k : null);
const err = (status: number, message: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error: { message, ...extra } }, { status });

/** Sign in: the API checks the password (and staff two-factor) and issues a session token; we seal it in an httpOnly cookie. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const kind = kindOf((await ctx.params).kind);
  if (!kind) return err(404, "Not found");
  if (!sameOrigin(req)) return err(403, "Bad origin");

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown; totp_code?: unknown } | null;
  if (typeof body?.email !== "string" || typeof body.password !== "string" || !body.email || !body.password) return err(400, "Email and password are required");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/v1/${kind}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password, ...(typeof body.totp_code === "string" && body.totp_code ? { totp_code: body.totp_code } : {}) }),
      cache: "no-store",
    });
  } catch {
    return err(502, "Cannot reach the ClearGateway API. Is it running?");
  }
  const j = (await res.json().catch(() => null)) as { token?: string; expires_at?: string; error?: { message?: string; details?: { totp_required?: boolean } } } | null;
  if (!res.ok || !j?.token || !j.expires_at) {
    return err(res.status === 429 ? 429 : res.status === 503 ? 503 : res.status === 403 ? 403 : 401, j?.error?.message ?? "Sign-in failed", j?.error?.details?.totp_required ? { totp_required: true } : {});
  }
  await setSession({ kind, token: j.token }, new Date(j.expires_at));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const kind = kindOf((await ctx.params).kind);
  if (!kind) return err(404, "Not found");
  if (!sameOrigin(req)) return err(403, "Bad origin");
  const s = await getSession(kind);
  if (s) {
    // Revoke server-side too, so a copied cookie is dead the moment the person signs out.
    await fetch(`${API_BASE}/auth/v1/logout`, { method: "POST", headers: upstreamHeaders(s), cache: "no-store" }).catch(() => undefined);
  }
  await clearSession(kind);
  return NextResponse.json({ ok: true });
}
