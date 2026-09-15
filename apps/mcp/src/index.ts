import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Local402Client, type PayAsset } from "@local402/client";

const SECRET = process.env.STELLAR_PRIVATE_KEY;
if (!SECRET) {
  throw new Error("STELLAR_PRIVATE_KEY is required. See .env.example");
}
const payWith = (process.env.PAY_WITH ?? "USDC").toUpperCase() as PayAsset;
// Without an explicit limit an agent could be talked into paying anything, so default to a small one.
const maxPrice = process.env.MAX_PRICE ?? "500 CLP";
const client = new Local402Client({ secret: SECRET, payWith, maxPrice });

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const failure = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

const server = new McpServer({ name: "local402", version: "0.1.0" });

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
    description: `Fetches an HTTP resource and pays for it on Stellar testnet if it returns 402. Pays with ${payWith}; refuses prices above ${maxPrice}. Returns the response body, the price and the transaction link.`,
    inputSchema: { url: z.string().url() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      return text(await client.pay(url));
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
