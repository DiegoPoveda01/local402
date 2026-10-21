// Mainnet smoke test: asks every paid route of the live demo for its price, without paying, and checks
// the quote against this client's own read of the oracle. No keys: the client's key is random and unfunded.
//
// npx tsx scripts/smoke.ts [https://local402-mainnet.vercel.app]
import { Keypair } from "@stellar/stellar-sdk";
import { Local402Client } from "@local402/client";
import { FX_MAINNET } from "@local402/fx";

const base = (process.argv[2] ?? "https://local402-mainnet.vercel.app").replace(/\/+$/, "");
const client = new Local402Client({ secret: Keypair.random().secret(), network: "stellar:pubnet" });

const catalog = (await (await fetch(`${base}/catalog`)).json()) as { network: string; items: { path: string }[] };
if (catalog.network !== "stellar:pubnet") throw new Error(`${base} runs on ${catalog.network}, not mainnet`);
const paths = [...catalog.items.map((item) => item.path), "/convertir"];

/** Quotes one route and checks it, throwing what is wrong with it. */
async function check(path: string): Promise<string> {
  // An error answer throws RESOURCE_UNAVAILABLE with its status; only a 2xx comes back as free.
  const price = await client.quote(`${base}${path}`);
  if (!price) throw new Error("answered without asking for payment");
  if (price.asset !== FX_MAINNET.usdc.contract) throw new Error(`settles in ${price.asset}, not mainnet USDC`);
  if (!price.local) throw new Error("has no extra.local402 quote");
  // Refuses a quote more than 2% above the client's own oracle rate, or one priced on a stale rate.
  await client.checkPrice(price);
  return `${price.local.amount} ${price.local.currency} = ${price.amount} USDC units  (${price.local.oracleSource})`;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
let failed = 0;
for (const path of paths) {
  try {
    console.log(`ok    ${path}  ${await check(path)}`);
  } catch (error) {
    // A cold start can fail one request. It is logged, and the route only fails if it fails again.
    console.log(`retry ${path}  ${reason(error)}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    try {
      console.log(`ok    ${path}  ${await check(path)}`);
    } catch (again) {
      failed++;
      console.log(`FAIL  ${path}  ${reason(again)}`);
    }
  }
}
console.log(`${paths.length - failed} of ${paths.length} routes quoted correctly`);
process.exitCode = failed ? 1 : 0;
