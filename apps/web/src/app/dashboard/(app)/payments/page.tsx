"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import { formatUsdc, parseUsdc } from "@/lib/money";
import type { Intent } from "@/lib/types";
import { Badge, Button, Card, CopyButton, ErrorNote, Field, Mono, PageHeader, Select, Table, Td, when } from "@/components/ui";

const STATUSES = ["created", "awaiting_payment", "confirming", "succeeded", "expired", "underpaid", "failed", "canceled", "refunded", "partially_refunded"];

export default function Payments() {
  const [status, setStatus] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const path = useMemo(() => {
    const q = new URLSearchParams({ limit: "20" });
    if (status) q.set("status", status);
    const after = cursors.at(-1);
    if (after) q.set("starting_after", after);
    return `payment_intents?${q}`;
  }, [status, cursors]);
  const list = useGet<List<Intent>>("merchant", path);

  const [amount, setAmount] = useState("");
  const [order, setOrder] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Intent | null>(null);
  // One idempotency key per form attempt: a double click or retry cannot create two payments.
  const idem = useRef(crypto.randomUUID());

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const units = parseUsdc(amount);
    if (!units) return setError("Enter a positive amount in USDC with at most 6 decimals, e.g. 25.50");
    setBusy(true);
    const r = await call<Intent>("merchant", "POST", "payment_intents", {
      amount: units,
      ...(order ? { merchant_order_id: order } : {}),
      ...(email ? { customer_email: email } : {}),
    }, idem.current);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    idem.current = crypto.randomUUID();
    setCreated(r.data);
    setAmount("");
    setOrder("");
    setEmail("");
    setCursors([]);
    void list.reload();
  }

  return (
    <>
      <PageHeader title="Payments" sub="Create a payment, then send the customer its checkout link." />
      <Card title="New payment" className="mb-6">
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-4">
          <Field label="Amount (USDC)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" required />
          <Field label="Your order id" value={order} onChange={(e) => setOrder(e.target.value)} maxLength={255} placeholder="optional" />
          <Field label="Customer email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
          <div className="flex items-end">
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating…" : "Create payment"}
            </Button>
          </div>
        </form>
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
        {created?.checkout_url && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
            <p className="mb-1 font-medium text-green-900">Payment created. Send this checkout link to your customer:</p>
            <Mono>{created.checkout_url}</Mono>
            <div className="mt-2 flex gap-2">
              <CopyButton text={created.checkout_url} label="Copy link" />
              <a className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-100" href={created.checkout_url} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 max-w-xs">
          <Select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursors([]);
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </div>
        <ErrorNote message={list.error} />
        <Table head={["Payment", "Amount", "Fee", "Status", "Method", "Created"]}>
          {(list.data?.data ?? []).map((p) => (
            <tr key={p.id}>
              <Td>
                <Link className="text-brand hover:underline" href={`/dashboard/payments/${p.id}`}>
                  {p.merchant_order_id ?? p.id.slice(0, 14)}
                </Link>
                {p.requires_review && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">review</span>}
              </Td>
              <Td>{formatUsdc(p.amount)}</Td>
              <Td>{formatUsdc(p.fee_amount)}</Td>
              <Td>
                <Badge value={p.status} />
              </Td>
              <Td>{p.payment_method ?? "—"}</Td>
              <Td>{when(p.created_at)}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
            Previous
          </Button>
          <Button variant="secondary" disabled={!list.data?.has_more} onClick={() => list.data?.next_cursor && setCursors((c) => [...c, list.data!.next_cursor!])}>
            Next
          </Button>
        </div>
      </Card>
    </>
  );
}
