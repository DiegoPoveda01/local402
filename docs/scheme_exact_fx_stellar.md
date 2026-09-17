# Scheme: `exact-fx` on Stellar

Status: draft, implemented in `packages/fx` (client, resource server, facilitator) and `contracts/fx-pay`.

## Summary

`exact-fx` settles like `exact`: the resource server receives exactly `amount` of `asset` at `payTo`. The difference is on the payer side, who spends a different asset. A Soroban contract (FxPay) swaps it on Soroswap and delivers the requested amount, all inside the one transaction the facilitator submits.

If the swap would need more than the payer allowed, or cannot deliver exactly `amount`, the transaction reverts and nothing moves.

Use cases:

- An agent holding XLM or EURC pays an API that only wants USDC, without a separate swap step and without the seller changing anything.
- A seller prices in local currency (e.g. `70 NGN` or `5 INR`, see Local402 pricing) while every payer, whatever it holds, is charged the same USDC amount.

## Relation to `exact`

Requirements are the same as `exact` apart from `scheme` and `extra`, so a server can offer both from one price:

```json
"accepts": [
  { "scheme": "exact",    "network": "stellar:pubnet", "asset": "<USDC SAC>", "amount": "524021", "payTo": "G...", "maxTimeoutSeconds": 60 },
  { "scheme": "exact-fx", "network": "stellar:pubnet", "asset": "<USDC SAC>", "amount": "524021", "payTo": "G...", "maxTimeoutSeconds": 60,
    "extra": { "areFeesSponsored": true, "fxContract": "C...", "sendAssets": ["<XLM SAC>", "<EURC SAC>"] } }
]
```

The payload has the same shape as `exact` on Stellar: one signed transaction in `payload.transaction`. Only the invoked function differs.

This could also be written as an `assetTransferMethod` of `exact` rather than a separate scheme, in the style proposed for cross-asset payments on other networks. What stays the same either way: the seller-facing guarantee of `exact`, and the facilitator checks below.

## `PaymentRequirements.extra`

| Field | Type | Description |
| --- | --- | --- |
| `areFeesSponsored` | `true` | The facilitator pays network fees, as in `exact`. Required. |
| `fxContract` | string | FxPay contract address. Clients must only sign for a contract they already trust; it is not taken from the server. |
| `sendAssets` | string[] | SEP-41 token contracts the facilitator accepts as the payer's asset. |

The facilitator advertises these through `/supported`, and the resource server copies them into its requirements.

## Payload

`payload.transaction` is a base64 XDR transaction with exactly one `invokeHostFunction` operation calling:

```
FxPay.pay(from, send_asset, max_send, dest_asset, dest_amount, pay_to, deadline) -> i128
```

- `from`: the payer account.
- `send_asset`: one of `extra.sendAssets`.
- `max_send`: the most `send_asset` the payer allows. Clients quote with `FxPay.quote(send_asset, dest_asset, dest_amount)` and add slippage (reference client: 2%). Unused input is refunded in the same call.
- `dest_asset`, `dest_amount`, `pay_to`: must equal `requirements.asset`, `requirements.amount` and `requirements.payTo`.
- `deadline`: unix seconds, no later than `now + maxTimeoutSeconds`.

The payer signs one Soroban authorization entry: `pay(args)` with a single sub-invocation, `send_asset.transfer(from, fxContract, max_send)`. The transaction source is not the payer's concern; the facilitator rebuilds it with its own account.

## Facilitator verification

A facilitator MUST reject the payload unless all of the following hold:

1. `x402Version` is 2; `scheme` is `exact-fx` in both payload and requirements; networks match and are Stellar.
2. The transaction has exactly one operation, an `invokeHostFunction` of type `invokeContract`.
3. Neither the transaction source nor the operation source is a facilitator account.
4. The call is `pay` on `extra.fxContract`, with 7 arguments.
5. `from` is not a facilitator account; `send_asset` is in `sendAssets`; `dest_asset`, `dest_amount` and `pay_to` match the requirements; `deadline` is in the future and within `maxTimeoutSeconds` (plus a small tolerance).
6. There is exactly one authorization entry, with address credentials for `from`, and its signature expiration is no later than the ledger `maxTimeoutSeconds` from now (plus a small tolerance).
7. The root invocation is `fxContract.pay` with arguments byte-identical to the operation's. It has exactly one sub-invocation, `send_asset.transfer(from, fxContract, max_send)`, and that sub-invocation has none of its own.
8. Simulation succeeds, and the fee (minimum resource fee plus the facilitator's inclusion fee ceiling) is within the facilitator's limit.
9. The simulated events include `asset.transfer(fxContract → payTo, amount)`.
10. No simulated `transfer`, `burn` or `approve` event moves tokens from a facilitator account.
11. The payer's signature is present and no other signature is pending.

Checks 9 and 10 are defense in depth: the authorization tree in 7 already limits what the payer's signature allows.

## Settlement

1. Re-run verification.
2. Rebuild the transaction with a facilitator account as source, the simulated Soroban data and the same host function and authorization. Bid an inclusion fee based on recent network fees, capped. Facilitators with several fee accounts SHOULD give each concurrent settlement its own account.
3. Sign, submit, poll until final.
4. On success, return the transaction hash. The reference facilitator also returns `extra.sendAsset` and `extra.sendAmount`: the send-asset amount the swap used, read from `pay`'s return value.

Error reasons use the prefixes `invalid_exact_fx_payload_*` and `settle_exact_fx_*`.

## Contract behavior (FxPay)

- It picks the cheaper of two Soroswap routes: the direct pool, or a hop through a hub asset (XLM). It fails with `NoRoute` if neither exists.
- It fails with `ExcessiveInput` if the route needs more than `max_send`, before any transfer.
- It pulls `max_send` from `from`, swaps for exactly `dest_amount`, transfers that to `pay_to`, and refunds `max_send - amount_in` to `from`.
- It emits `FxPaid(pay_to, from, send_asset, amount_in, dest_asset, amount_out)`.
- It keeps no balance between calls and has no admin functions.

## Security considerations

- **Pool price risk.** The seller's amount is exact, but the payer pays the pool's price. Clients SHOULD bound `max_send` against an independent oracle, not only against the pool's own quote. The reference client refuses more than 5% above Reflector's rate.
- **Trusted contract.** A client must pin `fxContract`. A malicious contract could spend up to `max_send`.
- **Sandwiching.** Slippage tolerance is what a sandwich attacker can capture. Keep it small; the refund returns everything the swap did not use.
- **Replay.** Soroban authorization nonces and the `deadline` prevent reuse, as with `exact`.

## Reference implementation

- Client: `ExactFxClientScheme` (`packages/fx/src/client.ts`)
- Resource server: `ExactFxServerScheme` (`packages/fx/src/server.ts`)
- Facilitator: `ExactFxFacilitatorScheme` (`packages/fx/src/facilitator.ts`)
- Contract and tests: `contracts/fx-pay`
