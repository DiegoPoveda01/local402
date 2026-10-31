# Integration guide: a route priced in your currency

This guide takes you from an empty folder to an API route that charges 50 Chilean pesos per call, paid on
Stellar testnet in USDC or XLM, and then lists what changes on mainnet. It uses only the published npm
packages. You do not need this repository, a wallet, or any testnet tokens beforehand.

It takes about 20 minutes. You need Node 20.12 or later and a terminal. Every command works the same in
bash, zsh and PowerShell unless a step says otherwise.

What you will have at the end:

- a facilitator of your own on `localhost:4022`, which verifies payments and pays the network fees;
- a seller on `localhost:4021` with `GET /weather` priced at `50 CLP`;
- two paid requests, one in USDC (`exact`) and one in XLM (`exact-fx`), with their transactions on
  stellar.expert;
- a `/receipts` route that lists what was sold, in pesos and in USDC.

Every function used here is described in the [API reference](api-reference.md). Every error code is in
[errors.md](errors.md).

## 1. Start a facilitator

A facilitator is the service that checks a signed payment and submits it to Stellar. It pays the network
fee, so the payer only needs the asset they pay with. On testnet you run your own in one minute:

```bash
mkdir facilitator
cd facilitator
npx -y local402-facilitator@1 keys
npx -y local402-facilitator@1 check
npx -y local402-facilitator@1
```

- `keys` creates two fee-paying testnet accounts, funds them with friendbot and writes their secret keys
  to `.env`. It prints only the public keys.
- `check` must end with `ready`. If a line says `fail`, it says why.
- The last command keeps running and prints `Local402 facilitator on http://localhost:4022`. Leave this
  terminal open.

Check it from another terminal: `curl http://localhost:4022/ready` answers `{"ready":true,...}`.

Every variable it reads is in [facilitator.md](facilitator.md).

## 2. Create the seller project

In a second terminal, next to the `facilitator` folder:

```bash
mkdir seller
cd seller
npm init -y
npm pkg set type=module
npm install local402-server@1 local402-client@1 @x402/express@2.25.0 express@5 @stellar/stellar-sdk@16.3.0
npm install -D tsx
```

Install `@x402/express` at exactly `2.25.0`. `local402-server` 1.0 is built on `@x402/core` 2.25.0, and
a newer `@x402/express` brings a second copy of `@x402/core` that does not recognise the server
`local402Server` returns.

## 3. Create two testnet accounts

The seller needs a Stellar address that can receive USDC, which means an account with a USDC trustline.
To pay, you also need a payer account. Save this as `accounts.ts`:

```ts
// Two testnet accounts: a seller that receives USDC and a payer. Writes their keys to .env.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

async function account(buyUsdc?: string) {
  const keypair = Keypair.random();
  const funded = await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
  if (!funded.ok) throw new Error(`friendbot answered ${funded.status}`);
  const builder = new TransactionBuilder(await horizon.loadAccount(keypair.publicKey()), { fee: "1000", networkPassphrase: Networks.TESTNET })
    .setTimeout(60)
    .addOperation(Operation.changeTrust({ asset: USDC }));
  if (buyUsdc) {
    builder.addOperation(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "1000", destination: keypair.publicKey(), destAsset: USDC, destAmount: buyUsdc, path: [] }));
  }
  const tx = builder.build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);
  return keypair;
}

const seller = await account();
const payer = await account("1");
appendFileSync(".env", [
  `PAY_TO=${seller.publicKey()}`,
  `STELLAR_SECRET=${payer.secret()}`,
  `LOCAL402_QUOTE_SECRET=${randomBytes(32).toString("hex")}`,
  "FACILITATOR_URL=http://localhost:4022",
  "",
].join("\n"));
console.log(`seller ${seller.publicKey()}\npayer  ${payer.publicKey()} (10000 XLM, 1 USDC)\nkeys written to .env`);
```

Run it once:

```bash
npx tsx accounts.ts
```

It prints two public keys and writes four variables to `.env`:

| Variable | What it is |
| --- | --- |
| `PAY_TO` | The seller's public key. The USDC lands here. |
| `STELLAR_SECRET` | The payer's secret key. It holds 10,000 test XLM and 1 test USDC bought on the testnet DEX. |
| `LOCAL402_QUOTE_SECRET` | A random value the seller signs its quotes with. The seller refuses to start without it. |
| `FACILITATOR_URL` | The facilitator from step 1. |

