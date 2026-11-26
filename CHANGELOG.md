# Changelog

The four packages (`local402-pricing`, `local402-fx`, `local402-client` and `local402-server`) share one
version from 1.0 on. `local402-facilitator`, the facilitator kit new in 1.0, is released with them under
the same version.

## create-local402 1.0.0 and local402-client 1.3.1

### Added

- **`create-local402`.** `npm create local402` asks for a price in the seller's currency, creates the seller,
  facilitator and buyer accounts on testnet with Friendbot, adds the USDC trustlines, writes an Express app that
  sells `GET /hello` at that price with its own facilitator in the same process, installs and starts it, and pays
  it with USDC (`exact`) and with XLM (`exact-fx`), printing both transaction links. A failure names the step
  that failed. A scheduled workflow runs it every 6 hours on a clean runner. It has its own version, like
  `local402-mcp`.

### Fixed

- **`local402-client` paid nothing above $1.** x402 caps each payment at $1 by default, so a 1.20 EUR or
  2000 CLP route was refused even within `maxPrice`. A client with `maxPrice` or a budget now lifts that
  cap, since its own limit is checked before signing; a client with neither keeps it. Only `local402-client`
  moves to 1.3.1; `local402-mcp` and `local402-paywall` pick it up through their `^1.3.0` range.

## 1.3.0

### Added

