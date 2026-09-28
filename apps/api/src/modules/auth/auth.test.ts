import { adminAuditLog, adminUsers, authInvites, authSessions, merchantUsers } from "@belk/db";
import { hashToken, totpCode } from "@belk/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, client, makeHarness, seedAdmin, seedMerchant, type Harness } from "../../test/harness.js";

let h: Harness;
let legacy: ReturnType<typeof adminClient>;
let api: ReturnType<typeof client>;
let seq = 0;
const GOOD = "correct horse battery staple";

beforeAll(async () => {
  h = await makeHarness();
  legacy = adminClient(h, await seedAdmin(h)); // an existing staff account bootstraps the first invites
  api = client(h);
});
afterAll(async () => {
  await h.close();
});

const post = (url: string, body: unknown, token?: string) =>
  api("POST", url, { body, idem: false, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (url: string, token?: string) => api("GET", url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const email = (p: string) => `${p}${Date.now()}${seq++}@cleargateway.test`;

/** Signs a staff member up through the real invite flow. Returns their credentials. */
async function onboardStaff(password = GOOD) {
  const e = email("staff");
  const inv = await legacy("POST", "/staff", { body: { email: e } });
  expect(inv.status).toBe(201);
  const token = inv.json.invite.token as string;
  const info = await get(`/auth/v1/invites/${token}`);
  const secret = info.json.totp.secret as string;
  const acc = await post(`/auth/v1/invites/${token}/accept`, { password, totp_code: totpCode(secret, Date.now()) });
  expect(acc.status, JSON.stringify(acc.json)).toBe(200);
  return { email: e, password, secret, id: inv.json.user.id as string, inviteToken: token };
}
/** A code is single-use per 30 s step, so tests that sign in repeatedly clear the replay marker (only the replay test does not). */
const freshStep = (id: string) => h.db.update(adminUsers).set({ totpLastStep: null }).where(eq(adminUsers.id, id));
const staffLogin = (s: { email: string; password: string; secret: string }, over: Record<string, unknown> = {}) =>
  // the invite's code already used the current step; the next step's code is valid (+/-1 drift window) and newer
  post("/auth/v1/admin/login", { email: s.email, password: s.password, totp_code: totpCode(s.secret, Date.now() + 30_000), ...over });

async function onboardMerchantUser(role: "owner" | "admin" | "developer" | "viewer" = "owner", opts: { merchantId?: string } = {}) {
  const m = opts.merchantId ? { merchantId: opts.merchantId } : await seedMerchant(h);
  const e = email("user");
  const inv = await legacy("POST", `/merchants/${m.merchantId}/users`, { body: { email: e, role } });
  expect(inv.status, JSON.stringify(inv.json)).toBe(201);
  const acc = await post(`/auth/v1/invites/${inv.json.invite.token}/accept`, { password: GOOD });
  expect(acc.status).toBe(200);
  return { email: e, password: GOOD, id: inv.json.user.id as string, merchantId: m.merchantId, inviteToken: inv.json.invite.token as string };
}
const userLogin = (u: { email: string; password: string }) => post("/auth/v1/merchant/login", { email: u.email, password: u.password });

describe("staff sign-in (password + two-factor)", () => {
  it("invite -> set password + confirm authenticator -> sign in -> use the internal API with no shared token", async () => {
    const s = await onboardStaff();
    const res = await staffLogin(s);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.token).toMatch(/^bsa_[0-9a-f]{64}$/);

    const me = await get("/auth/v1/me", res.json.token);
    expect(me.json).toMatchObject({ kind: "admin", email: s.email });
    const list = await api("GET", "/internal/v1/merchants", { headers: { authorization: `Bearer ${res.json.token}` } });
    expect(list.status).toBe(200);
  });

  it("actions are attributed to the person, in the audit log", async () => {
    const s = await onboardStaff();
    const token = (await staffLogin(s)).json.token as string;
    const created = await api("POST", "/internal/v1/merchants", { idem: false, headers: { authorization: `Bearer ${token}` }, body: { legal_name: "A", display_name: "A", payout_wallet_address: "0x000000000000000000000000000000000000dEaD", fee_bps: 100 } });
    expect(created.status).toBe(201);
    const [line] = await h.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, created.json.id));
    expect(line?.adminId).toBe(s.id);
  });

  it("wrong password, unknown email and a not-yet-activated account all give the same generic error", async () => {
    const s = await onboardStaff();
    const pending = await legacy("POST", "/staff", { body: { email: email("pending") } });
    const a = await staffLogin(s, { password: "wrong password here" });
    const b = await post("/auth/v1/admin/login", { email: "nobody@cleargateway.test", password: GOOD, totp_code: "123456" });
    const c = await post("/auth/v1/admin/login", { email: pending.json.user.email, password: GOOD, totp_code: "123456" });
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401);
      expect(r.json.error.message).toBe("Invalid email or password");
    }
  });

  it("asks for the two-factor code only after the password is right, and refuses a wrong or replayed code", async () => {
    const s = await onboardStaff();
    const noCode = await post("/auth/v1/admin/login", { email: s.email, password: s.password });
    expect(noCode.status).toBe(401);
    expect(noCode.json.error.details).toEqual({ totp_required: true });
    expect((await staffLogin(s, { totp_code: "000000" })).status).toBe(401);

    const ok = await staffLogin(s);
    expect(ok.status).toBe(200);
    expect((await staffLogin(s)).status).toBe(401); // the same code (same time step) cannot be used twice
  });

  it("locks the account after 5 failures, even for the right password, and then lets it through after the lock", async () => {
    const s = await onboardStaff();
    for (let i = 0; i < 5; i++) expect((await staffLogin(s, { password: "wrong password here" })).status).toBe(401);
    const locked = await staffLogin(s);
    expect(locked.status).toBe(429);
    await h.db.update(adminUsers).set({ lockedUntil: new Date(Date.now() - 1000), totpLastStep: null }).where(eq(adminUsers.id, s.id));
    expect((await staffLogin(s)).status).toBe(200);
  });

  it("the invite link works once, and not after it expires", async () => {
    const s = await onboardStaff();
    expect((await post(`/auth/v1/invites/${s.inviteToken}/accept`, { password: GOOD, totp_code: "123456" })).status).toBe(404);
    expect((await get(`/auth/v1/invites/${s.inviteToken}`)).status).toBe(404);

    const inv = await legacy("POST", "/staff", { body: { email: email("late") } });
    await h.db.update(authInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authInvites.tokenHash, hashToken(inv.json.invite.token)));
    expect((await get(`/auth/v1/invites/${inv.json.invite.token}`)).status).toBe(404);
    expect((await get(`/auth/v1/invites/binv_${"0".repeat(64)}`)).status).toBe(404);
    expect((await get("/auth/v1/invites/not-a-token")).status).toBe(400);
  });

  it("accepting requires a correct authenticator code and a strong password", async () => {
    const inv = await legacy("POST", "/staff", { body: { email: email("weak") } });
    const t = inv.json.invite.token;
    const secret = (await get(`/auth/v1/invites/${t}`)).json.totp.secret;
    expect((await post(`/auth/v1/invites/${t}/accept`, { password: GOOD })).status).toBe(400); // no code
    expect((await post(`/auth/v1/invites/${t}/accept`, { password: GOOD, totp_code: "000000" })).status).toBe(400);
    const weak = await post(`/auth/v1/invites/${t}/accept`, { password: "short", totp_code: totpCode(secret, Date.now()) });
    expect(weak.status).toBe(400);
    expect(weak.json.error.message).toMatch(/at least 12/);
    // none of those attempts used up the link
    expect((await post(`/auth/v1/invites/${t}/accept`, { password: GOOD, totp_code: totpCode(secret, Date.now()) })).status).toBe(200);
  });

  it("the raw invite token and the password are never stored or audited", async () => {
    const s = await onboardStaff();
    const rows = await h.db.select().from(authInvites).where(eq(authInvites.userId, s.id));
    expect(JSON.stringify(rows)).not.toContain(s.inviteToken);
    const [u] = await h.db.select().from(adminUsers).where(eq(adminUsers.id, s.id));
    expect(u?.passwordHash).toMatch(/^scrypt\$/);
    expect(u?.passwordHash).not.toContain(GOOD);
    expect(u?.totpSecretEncrypted).not.toContain(s.secret);
    expect(JSON.stringify(await h.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, s.id)))).not.toContain(s.inviteToken);
  });

  it("disabling ends sessions at once; you cannot disable yourself; reset wipes credentials and sessions", async () => {
    const s = await onboardStaff();
    const token = (await staffLogin(s)).json.token as string;
    const auth = { authorization: `Bearer ${token}` };
    const self = await api("POST", `/internal/v1/staff/${s.id}/disable`, { idem: false, headers: auth });
    expect(self.status).toBe(409);

    expect((await legacy("POST", `/staff/${s.id}/disable`)).json.user.status).toBe("disabled");
    expect((await api("GET", "/internal/v1/merchants", { headers: auth })).status).toBe(401);
    expect((await staffLogin(s)).status).toBe(401);
    await legacy("POST", `/staff/${s.id}/disable`); // idempotent
    expect((await h.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, s.id))).filter((r) => r.action === "staff.disable")).toHaveLength(1);

    await legacy("POST", `/staff/${s.id}/enable`);
    await freshStep(s.id);
    expect((await staffLogin(s)).status).toBe(200);
    await freshStep(s.id);
    const t2 = (await staffLogin(s)).json.token as string;

    const reset = await legacy("POST", `/staff/${s.id}/reset`);
    expect(reset.json.invite.token).toMatch(/^binv_/);
    expect((await api("GET", "/internal/v1/merchants", { headers: { authorization: `Bearer ${t2}` } })).status).toBe(401);
    await freshStep(s.id);
    expect((await staffLogin(s)).status).toBe(401); // old password no longer works (and the old authenticator secret is gone)
  });
});

