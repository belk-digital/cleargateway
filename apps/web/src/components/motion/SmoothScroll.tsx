"use client";
import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Only the public marketing site scrolls smoothly; the dashboard, admin and checkout keep native scrolling. */
const isPublic = (path: string) => path === "/" || path === "/blog" || path.startsWith("/blog/") || path === "/docs" || path.startsWith("/docs/");

/** Lenis smooth scrolling. Skipped for visitors who prefer reduced motion. Renders nothing. */
export function SmoothScroll() {
  const path = usePathname();
  const enabled = isPublic(path);
  useEffect(() => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), anchors: true });
    let raf = requestAnimationFrame(function tick(time) {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [enabled]);
  return null;
}
