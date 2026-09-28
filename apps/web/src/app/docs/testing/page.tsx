import { Callout } from "@/components/docs/Callout";

export default function Page() {
  return (
    <>
      <h1>Testing</h1>
      <Callout tone="warn" title="Testnet only">
        Everything runs on Base Sepolia (chain id 84532). Test USDC and test ETH have no value. Live API keys (<code>sk_live_…</code>) are refused with <code>live_mode_disabled</code>.
      </Callout>

      <h2>What you need</h2>
      <ul>
        <li>
          A <strong>test API key</strong> (<code>sk_test_…</code>) from ClearGateway staff.
        </li>
        <li>
          A browser wallet (for example MetaMask or Coinbase Wallet) on <strong>Base Sepolia</strong>. Add the network if your wallet does not list it.
        </li>
        <li>
          <strong>Test USDC</strong> in that wallet, from a public Base Sepolia USDC test faucet, and a little <strong>test ETH</strong> for network fees.
        </li>
      </ul>

      <h2>A full test run</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Create a payment for a small amount, such as <code>&quot;1000000&quot;</code> (1 USDC).</li>
        <li>Open its <code>checkout_url</code>. On the Wallet tab connect, approve USDC, then confirm the payment.</li>
        <li>
          Watch the payment go <code>awaiting_payment</code> → <code>confirming</code> → <code>succeeded</code> in the dashboard or with <code>GET /v1/payment_intents/&#123;id&#125;</code>.
        </li>
        <li>
          Confirm your webhook endpoint received <code>payment_intent.succeeded</code> and that your signature check passed.
        </li>
        <li>
          Try the <strong>Exchange / transfer</strong> tab: send the exact amount of test USDC to the deposit address shown.
        </li>
      </ol>

      <h2>Things worth testing</h2>
      <ul>
        <li>Retry the same create request with the same Idempotency-Key: you should get the same payment back.</li>
        <li>Let a payment expire, and cancel one, to see your handling of <code>expired</code> and <code>canceled</code>.</li>
        <li>Send a webhook test from the dashboard, and check that a tampered body is rejected by your verification code.</li>
        <li>Make your webhook endpoint return an error once and watch the retry arrive with a higher <code>ClearGateway-Delivery-Attempt</code>.</li>
      </ul>

      <h2>Card payments</h2>
      <p>The card option in checkout is not live yet, so you cannot test it end to end.</p>
    </>
  );
}
