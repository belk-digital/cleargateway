"use client";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { checkoutCall, type CheckoutView, type WalletPayload } from "@/lib/checkout-api";
import { CHAIN, erc20Abi, splitterPayAbi } from "@/lib/wagmi";
import { Button, ErrorNote, Mono } from "@/components/ui";

type Step = "idle" | "preparing" | "approving" | "paying" | "sent";

/** Pays from the customer's own wallet: approve USDC, then ClearGatewaySplitter.pay with the API-signed intent. */
export function WalletPanel({ id, secret, view, brand }: { id: string; secret: string; view: CheckoutView; brand: string }) {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CHAIN.id });
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const hasWallet = typeof window !== "undefined" && "ethereum" in window;

  async function pay() {
    if (!address || !publicClient) return;
    setError(null);
    try {
      if (chainId !== CHAIN.id) await switchChainAsync({ chainId: CHAIN.id });
      setStep("preparing");
      const r = await checkoutCall<WalletPayload>(id, secret, "/wallet-payment", "POST", { payer_address: address, method: "approve" });
      if (!r.ok) throw new Error(r.error);
      const p = r.data;
      // Refuse anything that is not exactly what this page displays: right network, right amount, right payer.
      if (p.chain_id !== CHAIN.id) throw new Error("Unexpected network in payment details");
      if (p.payment_intent.amount !== view.amount) throw new Error("Payment details do not match the amount shown");
      if (p.payment_intent.payer.toLowerCase() !== address.toLowerCase()) throw new Error("Payment details are for a different wallet");
      if (p.approval.spender.toLowerCase() !== p.contract_address.toLowerCase()) throw new Error("Unexpected approval target");

      setStep("approving");
      const approveHash = await writeContractAsync({ address: p.approval.token, abi: erc20Abi, functionName: "approve", args: [p.approval.spender, BigInt(p.approval.amount)], chainId: CHAIN.id });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStep("paying");
      const pi = p.payment_intent;
      const payHash = await writeContractAsync({
        address: p.contract_address,
        abi: splitterPayAbi,
        functionName: "pay",
        args: [{ intentId: pi.intentId, merchant: pi.merchant, payer: pi.payer, amount: BigInt(pi.amount), feeBps: BigInt(pi.feeBps), expiry: BigInt(pi.expiry) }, p.intent_signature],
        chainId: CHAIN.id,
      });
      setHash(payHash);
      setStep("sent");
    } catch (e) {
      setStep("idle");
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(/user rejected|denied/i.test(msg) ? "You canceled the request in your wallet. Nothing was charged." : msg.split("\n")[0]!.slice(0, 300));
    }
  }

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Connect a wallet that holds test USDC on Base Sepolia.</p>
        {connectors.length === 0 || !hasWallet ? (
          <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">No browser wallet detected. Install a wallet extension such as MetaMask or Coinbase Wallet, or use the Exchange / transfer tab.</p>
        ) : (
          connectors.map((c) => (
            <Button key={c.uid} className="w-full" style={{ background: brand }} disabled={connecting} onClick={() => connect({ connector: c })}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          ))
        )}
      </div>
    );
  }

  const label = { idle: "Pay now", preparing: "Preparing…", approving: "Step 1 of 2: approve USDC in your wallet…", paying: "Step 2 of 2: confirm payment in your wallet…", sent: "Payment sent" }[step];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          Connected <Mono>{`${address?.slice(0, 6)}…${address?.slice(-4)}`}</Mono>
        </span>
        <button className="text-xs underline" onClick={() => disconnect()} disabled={step !== "idle"}>
          Disconnect
        </button>
      </div>
      <Button className="w-full" style={{ background: brand }} disabled={step !== "idle"} onClick={pay}>
        {label}
      </Button>
      <p className="text-xs text-slate-500">Paying takes two wallet confirmations: allow USDC, then send the payment.</p>
      {step === "sent" && hash && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          Sent. Waiting for the network to confirm: this page updates by itself. <Mono>{hash}</Mono>
        </p>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
