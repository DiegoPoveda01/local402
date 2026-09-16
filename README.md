# Local402

**Charge in pesos. Receive exact USDC.**

### English · [Español](README.es.md)

Local402 is [x402](https://x402.org) on Stellar for the rest of the world: a seller prices an API route
in their own currency — `"50 CLP"`, `"0.05 EUR"`, `"0.01 UF"` — and a payer settles it with whatever
they hold: USDC, XLM or EURC. The seller always receives the exact USDC amount, in one transaction, with
no manual currency swap on either side.

| | |
| --- | --- |
| Dashboard (testnet) | **<https://local402.vercel.app>** |
| Live API (Stellar mainnet) | **<https://local402-mainnet.vercel.app>** |
| Scheme spec | [`docs/scheme_exact_fx_stellar.md`](docs/scheme_exact_fx_stellar.md) |
| npm | [`local402-pricing`](https://www.npmjs.com/package/local402-pricing) · [`local402-fx`](https://www.npmjs.com/package/local402-fx) · [`local402-client`](https://www.npmjs.com/package/local402-client) · [`local402-server`](https://www.npmjs.com/package/local402-server) |
| FxPay on mainnet | [`CBMWKVMFEBBSN2VS7VD3AYNDLHAIPW4WYP5ZAOAEXKT4NCG2OPGYRSCV`](https://stellar.expert/explorer/public/contract/CBMWKVMFEBBSN2VS7VD3AYNDLHAIPW4WYP5ZAOAEXKT4NCG2OPGYRSCV) |
| Bug found and reported upstream | [x402#3491](https://github.com/x402-foundation/x402/issues/3491) — mainnet rejects the fee the SDK bids |

---

## The problem

x402 lets an HTTP resource charge per request and lets an AI agent pay on its own. Today, though, the
price is a dollar amount settled in a single asset. Write `price: "50 CLP"` and the SDK fails.

That is not how commerce outside the US works. A Chilean API bills in pesos; a Brazilian one in reais;
a Chilean rental contract is denominated in **UF**, an inflation-indexed unit that changes daily. And
the customer pays with whatever is in their wallet, which is usually not the seller's asset.

## What Local402 adds

Two independent layers. Either one is useful on its own.

**1. Local-currency pricing (`local402-pricing`, `local402-server`).**
The price stays in the seller's currency. The [Reflector](https://reflector.network) on-chain oracle
converts it to USDC at request time, rounding **up** so the seller never receives less than the local
price. The quote travels inside the standard `402` response as `extra.local402`, and the requirement
itself is a plain `exact` USDC requirement — **any existing Stellar x402 client pays it unchanged.**

```ts
import { paymentMiddleware } from "@x402/express";
import { localRoute, local402Server } from "local402-server";

app.use(paymentMiddleware(
  { "GET /indicadores": localRoute("50 CLP", { payTo: SELLER_ADDRESS }) },
  local402Server(FACILITATOR_URL),
));
```

**2. `exact-fx`: pay with a different asset (`local402-fx`, `contracts/fx-pay`).**
A new x402 scheme. The payer signs a call to the **FxPay** Soroban contract, which swaps their XLM or
EURC on [Soroswap](https://soroswap.finance) for *exactly* the USDC the seller asked for, delivers it,
and refunds the unused input — all atomically. If the swap cannot deliver the exact amount within the
payer's limit, the whole transaction reverts and nothing moves.

The seller never touches XLM. The facilitator pays the network fee. The payer signs once.

## Quick start

```bash
npm install
npm run demo        # creates + funds throwaway testnet accounts, starts everything
```

Then open <http://localhost:3001>. The first run writes `.demo-keys.local` (gitignored); nothing else
is needed — no faucet visit, no configuration.

To run the pieces separately, copy each `.env.example` and:

```bash
npm run facilitator   # :4022  settles exact and exact-fx, pays fees
npm run api           # :3001  demo seller + dashboard
npm run agent         #        a paying client
npm run mcp           #        MCP server: an agent discovers, quotes and pays
```

## How a payment works

```mermaid
sequenceDiagram
    participant P as Payer / agent
    participant S as Seller (API)
    participant F as Facilitator
    participant N as Stellar

    P->>S: GET /indicadores
    S->>N: Reflector: 1 CLP = 0.00104548 USD
    S-->>P: 402 · accepts [exact, exact-fx] · extra.local402
    Note over P: Re-quotes from its OWN oracle<br/>rejects >2% overcharge<br/>bounds max_send, rejects >5% FX premium
    P->>F: signed FxPay.pay(...) authorization
    Note over F: 11 verification rules<br/>simulate · bid inclusion fee · fee-bump
    F->>N: submit
    N->>N: swap XLM on Soroswap for exactly 0.0522742 USDC
    N-->>S: 0.0522742 USDC — exact
    N-->>P: refund of the unused XLM
    F-->>S: tx hash → receipt
    S-->>P: 200 + the data
```

## Repository map

```
packages/
  pricing/   local currency → USDC.  Reflector oracle, UF source, x402 DynamicPrice
  fx/        the exact-fx scheme: client, resource server, facilitator, fee bidding
  client/    Local402Client — pays with USDC/XLM/EURC, with its own guards. Also a CLI
  server/    localRoute() and localToolPayment() — one line to price a route or an MCP tool
apps/
  demo-api/      the seller: three paid routes, receipts, the dashboard
  facilitator/   verifies and settles, pays fees, serves the x402 Bazaar catalog
  agent/         minimal paying client
  mcp/           MCP server an AI agent uses to discover, quote and pay
  mcp-seller/    an MCP server whose tool is itself paid per call
contracts/
  fx-pay/        the Soroban contract, in Rust, with its tests
docs/
  scheme_exact_fx_stellar.md   the exact-fx spec, in the x402 spec format
```

## Design decisions worth reading

These are the places where the obvious implementation is wrong.

**Rounding is directional.** `quoteLocalPrice` rounds *up* (`ceilDiv`). A seller asking 50 CLP must
never receive 49.999 CLP worth of USDC because of integer truncation.

**Quotes are median-of-five, not last-price.** Reflector's CLP feed has published single 5-minute
prints 0.65% away from their neighbours. `ReflectorFiatOracle` takes the median of the last five
records, so one outlier tick cannot set a price. Stale rates (>15 min by default) are rejected outright.

**Quotes are HMAC-signed and frozen.** x402 rebuilds the payment requirements when the paid retry
arrives — and the oracle may have moved in between, which would make the amount the payer signed no
longer match. `localPrice` signs the quote it issued; any server instance holding the same secret
honours it while it is valid. This is what makes the flow correct behind a load balancer, not just on
one process.

**The client trusts no one.** `Local402Client` re-derives the price from its *own* oracle and refuses a
quote more than 2% above it (`maxOverchargeBps`), and refuses an FX payment whose `max_send` is more
than 5% above the oracle value of the price (`maxFxPremiumBps`). The FxPay contract address is pinned
client-side and never taken from the server's response — a malicious contract could spend up to
`max_send`.

**The agent's budget is reserved, not checked.** `SpendingBudget` is debited *before* the request and
credited back on failure, so two concurrent payments cannot both pass a check-then-spend test and
together overrun the limit.

**The facilitator has eleven verification rules, and two are redundant on purpose.** The authorization
tree (rule 7) already bounds what the payer's signature permits. Rules 9 and 10 re-check the *simulated
events* — that the seller was paid, and that no facilitator account was drained — as defence in depth.
Since the facilitator pays the fees, a public deployment can also require an allowlisted seller and a
minimum amount, and rate-limits `verify`/`settle` separately because they cost different things.

**Fee bidding, and a bug we reported upstream.** `@x402/stellar` 2.25 always bids the 100-stroop base
fee, which mainnet frequently rejects under Soroban surge pricing. `feeBumpSigner` re-wraps the fee
bump with a bid of twice the network's recent p99, capped — without touching the inner transaction or
its signatures. Reported upstream as [x402#3491](https://github.com/x402-foundation/x402/issues/3491).

**Parallel settlement needs separate accounts.** Two settlements from one Stellar account collide on
the sequence number. `ChannelPool` hands each concurrent settlement its own fee-paying account.

**The UF is a date, not a rate.** It is defined per calendar day in Chile's timezone. `UfRateSource`
reads the SII (the tax service), falls back to two other sources, times out at 4 s and keeps the last
known value for up to three days — because an API that returns 402 with no price is worse than one
priced on yesterday's UF.

**A paid resource is never cached.** Both the client probe and the API send `no-store`. A cached 200
would hand out a paid response for free; a cached 402 would hand out an expired quote.

## Testing

```bash
npm test        # 27 unit tests across pricing, fx and client
npm run typecheck
cd contracts && cargo test    # 8 contract tests against a mock Soroswap router
```

The contract tests cover the cases that matter: exact delivery with a refund of the unused input,
`quote` agreeing with what `pay` actually spends, rejection when the route needs more than `max_send`,
routing through the hub asset when there is no direct pool, picking the cheaper of two routes, and
refusal without the payer's authorization.

Four further tests build a real `exact-fx` payload against testnet and run it through the facilitator's
verification, including the rejections. They only run when `FX_PAYER_SECRET` is set, so a clean
checkout needs no funded account to go green.

## Status

Running on **Stellar mainnet** with real payments — USDC, XLM and EURC — through the FxPay deployment
linked above. Every sale leaves a receipt recording the local price, the rate and its source, the swap
premium in basis points, and the transaction hash. `GET /receipts.csv` hands it to accounting.

`exact-fx` is a draft scheme. It is written in the x402 spec format so it can be discussed as a
proposal, and it could equally be expressed as an `assetTransferMethod` of `exact`; what does not
change either way is the seller-facing guarantee and the facilitator's verification rules.

## License

MIT — see [LICENSE](LICENSE).
