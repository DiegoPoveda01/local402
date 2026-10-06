# Threat model

Who can attack a Local402 payment, what they could get, and what stops them. It covers the whole path:
the seller's `402`, the payer's client, the facilitator, and the FxPay contract. The contract-level detail
behind the FxPay rows is in [security-review.md](security-review.md). Like that review, this was written by
the authors. **It is not an audit.**

## What is worth protecting

| Asset | Held by | Worst case if lost |
| --- | --- | --- |
| The payer's funds | The payer's account, and FxPay only for the length of one transaction | The payer spends more than the price, or pays for something else |
| The seller's revenue | The seller's account | The seller is paid less than its local price, or not at all |
| The facilitator's fee balance | The facilitator's fee-paying keys (XLM) | Someone else's traffic burns the fees, or a key leaks |
| The service itself | Seller API and facilitator | Payments stop: a stale price, a jammed facilitator |

FxPay holds nothing between payments. It has no admin, no upgrade and no pause, so there is no contract
balance to drain and no key that could redirect it.

## Attackers and mitigations

### A malicious or careless seller

| Attempt | Stopped by | Where |
| --- | --- | --- |
| Quote more than the local price is worth | `Local402Client` re-prices the route against its own oracle reading and refuses a quote more than 2% above it | `packages/client`, `maxOverchargeBps` |
| Quote on a stale or broken rate | The server refuses to quote when the rate is more than 15 minutes old, dated in the future, or zero, so no requirement is issued | `packages/pricing/src/quote.ts` |
| Change the price between the 402 and the paid retry | The quote is signed with `LOCAL402_QUOTE_SECRET`, and the facilitator checks amount, asset and recipient against the requirement | `packages/server`, `packages/fx` |

**Residual risk.** By default the seller and the payer read the same Reflector feed. That catches a seller
who misquotes, not a feed that is wrong. A payer that cares passes its own `oracle`.

### A malicious payer or agent

| Attempt | Stopped by | Where |
| --- | --- | --- |
| Pay a different amount, asset or recipient than the 402 asked for | `wrong_amount`, `wrong_asset` or `wrong_recipient` before simulation; FxPay reverts unless the seller receives exactly `dest_amount` | `packages/fx/src/facilitator.ts`, `contracts/fx-pay` |
| Smuggle extra authorizations into the transaction | Exactly one auth entry, rooted at FxPay's `pay`, with exactly one nested transfer (`unexpected_auth_entries`, `wrong_auth_root`, `wrong_auth_subinvocation`) | facilitator |
| Make the facilitator pay or sign as the payer | `facilitator_is_payer`, `unsafe_tx_or_op_source`, and `moves_facilitator_funds`, checked against the simulated events | facilitator |
| Pay with an asset nobody can route | `unsupported_send_asset` at the facilitator; `NoRoute` in FxPay otherwise | facilitator, contract |
| Hold a signed payment and replay it later | Signed deadline (`deadline_expired`, `deadline_too_far`), the auth's own expiry, and Stellar's nonce on the auth entry | facilitator, protocol |
| Make settlement expensive | Simulation must succeed, and the total fee must stay under `maxTransactionFeeStroops` (`fee_exceeds_maximum`) | facilitator |

### Someone draining the facilitator

Every settlement spends the facilitator's own XLM on fees. A public facilitator is therefore a target even
when nobody can steal payment funds through it.

| Attempt | Stopped by |
| --- | --- |
| Route dust payments through it to burn its fees | On mainnet, `MIN_AMOUNT` defaults to 100000 (0.01 USDC) |
| Use it to settle for arbitrary sellers | On mainnet, `PAY_TO_ALLOWLIST` defaults to the demo seller only (`pay_to_not_allowed`) |
| Flood `/verify` (an RPC simulation each) or `/settle` | 60 verify and 20 settle requests per minute per client IP; `trust proxy` is set to one hop so a client cannot pick its own IP through `X-Forwarded-For` |
| Send oversized or malformed bodies | 64 KB body limit; shape checks before the scheme runs (`invalid_request_body`, `invalid_payment_requirements`) |

**Residual risk.** The rate limits live in memory, so on a serverless deployment each instance counts on its
own. The allowlist and the minimum are what actually bound the cost on mainnet. That is why both stay on
until FxPay has an external audit.

### Someone who steals a facilitator key

The keys pay fees. They cannot spend a payer's funds: the payer's authorization fixes the asset, amount,
recipient and deadline, and the facilitator only wraps it. A stolen key loses whatever XLM that key holds
for fees. Mitigations: fund fee keys with operating float only; give each instance its own keys
(`FACILITATOR_PRIVATE_KEYS`), so one leak is one instance; rotate by replacing the variable.

### Someone on the network: front-running and pool manipulation

| Attempt | Bounded by |
| --- | --- |
| Move a Soroswap pool just before the payment so the swap costs more | The payer signs a `max_send`. FxPay reverts with `ExcessiveInput` above it, and refunds whatever is unused below it. The client refuses a `max_send` more than 5% above the oracle value (`maxFxPremiumBps`) |
| Make the swap deliver less than the price | Impossible without reverting: the seller is paid with an unconditional `transfer(dest_amount)` after the swap |

**Residual risk.** Per payment, an attacker can push the payer's cost up to the premium the payer accepted,
and no further. It is a bounded loss the payer chose when signing, not an open one.

### A compromised dependency

| Dependency | Trust placed in it | If it misbehaves |
| --- | --- | --- |
| Reflector oracle | Prices the local currency | A wrong feed gives a wrong price. Age and zero checks catch a dead feed, not a wrong one; an independent payer oracle catches a disagreeing one |
| Soroswap router (pinned in FxPay's constructor) | Quotes and executes the swap | It cannot short the seller (the final transfer reverts). It could push the payer's input up to `max_send` |
| SEP-41 token contracts | Standard transfers | FxPay mutates no storage during `pay`, so re-entry has no state to corrupt |
| x402 SDK | Builds and settles `exact` | Pinned to an exact version (2.25.0); the one upstream bug we hit was fixed in [x402#3503](https://github.com/x402-foundation/x402/pull/3503) |

## Out of scope

- **Key management on the payer's side.** The wallet or agent holding the payer's secret is the payer's.
- **Seller-side accounting.** Turning USDC into local currency after the sale is not Local402's job.
- **Availability of Stellar, Soroban RPC or Reflector.**

## What would change this model

- **An external audit of FxPay.** It is not in the October 2026 sprint (see [sprint-plan.md](sprint-plan.md)).
  It is the goal of the next funding step. Until it happens, the mainnet facilitator keeps its allowlist and
  its minimum amount.
- **A seller other than the demo on mainnet.** Adding one, such as kuyfi
  ([kuyfi#2](https://github.com/alex0tico/kuyfi/issues/2)), is an allowlist entry, not a code change. Each
  entry widens who can spend the facilitator's fees, so each one is added by hand.
