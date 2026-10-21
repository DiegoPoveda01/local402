# Quickstart: a route priced in pesos

`server.ts` sells `GET /weather` for 50 CLP. Each request is converted to USDC with the Reflector
oracle at request time, and any Stellar x402 client can pay it.

Outside this repo:

```sh
npm install
PAY_TO=G... LOCAL402_QUOTE_SECRET=$(openssl rand -hex 32) FACILITATOR_URL=http://localhost:4022 npm start
curl -i http://localhost:4021/weather   # 402, with the CLP quote in extra.local402
```

- `PAY_TO` is your Stellar testnet address, with a USDC trustline.
- `LOCAL402_QUOTE_SECRET` signs the quote. The seller refuses to start without it.
- `FACILITATOR_URL` is any x402 facilitator for Stellar testnet. `npm run facilitator` at the repo root starts one.

Inside this repo, from the root: `npx tsx --tsconfig examples/quickstart/tsconfig.json examples/quickstart/server.ts`.
CI compiles it against the workspace sources on every push.
