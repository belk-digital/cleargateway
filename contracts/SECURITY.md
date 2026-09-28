# ClearGatewaySplitter: Security Notes for Auditors

Status: **pre-audit, testnet only** (Base Sepolia, chain ID 84532). No mainnet deployment script exists by design.

## 1. Scope

| File | Notes |
|---|---|
| `src/ClearGatewaySplitter.sol` | In scope. The only production contract. |
| `src/DepositFactory.sol`, `src/DepositForwarder.sol` | In scope (Milestone 5: per-payment deposit addresses). See section 6. |
| `src/mocks/MockUSDC.sol` | Test/local only. Never deployed to a live network. |
| `script/*.s.sol` | Deployment scripts. `DeploySepolia` reverts unless `block.chainid == 84532` and the token equals Circle's Base Sepolia USDC. `DeployDepositFactory` is likewise Base Sepolia only. |

Dependencies: OpenZeppelin Contracts **v5.7.0** (git submodule, pinned tag), Solidity **0.8.28**, EVM version `cancun`, optimizer 200 runs.

## 2. What the contract does

A customer pays a backend-signed *payment intent*. In the same transaction the platform fee goes to `platformWallet` and the remainder to the merchant. The contract **never holds a balance between transactions** and has **no withdraw or rescue function**.

Two entry points (both `nonReentrant` and `whenNotPaused`):

1. `pay(intent, sig)`: standard `approve` + `transferFrom`. `msg.sender` must equal the signed `intent.payer`. Funds move payer → merchant and payer → platform directly; the contract never receives them.
2. `payWithAuthorization(intent, intentSig, validAfter, validBefore, authSig)`: EIP-3009 `receiveWithAuthorization`. The payer signs an authorization whose payee is *this contract* and whose nonce is `intentId`. Funds are pulled into the contract and forwarded to merchant and platform in the same call. Anyone may submit (relayer support); the signed `payer` is authoritative.

### Signed intent (EIP-712)

Domain: `name="ClearGatewaySplitter"`, `version="1"`, `chainId`, `verifyingContract` (OpenZeppelin `EIP712`).

```
PaymentIntent(bytes32 intentId,address merchant,address token,address payer,uint256 amount,uint256 feeBps,uint256 expiry)
```

The contract checks, in order: non-zero merchant, non-zero amount, `block.timestamp <= expiry`, `feeBps <= maxFeeBps`, `!paid[intentId]`, and `ECDSA.recover(digest, sig) == signer`. It then sets `paid[intentId] = true` (effects before interactions) and transfers.

### Fee math

`fee = amount * feeBps / 10_000` (rounds down); `merchantAmount = amount - fee`. Mirrored by `splitAmount` in `packages/shared/src/money.ts`; both test suites share the same vectors and the fuzz tests assert `fee + merchantAmount == amount`.

## 3. Trust assumptions

1. **The signer key is trusted for pricing.** Anyone holding it can sign an intent with any merchant, amount and fee (≤ `maxFeeBps`) for any *consenting* payer. It cannot move funds from a payer who does not call `pay` / sign an EIP-3009 authorization for that exact amount. Production: KMS-backed signer; testnet: env key.
2. **The owner is trusted for configuration only** (see §4). Owner should be a multisig / hardware wallet, distinct from the signer.
3. **USDC (Circle FiatTokenV2_2) behaves per its published source:** standard ERC-20 semantics (no fee-on-transfer, no rebasing, no hooks), and EIP-3009 `receiveWithAuthorization` enforces `to == msg.sender`. Fee-on-transfer or rebasing tokens are **not supported**; the token is immutable.
4. **Backend is the source of intent validity.** The contract does not know about orders, merchants' KYB status, or refunds.
5. Verified against Circle's docs/source: Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`; its live implementation (`0xd74cc5d4…c5b5`) contains both `receiveWithAuthorization` overloads (bytes-signature selector `0x88b7ab63`, used by this contract; v/r/s selector `0xef55bec6`). Re-verify the Base **mainnet** address and implementation before any mainnet deployment.

## 4. Admin powers (`Ownable2Step`)

| Function | Effect | Limits |
|---|---|---|
| `setSigner(addr)` | Rotates the intent signer. Invalidates all outstanding signatures from the old signer. | Non-zero. |
| `setPlatformWallet(addr)` | Changes fee recipient for *future* payments. | Non-zero. |
| `setMaxFeeBps(n)` | Changes the fee ceiling. | `n <= 10_000`. Existing intents are checked against the value at payment time. |
| `pause()` / `unpause()` | Blocks / restores both payment paths. | None. |
| `transferOwnership` / `acceptOwnership` | Two-step handover. | `renounceOwnership` is **disabled** (reverts). |

