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

## Explicitly not in this sprint

- **An external audit of FxPay.** The code is left audit-ready: [security-review.md](security-review.md)
  and [threat-model.md](threat-model.md) are where an auditor starts. The audit itself is the final goal of the
  roadmap, an SCF Build application. A follow-on Instaward, if eligible, comes before it.
- **Lifting the mainnet allowlist or minimum amount.** Both stay until the audit.
- **Getting `exact-fx` merged into x402.** We open the proposal. When it merges is up to x402's maintainers.
- New currencies or oracles, marketing, bounties, legal work, mobile apps, or a hosted paid service.
