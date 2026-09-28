import { Callout } from "@/components/docs/Callout";
import { CodeTabs } from "@/components/docs/CodeTabs";
import { API_URL } from "@/lib/site";

const REQ = `curl ${API_URL}/v1/refunds \\
  -H "Authorization: Bearer $CLEARGATEWAY_API_KEY" \\
  -H "Idempotency-Key: refund-order-1042-1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "payment_intent_id": "pi_...",
    "amount": "5000000",
    "to_address": "0xCustomerWalletAddress...",
    "reason": "customer_request"
  }'`;

export default function Page() {
  return (
    <>
      <h1>Refunds</h1>
      <Callout tone="warn" title="Recorded and reviewed, not automatic yet">
        Today a refund request is <strong>recorded and reviewed</strong> by ClearGateway staff. Sending the money back on-chain is not automated yet. You will see the status change as staff approve or reject it.
      </Callout>

      <h2>Request a refund</h2>
      <p>
        Refund a <code>succeeded</code> (or partially refunded) payment. Leave <code>amount</code> out to refund everything that has not been refunded yet. <code>to_address</code> is the wallet the money should go to.
        Check it carefully: on-chain refunds cannot be undone.
      </p>
      <CodeTabs samples={[{ label: "curl", code: REQ }]} />

      <h2>Rules</h2>
      <ul>
        <li>The payment must be <code>succeeded</code> or <code>partially_refunded</code>; otherwise the request is refused.</li>
        <li>
          The total of your open and approved refunds cannot exceed the <strong>amount the customer paid</strong> (the gross amount). A rejected refund frees its amount for a new request.
        </li>
        <li>You cannot refund to ClearGateway&apos;s own contract addresses, the USDC contract or the zero address.</li>
        <li>An Idempotency-Key is required, so retries never create two refunds.</li>
      </ul>

      <h2>Statuses</h2>
      <ul>
        <li>
          <code>requested</code>: waiting for review.
        </li>
        <li>
          <code>approved</code> or <code>rejected</code>: the staff decision.
        </li>
        <li>
          <code>processing</code>, <code>succeeded</code>, <code>failed</code>: reserved for when on-chain refunds are automated.
        </li>
      </ul>
      <p>
        You receive a <code>refund.created</code> webhook when a request is recorded. List and fetch refunds with <code>GET /v1/refunds</code> and <code>GET /v1/refunds/&#123;id&#125;</code>, or use the dashboard&apos;s
        Refunds page.
      </p>
    </>
  );
}
