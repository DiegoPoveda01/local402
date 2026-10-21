# Facilitator runbook

Operating a [`local402-facilitator`](facilitator.md) instance: its keys, how much XLM they need, how to
tell when they run low, and what to do when one leaks. The fees below are from Local402's own mainnet
settlements (see the README's cost table).

## Keys

Each instance has its own set of fee-paying accounts in `FACILITATOR_PRIVATE_KEYS`.

- **One set per instance, never shared.** `ChannelPool` keeps settlements in one process off each other's
  sequence numbers. It cannot see another process: two instances, or two replicas of one deployment, on
  the same account reject each other's transactions. Scaling out means a new set of keys per replica.
- **How many.** One key per settlement that can run at the same time. A settlement takes about 5 to 10
  seconds, so 2 keys handle a few per second; a third waits in a queue. More than 20 is rarely useful.
- **What each one does.** The first key pays the fee bump of every `exact` (plain USDC) settlement. Every
  key, picked in turn, is the source of `exact-fx` settlements and pays their fee. The first key therefore
  spends the most.
- **No trustlines needed.** The accounts only pay fees. They never receive the payments, which go from
  the payer to the seller.
- **Where they live.** In the host's secret store, never in the image or the repository.
  `local402-facilitator keys` writes them to `.env` with mode 600 and prints only public keys.

Making them:

```bash
npx local402-facilitator keys 3                         # testnet: created and funded by friendbot
NETWORK=stellar:pubnet npx local402-facilitator keys 3  # mainnet: created locally, you fund them
```

## Funding

On mainnet an account exists once it receives XLM: send each public key a payment from an exchange or
your treasury. Then `npx local402-facilitator check` shows every balance.

| | XLM |
| --- | --- |
| Base reserve, locked while the account exists | 1 |
| `MIN_FEE_BALANCE_XLM`, the floor where `/ready` turns 503 | 2 (default) |
| A plain USDC settlement (`exact`), paid by the first key | about 0.0024 |
| An `exact-fx` swap with FxPay's entries warm | about 0.0055 |
| The first `exact-fx` swaps after a fresh FxPay deployment | up to 0.081 |
| Ceiling the facilitator accepts for one `exact-fx` settlement | 0.1 resource fee plus at most 0.001 inclusion fee |

A practical start is 10 XLM per key, and more on the first key if most traffic is plain USDC: 7 XLM
above the floor is about 2,900 USDC settlements or 1,270 warm swaps. Fees rise under surge pricing,
since the facilitator bids twice the network's recent p99 inclusion fee, capped at 0.001 XLM.

On testnet friendbot gives each account 10,000 test XLM, which is enough for months.

## Monitoring and top-ups

Point the host's readiness check at `GET /ready`. It answers 503 when:

| Check | Error | Do |
| --- | --- | --- |
| RPC | the RPC's own error, or "RPC reports it is not healthy" | Wait, or switch `RPC_URL` to another provider. |
| A fee payer | "account does not exist: fund it with XLM" | Send it XLM. A new mainnet key does not exist until funded. |
| A fee payer | "below the N XLM minimum: top it up" | Send it XLM. The instance still settles until the account cannot pay, but the host stops routing to it. |
| FxPay | "FxPay contract not found: wrong FX_CONTRACT or its TTL expired" | Check `FX_CONTRACT`; on testnet, run `scripts/extend-ttl.sh`. |

Top up before `/ready` fails, not after: alert on the `xlm` field of each fee payer, at roughly twice
`MIN_FEE_BALANCE_XLM`. A top-up is an ordinary XLM payment to the public key and needs no restart.

## The FxPay TTL

Contract storage on Stellar expires unless someone extends it. When FxPay's instance or code expires,
`exact-fx` stops settling and `/ready` reports it. Anyone can pay for an extension:

```bash
SOURCE=<a funded stellar CLI identity> scripts/extend-ttl.sh   # testnet: FxPay, the SACs, Soroswap and its pairs
```

The script extends by 2,000,000 ledgers, about 115 days. Put it in the calendar well before then. Local402
extends its own testnet deployment; an instance pointing at its own FxPay owns that chore.

## Rotation

Rotate a set of keys on a schedule, or at once if one may have leaked:

1. `NETWORK=... npx local402-facilitator keys 2 --out .env.next` and fund the new public keys.
2. Replace `FACILITATOR_PRIVATE_KEYS` on the host with the new set and redeploy. `SIGTERM` lets
   settlements in flight finish on the old keys.
3. Check `/ready` is 200 on the new keys.
4. Move what is left on the old accounts back to your treasury with an account merge (the Stellar
   Laboratory, or the stellar CLI's `tx new account-merge`). Merging also removes the account, so a
   leaked key holds nothing.

A leaked fee-payer key exposes only that account's XLM: it cannot move payers' or sellers' funds, since
every payment needs the payer's own signature, and the facilitator rejects any transaction that would
move its own funds. Rotation is about the XLM on it and about stopping someone else from settling with
your sequence numbers.

## Mainnet allowlist

On `stellar:pubnet` the instance only settles for the sellers in `PAY_TO_ALLOWLIST` and refuses to start
without it. To add a seller:

1. Agree on the `FX_CONTRACT` both of you use: the payer's authorization is pinned to it.
2. Add the seller's `payTo` address to `PAY_TO_ALLOWLIST` and redeploy.
3. Ask them for one small payment and look up the transaction hash it returns on stellar.expert.

A seller that is not on the list gets `pay_to_not_allowed` from both `/verify` and `/settle`, before
anything is simulated or spent. `MIN_AMOUNT` keeps payments smaller than their own fee away; raise it
if the sellers you serve only charge more.

The minimum counts token units, so it only bounds anything for tokens that are worth something.
`ASSET_ALLOWLIST` defaults to USDC, XLM and EURC on `stellar:pubnet`; a payment in any other token gets
`asset_not_allowed`. If a seller you add is paid in another token, add its contract there too.
