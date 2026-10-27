# Changelog

The four packages (`local402-pricing`, `local402-fx`, `local402-client` and `local402-server`) share one
version from 1.0 on. `local402-facilitator`, the facilitator kit new in 1.0, is released with them under
the same version.

## 1.0.0

For now 1.0.0 is published under the npm `next` tag, so `npm install local402-server` keeps
installing 0.1.x until `latest` moves to 1.0:

```sh
npm install local402-server@next local402-client@next
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
