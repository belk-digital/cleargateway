/**
 * ClearGateway webhook signatures (same pattern as Stripe).
 *
 * MERCHANTS: copy `verifyWebhookSignature` into your server. It depends only on Node's `crypto`.
 *
 *   const ok = verifyWebhookSignature({
 *     payload: rawBody,                       // the exact raw request body string, NOT re-serialized JSON
 *     header: req.headers["cleargateway-signature"],  // "t=1700000000,v1=<hex>"
 *     secret: process.env.CLEARGATEWAY_WEBHOOK_SECRET // "whsec_..." shown once when you created the endpoint
 *   });
 *   if (!ok) return res.status(400).end();
 *
 * Header format: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<payload>">`.
 * Several `v1=` entries may be present (secret rotation); any valid one is accepted.
 * Reject stale timestamps (default 5 minutes) to stop replays, and dedupe on the `ClearGateway-Event-Id` header,
 * because deliveries are at-least-once.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "ClearGateway-Signature";
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function computeWebhookSignature(secret: string, timestamp: number, payload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

/** Builds the `ClearGateway-Signature` header value. */
export function signWebhookPayload(secret: string, payload: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeWebhookSignature(secret, timestamp, payload)}`;
}

export function verifyWebhookSignature(opts: {
  payload: string;
  header: string | undefined;
  secret: string;
  toleranceSeconds?: number;
  /** Unix seconds; injectable for tests. */
  now?: number;
}): boolean {
  const { payload, header, secret } = opts;
  if (!header) return false;
  const tolerance = opts.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  let timestamp = NaN;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") timestamp = Number(v);
    else if (k === "v1") candidates.push(v);
  }
  if (!Number.isInteger(timestamp) || candidates.length === 0) return false;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = Buffer.from(computeWebhookSignature(secret, timestamp, payload), "hex");
  return candidates.some((c) => {
    const got = Buffer.from(c, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
