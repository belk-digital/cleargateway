"use client";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useScroll, useSpring, type Variants } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Animation primitives for the public site (landing, docs, blog). All respect prefers-reduced-motion by
 * collapsing to an instant, non-animated render, and all trigger once as the element scrolls into view so
 * nothing above the fold waits on a mount animation.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

function useVariants(distance: number): Variants {
  const reduce = useReducedMotion();
  return {
    hidden: { opacity: 0, y: reduce ? 0 : distance },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.6, ease: EASE } },
  };
}

export function Reveal({ children, delay = 0, distance = 24, className }: { children: ReactNode; delay?: number; distance?: number; className?: string }) {
  const variants = useVariants(distance);
  return (
    <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }} variants={variants} transition={{ delay }} className={className}>
      {children}
    </motion.div>
  );
}

/** Wrap a list of children; each direct child should be a <Stagger.Item>. Children reveal in sequence as the group scrolls into view. */
export function StaggerGroup({ children, className, gap = 0.08 }: { children: ReactNode; className?: string; gap?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : gap } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, distance = 18 }: { children: ReactNode; className?: string; distance?: number }) {
  const variants = useVariants(distance);
  return (
    <motion.div variants={variants} className={className}>
      {children}
    </motion.div>
  );
}

/** A card/link that lifts slightly on hover. */
export function HoverLift({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div whileHover={reduce ? undefined : { y: -4 }} transition={{ duration: 0.2, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * A card with a soft brand-coloured glow that follows the cursor (pattern from 21st.dev's cursor-glow hero,
 * applied per card). Pass `href` to make the whole card a link. Falls back to a plain card on touch / reduced motion.
 */
export function SpotlightCard({ children, className = "", href }: { children: ReactNode; className?: string; href?: string }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(-300);
  const y = useMotionValue(-300);
  const glow = useMotionTemplate`radial-gradient(320px circle at ${x}px ${y}px, rgba(0,82,255,0.10), transparent 70%)`;
  const inner = (
    <>
      {!reduce && <motion.div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100" style={{ background: glow }} />}
      <div className="relative h-full">{children}</div>
    </>
  );
  const cls = `group/spot relative block overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/10 ${className}`;
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - r.left);
    y.set(e.clientY - r.top);
  };
  return href ? (
    <Link href={href} onMouseMove={onMove} className={`${cls} !no-underline`}>
      {inner}
    </Link>
  ) : (
    <div onMouseMove={onMove} className={cls}>
      {inner}
    </div>
  );
}

/** Thin brand-coloured reading-progress bar pinned under the sticky header. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 24, restDelta: 0.001 });
  return <motion.div aria-hidden style={{ scaleX }} className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-brand-gradient" />;
}

/** A line that draws itself left-to-right when scrolled into view. */
export function DrawLine({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      initial={{ scaleX: reduce ? 1 : 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 1.2, ease: EASE }}
      className={`origin-left ${className ?? ""}`}
    />
  );
}

/** Fades page content in on every navigation. Used from template.tsx files so docs/blog pages transition smoothly. */
export function PageFade({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}>
      {children}
    </motion.div>
  );
}
