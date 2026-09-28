"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/lib/client";
import { Button } from "./ui";

export function Shell({ kind, title, nav, who, children }: { kind: "merchant" | "admin"; title: string; nav: { href: string; label: string }[]; who?: string; children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-brand">{title}</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((n) => {
              const active = n.href === nav[0]?.href ? path === n.href : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`rounded-lg px-3 py-1.5 ${active ? "bg-slate-100 font-medium" : "text-slate-600 hover:bg-slate-50"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            {who && <span>{who}</span>}
            <Button variant="secondary" onClick={() => void logout(kind)}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
