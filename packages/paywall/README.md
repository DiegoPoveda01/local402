# local402-paywall

A browser paywall for [x402](https://x402.org) routes on Stellar priced in local currency. When a
browser opens a paid route, it gets a page with the price as the seller set it (for example 50 CLP),
a choice of USDC, XLM or EURC, and the amount in the asset picked. The visitor pays from Varial and then
sees the content and the transaction link. Agents asking for the same route keep getting the x402 402.

```bash
npm install local402-paywall local402-server
```

```ts
import { paymentMiddleware } from "@x402/express";
import { local402Paywall } from "local402-paywall";

app.use(paymentMiddleware(routes, server, undefined, local402Paywall()));
```

`routes` and `server` are the ones you already pass to x402, priced with `localRoute` from
`local402-server`. The page offers USDC when the route accepts `exact`, and XLM or EURC when it accepts
`exact-fx` with that asset; the seller always receives USDC.

## The maximum price

Before the wallet is asked to sign, the page converts the payment back to local currency and refuses it
when it is above the maximum. The default is the route's own price plus 2%; set your own with
`local402Paywall({ maxPrice: "60 CLP" })`. For XLM and EURC the check covers the FxPay quote plus
slippage, the most the visitor can spend, not just the USDC the seller gets.

## Options

- `maxPrice`: the most the page lets a visitor pay, as a local price such as `"60 CLP"`.
- `scriptUrl`: where the page loads its script from. The default is this version's `dist/browser.js` on
  jsDelivr; serve it yourself if your Content-Security-Policy does not allow that host.

MIT
