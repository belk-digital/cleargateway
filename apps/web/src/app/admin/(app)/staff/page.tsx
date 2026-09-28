"use client";
import { useState } from "react";
import { call, useGet, type List } from "@/lib/client";
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Table, Td, when } from "@/components/ui";
import { InviteBox, type InviteInfo } from "@/components/InviteBox";

interface Staff {
  id: string;
  email: string;
  status: string;
  two_factor: boolean;
  created_at: string;
}
interface InviteResp {
  user: Staff;
  invite?: { token: string; expires_at: string };
}

export default function StaffPage() {
  const list = useGet<List<Staff>>("admin", "staff");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  async function act(path: string, body?: unknown, reset = false) {
    setError(null);
    const r = await call<InviteResp>("admin", "POST", path, body);
    if (!r.ok) return setError(r.error);
    if (r.data.invite) setInvite({ email: r.data.user.email, token: r.data.invite.token, expires_at: r.data.invite.expires_at, reset, staff: true });
    setEmail("");
    void list.reload();
  }

  return (
    <>
      <PageHeader title="Staff" sub="Everyone who can use this console. Each person signs in with their own password and authenticator app." />
      {invite && (
        <div className="mb-6">
          <InviteBox invite={invite} onDone={() => setInvite(null)} />
        </div>
      )}
      <Card title="Invite a staff member" className="mb-6">
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act("staff", { email: email.trim() });
          }}
        >
          <div className="min-w-72 flex-1">
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Button type="submit">Create invite</Button>
        </form>
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      </Card>
      <Card>
        <ErrorNote message={list.error} />
        <Table head={["Email", "Status", "Two-factor", "Added", ""]}>
          {(list.data?.data ?? []).map((u) => (
            <tr key={u.id}>
              <Td>{u.email}</Td>
              <Td>
                <Badge value={u.status === "invited" ? "pending_kyb" : u.status === "active" ? "active" : "disabled"} />
                <span className="ml-2 text-xs text-slate-500">{u.status}</span>
              </Td>
              <Td>{u.two_factor ? "on" : "not set up"}</Td>
              <Td>{when(u.created_at)}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => confirm(`Reset ${u.email}? Their password and authenticator are wiped and all their sessions end.`) && act(`staff/${u.id}/reset`, undefined, true)}>
                    Reset access
                  </Button>
                  {u.status === "disabled" ? (
                    <Button variant="secondary" onClick={() => act(`staff/${u.id}/enable`)}>
                      Enable
                    </Button>
                  ) : (
                    <Button variant="danger" onClick={() => confirm(`Disable ${u.email}? Their sessions end immediately.`) && act(`staff/${u.id}/disable`)}>
                      Disable
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
