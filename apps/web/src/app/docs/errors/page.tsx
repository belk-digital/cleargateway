import { CodeTabs } from "@/components/docs/CodeTabs";

const ENVELOPE = `{
  "error": {
    "code": "invalid_request",
    "message": "Request validation failed",
    "request_id": "req_5c9f6ff2-3c98-43ad-a179-7af485f0d1f0",
    "details": []
  }
}`;

const CODES: [string, string, string][] = [
  ["invalid_request", "400", "The request is malformed or failed validation. See details."],
  ["unauthorized", "401", "Missing, malformed or revoked API key."],
  ["forbidden", "403", "The key is valid but not allowed: for example the merchant is suspended, or a read-only role."],
  ["live_mode_disabled", "403", "A live key was used while the platform is testnet-only."],
  ["not_found", "404", "The object does not exist, or belongs to another merchant."],
  ["idempotency_conflict", "409", "The Idempotency-Key was already used with a different request."],
  ["invalid_state_transition", "409", "The action is not allowed in the object's current state, for example refunding an unpaid payment."],
  ["conflict", "409", "The request conflicts with current state, for example paying an expired payment."],
  ["rate_limited", "429", "Too many requests. Wait for the Retry-After header's seconds."],
  ["not_configured", "503", "A capability is not set up on the platform yet."],
  ["internal_error", "500", "Our fault. Retry; quote the request_id if it persists."],
];

export default function Page() {
  return (
    <>
      <h1>Errors, limits &amp; idempotency</h1>

      <h2>Authentication</h2>
      <p>
        Send your secret key as a bearer token: <code>Authorization: Bearer sk_test_…</code>. Keys are matched by a hash on our side and are only ever shown once, at creation.
      </p>

      <h2>Errors</h2>
      <p>Every failed request returns the same JSON envelope and a matching HTTP status. Log the <code>request_id</code>: it lets us find the exact request.</p>
      <CodeTabs samples={[{ label: "Response", code: ENVELOPE }]} />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="px-4 py-2">code</th>
              <th className="px-4 py-2">HTTP</th>
              <th className="px-4 py-2">meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {CODES.map(([c, s, d]) => (
              <tr key={c}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{c}</td>
                <td className="px-4 py-2.5">{s}</td>
                <td className="px-4 py-2.5">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Idempotency</h2>
      <p>
        Requests that create or change money-related objects (<code>POST /v1/payment_intents</code>, cancel, refunds, webhook endpoints) <strong>require an <code>Idempotency-Key</code> header</strong>: 1 to 255 printable
        ASCII characters with no spaces.
      </p>
      <ul>
        <li>The same key with the same request replays the original response, without doing the work again. Use this to retry safely after a timeout or network error.</li>
        <li>The same key with a different request body is refused with <code>idempotency_conflict</code>.</li>
        <li>If the first attempt failed with an error, nothing was saved and you can retry with the same key.</li>
        <li>Keys are remembered for 24 hours per merchant.</li>
      </ul>
      <p>Good keys are derived from your own object, such as <code>order-1042</code> or <code>refund-1042-1</code>. Random keys defeat the purpose if you generate a new one on each retry.</p>

      <h2>Rate limits</h2>
      <p>
        Requests are limited per API key (600 per minute by default) and per IP address. Over the limit you get <code>429 rate_limited</code> and a <code>Retry-After</code> header. Back off and retry.
      </p>

      <h2>Pagination</h2>
      <p>
        List endpoints return <code>data</code>, <code>has_more</code> and <code>next_cursor</code>. Pass <code>limit</code> (1 to 100) and <code>starting_after</code> (the id of the last item you received) to get the next
        page.
      </p>

      <h2>Conventions</h2>
      <ul>
        <li>Timestamps are ISO 8601 in UTC.</li>
        <li>Ids are prefixed strings such as <code>pi_…</code> (payment), <code>re_…</code> (refund), <code>we_…</code> (webhook endpoint).</li>
        <li>Unknown fields in a request body are rejected, which catches typos early.</li>
        <li>Every response carries an <code>x-request-id</code> header.</li>
      </ul>
    </>
  );
}
