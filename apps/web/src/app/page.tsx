import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { CodeTabs } from "@/components/docs/CodeTabs";
import { API_URL } from "@/lib/site";

const FEATURES = [
  {
    title: "Non-custodial by design",
    body: "Customer payments are split by a smart contract in one atomic step: your share goes straight to your wallet, our fee to ours. ClearGateway never holds your money and has no withdraw function to abuse.",
  },
  {
    title: "Three ways to pay",
    body: "Customers can pay from a connected wallet, send USDC from an exchange to a per-payment deposit address, or (coming soon) buy USDC by card. One integration covers all of them.",
  },
  {
    title: "The blockchain is the source of truth",
    body: "A payment is only marked paid after the chain confirms it and a final re-check passes, with reorg protection. No trusting a customer's browser or a third party's say-so.",
  },
  {
    title: "Built for developers",
    body: "A small REST API, idempotency keys on every money-moving call, signed webhooks with automatic retries, and a hosted checkout so you can start with a redirect and a link.",
  },
  {
    title: "A dashboard for your team",
    body: "See payments and balances, create payment links, manage webhooks, request refunds, and invite teammates with owner, admin, developer or read-only roles.",
  },
  {
    title: "Exact money, no surprises",
    body: "Amounts are whole numbers of USDC base units (6 decimals), never floating point. Fees are set in basis points and always round down, so every cent is accounted for in a double-entry ledger.",
  },
];

const SNIPPET = `curl ${API_URL}/v1/payment_intents \\
  -H "Authorization: Bearer $CLEARGATEWAY_API_KEY" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": "25500000", "merchant_order_id": "order-1042" }'
# amount is in USDC base units: 25500000 = 25.50 USDC
# the response contains a checkout_url to send your customer to`;

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pb-10 pt-16 text-center">
          <p className="mb-3 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-brand">Testnet preview · Base Sepolia · USDC</p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">Accept stablecoin payments straight into your own wallet</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            ClearGateway lets any website take USDC payments with a hosted checkout, a simple API and signed webhooks, without ever handing us custody of your funds.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/docs/quickstart" className="rounded-xl bg-brand px-5 py-3 font-medium text-white hover:bg-brand-dark">
              Read the quickstart
            </Link>
            <Link href="/dashboard" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 hover:bg-slate-50">
              Merchant sign in
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-6">
          <CodeTabs samples={[{ label: "Create a payment", code: SNIPPET }]} />
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="mb-8 text-center text-2xl font-semibold">Why ClearGateway</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-2 font-semibold text-slate-900">{f.title}</h3>
                <p className="text-sm leading-6 text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="mb-8 text-center text-2xl font-semibold">How a payment works</h2>
          <ol className="grid gap-5 text-sm text-slate-700 md:grid-cols-4">
            {[
              ["1. Create", "Your server creates a payment for an amount and gets a checkout link."],
              ["2. Pay", "Your customer opens the link and pays with their wallet or from an exchange."],
              ["3. Confirm", "We watch the blockchain, wait for confirmations and mark the payment paid."],
              ["4. Notified", "We send your server a signed webhook. The money is already in your wallet."],
            ].map(([t, b]) => (
              <li key={t} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="mb-1 font-semibold text-slate-900">{t}</p>
                <p className="text-slate-600">{b}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 text-center">
          <h2 className="text-2xl font-semibold">Ready to integrate?</h2>
          <p className="mt-2 text-slate-600">Your team can be taking test payments in a few minutes.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/docs" className="rounded-xl bg-brand px-5 py-3 font-medium text-white hover:bg-brand-dark">
              Browse the docs
            </Link>
            <Link href="/docs/api" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium hover:bg-slate-50">
              API reference
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
