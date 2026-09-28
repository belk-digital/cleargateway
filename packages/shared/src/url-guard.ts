import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./errors.js";

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and IPv6-mapped equivalents. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPrivateV4(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") || // fc00::/7 unique local
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower) || // fe80::/10 link-local
      lower.startsWith("ff") // multicast
    );
  }
  return true; // not an IP literal: treat as unsafe
}

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    a >= 224 // multicast + reserved
  );
}

/**
 * Validates a merchant-supplied webhook URL (SSRF protection).
 * Production: https only, no credentials, hostname must not resolve to any private/internal address.
 * `allowPrivate` (dev/test only) permits http and internal hosts so local receivers work.
 * Call at endpoint creation AND again at delivery time (DNS can change; rebinding attacks).
 */
export async function assertWebhookUrlAllowed(rawUrl: string, opts: { allowPrivate: boolean }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("invalid_request", "Webhook URL is not a valid URL");
  }
  if (url.username || url.password) throw new AppError("invalid_request", "Webhook URL must not contain credentials");
  if (opts.allowPrivate) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppError("invalid_request", "Webhook URL must be http(s)");
    return url;
  }
  if (url.protocol !== "https:") throw new AppError("invalid_request", "Webhook URL must use https");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new AppError("invalid_request", "Webhook URL host does not resolve");
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new AppError("invalid_request", "Webhook URL must not point to a private or internal address");
  }
  return url;
}