- **`local402-paywall`.** An x402 `PaywallProvider` for routes priced with `localRoute`. A browser that
  opens a paid route gets a page with the local price, a choice of USDC, XLM or EURC with the amount in
  each, and a button that pays from Varial with `local402-client`. Payments above a maximum (by default
  the route's price plus 2%) are refused before the wallet is asked to sign. Agents keep getting the
  x402 402. The page's script is published as `dist/browser.js` and loaded from jsDelivr by default.

### Changed

- **`local402-client` checks every limit before anything is signed.** `pay()` used to create the
  payment, which signs it, and then check `maxPrice` and the budgets. It now checks the price the 402
  states first, and checks again only if the payment comes out at a different amount. For `exact-fx`,
  the FxPay quote plus slippage is checked between the quote and the signature.
- `local402-fx`: `ExactFxClientScheme` takes a `beforeSign(maxSend, requirements)` hook. It runs after
  the quote and before any auth entry is signed, and throwing from it stops the payment.
- The other packages move to 1.3.0 with `local402-paywall`, as they share one version.

## 1.2.0

### Added

- **Seller receipts in `local402-server`.** `recordReceipts(store)` is an `onAfterSettle` hook that keeps
  one receipt per settled payment: the price as the seller set it, the exchange rate with its oracle and
  publication time, the USDC received, what an `exact-fx` payer spent, the payer, the scheme and the
  transaction hash. `MemoryReceiptStore` and `FileReceiptStore` come with it; any other backend implements
  the two methods of `ReceiptStore`. `receiptsHandler(store, "json" | "csv")` serves them, and
  `receiptsToCsv` / `receiptsToJson` export them, with exact decimal amounts and spreadsheet-safe cells.
  The demo's own receipts code is gone: it records with the package and keeps them in Redis through its
  own `ReceiptStore`.

### Changed

- The demo's `/receipts.csv` uses the package's English column names (`usdc_received`, not
  `usdc_recibido`) and adds `oracle_time`, `network` and `pay_to`.
- The other four packages move to 1.2.0 with `local402-server`, as they share one version.

## 1.1.0

### Added

- **`local402-client` accepts several budgets.** `budget` takes one `SpendingBudget` or an array, and a
  payment must fit every one of them, so a daily and a total limit can be enforced together. `client.budget`
  still returns the first.
- **`local402-mcp` 1.0.0.** Per-payment, daily and total limits in any supported currency (`LIMITS=2000 CLP/day,
  5000 NGN/payment`), converted with the oracle sellers price with and counted from a payment history on disk,
  so they hold across restarts. New `local402_quote` (prices without paying) and `local402_history` tools,
  and `local402_discover` filters by currency and maximum price. Defaults are low limits on testnet; any
  `NETWORK` other than `stellar:testnet` or `stellar:pubnet` is refused. Setup for Claude Code, Claude Desktop
  and Cursor in its README, and CI runs an end-to-end job that quotes, pays and reads the history on testnet.

## 1.0.1

### Fixed

- **Testnet works again after its protocol 30 upgrade.** 1.0.0 pinned `@stellar/stellar-sdk` 16.3.0, which
  cannot read protocol 30 ledgers and fails with `XDR Read Error: unknown StellarValueType member for value 3`
  when it settles or verifies a payment. All five packages now pin 16.4.1. Mainnet is still on protocol 29,
  but it needs this release once it upgrades.

## 1.0.0

1.0.0 is the npm `latest` release, so a plain install gets it:

```sh
npm install local402-server local402-client
```

### Breaking

- **A seller needs a quote secret.** `localPrice`, `localRoute` and `localToolPayment` throw
  `QUOTE_SECRET_MISSING` at startup when neither `LOCAL402_QUOTE_SECRET` nor `quoteSecret` is set, and
  `QUOTE_SECRET_WEAK` when it is shorter than 32 characters. In 0.x they logged a warning and served
  unsigned quotes, so a paid retry that landed on another instance re-quoted and could reject a payment
  the payer had already signed.
- **Configuration is validated when it is built**, not on the first request. A misspelt network, a
  `payTo` or `fxContract` that is not a Stellar address, a non-http(s) `facilitatorUrl` or `rpcUrl`, or
  an out-of-range bps or seconds option now throws `INVALID_CONFIG` at startup.
- **Zero prices are rejected.** `"0 CLP"` throws `INVALID_PRICE` when the route is declared.
- **`Local402Client` takes a `secret` or a `signer`, not both.**
- **With XLM or EURC, `fxSlippageBps` must stay below `maxFxPremiumBps`** (defaults 200 and 500). A
  slippage that reaches the premium leaves the swap price no room to move, so nearly every payment was
  refused before it was signed. Now the client refuses to start.
- **`quoteTtlSeconds` may not exceed `maxOracleAgeSeconds`** (default 900). A quote that outlives the
  rate it was priced on lets the payer wait and pay only when the market has moved in their favour.
- **`local402-fx` depends on `local402-pricing`**, for the shared error class.

### Added

- `Local402Error`, exported by every package, with a stable `code` for every refusal and configuration
  error. See [docs/errors.md](docs/errors.md).
- `NO_PAYMENT_OPTION`: a client facing a seller that accepts none of its schemes or networks says so,
  and lists what the seller accepts, instead of failing inside x402.
- `quoteSecret` on `localRoute` and `localToolPayment`, passed through to `localPrice`.
- `examples/quickstart`: a route priced in pesos in 14 lines, compiled in CI.
- `local402-facilitator`: the facilitator as a package anyone can run with `npx local402-facilitator` or
  its Dockerfile, instead of from this repository. Every variable is validated at startup; verify and
  settle have separate per-client limits; `/health` and `/ready` (503 when the RPC, a fee payer's
  balance or FxPay fails); `keys` makes an instance its own fee-paying accounts and `check` tests a
  deploy before it takes traffic. See [docs/facilitator.md](docs/facilitator.md) and
  [the runbook](docs/facilitator-runbook.md).

### Security

- Error messages never repeat a secret key passed by mistake as `payTo` or a contract address, nor a
  `facilitatorUrl`, `rpcUrl` or oracle RPC URL, which can carry an API key. These messages end up in logs.
- The refusal a seller sends back (`PAYMENT_FAILED`) is cut to one line of at most 300 characters before
  it reaches the error. Through the MCP server that text is read by a model, so a hostile seller can no
  longer flood it or slip in multi-line instructions.
- A `SpendingBudget` holds when payments run at the same time. Before, two concurrent `pay` calls could
  both pass the budget check before either reserved its amount, and together spend past the limit.
- `Local402Client.quote` and `pay` throw `RESOURCE_UNAVAILABLE` when the resource answers an error. Before,
  any answer other than 402, a 500 included, came back as a free resource, so a seller that was down looked free.
- The demo apps treat an empty `MAX_PRICE`, `BUDGET` or `DEMO_MAX_PRICE` as unset and keep their default
  cap. Before, an empty value on the host meant no cap at all.
- The facilitator treats an empty `PAY_TO_ALLOWLIST` the same way, and on `stellar:pubnet` refuses to
  start without one. Before, `PAY_TO_ALLOWLIST=` on a mainnet host settled for any seller.
- `local402-facilitator` trusts no proxy unless `TRUST_PROXY` says so. A default of one proxy let a client
  that connects directly write its own `X-Forwarded-For` and get a new rate-limit bucket on every request.
  The Local402 deployment on Vercel keeps one.

### Unchanged

The wire format: quotes, their signature, requirements and the `exact-fx` payload are built the same
way as in 0.1, so a 1.0 client pays a 0.x seller and the reverse. The FxPay contract is not touched.

## 0.1.x

The versions published during the Find Your Way hackathon. Their history is the git log up to the
`v0.1.1` tag.

## Migrating from 0.x to 1.0

Most sellers change one line of configuration and no code.

1. **Set the quote secret on every seller instance.** Generate it once and give every instance the
   same value:

   ```sh
   LOCAL402_QUOTE_SECRET=$(openssl rand -hex 32)
   ```

   A seller that runs as exactly one process, and would rather not sign, can opt out explicitly:

   ```ts
   localRoute("50 CLP", { payTo, quoteSecret: false });
   ```

2. **Start it once.** Any option 0.x accepted but could never use now throws `INVALID_CONFIG` with the
   option's name and what it accepts. Fix what it names.

3. **Branch on codes, not messages.** If you matched error text, such as `/Refusing to pay/`, match
   `error.code` instead:

   ```ts
   if (error instanceof Local402Error && error.code.startsWith("REFUSED_")) { … }
   ```

   Every error is still an `Error` with a readable message, so code that only logs it keeps working.

4. **Client:** pass either `secret` or `signer`. If you pay with XLM or EURC and raised `fxSlippageBps`,
   keep it below `maxFxPremiumBps`.