The owner **cannot**: move, freeze or redirect user funds; change the token; upgrade the contract (not upgradeable, no proxy); mark intents paid/unpaid; withdraw anything.

## 5. Known risks and design decisions

1. **Stray tokens are unrecoverable.** USDC sent directly to the contract address (mistake or donation) stays there forever; there is deliberately no withdraw. The `payWithAuthorization` path forwards exactly `intent.amount`, so a pre-existing balance is never touched and never affects accounting. The invariant "balance is 0 after every payment" holds only absent donations; tests assert it in the absence of donations.
2. **USDC blacklist / pause.** Circle can blacklist addresses or pause USDC. If the merchant, payer or `platformWallet` is blacklisted the payment reverts atomically (no partial state). A blacklisted `platformWallet` blocks *all* payments until the owner calls `setPlatformWallet`. Merchant-side blacklisting only affects that merchant.
3. **USDC is an upgradeable proxy** controlled by Circle. A malicious or buggy upgrade is outside this contract's control.
4. **Signer compromise** allows attacker-chosen recipients for payers who are induced to pay (phishing-style). Mitigations: short expiries, payer binding in the signature, KMS, rapid rotation via `setSigner`, `pause`.
5. **Payer binding.** The intent signature binds `payer`; on the allowance path `msg.sender` must equal it. Contract-wallet payers (ERC-1271) are supported on the EIP-3009 path only if USDC accepts their signature; the *intent* signature is always verified with `ECDSA` (EOA signer).
6. **One payment per intent, forever.** `paid[intentId]` is never cleared. Overpay/underpay is impossible through this contract (exact signed amount or revert); those states can only arise from raw transfers handled off-chain.
7. **Timestamp dependence.** Expiry uses `block.timestamp` (`<=`); sequencer/validator skew of seconds is accepted.
8. **Front-running.** EIP-3009 uses `receiveWithAuthorization` so only this contract can consume the payer's authorization; nonce = `intentId` binds it to one intent. A third party may relay a valid submission, but funds can only go to the signed merchant/platform, so the outcome is identical to the intended one.
9. **Cross-chain / cross-deployment replay** is prevented by the EIP-712 domain (`chainId`, `verifyingContract`) and the `token` field. Tested (`test_signatureBoundToThisContractAndChain`, plus a Solidity/viem digest parity vector).
10. **Reentrancy.** `nonReentrant` on both entry points plus checks-effects-interactions. The token is trusted USDC (no hooks), but tests exercise a hostile token that re-enters during `transferFrom` and `receiveWithAuthorization`.
11. **Events after external calls** (`PaymentSettled`) are covered by the reentrancy guard. Off-chain consumers must also wait for confirmations and check block hashes (handled by the worker, not the contract).
12. **Not yet built:** multi-recipient splits (planned as a new typed-data struct/version), refund execution. These will be separate contracts/versions and need their own review.

## 6. Deposit addresses: `DepositFactory` / `DepositForwarder`

For customers paying from an exchange (a plain ERC-20 `transfer`, no signature, no contract call). `ClearGatewaySplitter` is unchanged.

**Mechanics.** Each payment gets a deterministic address: an EIP-1167 minimal-proxy clone of `DepositForwarder`, created with CREATE2 (`salt = intentId`) by `DepositFactory`. `DepositFactory.predict(intentId)` gives the address before anything is deployed; an unused address costs nothing. `sweep(intent, sig)` deploys the clone if needed and has it call `splitter.pay(intent, sig)` as the signed payer (`intent.payer` must equal the deposit address), so the 98/2 split still happens in one transaction. `sweep` is permissionless (anyone can relay; recipients are fixed by the signature). It is atomic: an underpaid deposit, bad signature, replay or paused splitter reverts everything, including the deployment.

**No admin.** The factory has no owner, pause or upgrade path. Implementation and splitter are immutable. Only `DepositFactory` can call a forwarder (`OnlyFactory`).

**Rescue (funds outside a settled payment).** Overpayment excess, underpaid/late deposits and wrong tokens stay at the address. `rescue(intentId, token, to, amount, expiry, sig)` moves them to `to` and is authorized by a backend signature over an EIP-712 `Rescue` struct in the FACTORY's domain (`ClearGatewayDepositFactory`/`1`), single use (`rescueUsed`), time-limited. By policy the backend only ever signs `to = merchant payout wallet`; the contract itself does not restrict `to` (see risk 2).

**Assumptions.** Sweeps move exactly `intent.amount`; the deposit may be larger (remainder stays; see rescue). Only `splitter.token()` (USDC) is swept. Exchange withdrawals are ordinary transfers to an address that has no code until swept.

