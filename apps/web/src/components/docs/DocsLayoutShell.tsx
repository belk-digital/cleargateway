"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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

export function DocsLayoutShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-4 py-10">
      <aside className="hidden w-56 shrink-0 md:block">
        <nav className="sticky top-6 space-y-6 text-sm">
          {NAV.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
              <ul className="space-y-1">
                {g.items.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} className={`block rounded-lg px-3 py-1.5 ${path === n.href ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <article className="min-w-0 flex-1">
        <details className="mb-6 rounded-lg border border-slate-200 bg-white p-3 text-sm md:hidden">
          <summary className="cursor-pointer font-medium">Documentation menu</summary>
          <div className="mt-3 space-y-3">
            {NAV.flatMap((g) => g.items).map((n) => (
              <Link key={n.href} href={n.href} className="block text-slate-700">
                {n.label}
              </Link>
            ))}
          </div>
        </details>
        <div className="space-y-4 text-[15px] leading-7 text-slate-700 [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-slate-900 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_li]:ml-5 [&_li]:list-disc [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-brand [&_a]:underline">
          {children}
        </div>
      </article>
    </div>
  );
}