describe("sessions", () => {
  it("logout revokes; absolute expiry and idle timeout both kill a session; a token only works for its own kind", async () => {
    const u = await onboardMerchantUser();
    const s1 = (await userLogin(u)).json.token as string;
    expect((await get("/auth/v1/me", s1)).status).toBe(200);
    await post("/auth/v1/logout", {}, s1);
    expect((await get("/auth/v1/me", s1)).status).toBe(401);

    const s2 = (await userLogin(u)).json.token as string;
    await h.db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authSessions.tokenHash, hashToken(s2)));
    expect((await get("/auth/v1/me", s2)).status).toBe(401);

    const s3 = (await userLogin(u)).json.token as string;
    await h.db.update(authSessions).set({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(authSessions.tokenHash, hashToken(s3)));
    expect((await get("/auth/v1/me", s3)).status).toBe(401);

    const s4 = (await userLogin(u)).json.token as string;
    expect((await api("GET", "/internal/v1/merchants", { headers: { authorization: `Bearer ${s4}` } })).status).toBe(401); // merchant session is not staff
    const staff = await onboardStaff();
    const st = (await staffLogin(staff)).json.token as string;
    expect((await api("GET", "/v1/payment_intents", { headers: { authorization: `Bearer ${st}` } })).status).toBe(401); // staff session is not a merchant
  });

  it("a disabled account is refused even if its session row was somehow left live", async () => {
    const staff = await onboardStaff();
    await freshStep(staff.id);
    const st = (await staffLogin(staff)).json.token as string;
    await h.db.update(adminUsers).set({ disabledAt: new Date() }).where(eq(adminUsers.id, staff.id)); // bypasses the revoke step
    expect((await api("GET", "/internal/v1/merchants", { headers: { authorization: `Bearer ${st}` } })).status).toBe(401);
    const u = await onboardMerchantUser();
    const ut = (await userLogin(u)).json.token as string;
    await h.db.update(merchantUsers).set({ disabledAt: new Date() }).where(eq(merchantUsers.id, u.id));
    expect((await get("/auth/v1/me", ut)).status).toBe(401);
  });

  it("a session token is stored only as a hash", async () => {
    const u = await onboardMerchantUser();
    const token = (await userLogin(u)).json.token as string;
    const rows = await h.db.select().from(authSessions).where(eq(authSessions.userId, u.id));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows.some((r) => r.tokenHash === hashToken(token))).toBe(true);
  });
});

