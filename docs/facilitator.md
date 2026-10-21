# Running a Local402 facilitator

`local402-facilitator` is the facilitator the Local402 demo runs, packaged so anyone can run their own
from npm instead of from this repository. It verifies and settles x402 payments on one Stellar network:

- `exact`: the payer transfers the seller's token (USDC or any Stellar asset) directly.
- `exact-fx`: the payer spends XLM or EURC and the seller receives exact USDC, through the
  [FxPay contract](scheme_exact_fx_stellar.md) and Soroswap.

The facilitator pays the network fees from its own accounts. That is the whole operational cost of
running one, and it is why a public instance has an allowlist, a minimum amount and rate limits.
The [runbook](facilitator-runbook.md) covers keys, funding, top-ups and rotation.

## One command

Node 20.12 or later:

```bash
mkdir my-facilitator && cd my-facilitator
npx local402-facilitator keys     # 2 fresh testnet accounts, funded with friendbot, into .env
npx local402-facilitator check    # exits 0 when it can settle
npx local402-facilitator          # listens on :4022
```

`keys` prints only public keys and never overwrites a `.env` that already holds facilitator keys, since
those accounts may hold funds. `keys 4` makes four; `--out file` writes somewhere else.

`check` prints what the instance will settle and then each check, so a bad deploy shows up before the
first payment:

```text
facilitator on stellar:testnet: 2 fee payer(s), payTo unrestricted, minimum amount none, limits 60 verify and 20 settle per client per minute
ok   RPC
ok   fee payer GC4N...  10000 XLM
ok   fee payer GBQX...  10000 XLM
ok   FxPay CD6PUDBJNDYWLTQPHYU26OCEH4GWR7WN3UIXAEKUP3DQIS3DKJQIF7DL
ready
```

### With Docker

The [Dockerfile](../packages/facilitator/Dockerfile) installs the published package, so it builds from an
empty folder:

```bash
docker build --build-arg VERSION=1.0.0 -t local402-facilitator .
docker run --env-file .env -p 4022:4022 local402-facilitator
```

### On a host

Any host that runs a Node process or a container works (Render, Fly.io, Railway, a VM). Set the
variables below as secrets, use `npx local402-facilitator` (or the image) as the start command, and:

- point the liveness check at `/health` and the readiness check at `/ready`;
- set `TRUST_PROXY` to the number of proxies in front of the instance (1 for a typical host's load
  balancer), so rate limits count real clients. It defaults to 0, for clients that connect directly;
- give every instance its own `FACILITATOR_PRIVATE_KEYS`. Scaling to two replicas with one set of keys
  makes them collide on sequence numbers.

The instance stops on `SIGTERM` by finishing the settlements in flight.

## Configuration

Read from the environment, or from a `.env` file in the working directory. Every value is checked at
startup: a mistake stops the process with an `INVALID_CONFIG` message that names the variable and what
it accepts. Messages never repeat a secret key or the RPC URL, which can carry an API key.

