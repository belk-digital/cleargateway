"use client";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/Motion";

/**
 * "How it works" on a violet video background: four frosted-glass step cards, each with a line icon, copy and a
 * small white UI panel showing that step, joined by dashed connectors with nodes between the cards.
 */

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";
const EASE = [0.16, 1, 0.3, 1] as const;

function LineIcon({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      width="52"
      height="52"
      viewBox="0 0 48 48"
      fill="none"
      stroke="#D5F3FF"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      animate={reduce ? undefined : { y: [0, -4, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      className="drop-shadow-[0_0_10px_rgba(160,230,255,0.6)]"
    >
      {children}
    </motion.svg>
  );
}

const ICONS = {
  create: (
    <>
      <path d="M8 40V22l9-5h14v20l-9 5H8zM8 22l9 5h14M17 27v13" />
      <path d="M26 20L40 8M31 8h9v9" />
    </>
  ),
  pays: (
    <>
      <path d="M22 6l14 8v16l-14 8-14-8V14l14-8zM8 14l14 8 14-8M22 22v16" />
      <path d="M32 34l6-3 6 3v7l-6 3-6-3v-7z" />
    </>
  ),
  confirm: <path d="M24 7l17 8-17 8-17-8 17-8zM7 24l17 8 17-8M7 33l17 8 17-8" />,
  wallet: (
    <>
      <path d="M6 30l8-4 8 4-8 4-8-4zM6 30v9l8 4v-9M22 30v9l-8 4" />
      <path d="M20 16l9-4 9 4-9 4-9-4zM20 16v9l9 4 9-4v-9" />
      <path d="M30 6l6-2 6 2-6 2-6-2z" />
    </>
  ),
};

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* ----- White UI panels ----- */

function CheckoutPanel() {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-xl shadow-indigo-900/20">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="h-5 w-5 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
        ClearGateway
      </p>
      <p className="mt-3 text-[11px] text-slate-500">Pay with USDC</p>
      <p className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2775CA] text-[11px] text-white">$</span>
        $125.00
      </p>
      <motion.div
        animate={{ boxShadow: ["0 0 0 0 rgba(99,102,241,0.45)", "0 0 0 10px rgba(99,102,241,0)"] }}
        transition={{ duration: 1.8, repeat: Infinity }}
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5B5BF0] to-[#7A6BFF] py-2.5 text-sm font-medium text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
        </svg>
        Create Payment Link
      </motion.div>
    </div>
  );
}

const ROWS: { label: string; badge?: string; tone: string; icon: ReactNode }[] = [
  { label: "Connect Wallet", tone: "bg-sky-100 text-sky-600", icon: <path d="M4 7a2 2 0 012-2h11v4M4 7v10a2 2 0 002 2h13V9H6a2 2 0 01-2-2zM16 14h.01" /> },
  { label: "Send from Exchange", tone: "bg-violet-100 text-violet-600", icon: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /> },
  { label: "Pay with Card", badge: "Coming Soon", tone: "bg-slate-200 text-slate-500", icon: <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M7 15h3" /> },
];

function MethodsPanel() {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-2.5">
      {ROWS.map((r, i) => (
        <motion.div
          key={r.label}
          initial={{ opacity: 0, x: reduce ? 0 : 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 + i * 0.14, duration: 0.6, ease: EASE }}
          whileHover={reduce ? undefined : { x: 3 }}
          className={`flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-lg shadow-indigo-900/15 ${r.badge ? "opacity-90" : ""}`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${r.tone}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
              {r.icon}
            </svg>
          </span>
          <span className="text-[13px] font-medium text-slate-800">{r.label}</span>
          {r.badge ? (
            <span className="ml-auto rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-500">{r.badge}</span>
          ) : (
            <svg className="ml-auto text-indigo-500" width="16" height="16" viewBox="0 0 24 24" {...stroke}>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function CheckBadge() {
  const reduce = useReducedMotion();
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-500/40">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduce ? 1 : 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ delay: 0.7, duration: 0.5 }} />
      </svg>
    </span>
  );
}

function ConfirmedPanel() {
  const reduce = useReducedMotion();
  return (
    <div className="rounded-2xl bg-white p-4 shadow-xl shadow-indigo-900/20">
      <div className="flex items-center gap-3">
        <CheckBadge />
        <div>
          <p className="text-sm font-semibold text-slate-900">Transaction Confirmed</p>
          <p className="text-xs text-slate-500">USDC on Base</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">3/3 confirmations</p>
      <div className="mt-1.5 flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            initial={{ scaleX: reduce ? 1 : 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 + i * 0.35, duration: 0.5, ease: EASE }}
            className="h-2 flex-1 origin-left rounded-full bg-[#1F6BFF]"
          />
        ))}
      </div>
    </div>
  );
}

function SettledPanel() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-xl shadow-indigo-900/20">
      <CheckBadge />
      <div>
        <p className="text-sm font-semibold text-slate-900">Payment Settled</p>
        <p className="text-xs text-slate-500">Direct to your wallet</p>
      </div>
    </div>
  );
}

const STEPS: { n: string; title: string; body: string; icon: ReactNode; panel: ReactNode }[] = [
  { n: "01", title: "Create Payment", body: "Generate a payment link or create a payment via our API for a fixed USDC amount.", icon: ICONS.create, panel: <CheckoutPanel /> },
  { n: "02", title: "Customer Pays", body: "Your customer pays using their preferred method — wallet, exchange, or card.", icon: ICONS.pays, panel: <MethodsPanel /> },
  { n: "03", title: "Confirmed on Chain", body: "We monitor the blockchain, wait for confirmations, and verify the payment.", icon: ICONS.confirm, panel: <ConfirmedPanel /> },
  { n: "04", title: "Funds to Your Wallet", body: "Payments settle directly to your wallet — instantly and securely. No holding, no batching.", icon: ICONS.wallet, panel: <SettledPanel /> },
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  return (
    <section id="how-it-works" className={`relative overflow-hidden bg-[#6B6BFA] py-24 text-white ${FONT}`}>
      {!reduce && (
        <video aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover" src="/how-it-works-bg-video.mp4" autoPlay muted loop playsInline preload="metadata" />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-indigo-600/10" />
      <div className="relative mx-auto max-w-[76rem] px-4 sm:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-white/90">How it works</p>
          <span className="mx-auto mt-3 block h-px w-10 bg-white/70" />
          <h2 className="mt-8 text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl">
            From payment to your wallet.
            <br />
            <span className="bg-gradient-to-r from-[#7FE8FF] via-[#C9D8FF] to-[#F2B8FF] bg-clip-text text-transparent">In a few simple steps.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-white/85 sm:text-lg">
            Accept USDC through a hosted checkout or API. Customers can pay with their wallet, exchange, or card, and funds settle directly to your wallet on Base.
          </p>
        </Reveal>

        <StaggerGroup className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8" gap={0.14}>
          {STEPS.map((s, i) => (
            <StaggerItem key={s.n} className="relative h-full">
              <div className="flex h-full flex-col rounded-3xl border border-white/30 bg-white/15 p-6 shadow-[0_20px_60px_rgba(40,30,150,0.25)] backdrop-blur-xl transition-transform duration-300 hover:-translate-y-1">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/30 text-sm font-semibold text-white ring-1 ring-white/40">{s.n}</span>
                <div className="mt-4">
                  <LineIcon>{s.icon}</LineIcon>
                </div>
                <h3 className="mt-3 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-6 text-white/85">{s.body}</p>
                <div className="mt-auto pt-6">{s.panel}</div>
              </div>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="absolute -right-8 top-1/2 z-10 hidden w-8 -translate-y-1/2 items-center justify-center lg:flex">
                  <span className="absolute inset-x-0 border-t border-dashed border-white/50" />
                  <span className="relative h-3.5 w-3.5 rounded-full border-2 border-white bg-[#6B6BFA]" />
                </span>
              )}
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
