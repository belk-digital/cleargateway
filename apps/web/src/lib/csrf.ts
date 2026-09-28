import type { NextRequest } from "next/server";

/**
 * CSRF defence for state-changing calls, on top of the SameSite=Strict cookie: the request must carry our custom
 * header (browsers will not send it cross-site without a CORS preflight, which we never grant) and, when the browser
 * sends an Origin, it must be this site.
 */
export function sameOrigin(req: NextRequest): boolean {
  if (req.headers.get("x-cleargateway-csrf") !== "1") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin;
}
