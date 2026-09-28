"use client";
import { useEffect, useState } from "react";
import { checkoutCall, type CheckoutView } from "@/lib/checkout-api";
import { formatUsdc } from "@/lib/money";
import { Button, CopyButton, ErrorNote, Mono, Notice } from "@/components/ui";

interface Deposit {
  address: string;
}

/** A per-payment address for sending USDC from an exchange or any wallet, no signing needed. */
export function DepositPanel({ id, secret, view }: { id: string; secret: string; view: CheckoutView }) {
  const [address, setAddress] = useState<string | null>(view.deposit_address?.address ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reveal an existing address without a click; otherwise the customer asks for one.
  useEffect(() => {
    setAddress(view.deposit_address?.address ?? null);
  }, [view.deposit_address?.address]);

  async function reveal() {
    setBusy(true);
    setError(null);
    const r = await checkoutCall<Deposit>(id, secret, "/deposit-address", "POST");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const a = r.data.address;
    if (typeof a === "string") setAddress(a);
    else setError("The server did not return an address");
  }

  const dep = view.deposit_address;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Send exactly this amount of USDC from an exchange or any wallet. We detect it automatically.</p>
      {!address ? (
        <Button className="w-full" disabled={busy} onClick={reveal}>
          {busy ? "Generating…" : "Show deposit address"}
        </Button>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Deposit address (Base Sepolia)</p>
            <Mono>{address}</Mono>
            <div className="mt-2">
              <CopyButton text={address} label="Copy address" />
            </div>
          </div>
          <p className="text-sm">
            Amount: <strong>{formatUsdc(view.amount)} USDC</strong>
          </p>
          {dep && dep.detected_amount !== "0" && (
            <p className="text-sm text-blue-800">
              Detected {formatUsdc(dep.detected_amount)} USDC ({dep.status.replace(/_/g, " ")}).
            </p>
          )}
          <Notice>Send USDC on the Base Sepolia network only. Sending other tokens or using another network can permanently lose funds. Send the full amount in one transfer.</Notice>
        </>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
