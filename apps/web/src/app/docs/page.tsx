import Link from "next/link";
import { Callout } from "@/components/docs/Callout";

const CARDS = [
  ["/docs/quickstart", "Quickstart", "Create your first payment and receive a webhook in about ten minutes."],
  ["/docs/payments", "Payments", "How a payment moves through its statuses, and how fees are calculated."],
  ["/docs/checkout", "Hosted checkout", "Send customers to a ready-made page: wallet, exchange transfer or card."],
  ["/docs/webhooks", "Webhooks", "Signed events for every change, with signature verification code."],
  ["/docs/refunds", "Refunds", "Request and track refunds."],
  ["/docs/api", "API reference", "Every endpoint, generated from the API itself."],
];

export default function Page() {
  return (
    <>
      <h1>ClearGateway documentation</h1>
      <p>
        ClearGateway lets your website accept USDC (a dollar-pegged stablecoin) and receive it directly in your own wallet. A smart contract splits each payment in a single atomic step: your share goes to your wallet and
        our fee to ours. We never hold your funds.
      </p>
      <Callout tone="warn" title="Testnet preview">
        Everything runs on <strong>Base Sepolia</strong>, a test network. Test USDC has no monetary value. Live payments are not enabled yet, and live API keys are refused.
      </Callout>

      <h2>How it fits together</h2>
      <ul>
        <li>
          <strong>Your server</strong> calls the API with a secret API key to create a payment.
        </li>
        <li>
          <strong>Your customer</strong> opens the payment&apos;s checkout link and pays.
        </li>
        <li>
          <strong>ClearGateway</strong> watches the blockchain, confirms the payment and sends your server a signed webhook.
        </li>
        <li>
          <strong>You</strong> fulfil the order when you receive <code>payment_intent.succeeded</code>. The money is already in your wallet.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map(([href, title, body]) => (
          <Link key={href} href={href!} className="!no-underline rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand">
            <p className="font-semibold !text-slate-900">{title}</p>
            <p className="mt-1 text-sm !text-slate-600">{body}</p>
          </Link>
        ))}
      </div>

      <h2>Key ideas</h2>
      <ul>
        <li>
          <strong>Amounts are integer strings in USDC base units.</strong> USDC has 6 decimals, so <code>&quot;25500000&quot;</code> is 25.50 USDC. Never use floating-point numbers for money.
        </li>
        <li>
          <strong>The blockchain is the source of truth.</strong> A payment is marked paid only after on-chain confirmation. Do not fulfil orders based on a redirect alone.
        </li>
        <li>
          <strong>Every money-moving request needs an Idempotency-Key</strong>, so retries can never create duplicates.
        </li>
      </ul>
    </>
  );
}
