"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useGet, type List } from "@/lib/client";
import { formatUsdc } from "@/lib/money";
import type { AdminIntent } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Field, Mono, PageHeader, Select, Table, Td, shortId, when } from "@/components/ui";

const STATUSES = ["created", "awaiting_payment", "confirming", "succeeded", "expired", "underpaid", "failed", "canceled", "refunded", "partially_refunded"];

export default function AdminPayments() {
  const [f, setF] = useState({ id: "", merchant_id: "", merchant_order_id: "", tx_hash: "", status: "", needs_review: "" });
  const [applied, setApplied] = useState(f);
  const [cursors, setCursors] = useState<string[]>([]);
  const path = useMemo(() => {
    const q = new URLSearchParams({ limit: "25" });
    for (const [k, v] of Object.entries(applied)) if (v) q.set(k, v);
    const after = cursors.at(-1);
    if (after) q.set("starting_after", after);
    return `payment_intents?${q}`;
  }, [applied, cursors]);
  const list = useGet<List<AdminIntent>>("admin", path);

  return (
    <>
      <PageHeader title="Payments" sub="Search every merchant's payments." />
      <Card className="mb-6">
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setCursors([]);
            setApplied(f);
          }}
        >
          <Field label="Payment id" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.trim() })} placeholder="pi_…" />
          <Field label="Merchant id" value={f.merchant_id} onChange={(e) => setF({ ...f, merchant_id: e.target.value.trim() })} placeholder="mer_…" />
          <Field label="Merchant order id" value={f.merchant_order_id} onChange={(e) => setF({ ...f, merchant_order_id: e.target.value })} />
          <Field label="Transaction hash" value={f.tx_hash} onChange={(e) => setF({ ...f, tx_hash: e.target.value.trim() })} placeholder="0x…" />
          <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Select label="Needs review" value={f.needs_review} onChange={(e) => setF({ ...f, needs_review: e.target.value })}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
          <div>
            <Button type="submit">Search</Button>
          </div>
        </form>
      </Card>
      <Card>
        <ErrorNote message={list.error} />
        <Table head={["Payment", "Merchant", "Amount", "Status", "Category", "Created"]} empty="No matching payments.">
          {(list.data?.data ?? []).map((p) => (
            <tr key={p.id}>
              <Td>
                <Link className="text-brand hover:underline" href={`/admin/payments/${p.id}`}>
                  <Mono>{shortId(p.id)}</Mono>
                </Link>
              </Td>
              <Td>
                <Link className="hover:underline" href={`/admin/merchants/${p.merchant_id}`}>
                  <Mono>{shortId(p.merchant_id)}</Mono>
                </Link>
              </Td>
              <Td>{formatUsdc(p.amount)}</Td>
              <Td>
                <Badge value={p.status} />
              </Td>
              <Td>{p.category ? p.category.replace(/_/g, " ") : "—"}</Td>
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
