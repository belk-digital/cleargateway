"use client";
import Link from "next/link";
import { useGet, type List } from "@/lib/client";
import { formatUsdc } from "@/lib/money";
import type { Balance, Intent } from "@/lib/types";
import { Badge, Card, ErrorNote, PageHeader, Table, Td, when } from "@/components/ui";

export default function Overview() {
  const bal = useGet<Balance>("merchant", "balance");
  const recent = useGet<List<Intent>>("merchant", "payment_intents?limit=8");
  return (
    <>
      <PageHeader title="Overview" sub="Totals come from the double-entry ledger and only include payments confirmed on-chain." />
      <ErrorNote message={bal.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card title="Net received">
          <p className="text-2xl font-semibold">{bal.data ? `${formatUsdc(bal.data.net)} USDC` : "…"}</p>
        </Card>
        <Card title="Settled">
          <p className="text-2xl font-semibold">{bal.data ? formatUsdc(bal.data.settled) : "…"}</p>
        </Card>
        <Card title="Refunded">
          <p className="text-2xl font-semibold">{bal.data ? formatUsdc(bal.data.refunded) : "…"}</p>
        </Card>
        <Card title="Paid payments">
          <p className="text-2xl font-semibold">{bal.data?.settled_payments ?? "…"}</p>
          <p className="text-xs text-slate-500">mode: {bal.data?.mode}</p>
        </Card>
      </div>
      <Card title="Latest payments">
        <ErrorNote message={recent.error} />
        <Table head={["Payment", "Amount", "Status", "Created"]} empty="No payments yet. Create one from the Payments page.">
          {(recent.data?.data ?? []).map((p) => (
            <tr key={p.id}>
              <Td>
                <Link className="text-brand hover:underline" href={`/dashboard/payments/${p.id}`}>
                  {p.merchant_order_id ?? p.id.slice(0, 12)}
                </Link>
              </Td>
              <Td>{formatUsdc(p.amount)}</Td>
              <Td>
                <Badge value={p.status} />
              </Td>
              <Td>{when(p.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
