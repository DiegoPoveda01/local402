# create-local402

A first paid [x402](https://x402.org) route on Stellar testnet, priced in your currency, in one command.

```bash
npm create local402@latest
```

It asks for a price ("50 CLP", "1.20 EUR", "0.01 UF"…), then:

1. creates three testnet accounts with Friendbot: the seller, a facilitator that pays the network fees, and a buyer;
2. adds the USDC trustline to the seller;
3. writes `local402-app/`, an Express app that sells `GET /hello` at that price, with its own facilitator in the
   same process, and installs it;
4. starts it and pays it twice as the buyer, with USDC (`exact`) and with XLM (`exact-fx`, the seller still
   receives exact USDC), and prints both transaction links.

```text
ok    Friendbot created the seller, facilitator and buyer accounts
ok    seller USDC trustline
ok    npm install
ok    the app answers 402 at http://localhost:4021/hello
ok    quote: 50 CLP in USDC
ok    paid 50 CLP with USDC (exact)
      https://stellar.expert/explorer/testnet/tx/…
ok    paid 50 CLP with XLM (exact-fx)
      https://stellar.expert/explorer/testnet/tx/…
```

Then `cd local402-app && npm start` runs it again. The secrets are testnet keys in `.env`, which is gitignored.

Options: `npm create local402@latest my-shop -- --price "1.20 EUR"`, and `--no-install` to write the files
only. A failure names the step that failed, so you know if it was Friendbot, Horizon or the app.

Node 20.12 or later. Everything runs on testnet; going to mainnet is the
[integration guide](https://github.com/DiegoPoveda01/local402/blob/main/docs/integration-guide.md).

MIT
