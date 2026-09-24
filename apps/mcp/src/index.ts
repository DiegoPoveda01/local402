import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar } from "@x402/extensions/bazaar";
import type { Network } from "@x402/core/types";
import { z } from "zod";
import { FXPAY_MAINNET, Local402Client, SpendingBudget, type PayAsset } from "@local402/client";
import type { LocalQuote } from "@local402/pricing";

/**
 * Reads a secret from stellar-cli. An MCP host launches this server without a login shell, so the
 * binary is looked for by every name it ships under and in the directory its installer uses, rather
 * than trusting `PATH` to contain it.
 */
function identitySecret(identity: string): string {
  const local = join(homedir(), ".local", "bin");
  const candidates = ["stellar", "stellar.cmd", "stellar.exe", join(local, "stellar"), join(local, "stellar.exe")];
  const tried: string[] = [];
  for (const binary of candidates) {
    try {
      return execFileSync(binary, ["keys", "secret", identity], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (error) {
      // Only "no such binary" is worth trying the next name for; anything else is stellar-cli answering.
      // EINVAL is Node on Windows refusing to execFile a .cmd without a shell, so it means the same.
      if (!["ENOENT", "EINVAL"].includes((error as { code?: string }).code ?? "")) {
        const detail = String((error as { stderr?: unknown }).stderr ?? "").trim() || (error as Error).message;
        throw new Error(`stellar keys secret ${identity} failed: ${detail.split("\n")[0]}`);
      }
      tried.push(binary);
    }
  }
  throw new Error(
    `stellar-cli not found, so STELLAR_IDENTITY "${identity}" cannot be read. Set STELLAR_PRIVATE_KEY instead, ` +
      `or put the binary on the PATH this server is started with. Tried: ${tried.join(", ")}`,
  );
}

// A stellar-cli identity keeps the secret out of MCP config files.
const identity = process.env.STELLAR_IDENTITY;
const SECRET = process.env.STELLAR_PRIVATE_KEY ?? (identity ? identitySecret(identity) : undefined);
if (!SECRET) {
  throw new Error("Set STELLAR_IDENTITY (a stellar-cli identity) or STELLAR_PRIVATE_KEY. See .env.example");
}

const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
const MAINNET = NETWORK === "stellar:pubnet";
const fxContract = process.env.FX_CONTRACT || (MAINNET ? FXPAY_MAINNET : undefined);
const HORIZON_URL = process.env.HORIZON_URL || (MAINNET ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");

const PAY_ASSETS = ["USDC", "XLM", "EURC"] as const;
const requested = (process.env.PAY_WITH ?? "USDC").toUpperCase();
if (!(PAY_ASSETS as readonly string[]).includes(requested)) {
  throw new Error(`PAY_WITH must be one of ${PAY_ASSETS.join(", ")}, not "${process.env.PAY_WITH}"`);
}
const payWith = requested as PayAsset;
// Without an explicit limit an agent could be talked into paying anything, so default to a small one.
const maxPrice = process.env.MAX_PRICE ?? "500 CLP";
// One budget for the whole session, whatever asset each payment uses.
const budget = new SpendingBudget(process.env.BUDGET ?? "5000 CLP");
const common = { secret: SECRET, network: NETWORK, fxContract, maxPrice, budget };
const clients: Record<PayAsset, Local402Client> = {
  USDC: new Local402Client({ ...common, payWith: "USDC" }),
  XLM: new Local402Client({ ...common, payWith: "XLM" }),
  EURC: new Local402Client({ ...common, payWith: "EURC" }),
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
    description: `Fetches an HTTP resource and pays for it on ${MAINNET ? "Stellar mainnet" : "Stellar testnet"} if it returns 402. Pays with ${payWith} unless payWith says otherwise (XLM or EURC is swapped to the seller's USDC in the same transaction); refuses prices above ${maxPrice} and stops once this session has spent ${budget.limit}. Returns the response body, the price and the transaction link.`,
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
    description: `Shows the agent's ${MAINNET ? "Stellar mainnet" : "Stellar testnet"} address, balances, payment asset, per-payment limit and how much of the session budget is spent.`,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const response = await fetch(`${HORIZON_URL}/accounts/${client.address}`);
      const account = (await response.json()) as { balances?: { asset_type: string; asset_code?: string; balance: string }[] };
      const balances = Object.fromEntries(
        (account.balances ?? []).map((b) => [b.asset_type === "native" ? "XLM" : b.asset_code, b.balance]),
      );
      const sessionBudget = { limit: budget.limit, spentUsdc: (Number(budget.spent) / 1e7).toFixed(7) };
      return text({ address: client.address, network: NETWORK, payWith, maxPrice, budget: sessionBudget, balances });
    } catch (error) {
      return failure(error);
    }
  },
);

await server.connect(new StdioServerTransport());
