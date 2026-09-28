"use client";
import { useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import type { Run } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, PageHeader, Table, Td, when } from "@/components/ui";

export default function Reconciliation() {
  const runs = useGet<List<Run>>("admin", "reconciliation/runs?limit=30");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run() {
    setError(null);
    setInfo(null);
    const r = await call("admin", "POST", "reconciliation/run");
    if (!r.ok) return setError(r.error);
    setInfo("Run queued. It appears below when the worker finishes (usually within seconds).");
    setTimeout(() => void runs.reload(), 4000);
  }

  return (
    <>
      <PageHeader title="Reconciliation" sub="Compares our records with the blockchain. It only reports differences; it never changes anything.">
        <Button onClick={run}>Run now</Button>
        <Button variant="secondary" onClick={() => void runs.reload()}>
          Refresh
        </Button>
      </PageHeader>
      <div className="mb-4 space-y-2">
        <ErrorNote message={runs.error ?? error} />
        {info && <p className="text-sm text-green-700">{info}</p>}
      </div>
      <Card>
        <Table head={["Started", "Trigger", "Result", "Mismatches", ""]} empty="No runs yet.">
          {(runs.data?.data ?? []).flatMap((r) => [
            <tr key={r.id}>
              <Td>{when(r.started_at)}</Td>
              <Td>{r.trigger}</Td>
              <Td>
                <Badge value={r.status} />
              </Td>
              <Td>{r.mismatch_count}</Td>
              <Td>
                <Button variant="secondary" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? "Hide report" : "Report"}
                </Button>
              </Td>
            </tr>,
            open === r.id ? (
              <tr key={`${r.id}-rep`}>
                <td colSpan={5} className="bg-slate-50 px-3 py-3">
                  <pre className="max-h-96 overflow-auto text-xs">{JSON.stringify(r.report, null, 2)}</pre>
                </td>
              </tr>
            ) : null,
          ])}
        </Table>
      </Card>
    </>
  );
}
