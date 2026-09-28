"use client";
import { useState } from "react";
import { Button, Card, ErrorNote, Field } from "./ui";

export function LoginForm({ kind }: { kind: "merchant" | "admin" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/session/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cleargateway-csrf": "1" },
      body: JSON.stringify({ email: email.trim(), password, ...(code ? { totp_code: code.trim() } : {}) }),
    });
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; totp_required?: boolean } } | null;
    if (res.ok) {
      window.location.href = kind === "merchant" ? "/dashboard" : "/admin";
      return;
    }
    if (j?.error?.totp_required) {
      setNeedCode(true);
      setError(code ? "That code was not accepted. Wait for a new one and try again." : null);
    } else setError(j?.error?.message ?? "Sign-in failed");
    setBusy(false);
  }

  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <Card title={kind === "merchant" ? "Merchant sign in" : "Staff sign in"}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={needCode} required />
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={needCode} required />
          {needCode && (
            <Field
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              hint="The 6-digit code from your authenticator app."
              autoFocus
              required
            />
          )}
          <ErrorNote message={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Checking…" : needCode ? "Verify and sign in" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-slate-500">Forgot your password? Ask {kind === "merchant" ? "ClearGateway support" : "a colleague"} for a reset link.</p>
        </form>
      </Card>
    </main>
  );
}
