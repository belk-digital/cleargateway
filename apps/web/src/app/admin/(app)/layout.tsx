import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { API_BASE, upstreamHeaders } from "@/lib/upstream";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Merchants" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/review", label: "Review queue" },
  { href: "/admin/refunds", label: "Refunds" },
  { href: "/admin/reconciliation", label: "Reconciliation" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/account", label: "Account" },
];

export default async function Layout({ children }: { children: ReactNode }) {
  const s = await getSession("admin");
  if (!s) redirect("/admin/login");
  const me = await fetch(`${API_BASE}/auth/v1/me`, { headers: upstreamHeaders(s), cache: "no-store" }).then(
    (r) => (r.ok ? (r.json() as Promise<{ email: string }>) : null),
    () => null,
  );
  if (!me) redirect("/admin/login");
  return (
    <Shell kind="admin" title="ClearGateway · Staff" nav={NAV} who={me.email}>
      {children}
    </Shell>
  );
}
