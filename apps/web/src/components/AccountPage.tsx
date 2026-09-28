"use client";
import { useState } from "react";
import { call, useGet, type Kind } from "@/lib/client";
import { Button, Card, ErrorNote, Field, PageHeader } from "./ui";

interface Me {
  email: string;
  role: string | null;
  merchant_name: string | null;
  expires_at: string;
}

export function AccountPage({ kind }: { kind: Kind }) {
  const me = useGet<Me>(kind, "auth/me");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (next !== again) return setError("The two new passwords do not match");
    const r = await call(kind, "POST", "auth/password", { current_password: cur, new_password: next });
    if (!r.ok) return setError(r.error);
    setCur("");
    setNext("");
    setAgain("");
    setOk(true);
  }

  return (
    <>
      <PageHeader title="Account" sub={me.data ? `${me.data.email}${me.data.role ? ` · ${me.data.role}` : ""}${me.data.merchant_name ? ` · ${me.data.merchant_name}` : ""}` : undefined} />
      <Card title="Change password" className="max-w-md">
        <form onSubmit={change} className="space-y-4">
          <Field label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="At least 12 characters. Your other sessions are signed out." required />
          <Field label="Repeat new password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          <ErrorNote message={error} />
          {ok && <p className="text-sm text-green-700">Password changed.</p>}
          <Button type="submit">Change password</Button>
        </form>
      </Card>
    </>
  );
}
