import { Local402Client, type PayAsset } from "@local402/client";

const SECRET = process.env.STELLAR_PRIVATE_KEY;
if (!SECRET) {
  throw new Error("STELLAR_PRIVATE_KEY is required. See .env.example");
}
const URL = process.env.RESOURCE_URL ?? "http://localhost:3001/indicadores";
const payWith = (process.env.PAY_WITH ?? "USDC").toUpperCase() as PayAsset;

// Paying in USDC is a stock x402 Stellar client. Paying in XLM or EURC only swaps in the exact-fx scheme.
const client = new Local402Client({ secret: SECRET, payWith, maxPrice: process.env.MAX_PRICE });

const result = await client.pay(URL);
if ("free" in result) {
  console.log("No payment required", result.body);
  process.exit(0);
}

const { price, spent } = result;
const usdc = Number(price.amount) / 1e7;
console.log(
  price.local
    ? `Price: ${price.local.amount} ${price.local.currency} -> ${usdc} USDC (1 ${price.local.currency} = ${price.local.usdPerUnit} USD)`
    : `Price: ${usdc} USDC`,
);
console.log(`Paid with ${payWith} using scheme "${price.scheme}"${spent ? `: spent ${Number(spent.amount) / 1e7} ${payWith}` : ""}`);
console.log(`Transaction: ${result.explorerUrl}`);
console.log(JSON.stringify(result.body, null, 2));
