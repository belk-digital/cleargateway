/**
 * Blog posts, written in-repo (no CMS yet). Body is lightweight markdown: blank-line-separated paragraphs,
 * "## " starts a heading, consecutive "- " lines become a bullet list. Rendered by BlogBody.
 */
export interface Post {
  slug: string;
  title: string;
  date: string; // ISO date
  excerpt: string;
  body: string;
}

export const POSTS: Post[] = [
  {
    slug: "why-non-custodial",
    title: "Why we built ClearGateway non-custodial",
    date: "2026-09-20",
    excerpt: "The simplest way to earn a merchant's trust with their money is to never be able to hold it in the first place.",
    body: `Most payment platforms work the same way: money passes through the platform's own bank account before it reaches the merchant. That's true whether it's a card processor batching settlements once a day, or a crypto platform that quietly custodies funds in its own wallet before a manual payout.

We built ClearGateway to not do that.

## How the money actually moves

When a customer pays, a smart contract called the splitter receives the payment and, in the same transaction, sends the merchant's share to the merchant's own wallet and our fee to ours. There is no intermediate step where the money sits in a ClearGateway-controlled account. There is no function in the contract that lets anyone — including us — withdraw or redirect a payment once it's made.

This isn't a policy we promise to follow. It's a property of the code, enforced by the blockchain itself, which is why it's checked by an independent test suite rather than taken on faith.

## What this buys a merchant

- They don't need to trust us with solvency. A platform that custodies funds can, in principle, run into trouble and be unable to pay out. That risk doesn't apply here, because we're never holding the money to begin with.
- Settlement is immediate, not batched. The moment a payment confirms on-chain, the merchant's wallet already has the funds.
- There's nothing to freeze on our end. We can suspend a merchant's ability to *create new* payments, but we have no mechanism to touch money already sent to their wallet.

## What it doesn't solve

Being non-custodial isn't a complete answer to every trust question. The underlying asset, USDC, is issued by Circle, and Circle's contract retains the ability to freeze specific addresses under narrow circumstances — that's a property of the stablecoin, not something our architecture changes. And a merchant still has to trust that our staff approve accounts responsibly, since we do gate who's allowed to create payments in the first place.

We think that's an honest trade-off to be upfront about, rather than a reason to oversell "non-custodial" as solving more than it does.`,
  },
  {
    slug: "how-confirmation-works",
    title: "How a payment actually gets confirmed",
    date: "2026-09-24",
    excerpt: "A payment isn't 'done' the moment a transaction is broadcast. Here's what we actually wait for, and why.",
    body: `A blockchain transaction can look successful for a moment and then disappear — a "reorganization," where the network settles on a different version of recent history. If a platform marks a payment as paid the instant it sees a transaction, a reorg can leave it having promised money that never actually arrived.

## What we wait for

Once a payment transaction is detected, it sits in a confirming state. Our watcher waits for a configurable number of block confirmations (5 on our test network) before doing anything final. Even then, we don't just trust the count — we re-check that the transaction's block hash and event details still match what we originally saw, immediately before marking the payment paid.

Only after that re-check passes do we, in a single database transaction, mark the payment succeeded, write the ledger entries, and queue the webhook that tells the merchant's server the payment is done. All three happen together, so a crash between steps can't leave a payment marked paid without a matching ledger entry, or vice versa.

## What happens if a reorg does happen

If the transaction disappears from the canonical chain after we already flagged it as "receipt missing," we wait a grace period for it to reappear (the network catching up, or an RPC provider being temporarily behind). If it doesn't come back within that window, the payment is marked failed, and — critically — nothing is booked to the ledger for it. No money was promised that didn't arrive.

## Why this matters for a merchant

It means "payment succeeded" is a claim we can actually stand behind, not an optimistic guess based on the first thing we saw. It also means a merchant fulfilling an order on our succeeded webhook is fulfilling against money that has already, genuinely, reached their wallet — not money that's still probabilistically at risk of vanishing.`,
  },
  {
    slug: "testnet-today",
    title: "Why we're on testnet, and what changes when we're not",
    date: "2026-09-27",
    excerpt: "Everything right now runs on Base Sepolia. Here's what that means in practice, and what's left before real money is involved.",
    body: `Every payment you can create on ClearGateway today runs on Base Sepolia — a test network. The USDC involved has no monetary value, and nothing you do on the platform right now moves real money.

## Why start here

Payment infrastructure is exactly the kind of software where "mostly working" isn't good enough. Money math has to be exact, confirmations have to be handled correctly under network reorganizations, and refund and review workflows need to hold up under real use before they're trusted with real funds. Testnet gives us a place to exercise all of that — real transactions, real confirmations, real webhook delivery — without the cost of a mistake being someone's actual money.

## What's already built and tested

- The smart contracts (splitter and deposit factory) and their test suite
- The full payment lifecycle: create, pay by wallet or exchange transfer, confirm, webhook
- A merchant dashboard with team roles and two-factor-protected staff accounts
- Refund requests and staff review
- A generated API reference and integration docs

## What's still ahead before this is live

- Deploying the contracts to Base mainnet, and the operational key management that requires
- A card-to-crypto on-ramp partner, so a customer doesn't need to already own crypto
- Broader compliance review appropriate to real-money operation

We'd rather be plain about exactly where that line sits than blur "the code works" with "this is ready for real transactions." Those are different claims, and only one of them is true today.`,
  },
];

export const getPost = (slug: string): Post | undefined => POSTS.find((p) => p.slug === slug);
