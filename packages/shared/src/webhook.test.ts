import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";
import { assertWebhookUrlAllowed, isPrivateIp } from "./url-guard.js";
import { computeWebhookSignature, signWebhookPayload, verifyWebhookSignature } from "./webhook-signature.js";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"payment_intent.succeeded"}';

describe("webhook signature", () => {
  it("round-trips and matches the documented format", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_700_000_000);
    expect(header).toBe(`t=1700000000,v1=${computeWebhookSignature(SECRET, 1_700_000_000, BODY)}`);
    expect(verifyWebhookSignature({ payload: BODY, header, secret: SECRET, now: 1_700_000_000 })).toBe(true);
  });
  it("rejects a tampered body, wrong secret, or wrong timestamp", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_700_000_000);
    const now = 1_700_000_000;
    expect(verifyWebhookSignature({ payload: BODY + " ", header, secret: SECRET, now })).toBe(false);
    expect(verifyWebhookSignature({ payload: BODY, header, secret: "other", now })).toBe(false);
    expect(verifyWebhookSignature({ payload: BODY, header: header.replace("t=1700000000", "t=1700000001"), secret: SECRET, now })).toBe(false);
  });
  it("rejects stale or future timestamps outside the tolerance", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_700_000_000);
    expect(verifyWebhookSignature({ payload: BODY, header, secret: SECRET, now: 1_700_000_301 })).toBe(false);
    expect(verifyWebhookSignature({ payload: BODY, header, secret: SECRET, now: 1_699_999_699 })).toBe(false);
    expect(verifyWebhookSignature({ payload: BODY, header, secret: SECRET, now: 1_700_000_299 })).toBe(true);
  });
  it("accepts any valid v1 during secret rotation and rejects malformed headers", () => {
    const good = computeWebhookSignature(SECRET, 1_700_000_000, BODY);
    const rotated = `t=1700000000,v1=${"0".repeat(64)},v1=${good}`;
    expect(verifyWebhookSignature({ payload: BODY, header: rotated, secret: SECRET, now: 1_700_000_000 })).toBe(true);
    for (const bad of [undefined, "", "garbage", "t=abc,v1=00", "v1=" + good, "t=1700000000", "t=1700000000,v1=zz"]) {
      expect(verifyWebhookSignature({ payload: BODY, header: bad, secret: SECRET, now: 1_700_000_000 })).toBe(false);
    }
  });
});

describe("secret box", () => {
  const key = "ab".repeat(32);
  it("round-trips, uses a fresh IV, and fails on tamper or wrong key", () => {
    const a = encryptSecret("whsec_abc", key);
    const b = encryptSecret("whsec_abc", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("whsec_abc");
    expect(decryptSecret(a, key)).toBe("whsec_abc");
    expect(() => decryptSecret(a, "cd".repeat(32))).toThrow();
    const parts = a.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
    expect(() => decryptSecret("nonsense", key)).toThrow();
  });
});

describe("SSRF guard", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"])(
    "treats %s as private",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("treats %s as public", (ip) => expect(isPrivateIp(ip)).toBe(false));

  it("in production mode requires https, no credentials, and a public host", async () => {
    const strict = { allowPrivate: false };
    await expect(assertWebhookUrlAllowed("http://example.com/hook", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("https://user:pw@example.com/hook", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("https://127.0.0.1/hook", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("https://169.254.169.254/latest/meta-data", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("https://[::1]/hook", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("not a url", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("ftp://example.com", strict)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("https://8.8.8.8/hook", strict)).resolves.toBeInstanceOf(URL);
  });
  it("in dev mode allows http and internal hosts but still blocks credentials and odd schemes", async () => {
    const dev = { allowPrivate: true };
    await expect(assertWebhookUrlAllowed("http://127.0.0.1:9999/hook", dev)).resolves.toBeInstanceOf(URL);
    await expect(assertWebhookUrlAllowed("http://u:p@127.0.0.1/hook", dev)).rejects.toBeInstanceOf(AppError);
    await expect(assertWebhookUrlAllowed("file:///etc/passwd", dev)).rejects.toBeInstanceOf(AppError);
  });
});
