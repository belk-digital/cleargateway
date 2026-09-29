"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/api", label: "API reference" },
  { href: "/blog", label: "Blog" },
];

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className="flex items-center gap-2 pl-2 pr-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#7FE8FF] via-[#5B8CF0] to-[#7A6BFF] shadow-md shadow-indigo-500/30">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-white/95" />
      </span>
      <span className="bg-gradient-to-r from-[#3F6FE8] to-[#7A6BFF] bg-clip-text text-[17px] font-bold tracking-[-0.03em] text-transparent">ClearGateway</span>
    </Link>
  );
}

/** Whether a nav item matches the current route. The API reference lives under /docs but has its own item. */
function isActive(href: string, path: string) {
  if (href === "/docs") return path.startsWith("/docs") && !path.startsWith("/docs/api");
  return path === href || path.startsWith(`${href}/`);
}

/**
 * Floating glassmorphism pill navigation for the public site. The wrapper is a zero-height sticky bar, so the pill
 * floats over the page without pushing content down. Collapses to logo + menu button below md.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const path = usePathname();
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-40 h-0 ${FONT}`}>
      <div className="pointer-events-none flex justify-center px-4 pt-4">
        <motion.div
          initial={{ y: reduce ? 0 : -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto w-full max-w-3xl"
        >
          <div
            className={`flex items-center gap-1 rounded-full border border-white/70 py-2 pl-2 pr-2 backdrop-blur-xl transition-all duration-500 ${
              scrolled ? "bg-white/70 shadow-[0_12px_40px_rgba(60,70,160,0.20)]" : "bg-white/45 shadow-[0_8px_30px_rgba(60,70,160,0.12)]"
            }`}
          >
            <Logo onClick={() => setOpen(false)} />

            <nav className="ml-4 hidden items-center md:flex" onMouseLeave={() => setHovered(null)}>
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onMouseEnter={() => setHovered(n.href)}
                  className={`relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${isActive(n.href, path) ? "text-[#3F4A9C]" : "text-[#5A6490] hover:text-[#3F4A9C]"}`}
                >
                  {hovered === n.href && <motion.span layoutId="nav-hover" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-full bg-white/80 shadow-sm" />}
                  <span className="relative">{n.label}</span>
                </Link>
              ))}
            </nav>

            <div className="ml-auto hidden items-center gap-1 md:flex">
              <Link href="/dashboard" className="rounded-full px-3.5 py-1.5 text-sm font-medium text-[#5A6490] transition hover:bg-white/70 hover:text-[#3F4A9C]">
                Merchant sign in
              </Link>
              <Link
                href="/docs/quickstart"
                className="rounded-full bg-gradient-to-r from-[#5B5BF0] to-[#7A6BFF] px-5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/40"
              >
                Get started
              </Link>
            </div>

            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#3F4A9C] transition hover:bg-white md:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
              </svg>
            </button>
          </div>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="mt-2 overflow-hidden rounded-3xl border border-white/70 bg-white/75 p-3 shadow-[0_16px_50px_rgba(60,70,160,0.22)] backdrop-blur-xl md:hidden"
              >
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] font-medium text-[#465078] transition hover:bg-white/80">
                    {n.label}
                  </Link>
                ))}
                <div className="mt-2 flex gap-2 border-t border-white/70 pt-3">
                  <Link href="/dashboard" onClick={() => setOpen(false)} className="flex-1 rounded-full border border-[#7B86D0]/40 px-4 py-2.5 text-center text-sm font-medium text-[#465078]">
                    Merchant sign in
                  </Link>
                  <Link href="/docs/quickstart" onClick={() => setOpen(false)} className="flex-1 rounded-full bg-gradient-to-r from-[#5B5BF0] to-[#7A6BFF] px-4 py-2.5 text-center text-sm font-semibold text-white">
                    Get started
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </header>
  );
}

export { SiteFooter } from "./SiteFooter";
