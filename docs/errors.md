# Error codes

Every error Local402 throws on purpose is a `Local402Error` with a `code`. Branch on the code, not the
message: messages may change between versions, codes do not. `Local402Error` is exported by every
package and is the same class in each, so `instanceof` works whichever one you import it from.

```ts
import { Local402Error } from "local402-client";

try {
  await client.pay(url);
} catch (error) {
  if (error instanceof Local402Error && error.code === "REFUSED_BUDGET") notifyOwner(error.message);
  else throw error;
}
```

If your install ends up with two copies of `local402-pricing` (two different versions pulled in by
different packages), `instanceof` fails across them. Checking the name and code works in every case:

```ts
const code = error instanceof Error && error.name === "Local402Error" ? (error as Local402Error).code : undefined;
```

## Configuration — thrown when a price, route, client or facilitator is built

These fire at startup, before any request, so a mistake surfaces when you deploy, not on the first payment.

| Code | Means | Fix |
| --- | --- | --- |
| `INVALID_CONFIG` | An option can never work: an unknown network, a `payTo` or contract that is not a Stellar address, a non-http(s) URL, a bps or seconds value out of range, both `secret` and `signer` given, `fxSlippageBps` not below `maxFxPremiumBps`, and so on. | The message names the option and what it accepts. |
| `INVALID_PRICE` | The price is not `"<amount> <CURRENCY>"`, or its amount is zero. | Write it as `"50 CLP"`, `"0.5 UF"`, `"1.25 EUR"`. |
| `QUOTE_SECRET_MISSING` | A seller was built without `LOCAL402_QUOTE_SECRET` or `quoteSecret`. | Set it to the same random value on every instance (`openssl rand -hex 32`), or pass `quoteSecret: false` on a single instance. |
| `QUOTE_SECRET_WEAK` | The secret is shorter than 32 characters. A short key lets a payer forge a cheaper signed quote. | Use at least 32 characters. |

## Quoting — the seller cannot price the request right now

Thrown by the seller's price function per request, and by the client when it checks a quote against its own oracle.

| Code | Means |
| --- | --- |
| `ORACLE_UNAVAILABLE` | The oracle RPC timed out or the simulation failed. Usually transient. |
| `ORACLE_NO_RATE` | The oracle does not publish that currency. |
| `ORACLE_STALE` | The latest rate is older than `maxOracleAgeSeconds` (default 900). Local402 refuses to price on it. |
| `ORACLE_FUTURE` | The rate is dated in the future. Check the server clock. |
| `ORACLE_INVALID_PRICE` | The oracle reported zero or a negative price. |
| `UF_UNAVAILABLE` | Every UF source (SII, findic.cl, mindicador.cl) failed, and `UfRateSource` has no value from the last three days to fall back on. |
| `PRICE_ROUNDS_TO_ZERO` | The price converts to zero token units. Unreachable with the default rounding; kept as a guard. |

## Client refusals — the payer declined to sign

Nothing was signed and nothing moved.

| Code | Means |
| --- | --- |
| `REFUSED_OVERCHARGE` | The seller asks more than the local price at the client's own oracle rate, plus `maxOverchargeBps`. |
| `REFUSED_MAX_PRICE` | The price is above the client's `maxPrice`. |
| `REFUSED_BUDGET` | Paying would exceed the `SpendingBudget`. |
| `REFUSED_FX_ORACLE_STALE` | Paying with XLM or EURC, and the oracle rate for that asset is stale. |
| `REFUSED_FX_PREMIUM` | The swap may spend more than `maxFxPremiumBps` above the oracle value of the USDC. |
| `REFUSED_UNTRUSTED_FX_CONTRACT` | The seller names an FxPay contract other than the one the client is pinned to. |
| `REFUSED_SEND_ASSET` | The facilitator does not accept the asset the client pays with. |
| `SIGNER_MISMATCH` | The transaction needs a signature from an account other than the payer. |
| `INSUFFICIENT_BALANCE` | The payer holds less than the quote plus slippage. The unused part is refunded, but all of it must be there to sign. |
| `INVALID_REQUIREMENTS` | The seller's `exact-fx` requirement is malformed. |
| `NO_PAYMENT_OPTION` | The seller accepts no scheme and network this client pays with. The message lists what it does accept. |
| `PAYMENT_FAILED` | The client signed, and the seller or facilitator rejected the payment. The message carries their reason. |

## Facilitator

| Code | Means |
| --- | --- |
| `FACILITATOR_BUSY` | Every facilitator account is settling and the queue is full. Retry, or give `ChannelPool` more accounts. |
