"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { Checkout } from "@/components/checkout/Checkout";
import { wagmiConfig } from "@/lib/wagmi";

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [queryClient] = useState(() => new QueryClient());
  const [secret, setSecret] = useState<string | null | undefined>(undefined);

  // The client secret arrives in the URL fragment (never sent to any server by the browser). Take it, then scrub the URL.
  useEffect(() => {
    const m = /client_secret=([^&]+)/.exec(window.location.hash);
    setSecret(m ? decodeURIComponent(m[1]!) : null);
    if (m) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (secret === undefined) return null;
  if (!secret) {
    return (
      <main className="mx-auto mt-24 max-w-md px-4 text-center">
        <h1 className="text-xl font-semibold">This payment link is incomplete</h1>
        <p className="mt-2 text-slate-600">Please use the full link you received from the merchant.</p>
      </main>
    );
  }
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Checkout id={id} secret={secret} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
