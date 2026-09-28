"use client";
import { useRef, useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import type { WebhookEndpoint } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Field, Mono, PageHeader, SecretOnce, Table, Td, when } from "@/components/ui";

export default function Webhooks() {
  const list = useGet<List<WebhookEndpoint>>("merchant", "webhook_endpoints");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const idem = useRef(crypto.randomUUID());

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await call<WebhookEndpoint>("merchant", "POST", "webhook_endpoints", { url: url.trim() }, idem.current);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    idem.current = crypto.randomUUID();
    setSecret(r.data.secret ?? null);
    setUrl("");
    void list.reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete this endpoint? Pending deliveries to it are abandoned.")) return;
    const r = await call("merchant", "DELETE", `webhook_endpoints/${id}`);
    setError(r.error);
    void list.reload();
  }

  async function test(id: string) {
    setInfo(null);
    const r = await call("merchant", "POST", `webhook_endpoints/${id}/test`, undefined, crypto.randomUUID());
    if (r.ok) setInfo("Test event queued. It is delivered within a few seconds.");
    else setError(r.error);
  }

  return (
    <>
      <PageHeader title="Webhooks" sub="ClearGateway sends signed HTTP calls to these URLs when a payment changes state." />
      {secret && (
        <div className="mb-6">
          <SecretOnce title="Signing secret for the new endpoint" value={secret} onDone={() => setSecret(null)} />
        </div>
      )}
      <Card title="Add an endpoint" className="mb-6">
        <form onSubmit={add} className="flex flex-wrap items-end gap-4">
          <div className="min-w-72 flex-1">
            <Field label="HTTPS URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/cleargateway-webhook" required />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add endpoint"}
          </Button>
        </form>
        <div className="mt-3 space-y-2">
          <ErrorNote message={error} />
          {info && <p className="text-sm text-green-700">{info}</p>}
        </div>
      </Card>
      <Card title="Endpoints">
        <ErrorNote message={list.error} />
        <Table head={["URL", "Events", "Status", "Created", ""]}>
          {(list.data?.data ?? []).map((w) => (
            <tr key={w.id}>
              <Td>
                <Mono>{w.url}</Mono>
              </Td>
              <Td>{w.enabled_events.join(", ")}</Td>
              <Td>
                <Badge value={w.status} />
              </Td>
              <Td>{when(w.created_at)}</Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => test(w.id)}>
                    Send test
                  </Button>
                  <Button variant="danger" onClick={() => remove(w.id)}>
                    Delete
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
