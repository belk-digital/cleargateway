"use client";
import { use, useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import type { ApiKeyRow, Merchant } from "@/lib/types";
import { MerchantUsers } from "@/components/MerchantUsers";
import { Badge, Button, Card, ErrorNote, Field, Mono, Notice, PageHeader, SecretOnce, Select, Table, Td, when } from "@/components/ui";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-6 border-b border-slate-100 py-2 text-sm last:border-0">
    <dt className="text-slate-500">{k}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

export default function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const m = useGet<Merchant>("admin", `merchants/${id}`);
  const keys = useGet<List<ApiKeyRow>>("admin", `merchants/${id}/api-keys`);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [fee, setFee] = useState("");
  const [wallet, setWallet] = useState("");
  const [keyMode, setKeyMode] = useState("test");
  const [newKey, setNewKey] = useState<string | null>(null);

  async function act(path: string, method = "POST", body?: unknown) {
    setError(null);
    const r = await call("admin", method, `merchants/${id}/${path}`.replace(/\/$/, ""), body);
    if (!r.ok) setError(r.error);
    setNote("");
    void m.reload();
    void keys.reload();
    return r;
  }

  const d = m.data;
  const withNote = { note: note || undefined };

  return (
    <>
      <PageHeader title={d?.display_name ?? "Merchant"} sub={id} />
      <ErrorNote message={m.error ?? error} />
      {newKey && (
        <div className="mb-6">
          <SecretOnce title="New API key" value={newKey} onDone={() => setNewKey(null)} />
        </div>
      )}
      {d && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Profile">
            <dl>
              <Row k="Legal name">{d.legal_name}</Row>
              <Row k="Status">
                <Badge value={d.status} />
              </Row>
              <Row k="KYB">
                <Badge value={d.kyb_status} />
              </Row>
              <Row k="Fee">{(d.fee_bps / 100).toFixed(2)}% ({d.fee_bps} bps)</Row>
              <Row k="Payout wallet">
                <Mono>{d.payout_wallet_address}</Mono>
              </Row>
              <Row k="Created">{when(d.created_at)}</Row>
            </dl>
          </Card>

          <Card title="Lifecycle">
            <Field label="Note (recorded in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={d.status === "active" && d.kyb_status === "approved"} onClick={() => act("approve-kyb", "POST", withNote)}>
                Approve KYB
              </Button>
              <Button variant="secondary" disabled={d.kyb_status === "rejected"} onClick={() => confirm("Reject KYB? An active merchant will also be suspended.") && act("reject-kyb", "POST", withNote)}>
                Reject KYB
              </Button>
              <Button variant="danger" disabled={d.status === "suspended"} onClick={() => confirm("Suspend this merchant? Their API keys stop working immediately.") && act("suspend", "POST", withNote)}>
                Suspend
              </Button>
              <Button variant="secondary" disabled={d.status !== "suspended"} onClick={() => act("reinstate", "POST", withNote)}>
                Reinstate
              </Button>
            </div>
          </Card>

          <Card title="Fee">
            <p className="mb-3 text-sm text-slate-500">A new fee applies to new payments only. Existing payments keep the fee they were created with.</p>
            <div className="flex items-end gap-3">
              <Field label="Fee (bps, 0–1000)" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} placeholder={String(d.fee_bps)} />
              <Button
                disabled={fee === ""}
                onClick={async () => {
                  const n = Number(fee);
                  if (!Number.isInteger(n) || n < 0 || n > 1000) return setError("Fee must be a whole number between 0 and 1000");
                  await act("fee", "PATCH", { fee_bps: n });
                  setFee("");
                }}
              >
                Set fee
              </Button>
            </div>
          </Card>

          <Card title="Payout wallet">
            <Notice>High risk: this is where a merchant&apos;s money goes. Verify the change out-of-band before saving. It is audited with the old and new address.</Notice>
            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <Field label="New payout wallet" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" />
              </div>
              <Button
                variant="danger"
                disabled={!wallet}
                onClick={async () => {
                  if (!confirm(`Change the payout wallet to ${wallet}?`)) return;
                  await act("", "PATCH", { payout_wallet_address: wallet.trim() });
                  setWallet("");
                }}
              >
                Change
              </Button>
            </div>
          </Card>

          <Card title="API keys" className="lg:col-span-2">
            <div className="mb-4 flex items-end gap-3">
              <div className="w-40">
                <Select label="Mode" value={keyMode} onChange={(e) => setKeyMode(e.target.value)}>
                  <option value="test">test</option>
                  <option value="live">live (disabled on testnet)</option>
                </Select>
              </div>
              <Button
                onClick={async () => {
                  const r = await act("api-keys", "POST", { mode: keyMode });
                  const k = (r.data as { key?: string } | null)?.key;
                  if (r.ok && k) setNewKey(k);
                }}
              >
                Create key
              </Button>
            </div>
            <Table head={["Key", "Mode", "Last used", "Created", "Status", ""]}>
              {(keys.data?.data ?? []).map((k) => (
                <tr key={k.id}>
                  <Td>
                    <Mono>{k.prefix}…</Mono>
                  </Td>
                  <Td>{k.mode}</Td>
                  <Td>{when(k.last_used_at)}</Td>
                  <Td>{when(k.created_at)}</Td>
                  <Td>
                    <Badge value={k.revoked_at ? "disabled" : "active"} />
                  </Td>
                  <Td>
                    {!k.revoked_at && (
                      <Button variant="danger" onClick={() => confirm("Revoke this key? It stops working immediately.") && act(`api-keys/${k.id}`, "DELETE")}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <MerchantUsers merchantId={id} />
        </div>
      )}
    </>
  );
}
