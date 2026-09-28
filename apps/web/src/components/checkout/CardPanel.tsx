"use client";
import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { checkoutCall } from "@/lib/checkout-api";
import { safeUrl } from "@/lib/checkout-api";
import { Button, ErrorNote, Field, Notice } from "@/components/ui";

interface Session {
  provider: string;
  session_id: string;
  widget_config: Record<string, unknown>;
}

/**
 * Card / Apple Pay through an on-ramp: the provider buys USDC INTO THE CUSTOMER'S OWN WALLET, and that wallet then pays
 * on the Wallet tab. The on-ramp never pays the merchant directly, so this tab can never mark a payment as paid.
 */
export function CardPanel({ id, secret }: { id: string; secret: string }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  async function start() {
    if (!address) return;
    setBusy(true);
    setError(null);
    const r = await checkoutCall<Session>(id, secret, "/onramp-session", "POST", { customer_wallet_address: address, ...(email ? { customer_email: email } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSession(r.data);
  }

  const widgetUrl = session ? safeUrl(typeof session.widget_config.url === "string" ? session.widget_config.url : null) : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Buy USDC with a card into your own wallet, then pay with it on the Wallet tab.</p>
      <Notice>Card purchases are not live on this test network yet: the on-ramp partners are still being set up. Use the Wallet or Exchange tab to test payments.</Notice>
      {!isConnected ? (
        <Button variant="secondary" className="w-full" onClick={() => connectors[0] && connect({ connector: connectors[0] })} disabled={connectors.length === 0}>
          Connect wallet to continue
        </Button>
      ) : (
        <>
          <Field label="Email for the receipt (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button className="w-full" disabled={busy || !!session} onClick={start}>
            {busy ? "Starting…" : "Continue to card payment"}
          </Button>
        </>
      )}
      {session && (
        <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          Session started with {session.provider}.{" "}
          {widgetUrl ? (
            <a className="underline" href={widgetUrl} target="_blank" rel="noreferrer">
              Open the card checkout
            </a>
          ) : (
            "No card checkout is available for this provider in test mode."
          )}
          <br />
          When your wallet is funded, return to the Wallet tab and press Pay.
        </div>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
