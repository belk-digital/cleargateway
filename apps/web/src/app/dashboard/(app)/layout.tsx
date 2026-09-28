import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { API_BASE, upstreamHeaders } from "@/lib/upstream";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/refunds", label: "Refunds" },
  { href: "/dashboard/webhooks", label: "Webhooks" },
  { href: "/dashboard/account", label: "Account" },
];

export default async function Layout({ children }: { children: ReactNode }) {
  const s = await getSession("merchant");
  if (!s) redirect("/dashboard/login");
  const me = await fetch(`${API_BASE}/auth/v1/me`, { headers: upstreamHeaders(s), cache: "no-store" }).then(
    (r) => (r.ok ? (r.json() as Promise<{ email: string; role: string; merchant_name: string }>) : null),
    () => null,
  );
  if (!me) redirect("/dashboard/login"); // expired, revoked or disabled: the API says so
  return (
    <Shell kind="merchant" title={`ClearGateway · ${me.merchant_name}`} nav={NAV} who={`${me.email} (${me.role})`}>
      {children}
    </Shell>
  );
}
