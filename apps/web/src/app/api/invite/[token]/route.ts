import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/csrf";
import { API_BASE } from "@/lib/upstream";

type Ctx = { params: Promise<{ token: string }> };
const TOKEN = /^binv_[0-9a-f]{64}$/;
const err = (status: number, message: string) => NextResponse.json({ error: { message } }, { status });

async function forward(token: string, method: "GET" | "POST", body?: unknown) {
  try {
    const res = await fetch(`${API_BASE}/auth/v1/invites/${token}${method === "POST" ? "/accept" : ""}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return err(502, "Cannot reach the ClearGateway API");
  }
}

/** Public: look at an invite/reset link (its one-time token is the credential). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!TOKEN.test(token)) return err(404, "This link is not valid");
  return forward(token, "GET");
}

/** Public: accept it (set a password; staff also confirm their authenticator app). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!TOKEN.test(token)) return err(404, "This link is not valid");
  if (!sameOrigin(req)) return err(403, "Bad origin");
  const body = (await req.json().catch(() => null)) as { password?: unknown; totp_code?: unknown } | null;
  if (typeof body?.password !== "string") return err(400, "Choose a password");
  return forward(token, "POST", { password: body.password, ...(typeof body.totp_code === "string" && body.totp_code ? { totp_code: body.totp_code } : {}) });
}
