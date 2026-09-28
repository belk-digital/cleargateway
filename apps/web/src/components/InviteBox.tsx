"use client";
import { Button, Card, CopyButton, Mono } from "./ui";

export interface InviteInfo {
  email: string;
  token: string;
  expires_at: string;
  reset: boolean;
  staff: boolean;
}

/** Shows a one-time setup link. There is no email service yet, so the person who created it delivers it. */
export function InviteBox({ invite, onDone }: { invite: InviteInfo; onDone: () => void }) {
  const link = `${window.location.origin}/accept#token=${invite.token}`;
  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="mb-1 text-sm font-semibold text-amber-900">
        {invite.reset ? "Password reset link" : "Invite link"} for {invite.email}
      </p>
      <p className="mb-3 text-sm text-amber-900">
        Send this link to them privately (it is not emailed). It works once and expires {new Date(invite.expires_at).toLocaleString()}.
        {invite.staff ? " They will also set up an authenticator app when they open it." : ""} It cannot be shown again.
      </p>
      <div className="mb-3 rounded-lg border border-amber-200 bg-white p-3">
        <Mono>{link}</Mono>
      </div>
      <div className="flex gap-2">
        <CopyButton text={link} label="Copy link" />
        <Button variant="secondary" onClick={onDone}>
          I have sent it
        </Button>
      </div>
    </Card>
  );
}
