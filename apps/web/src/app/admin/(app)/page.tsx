"use client";
import Link from "next/link";
import { useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import type { Merchant } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Select, Table, Td, when } from "@/components/ui";

export default function Merchants() {
  const [status, setStatus] = useState("");
  const list = useGet<List<Merchant>>("admin", `merchants?limit=100${status ? `&status=${status}` : ""}`);
  const [f, setF] = useState({ legal_name: "", display_name: "", payout_wallet_address: "", fee_bps: "200" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fee = Number(f.fee_bps);
    if (!Number.isInteger(fee) || fee < 0 || fee > 1000) return setError("Fee must be a whole number of basis points between 0 and 1000 (100 = 1%)");
    setBusy(true);
    const r = await call("admin", "POST", "merchants", { ...f, fee_bps: fee });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setF({ legal_name: "", display_name: "", payout_wallet_address: "", fee_bps: "200" });
    void list.reload();
  }

  return (
    <>
      <PageHeader title="Merchants" sub="New merchants start as pending KYB and cannot take payments until approved." />
      <Card title="Create merchant" className="mb-6">
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} required />
          <Field label="Display name (shown at checkout)" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required />
          <Field label="Payout wallet (Base Sepolia)" value={f.payout_wallet_address} onChange={(e) => setF({ ...f, payout_wallet_address: e.target.value })} placeholder="0x…" required hint="Where the merchant's money is sent. Must be a correctly checksummed address." />
          <Field label="Fee (basis points)" inputMode="numeric" value={f.fee_bps} onChange={(e) => setF({ ...f, fee_bps: e.target.value })} required hint="200 = 2.00%. Maximum 1000." />
          <div className="sm:col-span-2">
            <ErrorNote message={error} />
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create merchant"}
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <div className="mb-4 max-w-xs">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending_kyb">Pending KYB</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
        <ErrorNote message={list.error} />
        <Table head={["Merchant", "Status", "KYB", "Fee", "Created"]}>
          {(list.data?.data ?? []).map((m) => (
            <tr key={m.id}>
              <Td>
                <Link className="text-brand hover:underline" href={`/admin/merchants/${m.id}`}>
                  {m.display_name}
                </Link>
                <div className="text-xs text-slate-500">{m.legal_name}</div>
              </Td>
              <Td>
                <Badge value={m.status} />
              </Td>
              <Td>
                <Badge value={m.kyb_status} />
              </Td>
              <Td>{(m.fee_bps / 100).toFixed(2)}%</Td>
              <Td>{when(m.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
