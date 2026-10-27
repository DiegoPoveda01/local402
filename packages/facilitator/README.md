# local402-facilitator

An [x402](https://x402.org) facilitator for Stellar that you run yourself. It verifies and settles
`exact` payments (USDC and any Stellar token) and `exact-fx` payments (the payer spends XLM or EURC, the
seller receives exact USDC through the FxPay contract), and pays the network fees from its own accounts.

```bash
npx local402-facilitator keys     # two fresh fee-paying testnet accounts, funded, written to .env
npx local402-facilitator check    # config, RPC, balances and FxPay: exits 0 when it can settle
npx local402-facilitator          # listens on :4022
```

Then point a seller at it: `local402Server("http://localhost:4022")` in `local402-server`, or any x402
seller that takes a facilitator URL.

Node 20.12 or later. A `Dockerfile` that installs this package from npm is in the
[repository](https://github.com/DiegoPoveda01/local402/blob/main/packages/facilitator/Dockerfile).

## What a public instance needs

- **A seller allowlist and a minimum amount.** Every settlement spends this instance's XLM.
  `PAY_TO_ALLOWLIST` limits it to the sellers you name; on `stellar:pubnet` it refuses to start without one.
- **`TRUST_PROXY` set to the proxies really in front of it** (0 by default), so the limits count real clients.
- **Separate limits for verify and settle**, per client per minute: verify only simulates, settle spends fees.
- **Its own fee-paying keys.** Two instances sharing an account collide on its sequence number.
- **`/health` for liveness and `/ready` for readiness.** `/ready` answers 503, saying which check failed,
  when the RPC is down, a fee payer is below `MIN_FEE_BALANCE_XLM`, or FxPay is gone from the ledger.

Every variable, the endpoints and the mainnet configuration:
[docs/facilitator.md](https://github.com/DiegoPoveda01/local402/blob/main/docs/facilitator.md).
Keys, funding, top-ups and rotation:
[docs/facilitator-runbook.md](https://github.com/DiegoPoveda01/local402/blob/main/docs/facilitator-runbook.md).

## As a library

```ts
import { createFacilitator, facilitatorConfig } from "local402-facilitator";

const config = facilitatorConfig(process.env); // throws INVALID_CONFIG naming the variable, never a key
const { app } = createFacilitator(config);     // an Express app
app.listen(config.port);
```

MIT
