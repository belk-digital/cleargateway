"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/motion/Motion";

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";

/** A floating glass card showing the one call that starts everything, with the response it returns. */
function ApiCard() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.3, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-full max-w-sm"
    >
      <motion.div animate={reduce ? undefined : { y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        <div className="overflow-hidden rounded-2xl border border-white/40 bg-[#1B1F5C]/30 shadow-[0_24px_70px_rgba(30,20,120,0.35)] backdrop-blur-xl">
          <div className="flex items-center gap-1.5 border-b border-white/20 px-4 py-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full bg-white/50" />
            ))}
            <span className="ml-3 truncate text-xs text-white/80">POST /v1/payment_intents</span>
          </div>
          <pre className="overflow-hidden px-4 py-4 font-mono text-[12px] leading-6 text-white/95">
            <code>{`{
  "amount": "25500000",
  "merchant_order_id": "order-1042"
}`}</code>
          </pre>
          <div className="border-t border-white/20 bg-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              </span>
              201 Created
            </div>
            <p className="mt-1.5 truncate font-mono text-[11px] text-white/80">checkout_url: &quot;https://…/pay/pi_…&quot;</p>
          </div>
        </div>
      </motion.div>
      <motion.span
        aria-hidden
        className="absolute -right-3 -top-4 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#5B5BF0] shadow-lg"
        animate={reduce ? undefined : { y: [0, 6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
      >
        25.50 USDC
      </motion.span>
    </motion.div>
  );
}

export function CtaSection() {
  const reduce = useReducedMotion();
  return (
    <section className={`px-4 py-16 sm:px-8 ${FONT}`}>
      <Reveal className="mx-auto max-w-[76rem]">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#6B6BFA] via-[#7B86D0] to-[#8C95DC] px-6 py-14 text-white shadow-[0_30px_80px_rgba(60,70,180,0.30)] sm:px-12 lg:px-16 lg:py-20">
          <motion.div aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-white/25 blur-3xl" animate={reduce ? undefined : { x: [0, 40, 0], y: [0, 20, 0] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-cyan-300/30 blur-3xl" animate={reduce ? undefined : { x: [0, -30, 0], y: [0, -20, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />
          <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />

          <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="text-center lg:text-left">
              <p className="text-xs font-medium uppercase tracking-[0.35em] text-white/90">Get started</p>
              <h2 className="mt-5 text-4xl font-medium leading-[1.12] tracking-[-0.04em] sm:text-5xl">
                Ready to integrate?
                <br />
                <span className="bg-gradient-to-r from-[#7FE8FF] via-white to-[#F2B8FF] bg-clip-text text-transparent">Take test payments today.</span>
              </h2>
              <p className="mx-auto mt-6 max-w-lg text-lg leading-8 text-white/85 lg:mx-0">Your team can be taking test payments in a few minutes. Create a payment, send the checkout link, and get a signed webhook when it lands.</p>
              <div className="mt-9 flex flex-wrap justify-center gap-3 lg:justify-start">
                <Link href="/docs" className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-semibold text-[#5B5BF0] shadow-lg shadow-indigo-900/20 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl">
                  Browse the docs
                  <span className="transition-transform group-hover:translate-x-1">→</span>
                </Link>
                <Link href="/docs/api" className="rounded-full border border-white/50 bg-white/10 px-7 py-3.5 font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white/20">
                  API reference
                </Link>
              </div>
              <ul className="mt-8 flex flex-wrap justify-center gap-2 lg:justify-start">
                {["Base Sepolia testnet", "Non-custodial", "Signed webhooks"].map((t) => (
                  <li key={t} className="rounded-full border border-white/30 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <ApiCard />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
