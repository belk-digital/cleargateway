"use client";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Slow-drifting gradient blobs behind hero/CTA sections. Purely decorative: aria-hidden, pointer-events-none,
 * absolutely positioned inside a `relative` parent with `overflow-hidden`. Collapses to a static gradient when
 * the visitor prefers reduced motion.
 */
export function GradientBackdrop({ variant = "hero" }: { variant?: "hero" | "cta" }) {
  const reduce = useReducedMotion();
  const blobs =
    variant === "hero"
      ? [
          { className: "left-[-10%] top-[-10%] h-[420px] w-[420px] bg-blue-300/40", dx: 40, dy: 30, duration: 18 },
          { className: "right-[-15%] top-[10%] h-[380px] w-[380px] bg-indigo-300/30", dx: -30, dy: 40, duration: 22 },
          { className: "left-[20%] bottom-[-20%] h-[320px] w-[320px] bg-sky-200/40", dx: 25, dy: -25, duration: 20 },
        ]
      : [
          { className: "left-[10%] top-[-30%] h-[360px] w-[360px] bg-blue-300/30", dx: 30, dy: 20, duration: 20 },
          { className: "right-[5%] bottom-[-30%] h-[300px] w-[300px] bg-indigo-200/30", dx: -20, dy: -20, duration: 24 },
        ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full blur-3xl ${b.className}`}
          animate={reduce ? undefined : { x: [0, b.dx, 0], y: [0, b.dy, 0] }}
          transition={reduce ? undefined : { duration: b.duration, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
