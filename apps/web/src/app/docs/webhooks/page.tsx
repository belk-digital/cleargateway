import { Callout } from "@/components/docs/Callout";
import { CodeTabs } from "@/components/docs/CodeTabs";

const EVENTS: [string, string][] = [
  ["payment_intent.succeeded", "Confirmed and final. Fulfil the order."],
  ["payment_intent.expired", "The payment expired unpaid."],
  ["payment_intent.underpaid", "Less than the full amount arrived."],
  ["payment_intent.failed", "The payment failed, for example it was reorganised out of the chain."],
  ["payment_intent.requires_review", "Something needs a human look: a late, over- or mismatched payment. See Payments."],
  ["refund.created", "A refund was requested for one of your payments."],
  ["webhook.test", "Sent when you use “Send test” on an endpoint."],
];

const PAYLOAD = `{
  "id": "evt_9f3c1a...",
  "object": "event",
  "type": "payment_intent.succeeded",
  "created": "2026-09-27T12:00:00.000Z",
  "mode": "test",
  "data": {
    "object": {
      "id": "pi_...",
      "object": "payment_intent",
      "status": "succeeded",
      "amount": "25500000",
      "fee_amount": "510000",
      "merchant_amount": "24990000",
      "merchant_order_id": "order-1042",
      "tx_hash": "0x...",
      "...": "the same fields as GET /v1/payment_intents/{id}"
    }
  }
}`;

const NODE = `import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.CLEARGATEWAY_WEBHOOK_SECRET; // "whsec_..." shown once when you created the endpoint
const TOLERANCE_SECONDS = 300;

function verify(rawBody, header, secret) {
  if (!header) return false;
  let t = NaN;
  const candidates = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") candidates.push(v);
  }
  if (!Number.isInteger(t) || candidates.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false; // stale: possible replay
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  return candidates.some((c) => {
    const got = Buffer.from(c, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const app = express();
// IMPORTANT: verify the EXACT bytes we sent, so read the raw body. Do not parse then re-serialize.
app.post("/webhooks/cleargateway", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(raw, req.get("cleargateway-signature"), SECRET)) return res.status(400).end();

  const event = JSON.parse(raw);
  const eventId = req.get("cleargateway-event-id");
  if (await alreadyProcessed(eventId)) return res.status(200).end(); // deliveries are at-least-once

  if (event.type === "payment_intent.succeeded") {
    await fulfilOrder(event.data.object.merchant_order_id);
  }
  await markProcessed(eventId);
  res.status(200).end(); // any 2xx means "received"
});`;

const PY = `import hashlib, hmac, os, time
from flask import Flask, request

SECRET = os.environ["CLEARGATEWAY_WEBHOOK_SECRET"]  # "whsec_..."
TOLERANCE = 300

def verify(raw: bytes, header: str | None, secret: str) -> bool:
    if not header:
        return False
    t, candidates = None, []
    for part in header.split(","):
        k, _, v = part.partition("=")
        if k.strip() == "t":
            t = int(v)
        elif k.strip() == "v1":
            candidates.append(v.strip())
    if t is None or not candidates or abs(time.time() - t) > TOLERANCE:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, c) for c in candidates)

app = Flask(__name__)

@app.post("/webhooks/cleargateway")
def hook():
    raw = request.get_data()  # the exact bytes we sent
    if not verify(raw, request.headers.get("ClearGateway-Signature"), SECRET):
        return "", 400
    event = request.get_json()
    event_id = request.headers.get("ClearGateway-Event-Id")
    if already_processed(event_id):  # deliveries are at-least-once
        return "", 200
    if event["type"] == "payment_intent.succeeded":
        fulfil_order(event["data"]["object"]["merchant_order_id"])
    mark_processed(event_id)
    return "", 200`;

export default function Page() {
  return (
    <>
      <h1>Webhooks</h1>
      <p>
        Webhooks are HTTPS calls we make to your server when something changes. They are the reliable way to learn a payment succeeded, even if the customer closes their browser.
      </p>

      <h2>Add an endpoint</h2>
      <p>
        In the dashboard open <em>Webhooks</em> and add your URL, or call <code>POST /v1/webhook_endpoints</code>. The <strong>signing secret</strong> (<code>whsec_…</code>) is shown <strong>once</strong>, so save it
        now. Endpoints must be public <code>https://</code> URLs; private or internal addresses are refused. Use <em>Send test</em> to receive a <code>webhook.test</code> event.
      </p>

      <h2>Events</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {EVENTS.map(([e, d]) => (
              <tr key={e}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{e}</td>
                <td className="px-4 py-2.5">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>By default an endpoint receives all events. You can subscribe an endpoint to a specific list instead.</p>

      <h2>The request</h2>
      <p>
        We POST a JSON body. Each event has a stable <code>id</code>; the same event always has the same id, including on retries.
      </p>
      <CodeTabs samples={[{ label: "Body", code: PAYLOAD }]} />
      <p>Headers:</p>
      <ul>
        <li>
          <code>ClearGateway-Signature</code>: <code>t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>
        </li>
        <li>
          <code>ClearGateway-Event-Id</code>: the event id; use it to de-duplicate
        </li>
        <li>
          <code>ClearGateway-Event-Type</code> and <code>ClearGateway-Delivery-Attempt</code> (1 for the first try)
        </li>
      </ul>

      <h2>Verify the signature</h2>
      <p>
        Always verify. The signature is an HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw body&gt;</code> using your signing secret. Compare in constant time, reject timestamps more than 5 minutes old, and use the{" "}
        <strong>raw request body</strong> (parsing and re-serialising changes the bytes and breaks the signature). The header may carry more than one <code>v1</code> value; accept the event if any matches.
      </p>
      <CodeTabs samples={[{ label: "Node.js", code: NODE }, { label: "Python (Flask)", code: PY }]} />

      <h2>Delivery and retries</h2>
      <ul>
        <li>
          Respond with any <strong>2xx</strong> within 10 seconds. Anything else, a timeout, or a redirect counts as a failure. We do not follow redirects.
        </li>
        <li>
          On failure we retry with growing delays: 1, 5, 15, 30 and 60 minutes, then 2, 4, 6, 8 and 12 hours, then 12, 12 and finally 24 hours: up to 14 attempts over about 3½ days. After that the delivery is marked
          failed.
        </li>
        <li>
          Delivery is <strong>at-least-once</strong>. You may receive the same event more than once, so make your handler idempotent by recording processed event ids.
        </li>
        <li>Events are not guaranteed to arrive in order. Use the status inside the event, or fetch the payment, when order matters.</li>
      </ul>
      <Callout title="Tip">
        Return 200 quickly and do slow work afterwards. If your endpoint is down for a while, missed events are retried; you can also list payments with the API to catch up.
      </Callout>
    </>
  );
}
