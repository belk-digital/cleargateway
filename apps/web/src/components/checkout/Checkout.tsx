"use client";
import { useCallback, useEffect, useState } from "react";
import { checkoutCall, safeUrl, type CheckoutStatus, type CheckoutView } from "@/lib/checkout-api";
import { formatUsdc } from "@/lib/money";
import { Card, Mono } from "@/components/ui";
import { CardPanel } from "./CardPanel";
import { DepositPanel } from "./DepositPanel";
import { WalletPanel } from "./WalletPanel";

const TERMINAL = new Set(["succeeded", "expired", "failed", "canceled", "refunded", "partially_refunded"]);
type Tab = "wallet" | "deposit" | "card";

export function Checkout({ id, secret }: { id: string; secret: string }) {
  const [view, setView] = useState<CheckoutView | null>(null);
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("wallet");

  const refresh = useCallback(async () => {
    const r = await checkoutCall<CheckoutView>(id, secret, "");
    if (r.ok) setView(r.data);
    else setError(r.error);
  }, [id, secret]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll the payment's status until it reaches a final state. The chain (via our watcher) decides, never this page.
  const current = status?.status ?? view?.status;
  useEffect(() => {
    if (!view || (current && TERMINAL.has(current))) return;
    const t = setInterval(async () => {
      const r = await checkoutCall<CheckoutStatus>(id, secret, "/status");
      if (r.ok) setStatus(r.data);
    }, 3000);
    return () => clearInterval(t);
  }, [id, secret, view, current]);

  if (error && !view) {
    return (
      <main className="mx-auto mt-24 max-w-md px-4 text-center">
        <h1 className="text-xl font-semibold">We could not load this payment</h1>
        <p className="mt-2 text-slate-600">{error}</p>
      </main>
    );
  }
  if (!view) return <main className="mx-auto mt-24 max-w-md px-4 text-center text-slate-500">Loading…</main>;

  const color = view.merchant.branding.primary_color ?? "";
  const brand = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0052ff";
  const success = safeUrl(view.success_url);
  const cancel = safeUrl(view.cancel_url);
  const st = current ?? view.status;
  const txHash = status?.tx_hash ?? view.tx_hash;
  const payable = st === "created" || st === "awaiting_payment";

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-sm text-slate-500">Pay {view.merchant.display_name}</p>
        <p className="mt-1 text-4xl font-semibold" style={{ color: brand }}>
          {formatUsdc(view.amount)} <span className="text-lg text-slate-500">USDC</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">Base Sepolia test network. No real money.</p>
      </div>

      {st === "succeeded" || st === "refunded" || st === "partially_refunded" ? (
        <Card>
          <p className="text-lg font-semibold text-green-700">Payment complete</p>
          <p className="mt-1 text-sm text-slate-600">{view.merchant.display_name} has been paid. Thank you.</p>
          {txHash && <div className="mt-3 text-xs text-slate-500">Transaction <Mono>{txHash}</Mono></div>}
          {success && (
            <a className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: brand }} href={success}>
              Return to {view.merchant.display_name}
            </a>
          )}
        </Card>
      ) : st === "confirming" ? (
        <Card>
          <p className="text-lg font-semibold">Payment received. Confirming…</p>
          <p className="mt-1 text-sm text-slate-600">
            Waiting for network confirmations{status?.required_confirmations ? ` (${status.confirmations} of ${status.required_confirmations})` : ""}. Keep this page open; it updates by itself.
          </p>
          {txHash && <div className="mt-3 text-xs text-slate-500">Transaction <Mono>{txHash}</Mono></div>}
        </Card>
      ) : st === "underpaid" ? (
        <Card>
          <p className="text-lg font-semibold text-amber-700">We received less than the amount due</p>
          <p className="mt-1 text-sm text-slate-600">Please contact {view.merchant.display_name} to sort this out. Do not pay again until they confirm.</p>
        </Card>
      ) : !payable ? (
        <Card>
          <p className="text-lg font-semibold">{st === "expired" ? "This payment has expired" : st === "canceled" ? "This payment was canceled" : "This payment failed"}</p>
          <p className="mt-1 text-sm text-slate-600">If you already sent funds, contact {view.merchant.display_name}: a late payment is recorded and reviewed, never lost.</p>
          {cancel && (
            <a className="mt-4 inline-block text-sm text-brand underline" href={cancel}>
              Back to {view.merchant.display_name}
            </a>
          )}
        </Card>
      ) : (
        <Card>
          <div role="tablist" className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {(
              [
                ["wallet", "Wallet"],
                ["deposit", "Exchange / transfer"],
                ["card", "Card"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-2 py-2 font-medium ${tab === t ? "bg-white shadow-sm" : "text-slate-600"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === "wallet" && <WalletPanel id={id} secret={secret} view={view} brand={brand} />}
          {tab === "deposit" && <DepositPanel id={id} secret={secret} view={view} />}
          {tab === "card" && <CardPanel id={id} secret={secret} />}
          <p className="mt-5 text-center text-xs text-slate-500">
            Expires {new Date(view.expires_at).toLocaleTimeString()}. ClearGateway never holds your funds: they go straight to the merchant.
          </p>
        </Card>
      )}
    </main>
  );
}
