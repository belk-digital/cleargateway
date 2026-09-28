import { Callout } from "@/components/docs/Callout";
import { CodeTabs } from "@/components/docs/CodeTabs";

const HELPERS = [
  {
    label: "JavaScript",
    code: `// USDC amounts are integer strings in base units (6 decimals). Never use floats for money.
export function toUnits(usdc) {
  const m = /^(\\d{1,12})(?:\\.(\\d{1,6}))?$/.exec(usdc.trim());
  if (!m) throw new Error("amount must have at most 6 decimals");
  return (BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"))).toString();
}
export function fromUnits(units) {
  const v = BigInt(units);
  return \`\${v / 1_000_000n}.\${(v % 1_000_000n).toString().padStart(6, "0")}\`;
}
toUnits("25.50"); // "25500000"`,
  },
  {
    label: "Python",
    code: `from decimal import Decimal

def to_units(usdc: str) -> str:
    d = Decimal(usdc)
    units = d * 1_000_000
    if units != units.to_integral_value() or units <= 0:
        raise ValueError("amount must be positive with at most 6 decimals")
    return str(int(units))

to_units("25.50")  # "25500000"`,
  },
];

const STATUSES: [string, string][] = [
  ["created", "The payment exists. The customer has not started paying."],
  ["awaiting_payment", "The customer opened checkout and we are ready to see their payment."],
  ["confirming", "A payment was seen on-chain and is collecting confirmations. Do not fulfil yet."],
  ["succeeded", "Confirmed and final. Your share is in your wallet. Fulfil the order."],
  ["expired", "Nobody paid before the payment expired."],
  ["underpaid", "Less than the full amount arrived. Contact the customer; the payment is not complete."],
  ["failed", "The transaction was reorganised out of the chain or failed. Nothing was booked."],
  ["canceled", "You canceled it before it was paid."],
  ["partially_refunded", "Part of a paid amount has been refunded."],
  ["refunded", "The full amount has been refunded."],
];

export default function Page() {
  return (
    <>
      <h1>Payments</h1>
      <p>
        A <strong>payment</strong> (called a <em>payment intent</em> in the API) represents one request to be paid a fixed amount of USDC. You create it, the customer pays it, and we tell you when it is done.
      </p>

      <h2>Amounts</h2>
      <p>
        <code>amount</code> is a string containing a whole number of USDC <strong>base units</strong>. USDC has 6 decimals, so 1 USDC is <code>&quot;1000000&quot;</code>. The smallest payment is 0.01 USDC and the
        largest is 1,000,000 USDC.
      </p>
      <CodeTabs samples={HELPERS} />

      <h2>Fees</h2>
      <p>
        Your fee is set by ClearGateway per merchant, in <strong>basis points</strong> (100 bps = 1%). It is applied like this:
      </p>
      <ul>
        <li>
          <code>fee_amount = amount × fee_bps ÷ 10,000</code>, rounded <strong>down</strong> to a whole base unit.
        </li>
        <li>
          <code>merchant_amount = amount − fee_amount</code>: what you receive.
        </li>
      </ul>
      <p>
        Example: 100 USDC at 200 bps gives a fee of 2 USDC and a merchant amount of 98 USDC. The fee is recorded on the payment when it is created, so a later fee change never affects existing payments.
      </p>

      <h2>Statuses</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {STATUSES.map(([s, d]) => (
              <tr key={s}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{s}</td>
                <td className="px-4 py-2.5">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>The normal path is: created → awaiting_payment → confirming → succeeded.</p>
      <Callout tone="warn" title="Fulfil on succeeded only">
        Only <code>succeeded</code> means the money is final. A redirect back to your site, or a payment that is still <code>confirming</code>, is not proof of payment. Rely on the webhook, or fetch the payment from your
        server.
      </Callout>

      <h2>Confirmations and reorganisations</h2>
      <p>
        We wait for a number of network confirmations (currently 5 blocks on the test network) and then re-check that the payment is still in the chain before marking it <code>succeeded</code>. If the network reorganises
        and the transaction disappears, the payment is <code>failed</code> and nothing is booked.
      </p>

      <h2>Late, over- and under-payments</h2>
      <ul>
        <li>
          <strong>Late payment</strong> (after a payment expired or was canceled): the money is never dropped. The payment status does not change; it is flagged for review and you get a{" "}
          <code>payment_intent.requires_review</code> webhook. ClearGateway staff will work it out with you, usually by refunding the customer.
        </li>
        <li>
          <strong>Underpaid</strong>: the payment moves to <code>underpaid</code> and you get <code>payment_intent.underpaid</code>.
        </li>
        <li>
          <strong>Overpaid</strong> (deposit-address payments): flagged for review with the extra amount recorded.
        </li>
      </ul>

      <h2>Options when creating a payment</h2>
      <ul>
        <li>
          <code>merchant_order_id</code>: your own reference. Searchable in the dashboard.
        </li>
        <li>
          <code>metadata</code>: up to 50 key-value string pairs (keys up to 40 characters, values up to 500) that come back on the payment and in webhooks.
        </li>
        <li>
          <code>customer_email</code>: stored on the payment for your records.
        </li>
        <li>
          <code>success_url</code>, <code>cancel_url</code>: where checkout offers to send the customer back (http or https).
        </li>
        <li>
          <code>expires_in_seconds</code>: 300 to 86,400. Defaults to 3,600 (one hour).
        </li>
      </ul>

      <h2>Reading and canceling</h2>
      <ul>
        <li>
          <code>GET /v1/payment_intents/&#123;id&#125;</code> fetches one payment. <code>GET /v1/payment_intents</code> lists them (filter by <code>status</code>, <code>created_gte</code>, <code>created_lte</code>; page
          with <code>limit</code> and <code>starting_after</code>).
        </li>
        <li>
          <code>POST /v1/payment_intents/&#123;id&#125;/cancel</code> works only while the payment is <code>created</code> or <code>awaiting_payment</code>. A customer who already started paying can still complete a
          payment on-chain; if that lands after cancellation it is flagged for review.
        </li>
      </ul>
    </>
  );
}
