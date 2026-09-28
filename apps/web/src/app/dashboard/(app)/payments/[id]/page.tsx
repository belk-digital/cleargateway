"use client";
import Link from "next/link";
import { use, useState } from "react";
import { call, useGet } from "@/lib/client";
import { formatUsdc } from "@/lib/money";
import type { Intent } from "@/lib/types";
import { Badge, Button, Card, CopyButton, ErrorNote, Mono, Notice, PageHeader, when } from "@/components/ui";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-6 border-b border-slate-100 py-2 text-sm last:border-0">
    <dt className="text-slate-500">{k}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

export default function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: p, error, reload } = useGet<Intent>("merchant", `payment_intents/${id}`);
  const [err, setErr] = useState<string | null>(null);

  async function cancel() {
    if (!confirm("Cancel this payment? The customer will no longer be able to pay it.")) return;
    const r = await call("merchant", "POST", `payment_intents/${id}/cancel`, undefined, `cancel-${id}`);
    setErr(r.error);
    void reload();
  }

  return (
    <>
      <PageHeader title="Payment" sub={id}>
        {p && (p.status === "created" || p.status === "awaiting_payment") && (
          <Button variant="danger" onClick={cancel}>
            Cancel payment
          </Button>
        )}
        {p?.status === "succeeded" && (
          <Link className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark" href={`/dashboard/refunds?payment=${id}`}>
            Request refund
          </Link>
        )}
      </PageHeader>
      <ErrorNote message={error ?? err} />
      {p && (
        <div className="space-y-4">
          {p.requires_review && <Notice>ClearGateway staff are reviewing this payment (for example a late or mismatched transfer). No action is needed from you.</Notice>}
          <Card>
            <dl>
              <Row k="Status">
                <Badge value={p.status} />
              </Row>
              <Row k="Amount paid by customer">{formatUsdc(p.amount)} USDC</Row>
              <Row k={`ClearGateway fee (${(p.fee_bps / 100).toFixed(2)}%)`}>{formatUsdc(p.fee_amount)} USDC</Row>
              <Row k="You receive">{formatUsdc(p.merchant_amount)} USDC</Row>
              <Row k="Method">{p.payment_method ?? "—"}</Row>
              <Row k="Your order id">{p.merchant_order_id ?? "—"}</Row>
              <Row k="Customer email">{p.customer_email ?? "—"}</Row>
              <Row k="Payer wallet">{p.payer_address ? <Mono>{p.payer_address}</Mono> : "—"}</Row>
              <Row k="Transaction">{p.tx_hash ? <Mono>{p.tx_hash}</Mono> : "—"}</Row>
              <Row k="Confirmations">{p.confirmations}</Row>
              <Row k="Created">{when(p.created_at)}</Row>
              <Row k="Expires">{when(p.expires_at)}</Row>
              <Row k="Paid">{when(p.succeeded_at)}</Row>
            </dl>
          </Card>
          {p.checkout_url && (
            <Card title="Checkout link">
              <Mono>{p.checkout_url}</Mono>
              <div className="mt-2">
                <CopyButton text={p.checkout_url} label="Copy link" />
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
