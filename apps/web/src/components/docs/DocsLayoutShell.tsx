"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageBackdrop } from "@/components/PageBackdrop";

const NAV: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/testing", label: "Testing" },
    ],
  },
  {
    title: "Guides",
    items: [
      { href: "/docs/payments", label: "Payments" },
      { href: "/docs/checkout", label: "Hosted checkout" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/refunds", label: "Refunds" },
      { href: "/docs/dashboard", label: "Dashboard & team" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/api", label: "API reference" },
      { href: "/docs/errors", label: "Errors, limits & idempotency" },
    ],
  },
];

const FLAT = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";
const GLASS = "border border-white/70 bg-white/60 shadow-[0_16px_50px_rgba(60,70,160,0.10)] backdrop-blur-xl";

const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Right-hand outline built from the page's h2 headings, with the section in view highlighted. */
function OnThisPage({ contentRef, path }: { contentRef: React.RefObject<HTMLDivElement | null>; path: string }) {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const [active, setActive] = useState("");
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let io: IntersectionObserver | undefined;
    const raf = requestAnimationFrame(() => {
      const heads = Array.from(root.querySelectorAll("h2"));
      heads.forEach((h) => {
        if (!h.id) h.id = slug(h.textContent ?? "");
      });
      setItems(heads.map((h) => ({ id: h.id, text: h.textContent ?? "" })));
      io = new IntersectionObserver(
        (entries) => {
          const hit = entries.find((e) => e.isIntersecting);
          if (hit) setActive(hit.target.id);
        },
        { rootMargin: "-15% 0px -70% 0px" },
      );
      heads.forEach((h) => io?.observe(h));
    });
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [contentRef, path]);

  if (items.length < 2) return null;
  return (
    <aside className="hidden w-52 shrink-0 xl:block">
      <div className="sticky top-28">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#7B86D0]">On this page</p>
        <ul className="space-y-1 border-l border-[#D9E0F7] text-sm">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                className={`-ml-px block border-l-2 py-1 pl-3 leading-5 transition-colors ${active === it.id ? "border-[#5B5BF0] font-medium text-[#3F4A9C]" : "border-transparent text-[#6A7397] hover:text-[#3F4A9C]"}`}
              >
                {it.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

export function DocsLayoutShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const idx = FLAT.findIndex((n) => n.href === path);
  const current = FLAT[idx];
  const prev = idx > 0 ? FLAT[idx - 1] : undefined;
  const next = idx >= 0 ? FLAT[idx + 1] : undefined;

  useEffect(() => setMenuOpen(false), [path]);

  return (
    <div className={`relative ${FONT}`}>
      <PageBackdrop />
      <div className="mx-auto flex max-w-[88rem] gap-8 px-4 pb-16 pt-28 sm:px-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <nav className={`sticky top-28 max-h-[calc(100vh-8rem)] space-y-6 overflow-y-auto rounded-3xl p-5 text-sm ${GLASS}`}>
            {NAV.map((g) => (
              <div key={g.title}>
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#7B86D0]">{g.title}</p>
                <ul className="space-y-1">
                  {g.items.map((n) => {
                    const on = path === n.href;
                    return (
                      <li key={n.href}>
                        <Link href={n.href} className={`relative block rounded-xl px-3 py-2 font-medium transition-colors ${on ? "text-[#3F4A9C]" : "text-[#5A6490] hover:bg-white/70 hover:text-[#3F4A9C]"}`}>
                          {on && <motion.span layoutId="docs-nav-active" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#7B86D0]/20 to-[#7A6BFF]/10 ring-1 ring-[#7B86D0]/30" />}
                          <span className="relative">{n.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Menu (mobile / tablet) */}
          <div className="mb-5 lg:hidden">
            <button
              type="button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium text-[#465078] ${GLASS}`}
            >
              <span className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h10" />
                </svg>
                {current?.label ?? "Documentation"}
              </span>
              <motion.svg animate={{ rotate: menuOpen ? 180 : 0 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </motion.svg>
            </button>
            <AnimatePresence initial={false}>
              {menuOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                  <div className={`mt-2 space-y-4 rounded-2xl p-4 ${GLASS}`}>
                    {NAV.map((g) => (
                      <div key={g.title}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#7B86D0]">{g.title}</p>
                        {g.items.map((n) => (
                          <Link key={n.href} href={n.href} className={`block rounded-lg px-2 py-2 text-sm ${path === n.href ? "bg-[#7B86D0]/15 font-medium text-[#3F4A9C]" : "text-[#5A6490]"}`}>
                            {n.label}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <article className={`rounded-3xl p-5 sm:p-10 ${GLASS} !bg-white/70`}>
            {current && <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-[#7B86D0]">{current.group}</p>}
            <div
              ref={contentRef}
              className="space-y-4 text-[15px] leading-7 text-[#4A5578] sm:text-base sm:leading-8 [&_a]:font-medium [&_a]:text-[#5B5BF0] [&_a]:underline [&_a]:decoration-[#5B5BF0]/30 [&_a]:underline-offset-4 hover:[&_a]:decoration-current [&_code]:break-words [&_code]:rounded-md [&_code]:bg-[#EEF0FF] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:text-[#4A55A8] [&_h1]:mb-3 [&_h1]:text-[2rem] [&_h1]:font-medium [&_h1]:leading-[1.15] [&_h1]:tracking-[-0.04em] [&_h1]:text-[#465078] sm:[&_h1]:text-5xl [&_h1+p]:text-lg [&_h1+p]:text-[#5A6490] [&_h2+*]:!mt-5 [&_h2]:mt-12 [&_h2]:scroll-mt-28 [&_h2]:border-t [&_h2]:border-[#E3E8FA] [&_h2]:pt-8 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-[-0.03em] [&_h2]:text-[#465078] sm:[&_h2]:text-3xl [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#465078] [&_li]:ml-5 [&_li]:marker:text-[#7B86D0] [&_ol>li]:list-decimal [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-sky-50/95 [&_strong]:font-semibold [&_strong]:text-[#465078] [&_th]:text-[#7B86D0] [&_tbody_tr:hover]:bg-[#F3F4FF] [&_ul>li]:list-disc"
            >
              {children}
            </div>

            {(prev || next) && (
              <nav className="mt-14 grid gap-3 border-t border-[#E3E8FA] pt-8 sm:grid-cols-2">
                {prev ? (
                  <Link href={prev.href} className="group rounded-2xl border border-[#E3E8FA] bg-white/70 p-4 !no-underline transition hover:-translate-y-0.5 hover:border-[#7B86D0]/50 hover:shadow-lg hover:shadow-indigo-500/10">
                    <p className="text-xs text-[#7B86D0]">← Previous</p>
                    <p className="mt-1 font-semibold !text-[#465078]">{prev.label}</p>
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link href={next.href} className="group rounded-2xl border border-[#E3E8FA] bg-white/70 p-4 text-right !no-underline transition hover:-translate-y-0.5 hover:border-[#7B86D0]/50 hover:shadow-lg hover:shadow-indigo-500/10">
                    <p className="text-xs text-[#7B86D0]">Next →</p>
                    <p className="mt-1 font-semibold !text-[#465078]">{next.label}</p>
                  </Link>
                )}
              </nav>
            )}
          </article>
        </div>

        <OnThisPage contentRef={contentRef} path={path} />
      </div>
    </div>
  );
}
