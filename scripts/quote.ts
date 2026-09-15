// Live quote from Reflector mainnet: npx tsx scripts/quote.ts "50 CLP"
import { ReflectorFiatOracle, quoteLocalPrice } from "@local402/pricing";

const price = process.argv[2] ?? "50 CLP";
const quote = await quoteLocalPrice(price, { oracle: new ReflectorFiatOracle() });
console.log(JSON.stringify(quote, null, 2));
console.log(`${price} = ${Number(quote.tokenAmount) / 10 ** quote.tokenDecimals} USDC`);
