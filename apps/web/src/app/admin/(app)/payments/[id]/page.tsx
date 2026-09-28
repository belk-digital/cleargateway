"use client";
import { use } from "react";
import { useGet } from "@/lib/client";
import { formatUsdc } from "@/lib/money";
import type { AdminIntent } from "@/lib/types";
import { Badge, Card, ErrorNote, Mono, PageHeader, Table, Td, when } from "@/components/ui";

interface Detail {
  payment_intent: AdminIntent;
  events: { id: string; from_status: string | null; to_status: string; reason: string | null; actor: string; data: Record<string, unknown>; created_at: string }[];
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-6 border-b border-slate-100 py-2 text-sm last:border-0">
    <dt className="text-slate-500">{k}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

export default function AdminPaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useGet<Detail>("admin", `payment_intents/${id}`);
  const p = data?.payment_intent;
  return (
    <>
      <PageHeader title="Payment" sub={id} />
      <ErrorNote message={error} />
      {p && data && (
        <div className="space-y-6">
          <Card>
            <dl>
              <Row k="Status">
                <Badge value={p.status} />
              </Row>
              <Row k="Merchant">
                <Mono>{p.merchant_id}</Mono>
              </Row>
              <Row k="Amount / fee / merchant">
                {formatUsdc(p.amount)} / {formatUsdc(p.fee_amount)} / {formatUsdc(p.merchant_amount)} USDC
              </Row>
              <Row k="Method">{p.payment_method ?? "—"}</Row>
              <Row k="Payer">{p.payer_address ? <Mono>{p.payer_address}</Mono> : "—"}</Row>
              <Row k="Transaction">{p.tx_hash ? <Mono>{p.tx_hash}</Mono> : "—"}</Row>
              <Row k="Confirmations">{p.confirmations}</Row>
              <Row k="Review">{p.requires_review ? `${p.category ?? "other"} (${p.review_reason ?? ""})` : "—"}</Row>
              <Row k="Underpaid / overpaid">
                {formatUsdc(p.underpaid_amount)} / {formatUsdc(p.overpaid_amount)}
              </Row>
              <Row k="Deposit address">{p.deposit_address ? <Mono>{p.deposit_address}</Mono> : "—"}</Row>
              {p.deposit && (
                <Row k="Deposit">
                  {p.deposit.status}: detected {formatUsdc(p.deposit.detected_amount)}, confirmed {formatUsdc(p.deposit.confirmed_amount)}
                </Row>
              )}
              <Row k="On-ramp">{p.onramp_provider ? `${p.onramp_provider} (${p.onramp_status ?? "?"})` : "—"}</Row>
              <Row k="Created / expires">
                {when(p.created_at)} / {when(p.expires_at)}
              </Row>
            </dl>
          </Card>
          <Card title="Audit trail">
            <Table head={["When", "Change", "Reason", "Actor"]}>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <Td>{when(e.created_at)}</Td>
                  <Td>
                    {e.from_status ?? "∅"} → {e.to_status}
                  </Td>
                  <Td>{e.reason ?? "—"}</Td>
                  <Td>
                    <Mono>{e.actor}</Mono>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
