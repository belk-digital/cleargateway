import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/csrf";
import { getSession } from "@/lib/session";
import { API_BASE, AUTH_PATHS, upstreamHeaders, upstreamPrefix } from "@/lib/upstream";

type Ctx = { params: Promise<{ kind: string; path: string[] }> };
const SEGMENT = /^[A-Za-z0-9_\-:]+$/;
const err = (status: number, message: string) => NextResponse.json({ error: { message } }, { status });

/**
 * Server-side proxy to the ClearGateway API. The browser never sees the session token: it lives in an encrypted httpOnly cookie
 * and is attached here. Only the two fixed API prefixes (plus a short list of self-service account calls) are reachable.
 */
async function handle(req: NextRequest, ctx: Ctx) {
  const { kind, path } = await ctx.params;
  if (kind !== "merchant" && kind !== "admin") return err(404, "Not found");
  if (!path.every((s) => SEGMENT.test(s))) return err(400, "Bad path");
  const mutating = req.method !== "GET";
  if (mutating && !sameOrigin(req)) return err(403, "Bad origin");

  const isAuth = path[0] === "auth";
  if (isAuth && !(path.length === 2 && AUTH_PATHS.has(path[1]!))) return err(404, "Not found");

  const session = await getSession(kind);
  if (!session) return err(401, "Not signed in");

  const headers: Record<string, string> = upstreamHeaders(session);
  let body: string | undefined;
  if (mutating) {
    const text = await req.text();
    if (text) {
      body = text;
      headers["content-type"] = "application/json";
    }
    // Money-mutating merchant POSTs need an Idempotency-Key; the client may supply one to make retries safe.
    if (kind === "merchant" && req.method === "POST" && !isAuth) headers["idempotency-key"] = req.headers.get("idempotency-key") ?? randomUUID();
  }

  const target = isAuth ? `/auth/v1/${path[1]}` : `${upstreamPrefix(kind)}/${path.join("/")}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${target}${req.nextUrl.search}`, { method: req.method, headers, body, cache: "no-store" });
  } catch {
    return err(502, "Cannot reach the ClearGateway API");
  }
  return new NextResponse(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
