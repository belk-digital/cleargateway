"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, Field, Mono } from "@/components/ui";

interface Invite {
  kind: "merchant" | "admin";
  purpose: "invite" | "reset";
  email: string;
  totp: { secret: string; uri: string } | null;
}

/** Landing page for an invite or password-reset link: /accept#token=binv_... (the token stays in the fragment). */
export default function Accept() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const h = /token=([^&]+)/.exec(window.location.hash) ?? /token=([^&]+)/.exec(window.location.search);
    const t = h ? decodeURIComponent(h[1]!) : null;
    setToken(t);
    if (t) window.history.replaceState(null, "", window.location.pathname); // keep the one-time token out of the address bar/history
  }, []);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const r = await fetch(`/api/invite/${token}`);
      const j = (await r.json().catch(() => null)) as (Invite & { error?: { message?: string } }) | null;
      if (!r.ok || !j) return setLoadError(j?.error?.message ?? "This link is not valid");
      setInvite(j);
      if (j.totp) setQr(await QRCode.toDataURL(j.totp.uri, { margin: 1, width: 200 }));
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords do not match");
    setBusy(true);
    const r = await fetch(`/api/invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cleargateway-csrf": "1" },
      body: JSON.stringify({ password, ...(code ? { totp_code: code } : {}) }),
    });
    const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(j?.error?.message ?? "Something went wrong");
  }

  if (token === undefined) return null;
  const signInHref = invite?.kind === "admin" ? "/admin/login" : "/dashboard/login";

  return (
    <main className="mx-auto mt-16 max-w-md px-4">
      <Card title={invite?.purpose === "reset" ? "Reset your password" : "Set up your account"}>
        {!token || loadError ? (
          <ErrorNote message={loadError ?? "This link is incomplete. Use the full link you were given."} />
        ) : done ? (
          <div className="space-y-3">
            <p className="font-medium text-green-700">All set. Your account is ready.</p>
            <a className="inline-block rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white" href={signInHref}>
              Go to sign in
            </a>
          </div>
        ) : !invite ? (
          <p className="text-sm text-slate-500">Checking your link…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-slate-600">
              Account: <strong>{invite.email}</strong>
            </p>
            {invite.totp && qr && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-sm font-medium">1. Add this account to an authenticator app</p>
                <p className="mb-3 text-xs text-slate-500">Use Google Authenticator, 1Password, Authy or similar. Scan the code, or enter the key by hand.</p>
                <img src={qr} alt="Authenticator QR code" width={200} height={200} className="mx-auto" />
                <p className="mt-3 text-center text-xs text-slate-500">
                  Key: <Mono>{invite.totp.secret}</Mono>
                </p>
              </div>
            )}
            <div>
              {invite.totp && <p className="mb-2 text-sm font-medium">2. Choose a password</p>}
              <div className="space-y-3">
                <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 12 characters. A few random words works well." required />
                <Field label="Repeat password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
            </div>
            {invite.totp && (
              <Field label="3. Code from your authenticator app" inputMode="numeric" maxLength={6} pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
            )}
            <ErrorNote message={error} />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save and continue"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
