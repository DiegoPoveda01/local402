# November 2026 sprint: both ends of a payment in local currency

A 30-day sprint, proposed to start 2026-11-16, applied for through Stellar Instawards (Stellar Chile chapter).
It follows the [October sprint](sprint-plan.md), which is complete. This file is the public version of the
plan. Each deliverable has the evidence that proves it is done. If the evidence is not there at the end, the
deliverable is not done.

**Starting point (2026-11-09).** Five packages at `1.0.1` on npm (`local402-pricing`, `local402-fx`,
`local402-client`, `local402-server`, `local402-facilitator`). 140 TypeScript and 17 Soroban tests, 82.93% of
statements covered, CI green with a scheduled mainnet smoke test. The agent entry point, `local402-mcp`, is still
`0.1.0`: one in-memory budget per session, no payment history, no way to quote without paying. Receipts in local
currency and payment from Varial both exist, but only in the demo app, not in a package a seller can install.
Getting to a first paid route still means following the [integration guide](integration-guide.md) step by step.

**Goal.** Local402 already prices in local currency on the wire. At the end of this sprint it does so at the two
ends people touch: an agent operator sets a budget in pesos, a seller books the sale in pesos, a person in a
browser can pay the same route an agent pays, and a new seller gets to a paid route with one command.

Every deliverable is proven by code we publish, CI we run and transactions on Stellar testnet. None of the
evidence depends on another team or person.

## Deliverables and acceptance criteria

| # | Deliverable | Done when |
| --- | --- | --- |
| D1 | **`local402-mcp` 1.0: agent budgets in local currency.** Per-payment, daily and total limits set as `2000 CLP/day` or `5000 NGN/payment`, converted with the same oracle rate the seller uses and kept across restarts. A quote tool that does not pay, a payment-history tool with each receipt and transaction link, Bazaar discovery filtered by currency and maximum price, and safe defaults (testnet unless mainnet is explicit, low default limits). Setup for Claude Desktop, Claude Code and Cursor through `npx`. | `local402-mcp` 1.0.0 is on npm. CI tests the three budget paths (over the per-payment limit, over the daily limit, after a restart) and runs an end-to-end job where an MCP client quotes, pays and reads its history on testnet. At least 10 testnet payments made by an agent through it are listed here with their hashes. |
| D2 | **Seller receipts in local currency.** Receipts move from the demo app into `local402-server`: one per settled payment, with the price as the seller set it, the exchange rate and its oracle timestamp, the USDC received, the payer, the scheme and the transaction hash. Memory and file storage, with a documented interface for others, a receipts endpoint, and CSV and JSON export. | `local402-server` 1.1.0 is on npm with a CHANGELOG entry and tests for each storage backend and both formats. Every row of the CSV downloaded from the testnet demo on local402.xyz matches one transaction on stellar.expert, one to one, with the local price, rate and USDC amount. |
| D3 | **`local402-paywall`: a browser paywall priced in local currency.** It follows the x402 paywall pattern and adds the price in the seller's currency and payment in XLM or EURC through `exact-fx`. When a browser opens a paid route, the seller returns a page with the price (for example 500 CLP) and the amount in the asset the visitor picks. The visitor pays from Varial, with a maximum-price guard so the wallet never signs more than the quote allows, and then sees the content and the transaction link. The same route keeps answering agents with x402. | `local402-paywall` is on npm with tests (quote shown, maximum-price guard, each asset path). A paid testnet route on local402.xyz can be paid by anyone from Varial. One testnet payment in each of USDC, XLM and EURC goes through the published package, and a payment above the quoted maximum is refused before the wallet signs. |
| D4 | **`npm create local402`: a first paid route in one command.** `create-local402` creates and funds a testnet account through Friendbot, adds the USDC trustline, writes an Express app with a route priced in the currency the seller picks, and makes a paid request against it with `exact` and `exact-fx`, printing the transaction links. The guide gets a quick start that is this one command. | `create-local402` is on npm. A scheduled GitHub Actions workflow runs it every 6 hours on a clean runner against testnet, with the transaction hashes in each run's log, and has run green on at least 10 of its last 12 runs at the end of the sprint, with any failure traced to testnet or Friendbot in the log. Coverage across the packages stays at 80% or more. |

## Week by week

