import Link from "next/link";
import { Callout } from "@/components/docs/Callout";

export default function Page() {
  return (
    <>
      <h1>Dashboard &amp; team</h1>
      <p>
        The <Link href="/dashboard">merchant dashboard</Link> is where your team sees payments and balances, creates payment links, manages webhooks and requests refunds.
      </p>

      <h2>Getting access</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>ClearGateway staff invite your owner by email address and give them a one-time setup link.</li>
        <li>They open the link, choose a password of at least 12 characters and save.</li>
        <li>
          They sign in at <Link href="/dashboard/login">/dashboard/login</Link>.
        </li>
      </ol>
      <p>
        There are no default passwords. Sessions last up to 8 hours, end after 2 hours of inactivity, and end at once when you sign out or change your password. Five wrong passwords lock the account for 15 minutes. Forgot
        your password? Ask ClearGateway for a reset link.
      </p>

      <h2>Roles</h2>
      <ul>
        <li>
          <strong>Owner, Admin, Developer</strong>: full access to everything below.
        </li>
        <li>
          <strong>Viewer</strong>: read-only. Can see payments, balances, refunds and webhooks but cannot create or change anything.
        </li>
      </ul>
      <p>Staff add and remove your team members and change roles.</p>

      <h2>What you can do</h2>
      <ul>
        <li>
          <strong>Overview</strong>: net received, settled and refunded totals (from the ledger, counting only on-chain confirmed payments) and your latest payments.
        </li>
        <li>
          <strong>Payments</strong>: search and filter, open any payment, cancel an unpaid one, and <strong>create a payment link</strong> to send to a customer without writing code.
        </li>
        <li>
          <strong>Refunds</strong>: request a refund and track its status.
        </li>
        <li>
          <strong>Webhooks</strong>: add or remove endpoints, and send a test event. The signing secret is shown once.
        </li>
        <li>
          <strong>Account</strong>: change your password.
        </li>
      </ul>

      <h2>API keys</h2>
      <p>
        API keys are for your <strong>servers</strong>, not for signing in to the dashboard. ClearGateway staff issue and revoke them; the full key is shown once at creation.
      </p>
      <Callout tone="warn" title="Payout wallet">
        Your payout wallet (where your money is sent) is set by ClearGateway staff. Changes are recorded in an audit log; ask us to confirm any change with you directly.
      </Callout>
    </>
  );
}
