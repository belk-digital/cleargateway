const FAQ: [string, string][] = [
  [
    "Is ClearGateway live for real payments?",
    "Not yet. Everything runs on Base Sepolia, a test network, so nothing you send has real value while we finish integrating a card on-ramp and complete our own testing. The engineering — contracts, API, webhooks, dashboard — is built and tested; going live is a deliberate next step, not a technical blocker.",
  ],
  [
    "Do you ever hold our money?",
    "No. Payments are split by a smart contract in one transaction: your share goes straight to your wallet, our fee to ours, on-chain. There's no step where ClearGateway holds a balance on your behalf, and the contract has no withdraw function for anyone to misuse.",
  ],
  [
    "What can customers pay with?",
    "A connected crypto wallet, or a direct USDC transfer from an exchange to a one-time deposit address we generate per payment. Paying by card, so a customer never needs to own crypto first, is planned but not live yet — it depends on a card-to-crypto on-ramp partner we're still finalizing.",
  ],
  [
    "How do refunds work?",
    "A merchant requests a refund through the API or dashboard, and our staff review and approve or reject it. Recording and approving a refund is live today; automatically sending the money back on-chain is not yet — that's a near-term addition.",
  ],
  [
    "What happens if a customer pays late, or sends the wrong amount?",
    "Nothing is ever silently dropped. A late, underpaid, or overpaid payment is flagged for our staff to review, and the payment's status is left untouched until someone looks at it — we never guess on your behalf.",
  ],
  [
    "How is our team's access secured?",
    "Everyone signs in with their own email and password — no shared logins. Staff accounts also require a code from an authenticator app on every sign-in. Sessions can be revoked immediately, and every account action is written to an audit log.",
  ],
  [
    "What fee do you charge?",
    "A percentage set per merchant, in basis points, applied automatically by the smart contract on each payment — you'll always know the fee before a payment is created, and it never changes retroactively on a payment already made.",
  ],
  [
    "Which network and token do you support?",
    "USDC on Base (a low-fee Ethereum network). We deliberately support one chain and one asset rather than many, so the whole system — confirmations, reorg handling, fee math — stays simple enough to reason about and verify.",
  ],
];

export function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h2 className="mb-8 text-center text-2xl font-semibold">Frequently asked questions</h2>
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group p-5 open:pb-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-900">
              {q}
              <span className="shrink-0 text-slate-400 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-slate-600">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
