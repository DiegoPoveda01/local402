# October 2026 sprint: from demo to something another builder can use

A 30-day sprint, proposed to start 2026-10-15, applied for through Stellar Instawards (Stellar Chile chapter).
This file is the public version of the plan. Each deliverable has the evidence that proves it is done.
If the evidence is not there at the end, the deliverable is not done.

**Starting point (2026-10-06).** Four packages on npm at 0.1.x (`local402-pricing` 0.1.4, `local402-fx`
0.1.2, `local402-client` 0.1.3, `local402-server` 0.1.1). 41 TypeScript and 11 Soroban tests, CI green.
FxPay is live on mainnet with real XLM and EURC payments. One outside seller, kuyfi, charges in CLP on
testnet. There is no integration guide, and the mainnet facilitator settles only for the demo seller.

**Goal.** Another Stellar builder can take a route priced in their own currency from zero to paid in an
afternoon, with only the published packages and docs.

## Deliverables and acceptance criteria

| # | Deliverable | Done when |
| --- | --- | --- |
| D1 | **Packages 1.0.** Strict config validation with actionable messages, an explicit error code for every refusal, the signed-quote secret enforced, a CHANGELOG and a 0.x → 1.0 migration note. | The four packages are published as `1.0.0` on npm. A sample project in `examples/` prices a route in local currency in under 20 lines and builds in CI. |
| D2 | **A facilitator anyone can deploy.** One-command deploy, documented variables, a payee allowlist and a minimum amount, separate verify and settle limits, per-instance channel keys, health and readiness endpoints, and a runbook for keys and funding. | A second facilitator, deployed from the kit and not from our working tree, settles a testnet payment for a seller that is not ours. The tx hash is on stellar.expert. |
| D3 | **Integration guide and API reference.** Price a route, run it on testnet, then move to mainnet. Covers the 402 shape, `extra.local402`, `exact` and `exact-fx`, the client guards and receipts, plus a reference for every public function. | The guide is in the repo. Pau Koh (Stellar Chile community, not part of the project) has followed it from scratch with only the written steps, with screenshots. Every place where the run got stuck is fixed in the guide. |
| D4 | **Tests, QA and CI.** Oracle edge cases (stale, gaps, single-record prints), client guards, facilitator verification rules, and new contract tests for routing and refunds. A scheduled mainnet smoke test that quotes every demo route. | CI is green on `main`. The test count and coverage are reported here before and after. The scheduled workflow is visible in GitHub Actions. |
| D5 | **One external API charging through Local402.** kuyfi moves to the 1.0 packages and runs real paid scans on testnet: quote, sign, settle. Its payee is added to the mainnet allowlist and the mainnet switch is documented. Going live on mainnet is up to kuyfi ([kuyfi#2](https://github.com/alex0tico/kuyfi/issues/2)). | kuyfi's `/scan` answers `402` with a CLP quote. There are testnet tx hashes of paid scans made with the 1.0 packages. kuyfi#2 is updated with the mainnet plan. |

D5 is the acceptance test for the rest. If a seller we did not write cannot get from the published packages
and docs to a paid route, the sprint is not done.

## Week by week

| Week | Work | End-of-week check |
| --- | --- | --- |
| 1 | D1: validation, error codes, quote secret, CHANGELOG, migration note | Release candidates on npm. The sample project builds green in CI |
| 2 | D2: the deploy kit. D4: new test suites | A second facilitator settles on testnet. CI is green with the new suites |
| 3 | D3: the guide and reference, then Pau's run from scratch | The guide is revised from that run, with screenshots |
| 4 | D5: kuyfi on 1.0, paid testnet scans, allowlist entry. D4: the smoke test. 1.0 final. The `exact-fx` proposal opened upstream | Every row of the table above has its evidence. A written report goes to the Stellar Chile chapter lead |

## Plan B: if kuyfi cannot move in time

kuyfi is someone else's project. Its move to 1.0 needs its maintainer to merge it, and that may not happen
inside 30 days. If kuyfi has not merged by the start of week 4:

1. We run kuyfi's own server from a fork (it is MIT) on the 1.0 packages, against testnet. The payee is a
   fresh account, not the demo seller.
2. The same evidence is required: a `402` in CLP, paid scans with tx hashes on stellar.expert, made only with
   the published 1.0 packages.
3. We record the whole flow end to end as a video: request, `402`, quote, signature, settlement, `200`.
   kuyfi's current integration is already recorded this way, in
   [this thread](https://x.com/dpoveda0/status/2107313680660812005) (testnet tx
   [`44ef0d00…c8abf42`](https://stellar.expert/explorer/testnet/tx/44ef0d00b52dafd64acdb97b1c992ba62f996f7ee5a1d9c35f258d339c8abf42)).
4. The upstream PR stays open, and the final report says plainly that D5 closed on the fork rather than on
   kuyfi's main branch.

If Pau cannot do the D3 run, another member of the Stellar Chile community who is not part of the project
does it. The acceptance criterion stays the same.

## D4: tests before and after

Counted with `npm test`, `npm run coverage` and, in `contracts`, `cargo test` and `cargo llvm-cov`. TypeScript
coverage is of what ships to npm (`packages/*/src`), not of the demo apps.

| | Sprint start (2026-10-06) | Before the D4 suites (2026-10-18) | After (2026-10-18) |
| --- | --- | --- | --- |
| TypeScript tests | 41 | 86 (+4 that need testnet) | 140 (+4 that need testnet) |
| Soroban tests | 11 | 11 | 17 |
| Statements covered | | 62.89% | 82.93% |
| Branches covered | | 86.44% | 92.48% |
| Functions covered | | 68.75% | 88.05% |
| FxPay (`lib.rs`) regions and lines covered | | 97.73% and 98.70% | 100% and 100% |

By package, statements before and after: pricing 79.68% to 93.48%, client 59.86% to 73.92%, facilitator
65.39% to 68.25%, server 87.09% (unchanged), fx 50% to 90.57%.

The new suites:

- **Oracle** (`packages/pricing/test/oracle.test.ts`): the median of recent prints, gaps in the history,
  single-print rates, a missing history, zero prices, the last good rate reused for ten minutes and then
  dropped, a reused rate that still goes stale, and an RPC that fails or hangs.
- **Client guards** (`packages/client/test/guards.test.ts`): the cap on a plain x402 price, a stale oracle on
  the client's side, overcharges, a seller's refusal cut to one bounded line, and the budget given back when a
  payment does not go through. One test found that two payments running at the same time could both pass the
  budget check and spend past it; that is fixed (see the CHANGELOG). A seller that answers an error, a 500
  for example, is no longer read as a free resource.
- **Facilitator verification rules** (`packages/facilitator/test/verification.test.ts`): every shape check
  before the scheme runs, the order of the allowlist checks, verify and settle limits counted apart, the
  `X-Forwarded-For` rule, the one retry of a settlement that never reached the ledger, and `/supported`.
- **`exact-fx` against the network** (`packages/fx/test/facilitator-rpc.test.ts` and `client-rpc.test.ts`),
  with the Soroban RPC replaced by stubs so they run offline: the payer's one authorization and what it
  covers, how far its signature may reach, a failed or too costly simulation, the delivery to the seller
  and no tokens moved out of the facilitator's accounts, an unsigned payment, every way a settlement ends
  (sent, refused, failed, still pending), the fee bid, and the client's side, whose signed `pay` is then
  verified by the facilitator. Breaking any of the four delivery and authorization checks fails a test.
- **FxPay routing and refunds** (`contracts/fx-pay/src/test.rs`): no hub route when the hub is one of the two
  assets, the delivery and refund events the facilitator looks for, no refund when nothing is left over, and a
  router that tries to take more than the quoted input, or delivers short, reverts the whole payment, and
  amounts that are zero or negative are refused.

The 86 already include D1's `test/compat-0.1.test.ts` (9 tests: the published 0.1 packages against the 1.0 code).

The scheduled smoke test is `.github/workflows/smoke.yml`: every six hours it asks each paid route of the
mainnet demo for its price and checks the quote against Reflector, with `scripts/smoke.ts`. It never pays and
needs no secrets.

## Explicitly not in this sprint

- **An external audit of FxPay.** The code is left audit-ready: [security-review.md](security-review.md)
  and [threat-model.md](threat-model.md) are where an auditor starts. The audit itself is the next step of the
  roadmap, and it needs its own funding.
- **Lifting the mainnet allowlist or minimum amount.** Both stay until the audit.
- **Getting `exact-fx` merged into x402.** We open the proposal. When it merges is up to x402's maintainers.
- New currencies or oracles, marketing, bounties, legal work, mobile apps, or a hosted paid service.
