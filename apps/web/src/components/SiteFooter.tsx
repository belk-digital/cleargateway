"use client";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useRef, useState } from "react";
import { Marquee } from "@/components/Marquee";
import { SITE_NAME, SOCIALS } from "@/lib/site";

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";

const MARQUEE = ["Non-custodial Payments", "USDC on Base", "Signed Webhooks", "Idempotent API", "Reorg-Safe Confirmations", "Generated API Docs"];

const COL_ONE = [
  { href: "/", label: "Home" },
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
];
const COL_TWO = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/quickstart", label: "Quickstart" },
  { href: "/docs/api", label: "API reference" },
  { href: "/dashboard", label: "Merchant sign in" },
  { href: "/admin", label: "Staff" },
];

/** Blurry glassy lobes bottom-left, drifting slowly. */
function Blobs({ progress }: { progress: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const y = useTransform(progress, [0, 1], [reduce ? 0 : 90, reduce ? 0 : -50]);
  const lobe = "absolute rounded-[45%] bg-gradient-to-br from-white/60 via-indigo-200/50 to-sky-300/60 shadow-[inset_0_0_40px_rgba(255,255,255,0.5)] backdrop-blur-sm";
  return (
    <motion.div aria-hidden style={{ y }} className="pointer-events-none absolute -left-28 bottom-0 hidden h-[26rem] w-[26rem] lg:block">
      <motion.div className={`${lobe} left-6 top-10 h-52 w-40 rotate-[28deg]`} animate={reduce ? undefined : { y: [0, -14, 0], rotate: [28, 34, 28] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className={`${lobe} left-24 top-28 h-44 w-44 -rotate-12`} animate={reduce ? undefined : { y: [0, 12, 0] }} transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className={`${lobe} -left-4 top-56 h-40 w-56`} animate={reduce ? undefined : { x: [0, 12, 0] }} transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }} />
    </motion.div>
  );
}

function Newsletter() {
  const [msg, setMsg] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // No newsletter backend is connected yet, so be upfront rather than pretending to subscribe.
        setMsg("Sign-ups aren't open yet. Check back soon.");
      }}
      className="mt-8 max-w-[15rem]"
    >
      <label className="flex items-center border-b border-white/80 pb-2">
        <span className="sr-only">Your email</span>
        <input type="email" required placeholder="Your Email" className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/85 focus:outline-none" />
        <button type="submit" aria-label="Subscribe" className="text-white transition-transform hover:translate-x-1">
          →
        </button>
      </label>
      {msg && (
        <p role="status" className="mt-2 text-xs text-white/85">
          {msg}
        </p>
      )}
    </form>
  );
}

export function SiteFooter() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  // 0 when the footer's top edge reaches the bottom of the viewport, 1 when its bottom edge does.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.6 });
  // Wordmark rises out of its crop as the footer arrives; the glow behind it drifts slower for depth.
  const wordY = useTransform(smooth, [0, 0.55], [reduce ? "0%" : "38%", "0%"]);
  const wordOpacity = useTransform(smooth, [0, 0.3], [reduce ? 1 : 0, 1]);
  const glowY = useTransform(smooth, [0, 1], [reduce ? 0 : -60, reduce ? 0 : 60]);
  const linksY = useTransform(smooth, [0.2, 1], [reduce ? 0 : 40, 0]);
  const socials = SOCIALS.filter((s) => s.href);
  return (
    <footer ref={ref} className={`mt-16 ${FONT}`}>
      <Marquee items={MARQUEE} />

      {/* Oversized wordmark: the container is 0.74em tall, which crops the letters ~20% up from their baseline */}
      <div className="relative overflow-hidden bg-white">
        <motion.div aria-hidden style={{ y: glowY }} className="pointer-events-none absolute left-1/2 top-0 h-[26rem] w-[70rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-sky-200/50 via-indigo-200/40 to-violet-100/40 blur-3xl" />
        <div className="relative mx-auto flex max-w-[92rem] justify-center px-4 pt-14">
          <div className="overflow-hidden" style={{ fontSize: "min(13.5vw, 12.5rem)", height: "0.74em" }}>
            <motion.p
              aria-label={SITE_NAME}
              style={{ y: wordY, opacity: wordOpacity }}
              className="animate-gradient-x select-none whitespace-nowrap bg-gradient-to-r from-[#9BE3FF] via-[#7B86D0] to-[#7B86D0] bg-[length:200%_auto] bg-clip-text pr-[0.08em] font-extrabold leading-none tracking-[-0.06em] text-transparent"
            >
              {SITE_NAME}
            </motion.p>
          </div>
        </div>
      </div>

      {/* Violet link area */}
      <div className="relative overflow-hidden bg-[#7B86D0] text-white">
        <Blobs progress={smooth} />
        <motion.div style={{ y: linksY }} className="relative mx-auto grid max-w-[92rem] gap-12 px-6 py-20 sm:px-10 lg:grid-cols-[1.1fr_1fr_1.3fr] lg:py-28">
          <div className="lg:pl-56">
            <p className="text-4xl font-bold tracking-[-0.04em]">
              {SITE_NAME}
              <sup className="text-base font-medium">®</sup>
            </p>
            <p className="mt-3 max-w-[15rem] text-[15px] leading-6 text-white/90">Non-custodial USDC payments, straight into your own wallet.</p>
          </div>

          <div>
            <p className="text-3xl font-medium tracking-[-0.04em]">Stay in the Loop</p>
            <p className="mt-1 text-sm text-white/85">Be first to know what&apos;s next</p>
            <Newsletter />
            {socials.length > 0 && (
              <div className="mt-12 flex gap-5">
                {socials.map((s) => (
                  <a key={s.name} href={s.href} target="_blank" rel="noreferrer" aria-label={s.name} className="text-white/90 transition hover:-translate-y-0.5 hover:text-white">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={s.d} />
                    </svg>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[15px]">
              {[COL_ONE, COL_TWO].map((col, ci) => (
                <ul key={ci} className="space-y-3">
                  {col.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href} className="group relative inline-block text-white/90 transition hover:text-white">
                        {l.label}
                        <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-white transition-transform duration-300 group-hover:scale-x-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
            <p className="mt-10 text-sm text-white/85">
              Copyright © {SITE_NAME} {new Date().getFullYear()}.
            </p>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
