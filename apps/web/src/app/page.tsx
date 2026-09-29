import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { CodeTabs } from "@/components/docs/CodeTabs";
import { Faq } from "@/components/Faq";
import { POSTS } from "@/lib/blog";
import { API_URL } from "@/lib/site";

const WHY = [
  {
    title: "Non-custodial by design",
    body: "Customer payments are split by a smart contract in one atomic step: your share goes straight to your wallet, our fee to ours. ClearGateway never holds your money and has no withdraw function to abuse.",
  },
  {
    title: "The blockchain is the source of truth",
    body: "A payment is only marked paid after the chain confirms it and a final re-check passes, with reorg protection. No trusting a customer's browser or a third party's say-so.",
  },
  {
    title: "Exact money, no surprises",
    body: "Amounts are whole numbers of USDC base units, never floating point. Fees are set in basis points and always round down, so every cent is accounted for in a double-entry ledger.",
  },
];

const FEATURES = [
  { title: "Hosted checkout", body: "A ready-made payment page for wallet, exchange-transfer or (soon) card, branded with your business name." },
  { title: "REST API + idempotency", body: "A small, documented API. Every money-moving call takes an Idempotency-Key, so retries can never double-charge." },
  { title: "Signed webhooks", body: "HMAC-signed events for every status change, delivered with automatic retries over roughly 3½ days." },
  { title: "Merchant dashboard", body: "Payments, balances, payment links and webhooks in one place, with owner/admin/developer/viewer roles for your team." },
  { title: "Two-factor staff accounts", body: "Every sign-in — merchant and staff — is a real password account, not a shared secret. Staff also require an authenticator app." },
  { title: "Refund requests", body: "Merchants request refunds through the API or dashboard; staff review and approve them, with a full audit trail." },
  { title: "Review queue", body: "Late, over- or under-paid transfers are never dropped silently — they're flagged for a human to resolve." },
  { title: "Reconciliation", body: "A standing job compares our records against the chain and reports any mismatch. It only reports — it never silently fixes." },
  { title: "Generated API reference", body: "The docs on this site are generated from the API's own route definitions, so they can't drift out of sync with what it accepts." },
];

const SNIPPET = `curl ${API_URL}/v1/payment_intents \\
  -H "Authorization: Bearer $CLEARGATEWAY_API_KEY" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": "25500000", "merchant_order_id": "order-1042" }'
# amount is in USDC base units: 25500000 = 25.50 USDC
# the response contains a checkout_url to send your customer to`;

const METHODS = [
  {
    title: "Wallet",
    body: "The customer connects a wallet on our checkout page, approves USDC, and confirms the payment. Two wallet confirmations, funds land immediately.",
  },
  {
    title: "Exchange transfer",
    body: "We generate a one-time deposit address for that payment. The customer sends USDC to it from any wallet or exchange — no wallet connection needed.",
  },
  {
    title: "Card (in progress)",
    body: "A customer buys USDC by card through an on-ramp partner into their own wallet, then pays the same way as any wallet payment. Not live yet — pending a partner integration.",
  },
];

export default function Home() {
  const latest = POSTS.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
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
          <div className="grid gap-5 sm:grid-cols-3">
            {WHY.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-2 font-semibold text-slate-900">{f.title}</h3>
                <p className="text-sm leading-6 text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-50 py-14">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="mb-2 text-center text-2xl font-semibold">How a payment works</h2>
            <p className="mx-auto mb-8 max-w-xl text-center text-slate-600">Four steps, the same for every integration.</p>
            <ol className="mb-10 grid gap-5 text-sm text-slate-700 md:grid-cols-4">
              {[
                ["1. Create", "Your server creates a payment for an amount and gets a checkout link."],
                ["2. Pay", "Your customer opens the link and pays by wallet, exchange transfer, or card."],
                ["3. Confirm", "We watch the blockchain, wait for confirmations and mark the payment paid."],
                ["4. Notified", "We send your server a signed webhook. The money is already in your wallet."],
              ].map(([t, b]) => (
                <li key={t} className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="mb-1 font-semibold text-slate-900">{t}</p>
                  <p className="text-slate-600">{b}</p>
                </li>
              ))}
            </ol>
            <h3 className="mb-6 text-center text-lg font-semibold text-slate-900">Three ways a customer can pay</h3>
            <div className="grid gap-5 sm:grid-cols-3">
              {METHODS.map((m) => (
                <div key={m.title} className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="mb-1 font-semibold text-slate-900">{m.title}</p>
                  <p className="text-sm leading-6 text-slate-600">{m.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="mb-2 text-center text-2xl font-semibold">Platform features</h2>
          <p className="mx-auto mb-8 max-w-xl text-center text-slate-600">Everything a merchant and their team need day to day.</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="mb-2 font-semibold text-slate-900">{f.title}</h3>
                <p className="text-sm leading-6 text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <Faq />

        {latest && (
          <section className="mx-auto max-w-3xl px-4 py-12">
            <h2 className="mb-6 text-center text-2xl font-semibold">From the blog</h2>
            <Link href={`/blog/${latest.slug}`} className="block rounded-xl border border-slate-200 bg-white p-6 !no-underline hover:border-brand">
              <p className="font-semibold !text-slate-900">{latest.title}</p>
              <p className="mt-2 text-sm !text-slate-600">{latest.excerpt}</p>
              <p className="mt-3 text-sm font-medium text-brand">Read more →</p>
            </Link>
            <p className="mt-4 text-center text-sm">
              <Link href="/blog" className="text-brand hover:underline">
                See all posts
              </Link>
            </p>
          </section>
        )}

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
