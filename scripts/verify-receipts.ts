// Checks a receipts CSV against the chain: every row must be its own successful transaction that credits
// `pay_to` with exactly `usdc_received` of Circle's USDC.
//
// npx tsx scripts/verify-receipts.ts [https://local402.xyz/receipts.csv | path/to/receipts.csv]
import { readFileSync } from "node:fs";

const source = process.argv[2] ?? "https://local402.xyz/receipts.csv";
const USDC_ISSUER = { "stellar:testnet": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", "stellar:pubnet": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
const HORIZON = { "stellar:testnet": "https://horizon-testnet.stellar.org", "stellar:pubnet": "https://horizon.stellar.org" };

const text = /^https?:/.test(source) ? await (await fetch(source)).text() : readFileSync(source, "utf8");
// The columns checked here never contain commas, so a plain split is enough.
const [header, ...lines] = text.trim().split(/\r?\n/);
const columns = header.split(",");
const rows = lines.map((line) => Object.fromEntries(line.split(",").map((cell, i) => [columns[i], cell])));

type Effect = { type: string; account?: string; amount?: string; asset_code?: string; asset_issuer?: string };
async function check(row: Record<string, string>): Promise<string | undefined> {
  const network = row.network as keyof typeof HORIZON;
  const base = HORIZON[network];
  if (!base) return `unknown network ${row.network}`;
  const tx = (await (await fetch(`${base}/transactions/${row.transaction}`)).json()) as { successful?: boolean };
  if (!tx.successful) return "transaction not found or failed";
  const { _embedded } = (await (await fetch(`${base}/transactions/${row.transaction}/effects?limit=50`)).json()) as { _embedded: { records: Effect[] } };
  const credits = _embedded.records.filter(
    (e) => e.type === "account_credited" && e.account === row.pay_to && e.asset_code === "USDC" && e.asset_issuer === USDC_ISSUER[network],
  );
  if (credits.length !== 1) return `${credits.length} USDC credits to pay_to`;
  // Horizon writes 7 decimals; the CSV trims trailing zeros.
  if (Number(credits[0].amount) !== Number(row.usdc_received)) return `chain ${credits[0].amount} USDC, CSV ${row.usdc_received}`;
}

const seen = new Set<string>();
let failures = 0;
for (let i = 0; i < rows.length; i += 8) {
  const batch = rows.slice(i, i + 8);
  const results = await Promise.all(batch.map((row) => check(row).catch((error: Error) => error.message)));
  batch.forEach((row, j) => {
    const problem = seen.has(row.transaction) ? "transaction appears twice" : results[j];
    seen.add(row.transaction);
    if (problem) {
      failures++;
      console.log(`${row.id} ${row.transaction}: ${problem}`);
    }
  });
}
console.log(`${rows.length} rows, ${seen.size} transactions, ${failures} mismatches`);
process.exitCode = failures ? 1 : 0;