These are testnet keys, worth nothing. Still, keep `.env` out of git, and never reuse this setup with a
mainnet key.

## 4. Price a route in pesos

Save this as `server.ts`:

```ts
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { local402Server, localRoute } from "local402-server";

const payTo = process.env.PAY_TO!;
const receipts: object[] = [];

const server = local402Server(process.env.FACILITATOR_URL).onAfterSettle(async ({ requirements, result }) => {
  const quote = requirements.extra?.local402 as { localAmount: string; currency: string; usdPerUnit: string; oracleSource: string };
  receipts.unshift({
    paidAt: new Date().toISOString(),
    price: `${quote.localAmount} ${quote.currency}`,
    rate: `1 ${quote.currency} = ${quote.usdPerUnit} USD (${quote.oracleSource})`,
    scheme: requirements.scheme,
    received: `${Number(requirements.amount) / 1e7} USDC`,
    payer: result.payer,
    transaction: `https://stellar.expert/explorer/testnet/tx/${result.transaction}`,
  });
});

const app = express();
app.get("/receipts", (_req, res) => res.json(receipts));
app.use(
  paymentMiddleware(
    { "GET /weather": localRoute("50 CLP", { payTo, description: "Weather in Santiago" }) },
    server,
  ),
);
app.get("/weather", (_req, res) => res.json({ city: "Santiago", celsius: 18 }));
app.listen(4021, () => console.log("50 CLP per call: http://localhost:4021/weather"));
```

Three lines do the pricing:

- `localRoute("50 CLP", { payTo })` turns a local price into an x402 route. At each request it reads the
  CLP rate from the Reflector oracle and converts it to USDC.
- `local402Server(FACILITATOR_URL)` is a standard x402 resource server that accepts both `exact` (USDC)
  and `exact-fx` (XLM or EURC) and sends them to your facilitator.
- `paymentMiddleware` comes from x402 itself. Local402 adds a price, not a new middleware.

The `onAfterSettle` hook runs after every settled payment. Step 8 uses it.

Start the seller and leave it running:

```bash
npx tsx --env-file=.env server.ts
```

It prints `50 CLP per call: http://localhost:4021/weather`.

## 5. Read the 402

In a third terminal, in the `seller` folder:

```bash
npx local402-client quote http://localhost:4021/weather
```

```json
{
  "network": "stellar:testnet",
  "url": "http://localhost:4021/weather",
  "local": {
    "amount": "50",
    "currency": "CLP",
    "usdPerUnit": "0.00101055585484",
    "oracleSource": "reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC"
  },
  "amount": "505278",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "scheme": "exact",
  "payTo": "G..."
}
```

50 CLP at 0.00101055585484 USD each is 0.0505278 USDC, which is `505278` in USDC's smallest unit (7
decimals). Your rate will differ: it is read live.

The raw 402 is a standard x402 v2 response. The body is `{}`; everything is in the base64 JSON of the
`PAYMENT-REQUIRED` header. In bash you can decode it with:

```bash
curl -si http://localhost:4021/weather | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d
```

Its `accepts` array has two options for the same amount:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "http://localhost:4021/weather", "description": "Weather in Santiago", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "505278",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payTo": "G...",
      "maxTimeoutSeconds": 300,
      "extra": {
        "local402": {
          "currency": "CLP",
          "localAmount": "50",
          "usdPerUnit": "0.00101055585484",
          "tokenAmount": "505278",
          "tokenDecimals": 7,
          "oracleSource": "reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC",
          "oracleTimestamp": 1793414700,
          "expiresAt": 1793414802,
          "signature": "509d0b51..."
        },
        "areFeesSponsored": true
      }
    },
    {
      "scheme": "exact-fx",
      "network": "stellar:testnet",
      "amount": "505278",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payTo": "G...",
      "maxTimeoutSeconds": 300,
      "extra": {
        "local402": { "...": "the same quote" },
        "areFeesSponsored": true,
        "fxContract": "CD6PUDBJNDYWLTQPHYU26OCEH4GWR7WN3UIXAEKUP3DQIS3DKJQIF7DL",
        "sendAssets": ["CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", "CDHCVLBJWUA62CYRTTG46MBTPTXQ4VHKPTUTG6UNUPN4OTMK3FFJ77CE"]
      }
    }
  ]
}
```

What each part means:

| Field | Meaning |
| --- | --- |
| `amount`, `asset` | What the seller receives: always USDC (the testnet USDC contract here), always this exact amount. |
| `extra.local402` | The quote behind the amount: the local price, the rate, which oracle and when. Any client can re-check it. |
| `extra.local402.expiresAt` | Unix seconds until which the seller honours this amount. A payer who signs before then is not re-quoted. |
| `extra.local402.signature` | HMAC with `LOCAL402_QUOTE_SECRET`. It lets any instance of your seller honour a quote another instance issued. |
| `exact` | Stock x402 on Stellar: the payer transfers USDC directly. Any Stellar x402 client can pay this option, Local402 or not. |
| `exact-fx` | The payer spends one of `sendAssets` (XLM or EURC). The FxPay contract at `fxContract` swaps it on Soroswap and delivers exactly `amount` USDC to `payTo`, in the same transaction. |
| `areFeesSponsored` | The facilitator pays the network fee. |

The scheme is specified in [scheme_exact_fx_stellar.md](scheme_exact_fx_stellar.md).

## 6. Pay it

Save this as `pay.ts`:

```ts
import { Local402Client, type PayAsset } from "local402-client";

