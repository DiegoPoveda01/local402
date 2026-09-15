import { execFileSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar } from "@x402/extensions/bazaar";
import { z } from "zod";
import { Local402Client, type PayAsset } from "@local402/client";
import type { LocalQuote } from "@local402/pricing";

// A stellar-cli identity keeps the secret out of MCP config files.
const identity = process.env.STELLAR_IDENTITY;
const SECRET =
  process.env.STELLAR_PRIVATE_KEY ??
  (identity && execFileSync("stellar", ["keys", "secret", identity], { encoding: "utf8" }).trim());
if (!SECRET) {
  throw new Error("Set STELLAR_IDENTITY (a stellar-cli identity) or STELLAR_PRIVATE_KEY. See .env.example");
}
const payWith = (process.env.PAY_WITH ?? "USDC").toUpperCase() as PayAsset;
// Without an explicit limit an agent could be talked into paying anything, so default to a small one.
const maxPrice = process.env.MAX_PRICE ?? "500 CLP";
const clients: Record<PayAsset, Local402Client> = {
  USDC: new Local402Client({ secret: SECRET, payWith: "USDC", maxPrice }),
  XLM: new Local402Client({ secret: SECRET, payWith: "XLM", maxPrice }),
  EURC: new Local402Client({ secret: SECRET, payWith: "EURC", maxPrice }),
};
const client = clients[payWith];
const bazaar = withBazaar(new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL ?? "http://localhost:4022" }));

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const failure = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

const server = new McpServer({ name: "local402", version: "0.1.0" });

server.registerTool(
  "local402_discover",
  {
    title: "Find x402 resources priced in local currency",
    description:
      "Lists paid HTTP resources catalogued by the Local402 facilitator (x402 Bazaar): URL, description, local price (CLP, EUR, UF...), accepted payment assets and an example response. Call local402_quote or local402_pay next.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const { items } = await bazaar.extensions.bazaar.listResources({ type: "http" });
      return text(
        items.map((item) => {
          const quote = item.accepts.find((a) => a.extra?.local402)?.extra?.local402 as LocalQuote | undefined;
          const info = (item.extensions?.bazaar as { info?: { output?: { example?: unknown } } } | undefined)?.info;
          return {
            url: item.resource,
            description: item.description,
            price: quote ? `${quote.localAmount} ${quote.currency}` : undefined,
            payWith: item.accepts.some((a) => a.scheme === "exact-fx") ? ["USDC", "XLM", "EURC"] : ["USDC"],
            exampleResponse: info?.output?.example,
          };
        }),
      );
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "local402_quote",
  {
    title: "Quote an x402 resource",
    description:
      "Shows what an x402 HTTP resource costs without paying: the price in local currency (CLP, EUR...), the USDC amount and the exchange rate used.",
    inputSchema: { url: z.string().url() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      return text((await client.quote(url)) ?? { free: true });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "local402_pay",
  {
    title: "Pay for and fetch an x402 resource",
    description: `Fetches an HTTP resource and pays for it on Stellar testnet if it returns 402. Pays with ${payWith} unless payWith says otherwise (XLM or EURC is swapped to the seller's USDC in the same transaction); refuses prices above ${maxPrice}. Returns the response body, the price and the transaction link.`,
    inputSchema: { url: z.string().url(), payWith: z.enum(["USDC", "XLM", "EURC"]).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ url, payWith: asset }) => {
    try {
      return text(await clients[asset ?? payWith].pay(url));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "local402_wallet",
  {
    title: "Show the paying wallet",
    description: "Shows the agent's Stellar testnet address, balances, payment asset and per-payment limit.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${client.address}`);
      const account = (await response.json()) as { balances?: { asset_type: string; asset_code?: string; balance: string }[] };
      const balances = Object.fromEntries(
        (account.balances ?? []).map((b) => [b.asset_type === "native" ? "XLM" : b.asset_code, b.balance]),
      );
      return text({ address: client.address, network: "stellar:testnet", payWith, maxPrice, balances });
    } catch (error) {
      return failure(error);
    }
  },
);

await server.connect(new StdioServerTransport());
