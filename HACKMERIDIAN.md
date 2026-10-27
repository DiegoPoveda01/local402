# Local402 at HackMeridian 2026 (Scale)

**x402 only charges in dollars. Local402 lets any API charge in its own currency and receive exact USDC.**

Buyers, people or AI agents, pay with USDC, XLM or EURC in one Stellar transaction. The price is converted with
Reflector's on-chain rate, and the seller always receives the exact amount.

- Live dashboard (testnet, free to try): https://local402.vercel.app
- Mainnet payments with your own wallet: https://local402.vercel.app/#mainnet
- FxPay contract on mainnet: [`CA6Z4E55…UGHD`](https://stellar.expert/explorer/public/contract/CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD)
- npm: [`local402-client`](https://www.npmjs.com/package/local402-client), [`local402-server`](https://www.npmjs.com/package/local402-server), [`local402-pricing`](https://www.npmjs.com/package/local402-pricing), [`local402-fx`](https://www.npmjs.com/package/local402-fx), [`local402-mcp`](https://www.npmjs.com/package/local402-mcp)

## Try it in one minute

Give any MCP agent a Stellar wallet that pays in local prices:

```bash
claude mcp add local402 -e STELLAR_PRIVATE_KEY=S... -e "MAX_PRICE=500 CLP" -- npx -y local402-mcp
```

Then ask: *"Pay https://local402.vercel.app/indicadores"*. The agent gets four tools (`local402_discover`,
`local402_quote`, `local402_pay`, `local402_wallet`), checks the seller's rate against its own oracle and never spends
more than `MAX_PRICE` per call or `BUDGET` per session.

## How it uses Stellar

| Piece | What it does |
|---|---|
| x402 `exact` scheme | USDC payments, fee paid by the facilitator |
| `exact-fx` scheme + **FxPay** (Soroban) | Pay with XLM or EURC: FxPay swaps on **Soroswap** and delivers the exact USDC to the seller in the same transaction; change goes back, a shortfall reverts everything |
| **Reflector** oracle | Local price → USDC (24 fiat currencies plus Chile's UF), rounded in the seller's favour; the buyer re-checks it before signing |
| x402 **Bazaar** | Paid routes publish discovery info so agents can find them before paying |

## Built before vs. during HackMeridian

Before the event (Sept–Oct 2026): the four packages at 1.0, the FxPay contract on mainnet, testnet and mainnet
facilitators, the dashboard, and real mainnet payments in USDC, XLM and EURC.

During the event (25–26 Oct):

- **local402-mcp on npm**: the MCP server now runs with `npx -y local402-mcp` and defaults to the hosted facilitators.
- **Discovery that survives serverless restarts**: the facilitator's Bazaar catalog now lives in Redis, so
  `local402_discover` returns the paid routes.
- **A new landing at local402.vercel.app** (Next.js, English and Spanish): a free testnet demo with no wallet, a
  calculator that prices each asset against the live mainnet routes, receipts in local currency, and setup for MCP.

## Goals from the pre-event intake

| Goal we set | Where it stands |
|---|---|
| **Improve product and UX**: a seller experience simple enough for an API owner who has never used crypto, with quotes and receipts in local currency | Done: the new landing above, with the paid route, its 402 and its receipt visible in one place |
| **Get technical feedback** | Done: the mentors asked for a one-line problem statement, a design that doesn't look generated, and use from existing agent frameworks. The first is the line at the top of this page, the second the new landing, the third `local402-mcp` |
| **Improve our business model**: a written study of ways to sustain the facilitator | Moved to after the event: the mentors' advice was that it can wait, so the weekend went to UX and agents |

## Production readiness

- Mainnet: 8 payments by 2 wallets across USDC, XLM and EURC, each on stellar.expert
  ([list](apps/demo-api/public/mainnet-payments.json)).
- 72 tests passing (`npm test`), CI on every push to main and every pull request, typed config validation in the 1.0 packages.
- [Security review of FxPay](docs/security-review.md), [threat model](docs/threat-model.md),
  [error codes](docs/errors.md) and the [`exact-fx` scheme spec](docs/scheme_exact_fx_stellar.md).
- Guards by default: the buyer refuses a rate more than 2% off its own oracle or a swap more than 5% off, and only
  signs for the FxPay contract it is pinned to.
- npm: about 1,000 downloads across the four packages in the last month (npm's count includes CI and mirrors).

Known limits: the Bazaar catalog only lists routes after their first settlement.

## Next: Instawards sprint

Local402 is open source (MIT), Stellar-native and live on mainnet. The next step is finishing our Instawards sprint with
Stellar Chile (through mid-November 2026) and applying for a follow-on Instaward, while onboarding sellers in Latin
America, where Mexican and Colombian pesos, reais and soles already quote.
