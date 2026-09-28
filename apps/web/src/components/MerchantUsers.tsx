"use client";
import { useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import { InviteBox, type InviteInfo } from "./InviteBox";
import { Badge, Button, Card, ErrorNote, Field, Select, Table, Td } from "./ui";

interface U {
  id: string;
  email: string;
  role: string;
  status: string;
}
interface Resp {
  user: U;
  invite?: { token: string; expires_at: string };
}
const ROLES = [
  ["owner", "Owner: full access"],
  ["admin", "Admin: full access"],
  ["developer", "Developer: full access"],
  ["viewer", "Viewer: read-only"],
];

/** Dashboard sign-in accounts for one merchant (staff console). */
export function MerchantUsers({ merchantId }: { merchantId: string }) {
  const list = useGet<List<U>>("admin", `merchants/${merchantId}/users`);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("owner");
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  async function act(method: string, path: string, body?: unknown, reset = false) {
    setError(null);
    const r = await call<Resp>("admin", method, path, body);
    if (!r.ok) return setError(r.error);
    if (r.data.invite) setInvite({ email: r.data.user.email, token: r.data.invite.token, expires_at: r.data.invite.expires_at, reset, staff: false });
    if (method === "POST" && path.endsWith("/users")) setEmail("");
    void list.reload();
  }

  return (
    <Card title="Dashboard users" className="lg:col-span-2">
      {invite && (
        <div className="mb-4">
          <InviteBox invite={invite} onDone={() => setInvite(null)} />
        </div>
      )}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act("POST", `merchants/${merchantId}/users`, { email: email.trim(), role });
        }}
      >
        <div className="min-w-64 flex-1">
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="w-56">
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">Invite user</Button>
      </form>
      <ErrorNote message={list.error ?? error} />
      <Table head={["Email", "Role", "Status", ""]} empty="No dashboard users yet. Invite the merchant's owner above.">
        {(list.data?.data ?? []).map((u) => (
          <tr key={u.id}>
            <Td>{u.email}</Td>
            <Td>
              <select value={u.role} onChange={(e) => void act("PATCH", `merchant-users/${u.id}`, { role: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">
                {ROLES.map(([v]) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Td>
            <Td>
              <Badge value={u.status === "invited" ? "pending_kyb" : u.status === "active" ? "active" : "disabled"} />
              <span className="ml-2 text-xs text-slate-500">{u.status}</span>
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => confirm(`Reset ${u.email}? Their password is wiped and their sessions end.`) && act("POST", `merchant-users/${u.id}/reset`, undefined, true)}>
                  Reset password
                </Button>
                {u.status === "disabled" ? (
                  <Button variant="secondary" onClick={() => act("POST", `merchant-users/${u.id}/enable`)}>
                    Enable
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => confirm(`Disable ${u.email}?`) && act("POST", `merchant-users/${u.id}/disable`)}>
                    Disable
                  </Button>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
