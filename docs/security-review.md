# FxPay security review (internal)

This is an **internal** review of `contracts/fx-pay`, written by the authors. It is not an
external audit. Its purpose is to state the contract's invariants and trust boundaries plainly,
record what has been checked, and give an outside auditor a place to start. Where the README says
*"It is not audited,"* it still means it: nothing here replaces a paid third-party review.

Reviewed at `contracts/fx-pay/src/lib.rs` (161 lines) and `src/test.rs` (10 tests, all passing:
`cargo test -p fx-pay` → 10 passed).

## What the contract does

`pay(from, send_asset, max_send, dest_asset, dest_amount, pay_to, deadline)`:

1. Requires the payer's authorization for the exact call.
2. Rejects `max_send <= 0`, `dest_amount <= 0`, and `send_asset == dest_asset`.
3. Routes on Soroswap — the direct pool or a hop through the hub (XLM) — and picks the cheaper
   input, or fails with `NoRoute`.
4. Rejects if the required input exceeds `max_send` (`ExcessiveInput`).
5. Pulls `max_send` of `send_asset` from the payer into the contract.
6. Authorizes exactly one nested transfer of `amount_in` from the contract to the pool, and swaps
   for **exactly** `dest_amount` of `dest_asset`.
7. Transfers `dest_amount` to `pay_to`, refunds `max_send - amount_in` to the payer, emits `FxPaid`.

Everything after step 1 is one transaction. If any step fails, the whole thing reverts and nothing
moves.

## Invariants that hold, and why

- **The seller receives exactly `dest_amount` or the payment reverts.** The delivery on line 150 is
  an unconditional `transfer(this -> pay_to, dest_amount)`; if the swap did not leave that much in
  the contract, this transfer fails and the transaction reverts. The seller cannot be shorted.
- **The payer never spends more than `max_send`.** The input is bounded twice: `amount_in > max_send`
  reverts before any transfer (line 127), and the nested auth entry authorizes the pool to pull
  `amount_in`, not `max_send` (lines 137–147). The unused part is refunded (lines 151–153).
- **The contract holds no balance between payments.** Instance storage holds only `ROUTER` and `HUB`,
  both set once in the constructor. There is no setter, no admin, no upgrade, no pause. Any
  `send_asset` it touches is either swapped or refunded within the same call; `dest_asset` is
  forwarded to the seller within the same call. The end-of-call balances are asserted to be zero in
  `delivers_exact_amount_and_refunds_unused_input`.
- **The payer's signature fixes the whole deal.** `from.require_auth()` binds every argument —
  `send_asset`, `max_send`, `dest_asset`, `dest_amount`, `pay_to`, `deadline`. A facilitator cannot
  redirect the funds, change the asset, or raise the amount after signing.
- **A missing or wrong route is a readable error, not a trap.** `route` uses `try_router_get_amounts_in`
  and treats an empty answer as "no route on this path," so one dead pool cannot hide a live hub route,
  and a total absence returns `NoRoute` the payer can read.

## Trust boundaries (what an auditor should push on)

- **The Soroswap router is trusted.** Its address is pinned at construction and never changes. The
  contract's guarantees hold *given* a router that behaves like Soroswap's: if a compromised router
  under-delivered `dest_asset`, the final transfer to the seller would revert (safe), but a router
  that manipulated `router_get_amounts_in` versus the actual swap price could push the input up to
  `max_send`. The payer is protected by `max_send`; the tightness of the quote is only as good as the
  pinned router. **Verify the mainnet router address is the canonical Soroswap router.**
- **`amount_in_max` on the swap is the freshly quoted `amount_in`, not `max_send`.** This is
  conservative (it reverts on any rounding above the quote inside the same transaction) rather than
  loose. An auditor should confirm there is no path where legitimate rounding makes the exact-out swap
  need one unit more than the quote and revert a valid payment.
- **Token contracts are assumed standard (SEP-41).** `send_asset` and `dest_asset` are chosen by the
  payer and seller. A non-standard token with a transfer hook could re-enter, but no contract storage
  is mutated during `pay` after the reads, so there is no state for re-entry to corrupt.
- **The nested auth targets `router_pair_for(send_asset, path[1])`.** If the router misreported the
  pair, the authorized transfer context would not match what the swap pulls, and the swap would fail
  its own auth check and revert. Worth confirming against the production router's behavior.

## Test coverage

Ten tests, all passing: exact delivery + refund, quote-equals-spend, excessive input rejected, hub
routing when there is no direct pool, cheapest-route selection, no-route rejection, empty-amounts
router rejection, hub fallback when the direct pool answers empty, same-asset rejection, and payment
refused without payer authorization.

## Audit-readiness checklist

- [x] No admin, upgrade, or pause function
- [x] No persistent balances between payments
- [x] Payer authorization binds every argument
- [x] Input bounded by `max_send`; unused input refunded
- [x] Seller delivery is unconditional or the payment reverts
- [x] 10 unit tests against a mock router (happy path, refunds, routing, and every error)
- [ ] External third-party audit
- [ ] Property / fuzz tests on `route` and the exact-out rounding boundary
- [ ] `cargo audit` on the dependency tree (tooling not yet run in this environment)
- [ ] `cargo clippy` clean (component not installed in this environment)
- [ ] Confirm the pinned mainnet Soroswap router and hub addresses on deployment

Until the first three unchecked items are done, the mainnet facilitator keeps its two guards: it
settles only for the demo seller and only for at least 0.01 USDC.
