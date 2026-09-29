"use client";
import Link from "next/link";
import { useState } from "react";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/api", label: "API reference" },
  { href: "/blog", label: "Blog" },
];

/** Header for the public site (landing and docs). Collapses into a menu below sm; the full row shows at sm and up. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-brand" onClick={() => setOpen(false)}>
          ClearGateway
        </Link>
        <nav className="hidden gap-4 text-sm text-slate-600 sm:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-slate-900">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 text-sm sm:flex">
          <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-slate-700 hover:bg-slate-100">
            Merchant sign in
          </Link>
          <Link href="/docs/quickstart" className="rounded-lg bg-brand px-3.5 py-1.5 font-medium text-white hover:bg-brand-dark">
            Get started
          </Link>
        </div>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded-lg p-2 text-slate-700 hover:bg-slate-100 sm:hidden"
        >
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-slate-200 px-4 py-3 text-sm sm:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2 text-slate-700 hover:bg-slate-100">
              {n.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2 border-t border-slate-100 pt-3">
            <Link href="/dashboard" onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-center font-medium text-slate-700">
              Merchant sign in
            </Link>
            <Link href="/docs/quickstart" onClick={() => setOpen(false)} className="flex-1 rounded-lg bg-brand px-3 py-2 text-center font-medium text-white">
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500">
        <span>© ClearGateway. Testnet only: no real money moves.</span>
        <span className="flex gap-4">
          <Link href="/docs">Docs</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/admin">Staff</Link>
        </span>
      </div>
    </footer>
  );
}
