// End-to-end test of local402-mcp on testnet: an MCP client starts the server, discovers a route, quotes it,
// pays it and reads it back from the payment history. The payer is a new Friendbot account paying with XLM,
// so it needs no secrets. PAYMENTS=10 pays that many times; the hashes are printed.
//
// npx tsx scripts/mcp-e2e.ts [https://local402.vercel.app]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Keypair } from "@stellar/stellar-sdk";

const base = (process.argv[2] ?? "https://local402.vercel.app").replace(/\/+$/, "");
const payments = Number(process.env.PAYMENTS ?? 1);
const payer = Keypair.random();

const funded = await fetch(`https://friendbot.stellar.org/?addr=${payer.publicKey()}`);
if (!funded.ok) throw new Error(`Friendbot answered ${funded.status}`);
console.log(`payer ${payer.publicKey()} funded by Friendbot`);

// A cold testnet demo can answer 502 while its facilitator wakes up. Wake it before the agent quotes.
for (let attempt = 1; ; attempt++) {
  const status = (await fetch(`${base}/indicadores`)).status;
  if (status === 402 || attempt === 3) break;
  console.log(`demo answered ${status}, retrying`);
}

const history = join(mkdtempSync(join(tmpdir(), "local402-e2e-")), "history.jsonl");
const client = new Client({ name: "local402-e2e", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "apps/mcp/src/index.ts"],
    env: {
      ...(process.env as Record<string, string>),
      STELLAR_PRIVATE_KEY: payer.secret(),
      STELLAR_IDENTITY: "",
      NETWORK: "stellar:testnet",
      PAY_WITH: "XLM",
      LIMITS: "100 CLP/payment, 1000 CLP/day",
      LOCAL402_HISTORY: history,
    },
  }),
);

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
  return JSON.parse(result.content[0].text) as T;
}

const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
console.log(`tools ${tools.join(", ")}`);

// Discovery filtered by currency and price must still find the 50 CLP route of the testnet demo.
const found = await call<{ url: string; price: string }[]>("local402_discover", { currency: "CLP", maxPrice: "100 CLP" });
const route = found.find((r) => r.url.startsWith(base) && r.url.endsWith("/indicadores"));
if (!route) throw new Error(`local402_discover did not list ${base}/indicadores: ${JSON.stringify(found)}`);
console.log(`discover ${route.url} ${route.price}`);

const quote = await call<{ allowed: boolean; amount: string; refusal?: string }>("local402_quote", { url: route.url });
if (!quote.allowed) throw new Error(`quote refused: ${quote.refusal}`);
console.log(`quote ${quote.amount} USDC units, allowed`);

const hashes: string[] = [];
for (let i = 0; i < payments; i++) {
  const paid = await call<{ receipt: { transaction: string; explorerUrl: string } }>("local402_pay", { url: route.url });
  hashes.push(paid.receipt.transaction);
  console.log(`paid ${paid.receipt.explorerUrl}`);
}

const read = await call<{ payments: { transaction: string }[]; limits: { daily: { spentUsdc: string } } }>("local402_history", { limit: 200 });
const listed = new Set(read.payments.map((p) => p.transaction));
const missing = hashes.filter((hash) => !listed.has(hash));
if (missing.length) throw new Error(`history is missing ${missing.join(", ")}`);
console.log(`history lists all ${hashes.length} payments, ${read.limits.daily.spentUsdc} USDC spent today`);

await client.close();
