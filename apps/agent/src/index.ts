import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const SECRET = process.env.STELLAR_PRIVATE_KEY;
if (!SECRET) {
  throw new Error("STELLAR_PRIVATE_KEY is required. See .env.example");
}
const URL = process.env.RESOURCE_URL ?? "http://localhost:3001/indicadores";

// A stock x402 Stellar client: nothing Local402-specific is needed to pay a local-currency price.
const signer = createEd25519Signer(SECRET, "stellar:testnet");
const client = new x402HTTPClient(new x402Client().register("stellar:*", new ExactStellarScheme(signer)));

const first = await fetch(URL);
if (first.status !== 402) {
  console.log(`No payment required (HTTP ${first.status})`, await first.text());
  process.exit(0);
}

const required = client.getPaymentRequiredResponse((name) => first.headers.get(name), await first.json());
const option = required.accepts[0];
const quote = option.extra?.local402 as { localAmount: string; currency: string; usdPerUnit: string } | undefined;
console.log(
  quote
    ? `Price: ${quote.localAmount} ${quote.currency} -> ${Number(option.amount) / 1e7} USDC (1 ${quote.currency} = ${quote.usdPerUnit} USD)`
    : `Price: ${option.amount} of ${option.asset}`,
);

const payload = await client.createPaymentPayload(required);
const paid = await fetch(URL, { headers: client.encodePaymentSignatureHeader(payload) });
if (!paid.ok) {
  console.error(`Payment failed (HTTP ${paid.status})`, await paid.text());
  process.exit(1);
}

const settlement = client.getPaymentSettleResponse((name) => paid.headers.get(name));
console.log(`Paid. Transaction: https://stellar.expert/explorer/testnet/tx/${settlement.transaction}`);
console.log(JSON.stringify(await paid.json(), null, 2));
