import { Callout } from "@/components/docs/Callout";
import { CodeTabs } from "@/components/docs/CodeTabs";
import { API_URL } from "@/lib/site";

const CREATE = [
  {
    label: "curl",
    code: `curl ${API_URL}/v1/payment_intents \\
  -H "Authorization: Bearer $CLEARGATEWAY_API_KEY" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "25500000",
    "merchant_order_id": "order-1042",
    "success_url": "https://shop.example.com/thanks",
    "cancel_url": "https://shop.example.com/cart"
  }'`,
  },
  {
    label: "Node.js",
    code: `// Node 18+ (built-in fetch). Run this on your SERVER, never in the browser: it uses your secret key.
const res = await fetch("${API_URL}/v1/payment_intents", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.CLEARGATEWAY_API_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "order-1042", // reuse the same key when retrying the same order
  },
  body: JSON.stringify({
    amount: "25500000", // 25.50 USDC, as a string in base units
    merchant_order_id: "order-1042",
    success_url: "https://shop.example.com/thanks",
    cancel_url: "https://shop.example.com/cart",
  }),
});
if (!res.ok) throw new Error(JSON.stringify(await res.json()));
const payment = await res.json();
console.log(payment.id, payment.checkout_url);`,
  },
  {
    label: "Python",
    code: `import os, requests

res = requests.post(
    "${API_URL}/v1/payment_intents",
    headers={
        "Authorization": f"Bearer {os.environ['CLEARGATEWAY_API_KEY']}",
        "Idempotency-Key": "order-1042",
    },
    json={
        "amount": "25500000",  # 25.50 USDC, as a string in base units
        "merchant_order_id": "order-1042",
        "success_url": "https://shop.example.com/thanks",
        "cancel_url": "https://shop.example.com/cart",
    },
    timeout=15,
)
res.raise_for_status()
payment = res.json()
print(payment["id"], payment["checkout_url"])`,
  },
];

export default function Page() {
  return (
    <>
      <h1>Quickstart</h1>
      <p>Take your first test payment. You need a merchant account, an API key and a server that can make HTTPS requests.</p>

      <h2>1. Get a merchant account and API key</h2>
      <p>
        ClearGateway staff create your merchant account, approve it and issue your API key. Ask them for a <strong>test key</strong> (it starts with <code>sk_test_</code>) and a dashboard invite for your team. The key
        is shown once, so store it in your server&apos;s secret manager or environment, for example as <code>CLEARGATEWAY_API_KEY</code>.
      </p>
      <Callout tone="warn" title="Keep the key secret">
        Anyone with your secret key can create payments and read your data as you. Never put it in a web page, mobile app or public repository. If it leaks, ask us to revoke it and issue a new one.
      </Callout>

      <h2>2. Create a payment</h2>
      <p>
        Send the amount in USDC base units (6 decimals) and an <code>Idempotency-Key</code>. Use something stable per order, such as your order ID, so a retry returns the same payment.
      </p>
      <CodeTabs samples={CREATE} />
      <p>The response includes the payment&apos;s <code>id</code>, its <code>status</code> (<code>created</code>), the fee split, and a <code>checkout_url</code>.</p>

      <h2>3. Send your customer to checkout</h2>
      <p>
        Redirect the customer to <code>checkout_url</code> or show it as a link or button. It opens our hosted checkout page, where they pay. See <a href="/docs/checkout">Hosted checkout</a>.
      </p>

      <h2>4. Listen for the result</h2>
      <p>
        Add a webhook endpoint (in the dashboard under <em>Webhooks</em>, or with <code>POST /v1/webhook_endpoints</code>). When the payment is confirmed on-chain we send <code>payment_intent.succeeded</code>. Verify its
        signature, then fulfil the order. See <a href="/docs/webhooks">Webhooks</a>.
      </p>

      <h2>5. Go through it end to end</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Create a payment (step 2).</li>
        <li>Open the checkout link and pay with a wallet that has test USDC (see <a href="/docs/testing">Testing</a>).</li>
        <li>
          Watch the status change: <code>awaiting_payment</code>, <code>confirming</code>, <code>succeeded</code>. You can also poll <code>GET /v1/payment_intents/&#123;id&#125;</code>.
        </li>
        <li>Check your webhook receiver got <code>payment_intent.succeeded</code>, and the payment shows in your dashboard.</li>
      </ol>
    </>
  );
}
