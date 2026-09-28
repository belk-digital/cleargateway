"use client";
import { useRef, useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import { formatUsdc, parseUsdc } from "@/lib/money";
import type { Refund } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Field, Mono, Notice, PageHeader, Table, Td, when } from "@/components/ui";

export default function Refunds() {
  const list = useGet<List<Refund>>("merchant", "refunds?limit=50");
  const [payment, setPayment] = useState("");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idem = useRef(crypto.randomUUID());

  // Pre-fill from ?payment=pi_... (linked from a payment page). Read once on the client.
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && typeof window !== "undefined") {
    setPrefilled(true);
    const q = new URLSearchParams(window.location.search).get("payment");
    if (q) setPayment(q);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let units: string | undefined;
    if (amount.trim()) {
      const u = parseUsdc(amount);
      if (!u) return setError("Amount must be a positive USDC value with at most 6 decimals, or blank for a full refund");
      units = u;
    }
    setBusy(true);
    const r = await call("merchant", "POST", "refunds", { payment_intent_id: payment.trim(), to_address: to.trim(), ...(units ? { amount: units } : {}), ...(reason ? { reason } : {}) }, idem.current);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    idem.current = crypto.randomUUID();
    setAmount("");
    setTo("");
    setReason("");
    void list.reload();
  }

  return (
    <>
      <PageHeader title="Refunds" sub="Request a refund for a paid payment. ClearGateway staff review it before it is approved." />
      <Notice>Refunds are recorded and reviewed here; sending the money back on-chain is not automated yet.</Notice>
      <Card title="Request a refund" className="my-6">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment id" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="pi_…" required />
          <Field label="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="blank = everything not yet refunded" />
          <Field label="Send refund to (wallet address)" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" required hint="Double-check this address: on-chain refunds cannot be undone." />
          <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="optional" />
          <div className="sm:col-span-2">
            <ErrorNote message={error} />
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Request refund"}
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Your refund requests">
        <ErrorNote message={list.error} />
        <Table head={["Refund", "Payment", "Amount", "To", "Status", "Requested"]}>
          {(list.data?.data ?? []).map((r) => (
            <tr key={r.id}>
              <Td>
                <Mono>{r.id.slice(0, 12)}</Mono>
              </Td>
              <Td>
                <Mono>{r.payment_intent_id.slice(0, 12)}</Mono>
              </Td>
              <Td>{formatUsdc(r.amount)}</Td>
              <Td>
                <Mono>{`${r.to_address.slice(0, 8)}…${r.to_address.slice(-6)}`}</Mono>
              </Td>
              <Td>
                <Badge value={r.status} />
              </Td>
              <Td>{when(r.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
