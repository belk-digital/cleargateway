"use client";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Animated line icons for the "Why ClearGateway" cards, in the same style as the "How it works" icons: the strokes
 * draw themselves when scrolled into view, then the icon floats over a softly pulsing glow.
 */

type Part = { d: string; fill?: "glass" | "white" };

const ICONS: Record<string, Part[]> = {
  // Shield with a padlock: we never hold the funds.
  shield: [
    { d: "M24 5L39 10.5V22C39 31 32.5 38.5 24 42C15.5 38.5 9 31 9 22V10.5Z", fill: "glass" },
    { d: "M19.5 22h9a2.5 2.5 0 012.500 2.500v6a2.500 2.500 0 01-2.500 2.500h-9a2.500 2.500 0 01-2.500-2.500v-6A2.500 2.500 0 0119.500 22z", fill: "white" },
    { d: "M20 22v-3.500a4 4 0 018 0V22" },
    { d: "M22.400 27.500a1.600 1.600 0 103.200 0a1.600 1.600 0 10-3.200 0M24 29v2.200" },
  ],
  // Three stacked layers with a confirmed tick: the chain is the source of truth.
  chain: [
    { d: "M24 6L40 13L24 20L8 13Z", fill: "glass" },
    { d: "M8 21L24 28L40 21" },
    { d: "M8 29L24 36L40 29" },
    { d: "M28 35a7 7 0 1014 0a7 7 0 10-14 0", fill: "white" },
    { d: "M31.800 35.200l2.400 2.400 4.200-4.600" },
  ],
  // Coin with a dollar sign: exact amounts.
  coin: [
    { d: "M6 24a18 18 0 1036 0a18 18 0 10-36 0", fill: "glass" },
    { d: "M10.500 24a13.500 13.500 0 1027 0a13.500 13.500 0 10-27 0" },
    { d: "M28.500 19.500c-.6-1.800-2.400-3-4.500-3-2.600 0-4.500 1.500-4.500 3.600 0 2.200 1.700 3 4.500 3.900 2.800.9 4.500 1.700 4.500 3.900 0 2.100-1.900 3.600-4.500 3.600-2.200 0-4-1.200-4.600-3" },
    { d: "M24 13.500v3M24 31.500v3" },
  ],
};

export type WhyIconKind = "shield" | "chain" | "coin";

export function WhyIcon({ kind }: { kind: WhyIconKind }) {
  const reduce = useReducedMotion();
  const gid = `why-grad-${kind}`;
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <motion.span
        aria-hidden
        className="absolute inset-3 rounded-full bg-gradient-to-br from-sky-200/50 via-blue-200/40 to-indigo-200/50 blur-2xl"
        animate={reduce ? undefined : { scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.svg
        width="96"
        height="96"
        viewBox="0 0 48 48"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="relative drop-shadow-[0_6px_14px_rgba(123,134,208,0.25)]"
        animate={reduce ? undefined : { y: [0, -6, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8FE0FF" />
            <stop offset="0.5" stopColor="#86A6EA" />
            <stop offset="1" stopColor="#7B86D0" />
          </linearGradient>
        </defs>
        {ICONS[kind]!.map((part, i) => (
          <motion.path
            key={i}
            d={part.d}
            stroke={`url(#${gid})`}
            fill={part.fill === "white" ? "#fff" : part.fill === "glass" ? `url(#${gid})` : "none"}
            fillOpacity={part.fill === "glass" ? 0.08 : 1}
            initial={{ pathLength: reduce ? 1 : 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: 0.2 + i * 0.25, duration: 1, ease: "easeOut" }}
          />
        ))}
      </motion.svg>
    </div>
  );
}
