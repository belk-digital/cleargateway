import { Callout } from "@/components/docs/Callout";
import { CodeTabs } from "@/components/docs/CodeTabs";

const EXPRESS = `// Express example: create a payment on your server, then send the customer to checkout.
app.post("/checkout", async (req, res) => {
  const order = await loadOrder(req.body.orderId);        // your own order lookup
  const r = await fetch("https://YOUR-API/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.CLEARGATEWAY_API_KEY}\`,
      "Content-Type": "application/json",
      "Idempotency-Key": \`order-\${order.id}\`,
    },
    body: JSON.stringify({
      amount: toUnits(order.total),                        // e.g. "25500000"
      merchant_order_id: order.id,
      success_url: \`https://shop.example.com/orders/\${order.id}/thanks\`,
      cancel_url: "https://shop.example.com/cart",
    }),
  });
  const payment = await r.json();
  res.redirect(303, payment.checkout_url);
});`;

export default function Page() {
  return (
    <>
      <h1>Hosted checkout</h1>
      <p>
        The easiest integration: create a payment on your server and send the customer to its <code>checkout_url</code>. Our hosted page shows your business name and the amount, and lets the customer pay.
      </p>

      <h2>The checkout link</h2>
      <p>
        A payment&apos;s <code>checkout_url</code> looks like <code>https://…/pay/pi_…#client_secret=…</code>. The part after <code>#</code> is the payment&apos;s <strong>client secret</strong>. It stays in the URL
        fragment, so browsers never send it to any server, and the page removes it from the address bar after loading. Treat the whole link as private to that customer.
      </p>
      <CodeTabs samples={[{ label: "Node.js (Express)", code: EXPRESS }]} />

      <h2>How the customer can pay</h2>
      <ul>
        <li>
          <strong>Wallet.</strong> Connect a browser wallet on Base Sepolia holding USDC. The customer approves USDC, then confirms the payment: two wallet confirmations. Funds go straight to the contract, which
          splits them between you and ClearGateway.
        </li>
        <li>
          <strong>Exchange or transfer.</strong> The page shows a unique deposit address for this payment. The customer sends the full amount of USDC on Base to it from any wallet or exchange. We detect it, confirm it
          and move it to the contract automatically. Sending anything else, or using a different network, can lose funds permanently; the page warns about this.
        </li>
        <li>
          <strong>Card.</strong> Buy USDC with a card into the customer&apos;s own wallet, then pay with the wallet. <em>Not live yet:</em> this depends on an on-ramp partner that is still being connected.
        </li>
      </ul>

      <h2>After payment</h2>
      <p>
        Checkout shows the live status and, once <code>succeeded</code>, a &ldquo;Return to&hellip;&rdquo; button that goes to your <code>success_url</code>. If a payment expires, fails or is canceled it offers your{" "}
        <code>cancel_url</code>.
      </p>
      <Callout tone="warn" title="Do not trust the redirect">
        A customer can open your <code>success_url</code> without paying. Always confirm with the <code>payment_intent.succeeded</code> webhook or by fetching the payment with your API key before you fulfil.
      </Callout>

      <h2>Building your own checkout</h2>
      <p>
        You can build a custom page against the <code>/v1/checkout/&#123;id&#125;/…</code> endpoints (wallet payload, deposit address, status stream). They authenticate with the payment&apos;s client secret in the{" "}
        <code>x-client-secret</code> header rather than your API key. See the <a href="/docs/api">API reference</a>.
      </p>
    </>
  );
}