const client = new Local402Client({
  secret: process.env.STELLAR_SECRET,
  payWith: (process.argv[2] ?? "USDC") as PayAsset,
  maxPrice: "100 CLP",
});
const result = await client.pay("http://localhost:4021/weather");
console.log(JSON.stringify(result, null, 2));
```

Pay once in USDC, then once in XLM:

```bash
npx tsx --env-file=.env pay.ts USDC
npx tsx --env-file=.env pay.ts XLM
```

Each prints the price, the transaction and the response body:

```json
{
  "price": { "amount": "505278", "scheme": "exact-fx", "local": { "amount": "50", "currency": "CLP", "...": "..." }, "...": "..." },
  "payWith": "XLM",
  "transaction": "4d282cad...",
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/4d282cad...",
  "spent": { "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", "amount": "632028" },
  "fx": { "maxSend": "644669", "oracleSend": "2979083", "premiumBps": -7836, "oracleSource": "reflector:CAFJ..." },
  "body": { "city": "Santiago", "celsius": 18 }
}
```

Open `explorerUrl`. On the XLM payment you can see the payer's XLM go into Soroswap and exactly
0.0505278 USDC arrive at `PAY_TO`. `spent` is the XLM the swap took, never more than `fx.maxSend`.

`fx` compares the swap with the oracle. On testnet the pools are not priced like the real market, so
`premiumBps` can be far from zero, even negative. On mainnet it is a few percent.

The same is available from the command line. In bash, with `STELLAR_SECRET` exported:
`npx local402-client pay http://localhost:4021/weather --with XLM --max "100 CLP"`.

## 7. The client guards

`Local402Client` never trusts the seller's numbers. Before it signs, it re-quotes the price from its own
oracle and checks the limits you gave it. Change `maxPrice` in `pay.ts` to `"10 CLP"` and run it again. It stops with:

```text
Local402Error: Refusing to pay 50 CLP: above the 10 CLP limit
```

Nothing was signed and nothing moved. Each guard has an option and an error code:

| Guard | Option | Default | Refusal code |
| --- | --- | --- | --- |
| The seller charges more than the client's own oracle says the local price is worth | `maxOverchargeBps` | 200 (2%) | `REFUSED_OVERCHARGE` |
| One payment is worth more than a local price you set, in any currency | `maxPrice` | none | `REFUSED_MAX_PRICE` |
| Total spending would pass a budget | `budget: new SpendingBudget("5000 CLP")` | none | `REFUSED_BUDGET` |
| An XLM or EURC swap may spend more than this above the oracle value | `maxFxPremiumBps` | 500 (5%) | `REFUSED_FX_PREMIUM` |
| The rate for the asset being spent is older than 15 minutes | | | `REFUSED_FX_ORACLE_STALE` |
| The payer does not hold enough of the asset | | | `INSUFFICIENT_BALANCE` |

Branch on `error.code`, not on the message:

```ts
import { Local402Error } from "local402-client";

try {
  await client.pay(url);
} catch (error) {
  if (error instanceof Local402Error && error.code === "REFUSED_MAX_PRICE") console.log("too expensive");
  else throw error;
}
```

## 8. Receipts

Open <http://localhost:4021/receipts>. The `onAfterSettle` hook from step 4 recorded both sales:

```json
[
  {
    "paidAt": "2026-10-31T02:46:51.456Z",
    "price": "50 CLP",
    "rate": "1 CLP = 0.00101055585484 USD (reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC)",
    "scheme": "exact-fx",
    "received": "0.0505278 USDC",
    "payer": "G...",
    "transaction": "https://stellar.expert/explorer/testnet/tx/4d282cad..."
  }
]
```