| Variable | Default | What it does |
| --- | --- | --- |
| `FACILITATOR_PRIVATE_KEYS` | required | Fee-paying secret keys (`S...`), comma-separated, one per settlement that can run at the same time. `FACILITATOR_PRIVATE_KEY` (one key) also works. |
| `NETWORK` | `stellar:testnet` | `stellar:testnet` or `stellar:pubnet`. |
| `FX_CONTRACT` | Local402's testnet FxPay | The FxPay contract `exact-fx` settles through. Required on `stellar:pubnet`. |
| `SEND_ASSETS` | the network's XLM and EURC | Token contracts (`C...`) a payer may spend through `exact-fx`. Each needs a Soroswap route to the seller's asset. |
| `RPC_URL` | public testnet RPC, `https://mainnet.sorobanrpc.com` on pubnet | Soroban RPC for simulation and submission. |
| `PORT` | `4022` | |
| `PAY_TO_ALLOWLIST` | any seller on testnet; required on pubnet | Seller addresses (`G...` or `C...`) this instance settles for, comma-separated. An empty value counts as unset, never as "any seller". |
| `ASSET_ALLOWLIST` | any token on testnet; USDC, XLM and EURC on pubnet | Token contracts (`C...`) a seller may be paid in, comma-separated. The caller writes the payment requirements, token included, so without this list a token anyone can mint would meet `MIN_AMOUNT`. |
| `MIN_AMOUNT` | `0` on testnet, `100000` on pubnet | Smallest payment it settles, in token units (7 decimals: 100000 is 0.01 USDC). |
| `VERIFY_RATE_LIMIT` | `60` | `/verify` requests per client per minute. Verify simulates on the RPC and spends nothing. |
| `SETTLE_RATE_LIMIT` | `20` | `/settle` requests per client per minute. Each settlement spends this instance's XLM. |
| `MIN_FEE_BALANCE_XLM` | `2` | Below this, a fee payer makes `/ready` answer 503. |
| `TRUST_PROXY` | `0` (`1` on the Local402 deployment, behind Vercel) | Proxies whose `X-Forwarded-For` the instance believes. `0` when clients connect directly. Never more than are really there: each extra one lets a client choose its own address and dodge the limits. |

## Endpoints

| Route | Answers |
| --- | --- |
| `GET /health` | `200 {"status":"ok","network":...}` while the process is up. Touches nothing on the network. |
| `GET /ready` | `200` when the RPC is healthy, every fee payer exists and holds `MIN_FEE_BALANCE_XLM`, and FxPay is on the ledger; otherwise `503` with the failing check and what to do. Cached for 15 seconds. |
| `GET /supported` | The x402 schemes, networks and fee payers it settles. |
| `POST /verify` | x402 verify. Refusals of this instance's policy come back as `invalidReason`: `pay_to_not_allowed`, `asset_not_allowed`, `amount_below_minimum`, `unsupported_network`, `rate_limited` (HTTP 429). A verification that fails inside x402 answers 503 with the reason. |
| `POST /settle` | x402 settle, with the same refusals as `errorReason`. A submission that never reached the ledger is retried once on the next fee payer. |
| `GET /discovery/resources` | The x402 Bazaar catalog: resources that settled here and declared discovery info. |

A `503` from `/ready`:

```json
{
  "ready": false,
  "network": "stellar:pubnet",
  "rpc": { "ok": true },
  "feePayers": [
    { "address": "GC4N...", "ok": false, "xlm": "1.4", "error": "below the 2 XLM minimum: top it up" }
  ],
  "fxContract": { "address": "CA6Z...", "ok": true }
}
```

## Mainnet

A mainnet instance settles real payments and spends real XLM on every one. It refuses to start
without `FX_CONTRACT` and a `PAY_TO_ALLOWLIST`:

```bash
NETWORK=stellar:pubnet
FACILITATOR_PRIVATE_KEYS=S...,S...          # funded accounts, see the runbook
FX_CONTRACT=CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD   # Local402's verified FxPay, or your own
PAY_TO_ALLOWLIST=G...                        # the sellers you agreed to settle for
MIN_AMOUNT=100000                            # 0.01 USDC
RPC_URL=https://...                          # a provider with an SLA; the public one is best effort
SETTLE_RATE_LIMIT=10
```

FxPay on mainnet is the release wasm, [verified on stellar.expert](../README.md). Deploying your own
is `scripts/mainnet/deploy-fxpay.sh`; either way, the payer's authorization is pinned to the
`FX_CONTRACT` the seller's 402 names, so a seller and its facilitator must agree on it.

## As a library

The same pieces the command uses:

```ts
import { createFacilitator, facilitatorConfig } from "local402-facilitator";

const config = facilitatorConfig(process.env);
const { app, feePayers, ready } = createFacilitator(config);
app.listen(config.port);
```

`createFacilitator` returns an Express app, so it can be mounted under a path of a larger server, as the
Local402 demo does under `/facilitator`.
