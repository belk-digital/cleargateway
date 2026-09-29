"use client";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/Motion";

/**
 * "Platform features": a bento of nine cards, each with a small native mock-up of the feature (white UI panels on a
 * soft tint) above its title and description. Figures inside the mock-ups are illustrative, not live data.
 */

const EASE = [0.16, 1, 0.3, 1] as const;
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const PANEL = "rounded-xl border border-slate-200/80 bg-white shadow-[0_6px_20px_rgba(40,60,140,0.07)]";

function Ico({ d, size = 16, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className}>
      <path d={d} />
    </svg>
  );
}

/** Fades/slides an element in when its card scrolls into view, after `delay` seconds. */
function In({ children, delay = 0, className = "", x = 0, y = 10 }: { children: ReactNode; delay?: number; className?: string; x?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, x: reduce ? 0 : x, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay, duration: 0.6, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}


/** Steps through 0..length-1 every `ms`. Stays at 0 (static) when the visitor prefers reduced motion. */
function useCycle(length: number, ms: number) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % length), ms);
    return () => clearInterval(t);
  }, [reduce, length, ms]);
  return i;
}

/** Counts up to `to` the first time it scrolls into view. */
function CountUp({ to, className }: { to: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!seen || reduce) return;
    const c = animate(0, to, { duration: 1.8, ease: "easeOut", onUpdate: (n) => setV(Math.round(n)) });
    return () => c.stop();
  }, [seen, reduce, to]);
  return (
    <span ref={ref} className={className}>
      {v.toLocaleString("en-US")}
    </span>
  );
}


/**
 * Renders a mock-up at its natural width and scales it down (never up) to fit its card, so the illustrations stay
 * intact on phones instead of overflowing. `h` is the mock-up's design height in px.
 */