That is what a seller books: the sale in pesos, the rate it was converted at and from which oracle, the
USDC received and the transaction that proves it. The hook receives `requirements` (what was charged,
with the quote in `requirements.extra.local402`) and `result` (the transaction hash and the payer). This
example keeps receipts in memory, so they disappear when the process stops; store them in a database in a
real deployment.

## 9. Another currency

Replace `"50 CLP"` with any price in a currency Reflector publishes, or USD, or the UF, and restart the
seller:

```ts
localRoute("70 NGN", { payTo })    // Nigerian naira
localRoute("1 MXN", { payTo })     // Mexican peso
localRoute("0.01 UF", { payTo })   // Chile's Unidad de Fomento
```

The full list is in the [README](../README.md#where-it-works-today). A currency that Reflector starts
publishing works the same day, with no new code.

## 10. Moving to mainnet

On mainnet the seller receives real USDC and the facilitator spends real XLM on every settlement. What
changes:

1. **The seller's address.** `PAY_TO` must be a mainnet account with a trustline to Circle's USDC
   (`USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`). Any wallet that holds USDC on
   Stellar already has one. Only the public key goes in your config.
2. **The network, in two places.**

   ```ts
   localRoute("50 CLP", { payTo, network: "stellar:pubnet" })
   local402Server(process.env.FACILITATOR_URL, "stellar:pubnet")
   ```

3. **A mainnet facilitator.** Either:
   - run your own, as in step 1 but with `NETWORK=stellar:pubnet`, `FX_CONTRACT`, `PAY_TO_ALLOWLIST`
     set to your `PAY_TO`, and fee-paying accounts you fund with real XLM. The
     [mainnet section of facilitator.md](facilitator.md#mainnet) has the full configuration and the
     [runbook](facilitator-runbook.md) covers funding and rotation; or
   - ask for your `PAY_TO` to be added to Local402's mainnet facilitator by
     [opening an issue](https://github.com/DiegoPoveda01/local402/issues). It settles only for the
     sellers on its allowlist.
4. **A minimum price.** Mainnet facilitators settle from 0.01 USDC by default, so each price must be
   worth at least one US cent. 50 CLP is about five.
5. **The quote secret on every instance.** If more than one process serves the route (several
   containers, or serverless), give all of them the same `LOCAL402_QUOTE_SECRET`. Otherwise a paid
   retry that lands on another instance is re-quoted and refused.
6. **Payers.** A payer using USDC needs nothing new. A `Local402Client` paying with XLM or EURC on
   mainnet sets `network: "stellar:pubnet"` and `fxContract: FXPAY_MAINNET`, both exported by
   `local402-client`. The command-line client does this by itself.

The FxPay contract has no external audit yet. That is why the mainnet facilitator settles only for an
allowlist and from a minimum amount. The [threat model](threat-model.md) and the
[security review](security-review.md) explain what is trusted and why.

## When a step fails

| What you see | Why | Fix |
| --- | --- | --- |
| `QUOTE_SECRET_MISSING` when the seller starts | `LOCAL402_QUOTE_SECRET` is not in the environment | Start the seller with `--env-file=.env`, or set the variable. |
| `INVALID_CONFIG: payTo must be the Stellar address...` | `PAY_TO` is empty or is a secret key | Use the seller's public key (`G...`). |
| The middleware throws about an unknown server or scheme | Two copies of `@x402/core` | Install `@x402/express@2.25.0` exactly (step 2). |
| `ORACLE_STALE` or `ORACLE_UNAVAILABLE` on the 402 | The seller could not read a fresh rate | Wait a minute and retry. Reflector publishes every 5 minutes. |
| `PAYMENT_FAILED` with `pay_to_not_allowed` | The facilitator does not settle for this `PAY_TO` | On testnet, use the facilitator from step 1. On mainnet, see step 10. |
| `PAYMENT_FAILED` with a trustline error | `PAY_TO` has no USDC trustline | Create the account with `accounts.ts`, or add the trustline in your wallet. |
| `INSUFFICIENT_BALANCE` | The payer does not hold enough of the asset | Pay with XLM, or run `accounts.ts` again for a new payer. |
| `friendbot answered 429` or `5xx` | Friendbot is rate limiting | Wait a minute and run the command again. |

Every code, with its cause and fix, is in [errors.md](errors.md).
