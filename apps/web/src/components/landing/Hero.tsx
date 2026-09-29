"use client";
import Link from "next/link";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { GradientBackdrop } from "@/components/motion/GradientBackdrop";

const EASE = [0.16, 1, 0.3, 1] as const;

const STAGES = [
  { label: "Payment created", detail: "checkout_url issued", tone: "bg-slate-400" },
  { label: "Customer paying", detail: "Awaiting on-chain transfer", tone: "bg-amber-400" },
  { label: "Confirmed on Base", detail: "Confirmations reached · re-check passed", tone: "bg-emerald-500" },
  { label: "Webhook delivered", detail: "payment_intent.succeeded · 200 OK", tone: "bg-brand" },
];

/** A looping mock of a payment's lifecycle. Shows the final state, static, when the visitor prefers reduced motion. */
function PaymentDemo() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (reduce) {
      setStage(STAGES.length - 1);
      return;
    }
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2200);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.5, ease: EASE }}
      className="relative mx-auto mt-14 w-full max-w-md text-left"
    >
      <motion.div animate={reduce ? undefined : { y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-2xl shadow-brand/10 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">order-1042</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">
                25.50 <span className="text-base font-medium text-slate-500">USDC</span>
              </p>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-brand">Base Sepolia</span>
          </div>
          <ul className="mt-5 space-y-3">
            {STAGES.map((s, i) => {
              const done = i <= stage;
              return (
                <li key={s.label} className="flex items-start gap-3">
                  <motion.span
                    animate={{ scale: i === stage && !reduce ? [1, 1.35, 1] : 1 }}
                    transition={{ duration: 0.5 }}
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-500 ${done ? s.tone : "bg-slate-200"}`}
                  />
                  <div className={`transition-opacity duration-500 ${done ? "opacity-100" : "opacity-40"}`}>
                    <p className="text-sm font-medium text-slate-900">{s.label}</p>
                    <p className="text-xs text-slate-500">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Landing hero: drifting gradient blobs, a grid, and a brand glow that follows the cursor (adapted from a 21st.dev cursor-glow hero). */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const mx = useMotionValue(-400);
  const my = useMotionValue(-400);
  const glow = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, rgba(0,82,255,0.12), transparent 75%)`;
  const item = (i: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : 0.7, delay: reduce ? 0 : i * 0.1, ease: EASE },
  });
  return (
    <section
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        mx.set(e.clientX - r.left);
        my.set(e.clientY - r.top);
      }}
      className="relative overflow-hidden px-4 pb-20 pt-20 text-center sm:pt-28"
    >
      <GradientBackdrop variant="hero" />
      {!reduce && (
        <video
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          src="/cleargateway-hero-bg.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
      )}
      {/* Wash over the video so the headline stays readable, fading into the page background at the bottom. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/15 via-white/5 to-slate-50" />
      {!reduce && <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: glow }} />}
      <div className="relative mx-auto max-w-6xl">
        <motion.p {...item(0)} className="mb-8 inline-flex items-center rounded-full border border-[#7B86D0]/50 bg-white/30 p-0.5 text-xs backdrop-blur">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7B86D0] px-3.5 py-2 font-semibold text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 00-2.9-.1zM12 15l-3-3a22 22 0 012-4 12.9 12.9 0 0111-6c0 2.7-.8 7.5-6 11a22 22 0 01-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" />
            </svg>
            Testnet
          </span>
          <span className="px-4 font-medium uppercase tracking-wide text-[#6B74B8]">Base Sepolia · USDC</span>
        </motion.p>
        <motion.h1
          {...item(1)}
          className="mx-auto max-w-5xl text-[2.6rem] font-medium leading-[1.2] tracking-[-0.04em] text-[#465078] [font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif] sm:text-6xl lg:text-7xl lg:leading-[1.25]"
        >
          Accept stablecoin <span className="text-[#7B86D0]">payments</span>
          <br />
          straight into{" "}
          <span className="mx-1 my-1 inline-block rounded-full border border-[#8C95DC]/70 bg-white/25 px-5 pb-1 backdrop-blur-sm sm:px-7">
            <span className="animate-gradient-x bg-gradient-to-r from-[#7DD3F5] via-[#7B86D0] to-[#7DD3F5] bg-[length:200%_auto] bg-clip-text text-transparent">your own wallet</span>
          </span>
        </motion.h1>
        <motion.p {...item(2)} className="mx-auto mt-8 max-w-xl text-lg leading-8 text-[#5A6490] [font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif] sm:text-xl">
          ClearGateway lets any website take USDC payments with a hosted checkout, a simple API and signed webhooks, without ever handing us custody of your funds.
        </motion.p>
        <motion.div {...item(3)} className="mt-10 flex flex-wrap justify-center gap-4 [font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]">
          <Link
            href="/docs/quickstart"
            className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#6870BE] to-[#7C86D6] px-8 py-4 font-medium text-white shadow-lg shadow-[#6870BE]/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#6870BE]/40"
          >
            Read the quickstart
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-white px-8 py-4 font-medium text-[#6B74B8] shadow-md shadow-[#6870BE]/10 transition duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#6870BE]/20"
          >
            Merchant sign in
          </Link>
        </motion.div>
        <PaymentDemo />
      </div>
    </section>
  );
}