function Fit({ h, children }: { h: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const next = i.scrollWidth > o.clientWidth ? o.clientWidth / i.scrollWidth : 1;
      setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="w-full overflow-hidden" style={{ height: h * scale }}>
      <div ref={inner} style={{ width: "max-content", minWidth: "100%", height: h, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/* ---------- 1. Hosted checkout ---------- */

function Qr() {
  // Deterministic pseudo-random modules plus three finder squares: decorative, not a scannable code.
  const n = 21;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
  const cells: ReactNode[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (finder(x, y)) continue;
      if (rnd() > 0.52) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  const eye = (x: number, y: number) => (
    <g key={`e${x}${y}`}>
      <rect x={x} y={y} width="7" height="7" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="white" />
      <rect x={x + 2} y={y + 2} width="3" height="3" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="h-24 w-24" fill="#0B1440" shapeRendering="crispEdges">
      {cells}
      {eye(0, 0)}
      {eye(n - 7, 0)}
      {eye(0, n - 7)}
    </svg>
  );
}

function CheckoutArt() {
  const reduce = useReducedMotion();
  const sel = useCycle(2, 2600);
  const stage = useCycle(3, 1800);
  const paid = stage === 2;
  const rows = [
    { label: "Connect Wallet", d: "M4 7a2 2 0 012-2h11v4M4 7v10a2 2 0 002 2h13V9H6a2 2 0 01-2-2z" },
    { label: "Exchange Transfer", d: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" },
    { label: "Card", d: "M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18", soon: true },
  ];
  return (
    <div className="relative flex h-full items-center justify-center gap-5">
      <In className={`${PANEL} w-[13.5rem] p-4`} x={-16}>
        <p className="text-sm font-semibold text-slate-900">Pay with Crypto</p>
        <p className="text-[10px] text-slate-400">Complete your payment securely</p>
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => {
            const on = !r.soon && i === sel;
            return (
              <div key={r.label} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] transition-all duration-500 ${on ? "translate-x-1 border-indigo-300 bg-indigo-50/60 font-medium text-slate-900 shadow-md shadow-indigo-500/10" : "border-slate-200 text-slate-600"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded transition-colors duration-500 ${on ? "bg-indigo-500 text-white" : "text-slate-400"}`}>
                  <Ico d={r.d} size={12} />
                </span>
                {r.label}
                {r.soon ? <span className="ml-auto text-[9px] text-slate-400">Coming Soon</span> : <Ico d="M9 6l6 6-6 6" size={12} className={`ml-auto transition-transform duration-500 ${on ? "translate-x-0.5 text-indigo-500" : "text-slate-400"}`} />}
              </div>
            );
          })}
        </div>
      </In>
      <span aria-hidden className="relative hidden h-px w-6 border-t border-dashed border-indigo-300 sm:block">
        {!reduce && <motion.span className="absolute -top-[3px] h-1.5 w-1.5 rounded-full bg-indigo-500" animate={{ x: [0, 20], opacity: [0, 1, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />}
      </span>
      <In className={`${PANEL} hidden w-[10.5rem] p-3 text-center sm:block`} x={16} delay={0.15}>
        <p className="text-[10px] text-slate-500">Acme Store</p>
        <p className="text-sm font-bold text-slate-900">Pay $125.00</p>
        <div className="relative mx-auto mt-2 h-24 w-24">
          <Qr />
          {!reduce && (
            <motion.span
              aria-hidden
              className="absolute inset-x-0 h-0.5 rounded bg-indigo-500/80 shadow-[0_0_8px_rgba(99,102,241,0.9)]"
              animate={{ top: ["2%", "96%", "2%"] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>
        <p className="mt-2 rounded-md bg-slate-50 py-1 text-[10px] text-slate-600">USDC (Base)</p>
        <motion.p
          key={paid ? "paid" : "wait"}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`mt-2 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-medium ${paid ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50/70 text-indigo-600"}`}
        >
          {paid ? (
            <>
              <Ico d="M5 12.5l4.5 4.5L19 7.5" size={11} /> Payment received
            </>
          ) : (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
              </span>
              Waiting for payment…
            </>
          )}
        </motion.p>
      </In>
    </div>
  );
}

/* ---------- 2. REST API + idempotency ---------- */

const SAMPLES = {
  cURL: `curl https://api.example.com/v1/payment_intents \\
  -X POST \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": "125000000",
       "merchant_order_id": "order-1042"}'`,
  JavaScript: `await fetch("https://api.example.com/v1/payment_intents", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk_test_...",
    "Idempotency-Key": "order-1042",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ amount: "125000000" }),
});`,
  Python: `requests.post(
  "https://api.example.com/v1/payment_intents",
  headers={
    "Authorization": "Bearer sk_test_...",
    "Idempotency-Key": "order-1042",
  },
  json={"amount": "125000000"},
)`,
} as const;

function ApiArt() {
  const [tab, setTab] = useState<keyof typeof SAMPLES>("cURL");
  const [copied, setCopied] = useState(false);
  const endpoints = [
    ["POST", "Create payment", "201 Created"],
    ["GET", "Get payment", "200 OK"],
    ["POST", "Create refund", "201 Created"],
    ["GET", "Get balance", "200 OK"],
    ["POST", "Add webhook endpoint", "201 Created"],
  ] as const;
  const sel = useCycle(endpoints.length, 2400);
  return (
    <div className="flex h-full items-center gap-3">
      <In className={`${PANEL} hidden w-[45%] shrink-0 space-y-1 p-2.5 sm:block`} x={-16}>
        {endpoints.map(([m, l], i) => (
          <div key={l} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-all duration-500 ${i === sel ? "translate-x-1 bg-indigo-50 text-slate-900 shadow-sm" : "text-slate-600"}`}>
            <span className={`w-9 rounded px-1 py-0.5 text-center text-[9px] font-bold ${m === "POST" ? "bg-indigo-100 text-indigo-600" : "bg-emerald-100 text-emerald-600"}`}>{m}</span>
            {l}
          </div>
        ))}
      </In>
      <In className="relative min-w-0 flex-1 rounded-xl bg-[#0F1A3C] p-3 shadow-[0_10px_30px_rgba(15,26,60,0.3)]" x={16} delay={0.15}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
            {(Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${tab === t ? "bg-white text-slate-900" : "text-slate-300 hover:text-white"}`}>
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Copy code"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(SAMPLES[tab]);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable */
              }
            }}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            {copied ? <Ico d="M5 12.5l4.5 4.5L19 7.5" size={13} /> : <Ico d="M9 9h10v10H9zM5 15V5h10" size={13} />}
          </button>
        </div>
        <motion.pre key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="overflow-hidden text-[9.5px] leading-[1.55] text-sky-100/90">
          <code>{SAMPLES[tab]}</code>
          <span aria-hidden className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-sky-200/80 align-middle" />
        </motion.pre>
        <motion.span key={sel} initial={{ opacity: 0, scale: 0.7, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="absolute bottom-2 right-3 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-300">
          {endpoints[sel]?.[2]}
        </motion.span>
      </In>
    </div>
  );
}

/* ---------- 3. Signed webhooks ---------- */

function WebhooksArt() {
  const reduce = useReducedMotion();
  const rows = [
    { label: "POST", note: "200 OK", ok: true },
    { label: "Retry (1m)" },
    { label: "Retry (10m)" },
    { label: "Retry (1h)" },
  ];
  const step = useCycle(rows.length + 1, 1100); // 0 = origin fires, 1..n = each delivery lights up in turn
  return (
    <div className="flex h-full items-center justify-center gap-0">
      <In x={-14}>
        <motion.div
          animate={step === 0 && !reduce ? { scale: [1, 1.06, 1] } : { scale: 1 }}
          transition={{ duration: 0.5 }}
          className={`${PANEL} flex items-center gap-2 px-3 py-2.5 text-[11px] font-medium text-slate-800`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-100 text-indigo-600">
            <Ico d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" size={13} />
          </span>
          Payment created
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Ico d="M5 12.5l4.5 4.5L19 7.5" size={10} />
          </span>
        </motion.div>
      </In>
      <svg width="34" height="152" viewBox="0 0 34 152" fill="none" stroke="#818CF8" strokeWidth="1.2" strokeDasharray="3 3" className="shrink-0">
        <path d="M0 76H12M12 16V136M12 16H34M12 56H34M12 96H34M12 136H34" />
      </svg>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const on = step === i + 1;
          return (
            <In key={r.label} delay={0.2 + i * 0.15} x={10} y={0}>
              <div className={`${PANEL} flex h-8 w-[8.5rem] items-center gap-2 px-2.5 text-[11px] text-slate-700 transition-all duration-500 ${on ? "translate-x-1 !border-indigo-300 !shadow-indigo-500/20" : ""}`}>
                {r.ok ? <span className={`h-3 w-3 rounded-full border-[3px] border-indigo-500 ${on ? "animate-pulse" : ""}`} /> : <Ico d="M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" size={13} className={on ? "animate-spin text-indigo-500 [animation-duration:2s]" : "text-slate-400"} />}
                {r.label}
                {r.note && <span className="ml-auto rounded bg-emerald-50 px-1 text-[9px] font-medium text-emerald-600">{r.note}</span>}
              </div>
            </In>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 4. Merchant dashboard ---------- */

function DashboardArt() {
  const reduce = useReducedMotion();
  const sel = useCycle(5, 2200);
  const nav: [string, string][] = [
    ["Overview", "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z"],
    ["Payments", "M5 4h14v16H5zM9 9h6M9 13h6"],
    ["Balances", "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8M9.5 10.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4"],
    ["Payment Links", "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"],
    ["Webhooks", "M7 8l-4 4 4 4M17 8l4 4-4 4M14 5l-4 14"],
  ];
  const bars = [10, 16, 12, 22, 18, 28, 24, 34, 30, 40];
  return (
    <div className="flex h-full items-center gap-3">
      <In className={`${PANEL} hidden w-[38%] shrink-0 space-y-0.5 p-2 sm:block`} x={-12}>
        {nav.map(([l, d], i) => (
          <div key={l} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10.5px] transition-all duration-500 ${i === sel ? "translate-x-0.5 bg-indigo-50 font-medium text-indigo-600" : "text-slate-500"}`}>
            <Ico d={d} size={12} />
            {l}
          </div>
        ))}
      </In>
      <In className={`${PANEL} min-w-0 flex-1 p-3`} x={12} delay={0.12}>
        <p className="text-[10px] text-slate-500">Total payments</p>
        <p className="flex items-baseline gap-2 text-2xl font-bold text-slate-900">
          <CountUp to={2957} /> <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600">↗ 12%</span>
        </p>
        <div className="relative">
          <svg viewBox="0 0 200 60" className="mt-1 w-full overflow-visible" fill="none">
            {bars.map((h, i) => (
              <motion.rect
                key={i}
                x={6 + i * 19}
                y={60 - h}
                width="7"
                height={h}
                rx="2"
                fill="#E0E7FF"
                style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
                initial={{ scaleY: reduce ? 1 : 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.07, duration: 0.6, ease: EASE }}
              />
            ))}
            <motion.path
              d="M4 48 C24 44 34 50 52 38 S84 42 100 30 S140 34 156 24 S186 12 198 8"
              stroke="#5B5BF0"
              strokeWidth="2"
              strokeLinecap="round"
              initial={{ pathLength: reduce ? 1 : 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5, duration: 1.4, ease: "easeOut" }}
            />
            <motion.circle cx="156" cy="24" fill="white" stroke="#5B5BF0" strokeWidth="2" animate={reduce ? { r: 3 } : { r: [3, 4.5, 3] }} transition={{ duration: 2, repeat: Infinity }} />
          </svg>
          <motion.span
            initial={{ opacity: 0, scale: 0.6, y: 6 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 1.9, type: "spring", stiffness: 300, damping: 18 }}
            className="absolute left-[64%] top-[-14px] rounded bg-[#0F1A3C] px-1.5 py-0.5 text-[9px] font-semibold text-white"
          >
            $4,280
          </motion.span>
        </div>
      </In>
    </div>
  );
}

/* ---------- 5. Two-factor staff accounts ---------- */

function TwoFactorArt() {
  const reduce = useReducedMotion();
  const n = useCycle(10, 420); // types "123 456" one character at a time, then holds while verified
  const code = "123 456".slice(0, Math.min(n, 7));
  const verified = n >= 7;
  return (
    <div className="flex h-full items-center justify-center gap-3">
      <div className="space-y-2">
        <In className={`${PANEL} flex w-36 items-center gap-2 px-2.5 py-2.5 text-[11px] text-slate-400`} x={-12}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
            <Ico d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" size={11} />
          </span>
          • • • • • • •
        </In>
        <In delay={0.15} x={-12}>
          <div className={`${PANEL} flex w-36 items-center gap-2 px-2.5 py-2.5 text-[11px] font-medium text-slate-700 transition-colors duration-500 ${verified ? "!border-emerald-300" : ""}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors duration-500 ${verified ? "bg-emerald-100 text-emerald-600" : "bg-indigo-100 text-indigo-600"}`}>
              <Ico d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" size={11} />
            </span>
            <span className="tabular-nums tracking-wider">
              {code}
              {!verified && <span aria-hidden className="ml-px inline-block h-3 w-px animate-pulse bg-indigo-500 align-middle" />}
            </span>
          </div>
        </In>
      </div>
      <span aria-hidden className="relative h-px w-6 border-t border-dashed border-indigo-300">
        {!reduce && <motion.span className="absolute -top-[3px] h-1.5 w-1.5 rounded-full bg-indigo-500" animate={{ x: [0, 20], opacity: [0, 1, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />}
      </span>
      <div className="relative flex h-28 w-28 items-center justify-center">
        {!reduce &&
          [0, 1].map((k) => (
            <motion.span key={k} aria-hidden className="absolute inset-2 rounded-full border border-indigo-300" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 2.6, repeat: Infinity, delay: k * 1.3, ease: "easeOut" }} />
          ))}
        <span aria-hidden className="absolute inset-0 rounded-full border border-indigo-200 bg-indigo-50/60" />
        <motion.span
          animate={verified && !reduce ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={{ duration: 0.5 }}
          className={`relative flex h-16 w-10 items-center justify-center rounded-lg border-[3px] bg-white shadow-lg transition-colors duration-500 ${verified ? "border-emerald-500 text-emerald-500 shadow-emerald-500/20" : "border-indigo-600 text-indigo-600 shadow-indigo-500/20"}`}
        >
          <Ico d={verified ? "M5 12.5l4.5 4.5L19 7.5" : "M12 4l6 2.5v5c0 3.5-2.5 6-6 7.5-3.5-1.5-6-4-6-7.5v-5L12 4z"} size={20} />
        </motion.span>
      </div>
    </div>
  );
}

/* ---------- 6. Refund requests ---------- */

function RefundArt() {
  const a = useCycle(5, 1200); // 0..2 = each stage in turn, 3..4 = everything done, then restart
  const steps = [
    { t: "Refund request", s: "$125.00", d: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3", tone: "bg-indigo-100 text-indigo-600" },
    { t: "Under review", s: "Staff review and approve", d: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z", tone: "bg-indigo-50 text-indigo-600" },
    { t: "Approved", s: "Refund sent", d: "M5 12.5l4.5 4.5L19 7.5", tone: "bg-emerald-500 text-white" },
  ];
  return (
    <div className="flex h-full items-center justify-center gap-1.5">
      {steps.map((s, i) => {
        const reached = i <= a;
        const current = i === a;
        return (
          <div key={s.t} className="flex items-center gap-1.5">
            <In delay={i * 0.2} y={8}>
              <div className={`${PANEL} flex w-[7.2rem] items-start gap-1.5 p-2 transition-all duration-500 ${reached ? "opacity-100" : "opacity-40"} ${current ? "-translate-y-1 !border-indigo-300 !shadow-indigo-500/20" : ""}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.tone} ${i === 1 && current ? "animate-pulse" : ""}`}>
                  <Ico d={s.d} size={12} />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold leading-tight text-slate-800">{s.t}</span>
                  <span className="block text-[9px] leading-tight text-slate-400">{s.s}</span>
                </span>
              </div>
            </In>
            {i < steps.length - 1 && <Ico d="M5 12h14M13 6l6 6-6 6" size={12} className={`shrink-0 transition-all duration-500 ${a > i ? "translate-x-0.5 text-indigo-500" : "text-indigo-200"}`} />}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 7. Review queue ---------- */

function ReviewArt() {
  const a = useCycle(3, 1600);
  const rows = [
    { amt: "0.95 USDC", tag: "Underpaid", tone: "bg-red-50 text-red-500", d: "M12 5v14M6 13l6 6 6-6", ic: "text-red-500" },
    { amt: "210.00 USDC", tag: "Overpaid", tone: "bg-orange-50 text-orange-500", d: "M12 19V5M6 11l6-6 6 6", ic: "text-emerald-500" },
    { amt: "125.00 USDC", tag: "Late", tone: "bg-red-50 text-red-500", d: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z", ic: "text-slate-400" },
  ];
  return (
    <div className="flex h-full items-center">
      <div className={`${PANEL} w-full divide-y divide-slate-100 overflow-hidden`}>
        {rows.map((r, i) => (
          <In key={r.amt} delay={i * 0.15} y={6} className={`flex items-center gap-3 px-3 py-2.5 text-[11px] text-slate-700 transition-colors duration-500 ${i === a ? "bg-indigo-50/60" : ""}`}>
            <Ico d={r.d} size={14} className={r.ic} />
            <span className="w-20 shrink-0">{r.amt}</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${r.tone}`}>{r.tag}</span>
            <span className={`ml-auto rounded px-2.5 py-1 text-[10px] font-medium transition-all duration-500 ${i === a ? "scale-110 bg-indigo-500 text-white shadow-md shadow-indigo-500/30" : "bg-indigo-50 text-indigo-600"}`}>Review</span>
          </In>
        ))}
      </div>
    </div>
  );
}

/* ---------- 8. Reconciliation ---------- */

function ReconciliationArt() {
  const reduce = useReducedMotion();
  const Side = ({ title, icon, delay, x }: { title: string; icon: string; delay: number; x: number }) => (
    <In delay={delay} x={x} className={`${PANEL} w-[7.6rem] p-2.5`}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-800">
        <Ico d={icon} size={12} className="text-indigo-500" />
        {title}
      </p>
      {[
        ["2,957", "Payments"],
        ["$128,430", "Volume"],
        ["0", "Mismatches"],
      ].map(([v, l]) => (
        <p key={l} className="flex justify-between py-0.5 text-[10px]">
          <span className="font-semibold text-slate-800">{v}</span>
          <span className="text-slate-400">{l}</span>
        </p>
      ))}
    </In>
  );
  return (
    <div className="flex h-full items-center justify-center gap-1">
      <Side title="Our records" icon="M5 4h14v16H5zM9 9h6M9 13h6" delay={0} x={-12} />
      <div className="relative flex w-14 items-center justify-center">
        <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-indigo-300" />
        {!reduce && (
          <>
            <motion.span aria-hidden className="absolute left-0 top-1/2 -mt-[3px] h-1.5 w-1.5 rounded-full bg-indigo-500" animate={{ x: [0, 50], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
            <motion.span aria-hidden className="absolute right-0 top-1/2 -mt-[3px] h-1.5 w-1.5 rounded-full bg-sky-400" animate={{ x: [0, -50], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.9 }} />
          </>
        )}
        <motion.span
          className="relative flex h-8 w-8 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 shadow-md"
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        >
          <Ico d="M4 9h14l-4-4M20 15H6l4 4" size={15} />
        </motion.span>
        {!reduce && (
          <motion.span
            aria-hidden
            className="absolute -bottom-6 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"
            animate={{ scale: [0, 1, 1, 0], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 3.6, repeat: Infinity, times: [0, 0.2, 0.8, 1] }}
          >
            <Ico d="M5 12.5l4.5 4.5L19 7.5" size={11} />
          </motion.span>
        )}
      </div>
      <Side title="On-chain data" icon="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5" delay={0.15} x={12} />
    </div>
  );
}

/* ---------- 9. Generated API reference ---------- */

function ApiRefArt() {
  const [manual, setManual] = useState<"Request" | "Response" | null>(null);
  const auto = useCycle(2, 3200);
  const tab = manual ?? (auto === 0 ? "Request" : "Response");
  const sel = useCycle(3, 2000);
  const nav: [string, string, boolean?][] = [
    ["Introduction", "M12 4v16M4 12h16"],
    ["API Reference", "M7 8l-4 4 4 4M17 8l4 4-4 4", true],
    ["Webhooks", "M13 3L5 14h6l-1 7 8-11h-6l1-7z"],
    ["Errors", "M5 4h14v16H5zM9 9h6M9 13h6"],
  ];
  const routes: [string, string, string][] = [
    ["GET", "/v1/payment_intents/{id}", "Get a payment"],
    ["POST", "/v1/payment_intents", "Create a payment"],
    ["GET", "/v1/balance", "Get balance"],
  ];
  return (
    <div className="flex h-full min-w-0 items-center gap-3">
      <In className="hidden w-32 shrink-0 space-y-0.5 md:block" x={-12}>
        {nav.map(([l, d, on]) => (
          <div key={l} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10.5px] ${on ? "bg-indigo-50 font-medium text-indigo-600" : "text-slate-500"}`}>
            <Ico d={d} size={12} />
            {l}
          </div>
        ))}
      </In>
      <In delay={0.1} className={`${PANEL} hidden min-w-0 flex-1 divide-y divide-slate-100 overflow-hidden lg:block`}>
        {routes.map(([m, p, t], i) => (
          <div key={p} className={`flex items-center gap-3 px-3 py-2 text-[10.5px] transition-colors duration-500 ${i === sel ? "bg-indigo-50/70" : ""}`}>
            <span className={`w-10 rounded px-1 py-0.5 text-center text-[9px] font-bold ${m === "POST" ? "bg-indigo-100 text-indigo-600" : "bg-emerald-100 text-emerald-600"}`}>{m}</span>
            <span className="truncate font-mono text-slate-700">{p}</span>
            <span className="ml-auto hidden shrink-0 text-slate-400 xl:block">{t}</span>
          </div>
        ))}
      </In>
      <In delay={0.2} className={`${PANEL} min-w-0 flex-1 p-2.5`} x={12}>
        <div className="mb-2 flex gap-1">
          {(["Request", "Response"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setManual(t)} className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${tab === t ? "bg-[#0F1A3C] text-white" : "bg-slate-100 text-slate-500 hover:text-slate-800"}`}>
              {t}
            </button>
          ))}
        </div>
        <motion.pre key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="overflow-hidden text-[9.5px] leading-[1.6] text-slate-700">
          <code>
            {tab === "Request"
              ? `curl https://api.example.com/v1/balance\n  -H "Authorization: Bearer sk_test_..."`
              : `{ "object": "balance",\n  "currency": "USDC" }`}
          </code>
        </motion.pre>
      </In>
    </div>
  );
}

/* ---------- Layout ---------- */

type Feature = { title: string; body: string; art: ReactNode; span: string; tall?: boolean };

const FEATURES: Feature[] = [
  { title: "Hosted checkout", body: "A ready-made payment page for wallet, exchange-transfer or (soon) card, branded with your business name.", art: <CheckoutArt />, span: "lg:col-span-3", tall: true },
  { title: "REST API + idempotency", body: "A small, documented API. Every money-moving call takes an Idempotency-Key, so retries can never double-charge.", art: <ApiArt />, span: "lg:col-span-3", tall: true },
  { title: "Signed webhooks", body: "HMAC-signed events for every status change, delivered with automatic retries over roughly 3½ days.", art: <WebhooksArt />, span: "lg:col-span-2" },
  { title: "Merchant dashboard", body: "Payments, balances, payment links and webhooks in one place, with owner/admin/developer/viewer roles for your team.", art: <DashboardArt />, span: "lg:col-span-2" },
  { title: "Two-factor staff accounts", body: "Every sign-in — merchant and staff — is a real password account, not a shared secret. Staff also require an authenticator app.", art: <TwoFactorArt />, span: "lg:col-span-2" },
  { title: "Refund requests", body: "Merchants request refunds through the API or dashboard; staff review and approve them, with a full audit trail.", art: <RefundArt />, span: "lg:col-span-2" },
  { title: "Review queue", body: "Late, over- or under-paid transfers are never dropped silently — they're flagged for a human to resolve.", art: <ReviewArt />, span: "lg:col-span-2" },
  { title: "Reconciliation", body: "A standing job compares our records against the chain and reports any mismatch. It only reports — it never silently fixes.", art: <ReconciliationArt />, span: "lg:col-span-2" },
];

const CARD = "group flex h-full flex-col rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_10px_40px_rgba(30,50,120,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_50px_rgba(30,50,120,0.12)]";

export function PlatformFeatures() {
  return (
    <section id="features" className="relative overflow-hidden py-24">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-72 w-[52rem] -translate-x-1/2 rounded-full bg-indigo-100/50 blur-3xl" />
      <div className="relative mx-auto max-w-[88rem] px-4 sm:px-8">
        <Reveal className="mx-auto mb-14 max-w-3xl text-center [font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#7B86D0]">Platform</p>
          <h2 className="mt-4 text-4xl font-medium leading-[1.2] tracking-[-0.04em] text-[#465078] sm:text-6xl">
            Platform <span className="text-[#7B86D0]">features</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-[#5A6490] sm:text-xl">Everything a merchant and their team need day to day.</p>
        </Reveal>

        <StaggerGroup className="grid gap-5 lg:grid-cols-6" gap={0.07}>
          {FEATURES.map((f) => (
            <StaggerItem key={f.title} className={`min-w-0 ${f.span}`}>
              <div className={CARD}>
                <div className="rounded-xl bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/60 p-3 transition-transform duration-500 ease-out group-hover:scale-[1.02]">
                  <Fit h={f.tall ? 216 : 184}>{f.art}</Fit>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-[#0B1440]">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-6 text-slate-500">{f.body}</p>
              </div>
            </StaggerItem>
          ))}
          <StaggerItem className="min-w-0 lg:col-span-6">
            <div className={`${CARD} lg:!flex-row lg:items-center lg:gap-8`}>
              <div className="min-w-0 rounded-xl bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/60 p-3 lg:w-[62%]">
                <Fit h={184}>
                  <ApiRefArt />
                </Fit>
              </div>
              <div className="mt-5 lg:mt-0 lg:flex-1">
                <h3 className="text-xl font-semibold tracking-tight text-[#0B1440]">Generated API reference</h3>
                <p className="mt-2 text-[15px] leading-6 text-slate-500">The docs on this site are generated from the API&apos;s own route definitions, so they can&apos;t drift out of sync with what it accepts.</p>
              </div>
            </div>
          </StaggerItem>
        </StaggerGroup>
      </div>
    </section>
  );
}