| Week | Work | End-of-week check |
| --- | --- | --- |
| 1 | D1: persistent budgets, quote and history tools, discovery filters, safe defaults, setup docs, end-to-end CI | `local402-mcp` 1.0.0 on npm and an agent paying through it on testnet |
| 2 | D2: receipts API, the two storage backends, the receipts endpoint, CSV and JSON export | `local402-server` 1.1.0 on npm. The testnet demo records receipts and serves a CSV |
| 3 | D3: the Varial flow moves out of the demo into `local402-paywall`, with the price page, the three asset paths and the guard | A paid testnet route on local402.xyz that anyone can pay from Varial |
| 4 | D4: `create-local402`, the scheduled onboarding workflow, the quick start | Every row of the table above has its evidence. A written report goes to the Stellar Chile chapter lead |

Progress and its evidence links are posted to Passport every week, as in October.

## Evidence

### D1: testnet payments made by an agent through `local402-mcp`

Ten payments of 50 CLP (0.0502463 USDC each, paid with XLM through `exact-fx`) for
`https://local402.vercel.app/indicadores`, made on 13-11-2026 by `scripts/mcp-e2e.ts`: an MCP client that
starts the server, discovers the route with the currency and price filters, quotes it, pays it ten times and
finds every transaction in `local402_history`. Payer `GAMEBKSUXN7JVQDGSAIX2ATSZUISQIC6RZVEGFYYVK52236KIECWOPXC`.

| # | Transaction |
| --- | --- |
| 1 | [`c8d4a0d6…8ef38`](https://stellar.expert/explorer/testnet/tx/c8d4a0d67d128d8982993ca9308c8a316927d18f8061b7a3fef6e36110b8ef38) |
| 2 | [`c7fa10c4…f2a02`](https://stellar.expert/explorer/testnet/tx/c7fa10c4d662a8f616be72238c18103f8b5542f1f5dd722b667c7c2b577f2a02) |
| 3 | [`d6683110…db168`](https://stellar.expert/explorer/testnet/tx/d66831106bda0f1f48905463f7b0c27f2aa796a88aadd3c8ee045db4327db168) |
| 4 | [`0acd361f…6a4f0`](https://stellar.expert/explorer/testnet/tx/0acd361f9e1f3b01f5ce77fe9f14745d100890b50d8a38fd5f57629cf0a6a4f0) |
| 5 | [`0deb5dcf…30144`](https://stellar.expert/explorer/testnet/tx/0deb5dcfa7c583a3ff16fe57606384779dfb0cb0058da609b469265ae1230144) |
| 6 | [`7d6393f3…88640`](https://stellar.expert/explorer/testnet/tx/7d6393f3d6d77739dae5c9db1fc12c827707e34b3df71e8712b7d93916588640) |
| 7 | [`9c8f8849…e870c`](https://stellar.expert/explorer/testnet/tx/9c8f884970de3aa3dcf4cd8b04624c81a3b30f2aa3c12c8739705957cde1870c) |
| 8 | [`195dd3b3…12164`](https://stellar.expert/explorer/testnet/tx/195dd3b3e1da28f0dc3a5e0c83dc8c48169055e4cc765550dbeba8e358c12164) |
| 9 | [`8664695a…660cf`](https://stellar.expert/explorer/testnet/tx/8664695a2d1a527c0b85cb09b9ffc9038212e553e1ad259dd8f3a615e0c660cf) |
| 10 | [`ae36a8a9…b3b19`](https://stellar.expert/explorer/testnet/tx/ae36a8a99078a0333ed318d6e5f2b985aa359146d774735b307e693b4e8d3b19) |

## Explicitly not in this sprint

- **Anything delivered in October** (the 1.0 packages, the facilitator kit, the integration guide, the CI
  expansion, kuyfi on 1.0). This sprint builds on it.
- **An external audit of FxPay, and opening the mainnet facilitator to sellers beyond the allowlist.** Both
  wait for the audit.
- **Getting `exact-fx` merged into x402.** The [proposal](https://github.com/x402-foundation/x402/issues/4091)
  is open. When it merges is up to x402's maintainers.
- Onboarding or paying third-party sellers, user acquisition, marketing, events or bounties.
- New currencies, oracles or swap routes, and legal or accounting work.
