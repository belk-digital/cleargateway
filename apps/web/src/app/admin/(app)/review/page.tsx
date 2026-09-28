"use client";
import Link from "next/link";
import { useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import { formatUsdc } from "@/lib/money";
import type { AdminIntent } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Field, Mono, PageHeader, Select, Table, Td, shortId, when } from "@/components/ui";

const CATEGORIES = ["late_payment", "overpaid", "underpaid", "stuck_deposit", "chain_mismatch", "other"];
const RESOLUTIONS = [
  ["acknowledged", "Acknowledged"],
  ["refund_recorded", "Refund recorded"],
  ["refunded_externally", "Refunded outside ClearGateway"],
  ["no_action_needed", "No action needed"],
  ["escalated", "Escalated"],
];
const HELP: Record<string, string> = {
  late_payment: "Money arrived after the payment expired or was canceled. The payment status is unchanged; decide whether to refund.",
  overpaid: "The customer sent more than the amount due.",
  underpaid: "The customer sent less than the amount due.",
  stuck_deposit: "A deposit could not be moved to the merchant automatically.",
  chain_mismatch: "The chain and our records disagree. Investigate before anything else.",
  other: "Flagged for another reason; see the payment's audit trail.",
};

export default function Review() {
  const [cat, setCat] = useState("");
  const list = useGet<List<AdminIntent>>("admin", `review-queue?limit=50${cat ? `&category=${cat}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const [resolution, setResolution] = useState("acknowledged");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string) {
    setError(null);
    const r = await call("admin", "POST", `review-queue/${id}/resolve`, { resolution, note });
    if (!r.ok) return setError(r.error);
    setOpen(null);
    setNote("");
    void list.reload();
  }

  return (
    <>
      <PageHeader title="Review queue" sub="Payments that need a human decision. Resolving clears the flag and records who and why; it never changes the payment's status." />
      <Card>
        <div className="mb-4 max-w-xs">
          <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </div>
        {cat && <p className="mb-4 text-sm text-slate-600">{HELP[cat]}</p>}
        <ErrorNote message={list.error ?? error} />
        <Table head={["Payment", "Category", "Reason", "Amount", "Status", "Created", ""]} empty="Nothing needs review.">
          {(list.data?.data ?? []).flatMap((p) => [
            <tr key={p.id}>
              <Td>
                <Link className="text-brand hover:underline" href={`/admin/payments/${p.id}`}>
                  <Mono>{shortId(p.id)}</Mono>
                </Link>
              </Td>
              <Td>{p.category?.replace(/_/g, " ") ?? "—"}</Td>
              <Td>{p.review_reason ?? "—"}</Td>
              <Td>
                {formatUsdc(p.amount)}
                {p.underpaid_amount !== "0" && <div className="text-xs text-amber-700">short by {formatUsdc(p.underpaid_amount)}</div>}
                {p.overpaid_amount !== "0" && <div className="text-xs text-amber-700">extra {formatUsdc(p.overpaid_amount)}</div>}
              </Td>
              <Td>
                <Badge value={p.status} />
              </Td>
              <Td>{when(p.created_at)}</Td>
              <Td>
                {p.requires_review ? (
                  <Button variant="secondary" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    Resolve
                  </Button>
                ) : (
                  <span className="text-xs text-slate-500">no flag to clear</span>
                )}
              </Td>
            </tr>,
            open === p.id ? (
              <tr key={`${p.id}-form`}>
                <td colSpan={7} className="bg-slate-50 px-3 py-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Select label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                      {RESOLUTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    <div className="sm:col-span-2">
                      <Field label="Note (required)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Button disabled={!note.trim()} onClick={() => resolve(p.id)}>
                      Save resolution
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
