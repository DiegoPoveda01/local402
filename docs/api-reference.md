# API reference

Every public export of the five npm packages, version 1.0. The [integration guide](integration-guide.md)
shows them working together; this page says what each one takes and returns.

| Package | For | You need it when |
| --- | --- | --- |
| [`local402-server`](#local402-server) | sellers | you price a route or an MCP tool in local currency |
| [`local402-client`](#local402-client) | payers | you pay Local402 routes from code or the command line |
| [`local402-pricing`](#local402-pricing) | both | you want the quote without x402, or a custom oracle |
| [`local402-fx`](#local402-fx) | advanced | you build your own x402 client or facilitator for `exact-fx` |
| [`local402-facilitator`](#local402-facilitator) | operators | you run the service that verifies and settles payments |

Conventions on this page:

- A **price** is a string `"<amount> <currency>"`: `"50 CLP"`, `"1.5 USD"`, `"0.01 UF"`. The currency is
  an ISO 4217 code that Reflector publishes, `USD`, or `UF` (also accepted as `CLF`).
- **Amounts** of tokens are strings or bigints in the token's smallest unit. USDC, XLM and EURC all have
  7 decimals, so `"505278"` is 0.0505278.
- A **network** is `"stellar:testnet"` or `"stellar:pubnet"`. Every default is testnet.
- Every error thrown on purpose is a `Local402Error` with a stable `code`. All packages re-export it. The
  codes, with causes and fixes, are in [errors.md](errors.md).

## local402-server

```ts
import { localRoute, local402Server, Local402Error } from "local402-server";
import { localToolPayment } from "local402-server/mcp";
```

### `localRoute(price, options): RouteConfig`

An x402 route priced in local currency, for `paymentMiddleware` from `@x402/express` (or any x402 HTTP
middleware built on `@x402/core` 2.25). Each 402 offers `exact` (USDC) and `exact-fx` (XLM or EURC, via
FxPay) for the same USDC amount, from one shared quote.

```ts
paymentMiddleware({ "GET /weather": localRoute("50 CLP", { payTo }) }, local402Server(url));
```

| Option | Type | Default | |
| --- | --- | --- | --- |
| `payTo` | `string` | required | Stellar public key (`G...`) that receives the USDC. A secret key is refused. |
| `network` | `Network` | `"stellar:testnet"` | |
| `oracle` | `FiatRateSource` | Reflector plus UF | Where the rate comes from. |
| `quoteSecret` | `string \| false` | `LOCAL402_QUOTE_SECRET` | See [`localPrice`](#localpriceprice-options-dynamicprice). |
| any other `RouteConfig` field | | | `description`, `mimeType` and the rest pass through to x402. |

Throws `INVALID_CONFIG`, `INVALID_PRICE`, `QUOTE_SECRET_MISSING` or `QUOTE_SECRET_WEAK` when it is called,
not when the first request arrives.

### `local402Server(facilitatorUrl?, network?): x402ResourceServer`

A standard `x402ResourceServer` that accepts `exact` and `exact-fx` on `network` and sends verification
and settlement to the facilitator at `facilitatorUrl`. It registers the x402 Bazaar extension, so paid
routes appear in the facilitator's `/discovery/resources`.

| Parameter | Default |
| --- | --- |
| `facilitatorUrl` | `"http://localhost:4022"` |
| `network` | `"stellar:testnet"` |

Use the x402 hooks on the returned server. `onAfterSettle(({ requirements, result, paymentPayload }) => ...)`
runs after each settled payment, which is where receipts come from:

| Value | What it holds |
| --- | --- |
| `requirements.extra.local402` | The [`LocalQuote`](#localquote) the payer accepted. |
| `requirements.scheme` | `"exact"` or `"exact-fx"`. |
| `requirements.amount` | USDC received, in its smallest unit. |
| `result.transaction` | The settlement transaction hash. |
| `result.payer` | The payer's public key. |
| `result.extra.sendAsset`, `result.extra.sendAmount` | On `exact-fx`, the asset the payer spent and how much. |

### `localToolPayment(server, price, options)` (from `local402-server/mcp`)

The MCP counterpart of `localRoute`: charges each call of one MCP tool a local price. It returns a
wrapper for the tool's handler, built on `@x402/mcp`.

```ts
const paid = localToolPayment(local402Server(url), "50 CLP", { toolName: "weather", payTo });
mcpServer.tool("weather", "Weather in Santiago", {}, paid(async () => ({ content: [{ type: "text", text: "18 C" }] })));
```

| Option | Type | |
| --- | --- | --- |
| `toolName` | `string` | Required. The name the tool is registered under. |
| `payTo`, `network`, `oracle`, `quoteSecret`, `description` | | As in `localRoute`. |

## local402-client

```ts
import { Local402Client, SpendingBudget, FXPAY_MAINNET, Local402Error } from "local402-client";
```

### `new Local402Client(options)`

Pays Local402 routes, and any stock x402 route on Stellar. It re-checks every quote against its own oracle
before it signs.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `secret` | `string` | | Payer secret key. Give this or `signer`. |
| `signer` | `ClientStellarSigner` | | Signs without exposing a key, for example a browser wallet. |
| `network` | `Network` | `"stellar:testnet"` | |
| `rpcUrl` | `string` | public RPC for `network` | Soroban RPC. |
| `fxContract` | `string` | testnet FxPay | FxPay contract trusted with XLM and EURC. On mainnet pass `FXPAY_MAINNET`. |
| `payWith` | `"USDC" \| "XLM" \| "EURC"` | `"USDC"` | USDC pays `exact`; XLM and EURC pay `exact-fx`. |
| `maxPrice` | price | none | Refuse a single payment worth more than this, whatever currency the route uses. |
| `budget` | `SpendingBudget` | none | Refuse a payment that takes total spending past the budget. |
| `maxOverchargeBps` | `number` | `200` | Refuse a quote this many basis points above the client's own rate. |
| `oracle` | `FiatRateSource` | Reflector plus UF | Rates used to check the seller's quote. |
| `maxFxPremiumBps` | `number` | `500` | Refuse an XLM or EURC swap that may spend this much above the oracle value. |
| `fxSlippageBps` | `number` | `200` | Slippage the swap may use. Unused input is refunded. Keep it below `maxFxPremiumBps`. |
| `assetOracle` | `FiatRateSource` | Reflector | USD rates for `XLM` and `EUR`, used for the FX check. |

### `client.quote(url): Promise<Price | undefined>`

Requests `url` without paying. Returns the price of its 402, or `undefined` if the resource is free.

### `client.pay(url): Promise<PaidResult | { free: true; body }>`

Requests `url`, checks the 402 against every guard, signs, pays and returns the paid response. Throws a
`Local402Error` with a `REFUSED_*` code when a guard refuses, `INSUFFICIENT_BALANCE` when the payer
cannot cover it, or `PAYMENT_FAILED` when the facilitator does not settle.

### `client.checkPrice(price): Promise<void>`

Runs the overcharge, `maxPrice` and budget checks on a `Price` without paying. Throws the same refusals
as `pay`.

### `client.checkFxLeg(usdcAmount, maxSend): Promise<FxCheck>`

Compares the most an XLM or EURC swap may spend (`maxSend`, a bigint) with what `usdcAmount` is worth at
the oracle rate. Throws `REFUSED_FX_PREMIUM` or `REFUSED_FX_ORACLE_STALE`.

### Types

```ts
type PayAsset = "USDC" | "XLM" | "EURC";

interface Price {
  url: string;
  local?: { amount: string; currency: string; usdPerUnit: string; oracleSource: string }; // absent on a stock x402 route
  amount: string;   // settlement token amount, smallest unit
  asset: string;    // settlement token contract
  scheme: string;   // "exact" or "exact-fx"
  payTo: string;
}

interface PaidResult {
  price: Price;
  payWith: PayAsset;
  transaction: string;
  explorerUrl: string;                          // stellar.expert link
  spent?: { asset: string; amount: string };    // XLM or EURC the swap took
  fx?: FxCheck;
  body: unknown;                                // the paid response, parsed as JSON when it is JSON
}

interface FxCheck {
  maxSend: string;      // most send asset the payment can spend
  oracleSend: string;   // send asset the USDC price is worth at the oracle rate
  premiumBps: number;   // maxSend over oracleSend; negative when the pool prices the asset above the oracle
  oracleSource: string;
}
```

### `new SpendingBudget(limit)`

A running cap in local currency, such as `new SpendingBudget("5000 CLP")`. Pass the same instance to
several clients to share one cap across assets. `spent` holds the USDC units used so far.

### Other exports

| Export | |
| --- | --- |
| `FXPAY_MAINNET` | The mainnet FxPay contract, `CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD`. |
| `oracleSendAmount(usdcAmount, rate)` | Send-asset units `usdcAmount` is worth at a `FiatRate`. |
| `fxMaxSend(paymentPayload)` | The `max_send` an `exact-fx` payload authorizes. |

### Command line

```bash
npx local402-client quote <url>
STELLAR_SECRET=S... npx local402-client pay <url> [--with USDC|XLM|EURC] [--max "1000 CLP"]
```

`quote` prints the price as JSON. `pay` pays and prints the result. On a mainnet route the CLI uses
`FXPAY_MAINNET` by itself.

## local402-pricing

```ts
import { localPrice, quoteLocalPrice, ReflectorFiatOracle, parseLocalPrice } from "local402-pricing";
```

The conversion from a local price to a USDC amount, with no dependency on a server framework.

### `localPrice(price, options): DynamicPrice`

An x402 dynamic price for a route's `accepts` entry: a stock `exact` requirement whose amount is quoted
per request, with the quote in `extra.local402`. `localRoute` is built on it; use it directly to offer
only `exact`.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `network` | `Network` | required | |
| `oracle` | `FiatRateSource` | Reflector | Wrap it in `UfRateSource` to accept UF prices, as `localRoute` does. |
| `quoteSecret` | `string \| false` | `LOCAL402_QUOTE_SECRET` | HMAC key that signs quotes, at least `MIN_QUOTE_SECRET_LENGTH` (32) characters and the same on every instance. `false` serves unsigned quotes, which only the instance that issued them can honour. |
| `maxOracleAgeSeconds` | `number` | `900` | Refuse a rate older than this. |
| `quoteTtlSeconds` | `number` | `60` | How long a quoted amount stays valid. |
| `now` | `() => number` | `Date.now` | |

A quote is reused for its TTL, and a new 402 gets a fresh one once half the TTL has passed, so a payer
always has time to sign before the amount it accepted expires.

### `quoteLocalPrice(price, options): Promise<LocalQuote>`

Converts one price, rounding up so the seller never receives less than the local price.

Options: `oracle` (required), `maxOracleAgeSeconds` (900), `quoteTtlSeconds` (60), `tokenDecimals` (7),
`now`.

### `LocalQuote`

The object in `extra.local402`:

| Field | |
| --- | --- |
| `currency` | ISO code, `CLF` for the UF. |
| `localAmount` | The local price, as a decimal string. |
| `usdPerUnit` | USD value of one unit of the currency. |
| `tokenAmount` | USDC to pay, in its smallest unit. |
| `tokenDecimals` | 7. |
| `oracleSource` | Which oracle, such as `reflector:<contract>`. |
| `oracleTimestamp` | Unix seconds when the oracle recorded the rate. |
| `oracleValueDate` | For the UF, the day whose UF value was used. |
| `expiresAt` | Unix seconds until which the amount is honoured. |
| `signature` | HMAC of the quote, when a quote secret is set. |

### `parseLocalPrice(price): LocalMoney`

`"50 CLP"` to `{ amount: "50", currency: "CLP" }`. `UF` becomes `CLF`. Throws `INVALID_PRICE`.

### Oracles

```ts
interface FiatRateSource { getRate(currency: string): Promise<FiatRate> }

interface FiatRate {
  usdPerUnit: bigint;   // USD per unit, scaled by 10^decimals
  decimals: number;
  timestamp: number;    // Unix seconds
  source: string;
  valueDate?: string;   // the day the value is dated, when that differs from timestamp (the UF)
}
```

| Export | |
| --- | --- |
| `new ReflectorFiatOracle(config?, { records? })` | Reads Reflector's fiat feed over Soroban RPC. `config` defaults to `REFLECTOR_FIAT.mainnet`; the rate is the median of the last `records` (5) prices. Mainnet rates are used for testnet routes too, since they are real-world prices. |
| `REFLECTOR_FIAT.mainnet`, `REFLECTOR_FIAT.testnet` | `{ rpcUrl, networkPassphrase, contractId }` for Reflector's fiat feed. |
| `REFLECTOR_CEX` | Reflector's exchange feed on mainnet, which prices `XLM`. |
| `new UfRateSource(inner, ufValue?)` | Answers `CLF` from the CLP rate of `inner` and the day's UF value, and passes every other currency to `inner`. |
| `chileUf` | The day's UF value from the SII, falling back to findic.cl and then mindicador.cl. |
| `siiUf`, `findicUf`, `mindicadorUf` | One source each. |
| `firstUf(...sources)` | The first source that answers. |

Write your own `FiatRateSource` to price from another oracle; pass it as `oracle` to `localRoute`,
`localPrice` or `Local402Client`.

## local402-fx

```ts
import { ExactFxClientScheme, ExactFxFacilitatorScheme, ExactFxServerScheme, FX_TESTNET } from "local402-fx";
```

The `exact-fx` x402 scheme: the payer spends XLM or EURC and the FxPay contract delivers an exact USDC
amount through Soroban. The wire format is in [scheme_exact_fx_stellar.md](scheme_exact_fx_stellar.md).
`local402-server`, `local402-client` and `local402-facilitator` already use it; you need this package only
to register the scheme in your own x402 client, server or facilitator.

### Schemes

| Export | |
| --- | --- |
| `new ExactFxServerScheme()` | Server side. Register it on an `x402ResourceServer` under `FX_SCHEME`. |
| `new ExactFxClientScheme(signer, options)` | Client side. Signs an FxPay `pay` that spends `sendAsset` to deliver the required amount. |
| `new ExactFxFacilitatorScheme(signers, options)` | Facilitator side. Verifies the payload, simulates it, and submits it with a fee-paying signer. |

`ExactFxClientScheme` options:

| Option | Default | |
| --- | --- | --- |
| `fxContract` | required | FxPay contract the client trusts. |
| `sendAsset` | required | Asset contract to spend, such as the XLM SAC. |
| `slippageBps` | `200` | Extra input allowed over the quote. Unused input is refunded. |
| `signingGraceSeconds` | `180` | Signing time allowed beyond the requirement's `maxTimeoutSeconds`. |
| `rpcConfig` | public RPC | |

`ExactFxFacilitatorScheme` options:

| Option | Default | |
| --- | --- | --- |
| `fxContract` | required | |
| `sendAssets` | required | Assets payers may spend; each needs a Soroswap pool against USDC. |
| `rpcConfig` | public RPC | |
| `maxTransactionFeeStroops` | `1000000` | Highest fee it pays for one settlement (0.1 XLM). |
| `maxInclusionFeeStroops` | `10000` | Ceiling of the inclusion fee bid. |
| `selectSigner` | round-robin | Picks the account that settles, such as `ChannelPool.select`. |
| `settleBudgetSeconds` | `45` | Wall-clock limit for one settlement. Past it, it returns `settle_exact_fx_confirmation_pending` with the hash. |

### Helpers

| Export | |
| --- | --- |
| `FX_SCHEME` | `"exact-fx"`. |
| `FX_TESTNET` | Testnet FxPay, XLM, EURC and USDC contracts. |
| `FX_MAINNET` | Mainnet RPC, Horizon, Soroswap router, XLM, USDC and EURC. |
| `fxNetwork(network, fxContract?)` | `{ fxContract, xlm, eurc, rpcUrl }` for a network. |
| `parseFxExtra(extra)` | Validates an `exact-fx` requirement's `extra`. Throws `INVALID_REQUIREMENTS`. |
| `quoteFx(options, network, asset, amount)` | Send-asset units FxPay needs now to deliver `amount` of `asset`. |
| `maxSendFor(quote, slippageBps)` | A quote plus slippage, rounded up. |
| `formatUnits(value)` | A 7-decimal bigint as a decimal string. |
| `mainnetShadowQuote(sendAsset, usdcAmount)` | What paying `usdcAmount` with XLM or EURC would cost on mainnet now, through Soroswap (`soroswap`) and the order book (`sdex`). Reads only. |
| `new ChannelPool(addresses, maxQueued?)` | Hands out distinct settling accounts so concurrent settlements never share a sequence number. `run(fn)` holds an account while `fn` runs; `select` is the matching `selectSigner`. Throws `FACILITATOR_BUSY` past `maxQueued` (50) waiting settlements. |
| `feeBumpSigner(signer, { network, rpcConfig?, maxInclusionFeeStroops? })` | Wraps a facilitator signer so the fee is paid through a fee bump. |
| `inclusionFeeBid(server, max)` | The inclusion fee to bid now, capped at `max` stroops. |

## local402-facilitator

The service that verifies payments and settles them on Stellar, paying the network fee. How to run and
configure it is in [facilitator.md](facilitator.md); this is the library and command surface.

### Command line

```bash
npx local402-facilitator keys [n] [--out file]   # n fee-paying accounts (default 2) into file (default .env)
npx local402-facilitator check                   # checks RPC, fee payers and FxPay, then prints ready or not ready
npx local402-facilitator                         # serves on PORT (default 4022)
```

On testnet, `keys` also funds the new accounts with friendbot. It never prints a secret key.

### Endpoints

| Route | |
| --- | --- |
| `GET /health` | The process is up. |
| `GET /ready` | RPC, fee payers and FxPay are reachable and funded. Answers 503 when not. |
| `GET /supported` | The schemes and network it settles. |
| `POST /verify` | x402 verification. |
| `POST /settle` | x402 settlement. |
| `GET /discovery/resources` | The x402 Bazaar catalog of paid routes it has settled for. |

### Library

```ts
import { createFacilitator, facilitatorConfig } from "local402-facilitator";

const { app } = createFacilitator(facilitatorConfig(process.env));
app.listen(4022);
```

| Export | |
| --- | --- |
| `facilitatorConfig(env?)` | Reads and validates the configuration from `env` (default `process.env`). Throws `INVALID_CONFIG` naming the variable. The variables are listed in [facilitator.md](facilitator.md#configuration). |
| `createFacilitator(config, { probe? })` | Returns `{ app, feePayers, ready() }`: an Express app with every endpoint above, the fee payers' public keys, and the `/ready` checks run on demand. |
| `describe(config, feePayers)` | The one-line summary it logs at start. |
| `refusal(body, config)` | Why a `/verify` or `/settle` body is refused before any network call (wrong network, `pay_to_not_allowed`, below the minimum amount), or `undefined`. |
| `new RateLimiter(limits)` | Per-client requests per minute for each route. |
| `readiness(probe, options)`, `rpcProbe(server)` | The `/ready` checks, and the probe that answers them over Soroban RPC. |
| `newKeys(count)`, `writeKeys(file, secrets)`, `fundOnTestnet(address)` | What `keys` does, as functions. |