describe("merchant dashboard users", () => {
  it("a signed-in user can create and read payments for their merchant, like an API key", async () => {
    const u = await onboardMerchantUser("owner");
    const token = (await userLogin(u)).json.token as string;
    const auth = { authorization: `Bearer ${token}` };
    const created = await api("POST", "/v1/payment_intents", { headers: auth, body: { amount: "25000000" } });
    expect(created.status).toBe(201);
    expect((await api("GET", `/v1/payment_intents/${created.json.id}`, { headers: auth })).json.amount).toBe("25000000");
    expect((await api("GET", "/v1/balance", { headers: auth })).status).toBe(200);
    // ...and only for their own merchant
    const other = await seedMerchant(h);
    const otherPay = await api("POST", "/v1/payment_intents", { key: other.apiKey, body: { amount: "1000000" } });
    expect((await api("GET", `/v1/payment_intents/${otherPay.json.id}`, { headers: auth })).status).toBe(404);
  });

  it("viewers are read-only; other roles can write", async () => {
    const m = await seedMerchant(h);
    const viewer = await onboardMerchantUser("viewer", { merchantId: m.merchantId });
    const dev = await onboardMerchantUser("developer", { merchantId: m.merchantId });
    const vAuth = { authorization: `Bearer ${(await userLogin(viewer)).json.token}` };
    const dAuth = { authorization: `Bearer ${(await userLogin(dev)).json.token}` };
    expect((await api("GET", "/v1/payment_intents", { headers: vAuth })).status).toBe(200);
    const denied = await api("POST", "/v1/payment_intents", { headers: vAuth, body: { amount: "1000000" } });
    expect(denied.status).toBe(403);
    expect((await api("POST", "/v1/payment_intents", { headers: dAuth, body: { amount: "1000000" } })).status).toBe(201);
    // a role change applies to live sessions immediately
    await legacy("PATCH", `/merchant-users/${dev.id}`, { body: { role: "viewer" } });
    expect((await api("POST", "/v1/payment_intents", { headers: dAuth, body: { amount: "1000000" } })).status).toBe(403);
  });

  it("suspending the merchant, or disabling the user, cuts access immediately", async () => {
    const u = await onboardMerchantUser();
    const auth = { authorization: `Bearer ${(await userLogin(u)).json.token}` };
    expect((await api("GET", "/v1/payment_intents", { headers: auth })).status).toBe(200);
    await legacy("POST", `/merchants/${u.merchantId}/suspend`);
    expect((await api("GET", "/v1/payment_intents", { headers: auth })).status).toBe(403);
    await legacy("POST", `/merchants/${u.merchantId}/reinstate`);
    expect((await api("GET", "/v1/payment_intents", { headers: auth })).status).toBe(200);

    expect((await legacy("POST", `/merchant-users/${u.id}/disable`)).json.user.status).toBe("disabled");
    expect((await api("GET", "/v1/payment_intents", { headers: auth })).status).toBe(401);
    expect((await userLogin(u)).status).toBe(401);
    await legacy("POST", `/merchant-users/${u.id}/enable`);
    expect((await userLogin(u)).status).toBe(200);
  });

  it("locks after repeated failures", async () => {
    const u = await onboardMerchantUser();
    for (let i = 0; i < 5; i++) expect((await userLogin({ ...u, password: "wrong password here" })).status).toBe(401);
    expect((await userLogin(u)).status).toBe(429);
    await h.db.update(merchantUsers).set({ lockedUntil: null }).where(eq(merchantUsers.id, u.id));
    expect((await userLogin(u)).status).toBe(200);
  });

  it("changing your password needs the current one, enforces policy, and signs out your other sessions", async () => {
    const u = await onboardMerchantUser();
    const a = (await userLogin(u)).json.token as string;
    const b = (await userLogin(u)).json.token as string;
    expect((await post("/auth/v1/password", { current_password: "nope nope nope nope", new_password: "another long passphrase" }, a)).status).toBe(403);
    expect((await post("/auth/v1/password", { current_password: GOOD, new_password: "short" }, a)).status).toBe(400);
    expect((await post("/auth/v1/password", { current_password: GOOD, new_password: "another long passphrase" }, a)).status).toBe(200);
    expect((await get("/auth/v1/me", a)).status).toBe(200); // this session stays
    expect((await get("/auth/v1/me", b)).status).toBe(401); // the others end
    expect((await userLogin(u)).status).toBe(401);
    expect((await userLogin({ email: u.email, password: "another long passphrase" })).status).toBe(200);
  });

  it("an admin reset wipes the password and sessions and issues a fresh single-use link", async () => {
    const u = await onboardMerchantUser();
    const t = (await userLogin(u)).json.token as string;
    const reset = await legacy("POST", `/merchant-users/${u.id}/reset`);
    expect((await get("/auth/v1/me", t)).status).toBe(401);
    expect((await userLogin(u)).status).toBe(401);
    expect((await post(`/auth/v1/invites/${reset.json.invite.token}/accept`, { password: "brand new passphrase!" })).status).toBe(200);
    expect((await userLogin({ email: u.email, password: "brand new passphrase!" })).status).toBe(200);
    expect((await post(`/auth/v1/invites/${reset.json.invite.token}/accept`, { password: "brand new passphrase!" })).status).toBe(404);
  });

  it("rejects duplicate emails, unknown merchants and bad roles; lists users; API keys still work", async () => {
    const m = await seedMerchant(h);
    const e = email("dup");
    expect((await legacy("POST", `/merchants/${m.merchantId}/users`, { body: { email: e, role: "owner" } })).status).toBe(201);
    expect((await legacy("POST", `/merchants/${m.merchantId}/users`, { body: { email: e.toUpperCase(), role: "owner" } })).status).toBe(409);
    expect((await legacy("POST", `/merchants/mer_${"0".repeat(32)}/users`, { body: { email: email("x"), role: "owner" } })).status).toBe(404);
    expect((await legacy("POST", `/merchants/${m.merchantId}/users`, { body: { email: email("x"), role: "god" } })).status).toBe(400);
    const list = await legacy("GET", `/merchants/${m.merchantId}/users`);
    expect(list.json.data[0]).toMatchObject({ email: e, role: "owner", status: "invited" });
    expect(JSON.stringify(list.json)).not.toMatch(/password|hash|token/i);
    expect((await api("GET", "/v1/payment_intents", { key: m.apiKey })).status).toBe(200);
  });
});

describe("sign-in rate limit", () => {
  it("throttles repeated sign-in attempts per IP", async () => {
    const h2 = await makeHarness({ env: { AUTH_RATE_LIMIT_PER_MIN: "3" } });
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; // fresh key: limiter state lives in Redis
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await h2.app.inject({ method: "POST", url: "/auth/v1/merchant/login", remoteAddress: ip, headers: { "content-type": "application/json" }, payload: JSON.stringify({ email: "x@cleargateway.test", password: "whatever password" }) });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    await h2.close();
  });
});
