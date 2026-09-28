"use client";
import { useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import { formatUsdc } from "@/lib/money";
import type { Refund } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Field, Mono, Notice, PageHeader, Select, Table, Td, shortId, when } from "@/components/ui";

export default function AdminRefunds() {
  const [status, setStatus] = useState("requested");
  const list = useGet<List<Refund>>("admin", `refunds?limit=100${status ? `&status=${status}` : ""}`);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, kind: "approve" | "reject") {
    setError(null);
    const r = await call("admin", "POST", `refunds/${id}/${kind}`, kind === "reject" ? { note } : undefined);
    if (!r.ok) return setError(r.error);
    setRejecting(null);
    setNote("");
    void list.reload();
  }

  return (
    <>
      <PageHeader title="Refunds" sub="Approve or reject refund requests from merchants." />
      <Notice>Approving records the decision only. Sending the money back on-chain is a later phase.</Notice>
      <Card className="mt-6">
        <div className="mb-4 max-w-xs">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["requested", "approved", "rejected"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <ErrorNote message={list.error ?? error} />
        <Table head={["Refund", "Payment", "Amount", "To", "Reason", "Status", "Requested", ""]} empty="No refunds in this state.">
          {(list.data?.data ?? []).flatMap((r) => [
            <tr key={r.id}>
              <Td>
                <Mono>{shortId(r.id)}</Mono>
              </Td>
              <Td>
                <Mono>{shortId(r.payment_intent_id)}</Mono>
              </Td>
              <Td>{formatUsdc(r.amount)}</Td>
              <Td>
                <Mono>{r.to_address}</Mono>
              </Td>
              <Td>{r.reason ?? "—"}</Td>
              <Td>
                <Badge value={r.status} />
              </Td>
              <Td>{when(r.created_at)}</Td>
              <Td>
                <div className="flex gap-2">
                  {r.status === "requested" && (
                    <Button onClick={() => confirm(`Approve refund of ${formatUsdc(r.amount)} USDC to ${r.to_address}?`) && decide(r.id, "approve")}>Approve</Button>
                  )}
                  {(r.status === "requested" || r.status === "approved") && (
                    <Button variant="danger" onClick={() => setRejecting(rejecting === r.id ? null : r.id)}>
                      Reject
                    </Button>
                  )}
                </div>
              </Td>
            </tr>,
            rejecting === r.id ? (
              <tr key={`${r.id}-rej`}>
                <td colSpan={8} className="bg-slate-50 px-3 py-4">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Field label="Reason for rejecting (required)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                    </div>
                    <Button variant="danger" disabled={!note.trim()} onClick={() => decide(r.id, "reject")}>
                      Confirm reject
                    </Button>
                  </div>
                </td>
              </tr>
            ) : null,
          ])}
        </Table>
      </Card>
    </>
  );
}