**Risks specific to deposit addresses**
1. **Larger blast radius for the signer key.** Deposit funds are "pre-consented": the customer has already sent them to an address that only a signer-authorized call can move. A compromised signer can direct funds sitting in deposit addresses (pending sweeps, stuck leftovers) to an attacker. The exposure lasts from deposit until sweep or rescue. Mitigations: KMS-backed signer, signatures minted at sweep time with ~10 minute expiry (never in advance), sweeping as soon as the deposit is confirmed, worker-side checks that `merchant` equals the database payout wallet, alerting, `setSigner` rotation on the splitter (the factory follows `splitter.signer()`).
2. **`rescue` recipient is signer-chosen.** Same trust root as risk 1; a signer compromise can also rescue to any address. Backend policy (merchant wallet only) is not enforced on-chain.
3. **Sweep/rescue signature domain separation.** A sweep signature visible in a mempool cannot be replayed as a rescue (which would send the full amount to the merchant and skip the platform fee), and a rescue signature cannot authorize a sweep. Both directions are tested.
4. **Rescue replay.** Each rescue digest works once. Without this, a signature could be re-used to drain later deposits to the same address within its expiry; a test breaks if it is removed.
5. **Paused splitter blocks sweeps, not rescues.** While paused, deposits cannot be swept but can still be rescued with a signature.
6. **Wrong network / wrong token deposits.** Funds sent on another network to the same address string are not recoverable by this system. Other ERC-20 tokens on Base are recoverable via `rescue`; native ETH is rejected (no `receive`) except via forced sends, which are not recoverable.
7. **CREATE2 address knowledge.** Addresses are public and computable from `intentId`. Anyone may send funds to them; the factory cannot tell senders apart. Transfers of dust or from attackers only add to the balance.
8. **Off-chain assumptions.** The worker must not sweep an unconfirmed deposit (a reorg would revert the sweep safely, but the intent state would be wrong) and must not rescue USDC for an intent that could still legitimately be paid.
9. **The gas relayer holds no authority.** `sweep` is permissionless and its recipients are fixed by the backend signature, so the relayer key that submits it can, at worst, waste gas or delay a sweep — it can never redirect a payment or receive funds itself. It is a separate key from the signer for exactly this reason.

**Off-chain sweeper worker (`apps/worker/src/jobs/sweeper.ts`).** Only sweeps a deposit address once the deposit watcher has marked it `funded` (confirmed deposits, at the required confirmation depth, cover `intent.amount`). Signs a fresh intent at send time (payer = the deposit address, merchant = the payout wallet read from the database at that moment, expiry ≈ 10 minutes) rather than reusing anything issued earlier. If the underlying payment intent has reached a terminal state (canceled/expired/failed) by the time a deposit is funded, the worker refuses to sweep, flags the intent for manual review, and marks the address `abandoned`; it never sweeps to the merchant in that case. After a configurable number of failed attempts it likewise abandons and flags rather than retrying forever. Both the deposit watcher and the sweeper scope their queries to the currently configured `DepositFactory` address, so addresses created under a retired factory (after a rotation) are never mistakenly swept against a new one.

## 7. Test coverage (`forge test`)

- Happy paths for both payment methods; relayer submission; zero-fee.
- Wrong signer, garbage signature, tampered amount / merchant / fee / intentId / payer, wrong caller, wrong contract.
- Expiry (including exact-expiry), double payment (same path and cross path), fee cap, zero amount / merchant.
- EIP-3009: authorization for wrong value / payee / nonce; front-run attempt.
- Pause / unpause, all admin functions, access control, two-step ownership, disabled renounce, constructor validation.
- Fee rounding vectors shared with TypeScript; fuzz on `(amount, feeBps)` for split and full payment (both paths), 1000 runs each.
- Reentrancy via hostile token on both paths.
- Invariants (256 runs × 32 depth): splitter USDC balance is always 0; every USDC paid reaches merchant or platform.
- Digest parity with viem (`packages/chain/src/eip712.test.ts`).
- Deposit addresses (`test/DepositFactory*.t.sol`): prediction (incl. an independent manual CREATE2/EIP-1167 computation), sweep before/after deployment, over- and underpayment, wrong/other-intent payer, tampered fields, expiry, double sweep, paused splitter, signer rotation, fee cap, rescue (excess, underpaid, wrong token, pre-deployment), rescue wrong signer/tampering/expiry/replay, sweep-vs-rescue signature domain separation, no ETH, reentrancy through a hostile token, fuzz on amounts/fees/extra, invariants (factory and splitter hold nothing; every minted unit is in a deposit address, merchant or platform).

Not yet done: formal verification, gas-griefing review, external audit, mainnet fork tests against real USDC.

## 8. Reproducing

```
pnpm contracts:test          # forge test via Docker (no local Foundry needed)
pnpm contracts:build
pnpm contracts:export-abi    # writes packages/chain/src/abis/*.ts
```
