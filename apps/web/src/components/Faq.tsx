"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Reveal } from "@/components/motion/Motion";

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
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="bg-[#7B86D0] px-4 py-24 text-white [font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Reveal className="mb-12 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-white/90">FAQ</p>
          <span className="mx-auto mt-3 block h-px w-10 bg-white/70" />
          <h2 className="mt-7 text-4xl font-medium leading-[1.2] tracking-[-0.04em] sm:text-6xl">Frequently asked questions</h2>
        </Reveal>
        <Reveal>
          <div className="divide-y divide-white/20 overflow-hidden rounded-3xl border border-white/30 bg-white/15 shadow-[0_20px_60px_rgba(40,30,150,0.25)] backdrop-blur-xl">
            {FAQ.map(([q, a], i) => {
              const isOpen = open === i;
              return (
                <div key={q} className={`transition-colors ${isOpen ? "bg-white/10" : "hover:bg-white/5"}`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 p-6 text-left text-lg font-medium text-white"
                  >
                    {q}
                    <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-2xl leading-none text-white">
                      +
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-3xl px-6 pb-6 text-base leading-7 text-white/85">{a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
